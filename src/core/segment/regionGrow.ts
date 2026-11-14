// Threshold + region grow from a seed (manual-first segmentation), on the
// grid of the finest volume that contains the seed, inside a bounding box.
import { Vec3, Volume, voxelToWorld, worldToVoxel } from '../volume/volume';

export interface Mask {
  origin: Vec3;         // world of voxel (0,0,0)
  spacing: Vec3;
  dims: Vec3;
  rowDir: Vec3; colDir: Vec3; normal: Vec3;
  data: Uint8Array;     // 1 = inside
  count: number;
}

export function regionGrow(vol: Volume, seed: Vec3, threshold: number, boxMm: Vec3 = [14, 14, 30]): Mask | null {
  const [si, sj, sk] = worldToVoxel(vol, seed).map(Math.round);
  const [nx, ny, nz] = vol.dims;
  if (si < 0 || sj < 0 || sk < 0 || si >= nx || sj >= ny || sk >= nz) return null;
  if (vol.data[si + nx * (sj + ny * sk)] < threshold) return null;
  const half = boxMm.map((m, a) => Math.round(m / vol.spacing[a] / 2));
  const i0 = Math.max(0, si - half[0]), i1 = Math.min(nx - 1, si + half[0]);
  const j0 = Math.max(0, sj - half[1]), j1 = Math.min(ny - 1, sj + half[1]);
  const k0 = Math.max(0, sk - half[2]), k1 = Math.min(nz - 1, sk + half[2]);
  const mx = i1 - i0 + 1, my = j1 - j0 + 1, mz = k1 - k0 + 1;
  const mask = new Uint8Array(mx * my * mz);
  const stack = new Int32Array(mx * my * mz);
  let sp = 0, count = 0;
  const push = (i: number, j: number, k: number) => {
    const m = (i - i0) + mx * ((j - j0) + my * (k - k0));
    if (mask[m]) return;
    if (vol.data[i + nx * (j + ny * k)] < threshold) { return; }
    mask[m] = 1; count++;
    stack[sp++] = m;
  };
  push(si, sj, sk);
  while (sp > 0) {
    const m = stack[--sp];
    const i = (m % mx) + i0, j = (Math.floor(m / mx) % my) + j0, k = Math.floor(m / (mx * my)) + k0;
    if (i > i0) push(i - 1, j, k);
    if (i < i1) push(i + 1, j, k);
    if (j > j0) push(i, j - 1, k);
    if (j < j1) push(i, j + 1, k);
    if (k > k0) push(i, j, k - 1);
    if (k < k1) push(i, j, k + 1);
  }
  return {
    origin: voxelToWorld(vol, i0, j0, k0), spacing: [...vol.spacing] as Vec3, dims: [mx, my, mz],
    rowDir: vol.rowDir, colDir: vol.colDir, normal: vol.normal, data: mask, count,
  };
}

export function maskAt(m: Mask, p: Vec3): number {
  const d: Vec3 = [p[0] - m.origin[0], p[1] - m.origin[1], p[2] - m.origin[2]];
  const i = Math.round((d[0] * m.rowDir[0] + d[1] * m.rowDir[1] + d[2] * m.rowDir[2]) / m.spacing[0]);
  const j = Math.round((d[0] * m.colDir[0] + d[1] * m.colDir[1] + d[2] * m.colDir[2]) / m.spacing[1]);
  const k = Math.round((d[0] * m.normal[0] + d[1] * m.normal[1] + d[2] * m.normal[2]) / m.spacing[2]);
  if (i < 0 || j < 0 || k < 0 || i >= m.dims[0] || j >= m.dims[1] || k >= m.dims[2]) return 0;
  return m.data[i + m.dims[0] * (j + m.dims[1] * k)];
}

export function maskVolumeMm3(m: Mask): number { return m.count * m.spacing[0] * m.spacing[1] * m.spacing[2]; }

// Compact storage for the case file: bit-packed, base64.
export function packMask(m: Mask): Omit<Mask, 'data'> & { bits: string } {
  const bytes = new Uint8Array(Math.ceil(m.data.length / 8));
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const { data: _d, ...rest } = m;
  void _d;
  return { ...rest, bits: btoa(s) };
}

export function unpackMask(p: Omit<Mask, 'data'> & { bits: string }): Mask {
  const s = atob(p.bits);
  const n = p.dims[0] * p.dims[1] * p.dims[2];
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  const { bits: _b, ...rest } = p;
  void _b;
  return { ...rest, data };
}
