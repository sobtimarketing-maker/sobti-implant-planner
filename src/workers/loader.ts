// CBCT loading pipeline (runs inside a worker; also callable directly in tests).
// Pass 1 reads only the header of each slice; pass 2 streams pixels in sorted
// order into the downsampling builder.
import { isZip, listEntries, readEntry, ZipEntry } from '../core/io/zip';
import { parseDicom, T, UNCOMPRESSED_TS } from '../core/dicom/parser';
import { assembleSeries, readSliceHeader, readStudyMeta, Series, SliceHeader, StudyMeta } from '../core/volume/series';
import { VolumeBuilder } from '../core/volume/builder';
import { chooseFactor, Tier } from '../core/volume/budget';
import { Volume } from '../core/volume/volume';

export interface LoadOptions {
  tier: Tier;
  ramGb: number;
  max3d?: number;
  onProgress?: (p: LoadProgress) => void;
}

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
