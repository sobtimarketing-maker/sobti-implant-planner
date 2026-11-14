// CBCT loading pipeline (runs inside a worker; also callable directly in tests).
// Pass 1 reads only the header of each slice; pass 2 streams pixels in sorted
// order into the downsampling builder.
import { isZip, listEntries, readEntry, ZipEntry } from '../core/io/zip';
import { parseDicom, T, UNCOMPRESSED_TS } from '../core/dicom/parser';
import { assembleSeries, readSliceHeader, readStudyMeta, Series, SliceHeader, StudyMeta } from '../core/volume/series';
import { slicePixels, VolumeBuilder } from '../core/volume/builder';
import { chooseFactor, Tier } from '../core/volume/budget';
import { dot, Vec3, Volume } from '../core/volume/volume';

export interface LoadOptions {
  tier: Tier;
  ramGb: number;
  max3d?: number;
  onProgress?: (p: LoadProgress) => void;
  /** Receives the open source so full-resolution regions can be read later. */
  keep?: (src: CbctSource) => void;
}

/** An opened scan: file readers plus the sorted series. Lives in the worker. */
export interface CbctSource { sources: Source[]; series: Series }

export interface LoadProgress {
  phase: 'scan' | 'headers' | 'pixels' | 'done';
  done: number;
  total: number;
  message: string;
}

export interface LoadResult {
  volume: Volume;
  meta: StudyMeta;
  seriesUid: string;
  sliceCount: number;
  warnings: string[];
  sourceName: string;
  ms: number;
}

interface Source {
  name: string;
  read(maxBytes?: number): Promise<Uint8Array>;
}

async function enumerate(files: File[]): Promise<Source[]> {
  const out: Source[] = [];
  for (const f of files) {
    if (await isZip(f)) {
      const entries = await listEntries(f);
      for (const e of entries) {
        if (e.isDirectory || e.size < 132) continue;
        const base = e.name.split('/').pop() ?? '';
        if (/\.(txt|xml|html?|jpe?g|png|pdf|exe|dll|ini|inf)$/i.test(base)) continue;
        out.push({ name: e.name, read: (m?: number) => readEntry(f, e as ZipEntry, m) });
      }
    } else {
      out.push({ name: f.name, read: async (m?: number) => new Uint8Array(await (m ? f.slice(0, m) : f).arrayBuffer()) });
    }
  }
  return out;
}

export async function loadCbct(files: File[], opts: LoadOptions): Promise<LoadResult> {
  const t0 = performance.now();
  const report = opts.onProgress ?? (() => {});
  report({ phase: 'scan', done: 0, total: 1, message: 'Reading file list' });
  const sources = await enumerate(files);
  if (!sources.length) throw new Error('No files found.');

  // Pass 1: headers.
  const headers: SliceHeader[] = [];
  let meta: StudyMeta | undefined;
  const PREFIX = 16 * 1024;
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const idx = next++;
      try {
        let bytes = await sources[idx].read(PREFIX);
        let ds = parseDicom(bytes, { stopAtPixelData: true });
        if (ds.truncated && bytes.length === PREFIX) {
          bytes = await sources[idx].read(512 * 1024);
          ds = parseDicom(bytes, { stopAtPixelData: true });
        }
        const h = readSliceHeader(ds, idx);
        if (h && ds.has(T.PixelData)) {
          headers.push(h);
          if (!meta) meta = readStudyMeta(ds);
        }
      } catch { /* not DICOM: skip */ }
      if (idx % 20 === 0) report({ phase: 'headers', done: idx, total: sources.length, message: 'Checking slices' });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (!headers.length) throw new Error('No DICOM images found in the selection.');

  const all = assembleSeries(headers);
  const series: Series = all[0];
  const warnings = [...series.warnings];
  if (all.length > 1) warnings.push(`${all.length} image series found; opened the largest (${series.slices.length} slices).`);
  if (!UNCOMPRESSED_TS.has(series.slices[0].transferSyntax)) throw new Error(warnings[0]);
  if (series.slices.length < 10) throw new Error('This looks like a single image, not a CBCT volume.');

  const dims: [number, number, number] = [series.cols, series.rows, series.slices.length];
  const minSpacing = Math.min(...series.spacing);
  const f = chooseFactor(opts.tier, dims, minSpacing, opts.ramGb, opts.max3d);
  const builder = new VolumeBuilder(series, f);

  // Pass 2: pixels, read ahead a few slices but consume in order.
  const total = series.slices.length;
  const AHEAD = 6;
  const pending: Promise<Uint8Array>[] = [];
  const fetchSlice = (n: number) => sources[series.slices[n].source].read();
  for (let n = 0; n < Math.min(AHEAD, total); n++) pending.push(fetchSlice(n));
  for (let n = 0; n < total; n++) {
    const bytes = await pending[n];
    delete pending[n];
    if (n + AHEAD < total) pending[n + AHEAD] = fetchSlice(n + AHEAD);
    const ds = parseDicom(bytes, { stopAtPixelData: true });
    const px = ds.elements.get(T.PixelData);
    if (!px || px.length < 0) throw new Error('Slice without readable pixel data.');
    builder.addSlice(series.slices[n], bytes.subarray(px.offset, px.offset + px.length));
    if (n % 8 === 0) report({ phase: 'pixels', done: n, total, message: 'Building working volume' });
  }
  const volume = builder.finish();
  opts.keep?.({ sources, series });
  report({ phase: 'done', done: total, total, message: 'Ready' });
  return {
    volume,
    meta: meta ?? {},
    seriesUid: series.uid,
    sliceCount: total,
    warnings,
    sourceName: files.length === 1 ? files[0].name : `${files.length} files`,
    ms: performance.now() - t0,
  };
}

/**
 * Read a full-resolution region of interest (spec section 2): a box of
 * sizeMm centred on a world point, cropped from the source slices on disk.
 */
export async function loadRoi(src: CbctSource, center: Vec3, sizeMm: Vec3, onProgress?: (p: LoadProgress) => void): Promise<Volume> {
  const s = src.series;
  const sp = s.spacing;
  const d: Vec3 = [center[0] - s.origin[0], center[1] - s.origin[1], center[2] - s.origin[2]];
  const ci = dot(d, s.rowDir) / sp[0], cj = dot(d, s.colDir) / sp[1], ck = dot(d, s.normal) / sp[2];
  const half = (mm: number, spc: number) => Math.round(mm / spc / 2);
  const range = (c: number, hw: number, n: number): [number, number] => {
    let a = Math.round(c) - hw, b = Math.round(c) + hw;
    if (a < 0) { b -= a; a = 0; }
    if (b > n - 1) { a -= b - (n - 1); b = n - 1; }
    return [Math.max(0, a), b];
  };
  const [i0, i1] = range(ci, half(sizeMm[0], sp[0]), s.cols);
  const [j0, j1] = range(cj, half(sizeMm[1], sp[1]), s.rows);
  const [k0, k1] = range(ck, half(sizeMm[2], sp[2]), s.slices.length);
  const nx = i1 - i0 + 1, ny = j1 - j0 + 1, nz = k1 - k0 + 1;
  const data = new Int16Array(nx * ny * nz);
  for (let k = k0; k <= k1; k++) {
    const h = s.slices[k];
    const bytes = await src.sources[h.source].read();
    const ds = parseDicom(bytes, { stopAtPixelData: true });
    const px = ds.elements.get(T.PixelData);
    if (!px || px.length < 0) throw new Error('Slice without readable pixel data.');
    const vals = slicePixels(h, bytes.subarray(px.offset, px.offset + px.length));
    const base = (k - k0) * nx * ny;
    for (let j = j0; j <= j1; j++) {
      const row = j * h.cols, out = base + (j - j0) * nx;
      for (let i = i0; i <= i1; i++) {
        const v = vals[row + i] * h.slope + h.intercept;
        data[out + i - i0] = v < -32768 ? -32768 : v > 32767 ? 32767 : Math.round(v);
      }
    }
    if ((k - k0) % 8 === 0) onProgress?.({ phase: 'pixels', done: k - k0, total: nz, message: 'Reading full detail' });
  }
  const o = s.origin;
  const at = (a: number, b: number, c: number): Vec3 => [
    o[0] + a * sp[0] * s.rowDir[0] + b * sp[1] * s.colDir[0] + c * sp[2] * s.normal[0],
    o[1] + a * sp[0] * s.rowDir[1] + b * sp[1] * s.colDir[1] + c * sp[2] * s.normal[1],
    o[2] + a * sp[0] * s.rowDir[2] + b * sp[1] * s.colDir[2] + c * sp[2] * s.normal[2],
  ];
  return {
    dims: [nx, ny, nz], spacing: [...sp] as Vec3, origin: at(i0, j0, k0),
    rowDir: s.rowDir, colDir: s.colDir, normal: s.normal, factor: 1,
    sourceDims: [s.cols, s.rows, s.slices.length], sourceSpacing: sp, data,
  };
}
