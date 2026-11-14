// Axis-aligned MPR on the working volume (CPU, typed arrays).
// Display conventions (radiological): axial seen from the feet, patient right
// on screen left, anterior at top; coronal and sagittal with superior at top.
// Assumes axial acquisition (IOP ~ [1 0 0 0 1 0]); other orientations are
// shown in voxel order and flagged by the loader.
import type { Volume } from '../core/volume/volume';

export type ViewKind = 'axial' | 'coronal' | 'sagittal';

export interface SliceImage {
  w: number;
  h: number;
  pxW: number; // mm per pixel horizontally
  pxH: number; // mm per pixel vertically
  data: Int16Array;
}

export function sliceCount(v: Volume, kind: ViewKind): number {
  return kind === 'axial' ? v.dims[2] : kind === 'coronal' ? v.dims[1] : v.dims[0];
}

/** Slice index for a view given a voxel cursor [i, j, k]. */
export function sliceIndex(kind: ViewKind, c: [number, number, number]): number {
  return kind === 'axial' ? c[2] : kind === 'coronal' ? c[1] : c[0];
}

export function extractSlice(v: Volume, kind: ViewKind, index: number, out?: Int16Array): SliceImage {
  const [nx, ny, nz] = v.dims;
  const d = v.data;
  if (kind === 'axial') {
    const k = clamp(index, 0, nz - 1);
    const n = nx * ny;
    const data = out && out.length === n ? out : new Int16Array(n);
    data.set(d.subarray(k * n, (k + 1) * n));
    return { w: nx, h: ny, pxW: v.spacing[0], pxH: v.spacing[1], data };
  }
  if (kind === 'coronal') {
    const j = clamp(index, 0, ny - 1);
    const n = nx * nz;
    const data = out && out.length === n ? out : new Int16Array(n);
    for (let y = 0; y < nz; y++) {
      const k = nz - 1 - y;
      const src = nx * (j + ny * k);
      data.set(d.subarray(src, src + nx), y * nx);
    }
    return { w: nx, h: nz, pxW: v.spacing[0], pxH: v.spacing[2], data };
  }
  const i = clamp(index, 0, nx - 1);
  const n = ny * nz;
  const data = out && out.length === n ? out : new Int16Array(n);
  for (let y = 0; y < nz; y++) {
    const k = nz - 1 - y;
    const base = i + nx * ny * k;
    const row = y * ny;
    for (let j = 0; j < ny; j++) data[row + j] = d[base + nx * j];
  }
  return { w: ny, h: nz, pxW: v.spacing[1], pxH: v.spacing[2], data };
}

/** Map an image pixel (x, y) in a view back to voxel coordinates. */
export function pixelToVoxel(v: Volume, kind: ViewKind, index: number, x: number, y: number): [number, number, number] {
  const nz = v.dims[2];
  if (kind === 'axial') return [x, y, index];
  if (kind === 'coronal') return [x, index, nz - 1 - y];
  return [index, x, nz - 1 - y];
}

/** Voxel cursor to image pixel in a view. */
export function voxelToPixel(v: Volume, kind: ViewKind, c: [number, number, number]): [number, number] {
  const nz = v.dims[2];
  if (kind === 'axial') return [c[0], c[1]];
  if (kind === 'coronal') return [c[0], nz - 1 - c[2]];
  return [c[1], nz - 1 - c[2]];
}

/** Orientation letters [left, right, top, bottom] for each view. */
export const ORIENT: Record<ViewKind, [string, string, string, string]> = {
  axial: ['R', 'L', 'A', 'P'],
  coronal: ['R', 'L', 'S', 'I'],
  sagittal: ['A', 'P', 'S', 'I'],
};

export class WindowLut {
  private lut = new Uint32Array(65536);
  private key = '';
  constructor() { this.set(400, 2000); }

  set(wc: number, ww: number): void {
    const key = `${wc}|${ww}`;
    if (key === this.key) return;
    this.key = key;
    const lo = wc - ww / 2;
    const lut = this.lut;
    for (let hu = -32768; hu < 32768; hu++) {
      let g = ((hu - lo) / ww) * 255;
      g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
      lut[hu + 32768] = 0xff000000 | (g << 16) | (g << 8) | g; // ABGR little-endian
    }
  }

  apply(src: Int16Array, dst: Uint32Array): void {
    const lut = this.lut;
    for (let i = 0; i < src.length; i++) dst[i] = lut[src[i] + 32768];
  }
}

export const WINDOW_PRESETS = [
  { id: 'bone', label: 'Bone', wc: 600, ww: 2600 },
  { id: 'dense', label: 'Teeth', wc: 1400, ww: 3000 },
  { id: 'soft', label: 'Soft tissue', wc: 40, ww: 600 },
  { id: 'implant', label: 'High contrast', wc: 300, ww: 1400 },
] as const;

/** Auto window from the volume histogram (P1 to P99.5 of voxels above air). */
export function autoWindow(v: Volume): { wc: number; ww: number } {
  const d = v.data;
  const hist = new Uint32Array(4096);
  const step = Math.max(1, Math.floor(d.length / 2_000_000));
  let n = 0;
  for (let i = 0; i < d.length; i += step) {
    const x = d[i];
    if (x < -500) continue;
    hist[Math.min(4095, Math.max(0, (x + 1024) >> 3))]++;
    n++;
  }
  if (!n) return { wc: 400, ww: 2000 };
  const pick = (q: number) => {
    let acc = 0;
    for (let b = 0; b < 4096; b++) { acc += hist[b]; if (acc >= q * n) return b * 8 - 1024; }
    return 32767;
  };
  const lo = pick(0.01), hi = pick(0.995);
  return { wc: Math.round((lo + hi) / 2), ww: Math.max(200, Math.round(hi - lo)) };
}

function clamp(x: number, a: number, b: number): number { return x < a ? a : x > b ? b : x; }
