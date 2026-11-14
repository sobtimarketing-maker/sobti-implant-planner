// Tooth outline with an estimated root (Session 4).
//
// Root dentin and the bone around it have nearly the same density on CBCT,
// so a threshold cannot follow roots reliably (tested on the clinic's scan:
// it either stops at the neck or runs into bone). Instead:
// 1. Crown: in a lightly smoothed (3×3×3 mean) local box, 3D region grow
//    above the outline level on an eroded mask, then grown back one voxel,
//    so a thin contact point does not join two crowns. Each slice is filled
//    to its convex outline (the dentin core inside the enamel shell).
// 2. Root: a tapered shape from the crown's neck outline to the root tip.
//    The tip defaults to a typical root length for that tooth straight down
//    (lower) or up (upper); the user can tap the real tip to move it.
// Slices run along the volume's slice axis (the scan's axial direction).
import { Vec3, Volume, voxelToWorld, worldToVoxel } from '../volume/volume';
import { cropMask, Mask } from './regionGrow';

export interface ToothOptions {
  /** Which jaw the tooth is in (from its FDI number). */
  jaw: 'upper' | 'lower';
  /** Root length to use when no tip is given, mm. */
  rootMm: number;
  /** Root tip (world mm), if the user has set it. */
  apex?: Vec3 | null;
  /** Leave the root off. */
  crownOnly?: boolean;
}

export interface ToothResult { mask: Mask; apex: Vec3; neck: Vec3; /** The crown reached the size limit: it may touch the next tooth. */ wide: boolean }

/** Typical root length by FDI number, mm. */
export function rootLength(fdi: number): number {
  return [0, 12.5, 13, 16, 14, 14, 13, 13, 11][fdi % 10] ?? 13;
}

export function jawOf(fdi: number): 'upper' | 'lower' { const q = Math.floor(fdi / 10); return q === 1 || q === 2 || q === 5 || q === 6 ? 'upper' : 'lower'; }

export function toothGrow(vol: Volume, seed: Vec3, level: number, o: ToothOptions): ToothResult | null {
  const [nx, ny, nz] = vol.dims;
  const [sx, sy, sz] = vol.spacing;
  const s = worldToVoxel(vol, seed).map(Math.round);
  if (s[0] < 0 || s[1] < 0 || s[2] < 0 || s[0] >= nx || s[1] >= ny || s[2] >= nz) return null;
  // k direction towards the root (upper roots point superior, +z in LPS).
  const dir = (o.jaw === 'upper' ? 1 : -1) * Math.sign(vol.normal[2] || 1);
  const reach = Math.max(o.rootMm, o.apex ? Math.abs(o.apex[2] - seed[2]) : 0) + 14;
  const hr = Math.round(9 / sx), hc = Math.round(9 / sy);
  const i0 = Math.max(0, s[0] - hr), i1 = Math.min(nx - 1, s[0] + hr);
  const j0 = Math.max(0, s[1] - hc), j1 = Math.min(ny - 1, s[1] + hc);
  const kRoot = s[2] + dir * Math.round(reach / sz), kOcc = s[2] - dir * Math.round(12 / sz);
  const k0 = Math.max(0, Math.min(kRoot, kOcc)), k1 = Math.min(nz - 1, Math.max(kRoot, kOcc));
  const mx = i1 - i0 + 1, my = j1 - j0 + 1, mz = k1 - k0 + 1;
  const plane = mx * my, N = plane * mz;
  const L = smooth(vol, i0, j0, k0, mx, my, mz);
  const si = s[0] - i0, sj = s[1] - j0, sk = s[2] - k0;
  const seedIdx = si + mx * (sj + my * sk);
  if (L[seedIdx] < level && vol.data[s[0] + nx * (s[1] + ny * s[2])] < level) return null;

  // ---- 1. crown (within ±12 mm along the slices around the tap)
  const ck = Math.round(12 / sz);
  const ka = Math.max(0, sk - ck), kb = Math.min(mz - 1, sk + ck);
  const thr = new Uint8Array(N);
  // Limit the crown to a 6.5 mm radius around the tap (the widest molar
  // crown is about 11 mm), so a splinted or touching neighbour stays out.
  const R = 6.5 / sx, R2 = R * R;
  for (let k = ka; k <= kb; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
    const m = i + mx * j;
    thr[m + plane * k] = L[m + plane * k] >= level && (i - si) ** 2 + ((j - sj) * sy / sx) ** 2 <= R2 ? 1 : 0;
  }
  thr[seedIdx] = 1;
  const ER = Math.max(1, Math.round(0.3 / sx)); // erosion depth in voxels
  let eroded: Uint8Array<ArrayBuffer> = thr;
  for (let e = 0; e < ER; e++) eroded = erode3(eroded, mx, my, mz);
  const out = new Uint8Array(N);
  const stack = new Int32Array(N);
  let start = eroded[seedIdx] ? seedIdx : -1;
  if (start < 0) {
    const r = Math.round(1 / sx); let bd = Infinity;
    for (let dk = -r; dk <= r; dk++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = si + di, j = sj + dj, k = sk + dk;
      if (i < 0 || j < 0 || k < 0 || i >= mx || j >= my || k >= mz) continue;
      const q = i + mx * (j + my * k), dd = di * di + dj * dj + dk * dk;
      if (eroded[q] && dd < bd) { bd = dd; start = q; }
    }
  }
  if (start >= 0) {
    flood3(eroded, start, out, mx, my, mz, stack);
    let grown: Uint8Array<ArrayBuffer> = out;
    for (let e = 0; e < ER; e++) { grown = dilate3(grown, mx, my, mz); for (let m = 0; m < N; m++) grown[m] &= thr[m]; }
    out.set(grown);
  } else flood3(thr, seedIdx, out, mx, my, mz, stack);
  const area = new Float64Array(mz);
  for (let k = 0; k < mz; k++) {
    const sl = out.subarray(plane * k, plane * (k + 1));
    let any = 0; for (let m = 0; m < plane; m++) any |= sl[m];
    if (any) { hullFill(sl, mx, my); area[k] = count(sl); }
  }

  // ---- 2. neck: the last slice towards the root still at least 40% of the
  // widest crown slice.
  let wide = false;
  for (let k = 0; k < mz && !wide; k++) for (let j = 0; j < my && !wide; j++) for (let i = 0; i < mx; i++) {
    if (out[i + mx * (j + my * k)] && (i - si) ** 2 + ((j - sj) * sy / sx) ** 2 > (R - 1.5) ** 2) { wide = true; break; }
  }
  let kMax = 0;
  for (let k = 0; k < mz; k++) if (area[k] > area[kMax]) kMax = k;
  let kNeck = kMax;
  for (let k = kMax; k >= 0 && k < mz; k += dir) { if (area[k] >= area[kMax] * 0.4) kNeck = k; else break; }
  const base = out.slice(plane * kNeck, plane * (kNeck + 1));
  let bx = 0, by = 0, bn = 0;
  for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) if (base[i + mx * j]) { bx += i; by += j; bn++; }
  bx /= bn; by /= bn;
  const neck = voxelToWorld(vol, bx + i0, by + j0, kNeck + k0);
  // Remove crown voxels past the neck towards the root (thin cervical bits);
  // the root shape replaces them.
  for (let k = kNeck + dir; k >= 0 && k < mz; k += dir) out.fill(0, plane * k, plane * (k + 1));
  let apex: Vec3;
  if (o.apex) apex = o.apex;
  else {
    const ax = dir * Math.sign(vol.normal[2] || 1); // world z sign of the root direction
    apex = [neck[0], neck[1], neck[2] + ax * o.rootMm];
  }
  if (!o.crownOnly) {
    const av = worldToVoxel(vol, apex);
    const aI = av[0] - i0, aJ = av[1] - j0, aK = Math.max(0, Math.min(mz - 1, Math.round(av[2] - k0)));
    const span = aK - kNeck;
    if (Math.abs(span) >= 2) {
      const step = Math.sign(span);
      for (let k = kNeck + step; k !== aK + step; k += step) {
        const t = (k - kNeck) / span;
        const sc = 0.9 * Math.pow(1 - t, 0.75) + 0.04;   // taper, 90% of the neck at the start
        const cx = bx + (aI - bx) * t, cy = by + (aJ - by) * t;
        for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
          const u = Math.round(bx + (i - cx) / sc), w = Math.round(by + (j - cy) / sc);
          if (u >= 0 && w >= 0 && u < mx && w < my && base[u + mx * w]) out[i + mx * (j + my * k)] = 1;
        }
      }
    }
  }
  let total = 0;
  for (let m = 0; m < N; m++) total += out[m];
  return {
    mask: cropMask({
      origin: voxelToWorld(vol, i0, j0, k0), spacing: [sx, sy, sz], dims: [mx, my, mz],
      rowDir: vol.rowDir, colDir: vol.colDir, normal: vol.normal, data: out, count: total,
    }),
    apex, neck, wide,
  };
}

/** 3×3×3 mean of a box of the volume (edges clamp). */
function smooth(vol: Volume, i0: number, j0: number, k0: number, mx: number, my: number, mz: number): Float32Array {
  const [nx, ny, nz] = vol.dims, d = vol.data;
  const at = (i: number, j: number, k: number) => d[Math.max(0, Math.min(nx - 1, i)) + nx * (Math.max(0, Math.min(ny - 1, j)) + ny * Math.max(0, Math.min(nz - 1, k)))];
  // Separable: x, then y, then z.
  const a = new Float32Array(mx * my * mz), b = new Float32Array(mx * my * mz);
  // x pass reads the volume, over a slab one voxel wider in y and z is not
  // needed because later passes clamp within the box.
  for (let k = 0; k < mz; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
    const I = i + i0, J = j + j0, K = k + k0;
    a[i + mx * (j + my * k)] = (at(I - 1, J, K) + at(I, J, K) + at(I + 1, J, K)) / 3;
  }
  const P = mx * my;
  for (let k = 0; k < mz; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++) {
    const m = i + mx * (j + my * k);
    b[m] = (a[j > 0 ? m - mx : m] + a[m] + a[j < my - 1 ? m + mx : m]) / 3;
  }
  for (let k = 0; k < mz; k++) for (let m0 = 0; m0 < P; m0++) {
    const m = m0 + P * k;
    a[m] = (b[k > 0 ? m - P : m] + b[m] + b[k < mz - 1 ? m + P : m]) / 3;
  }
  return a;
}

function count(a: Uint8Array): number { let c = 0; for (let i = 0; i < a.length; i++) c += a[i]; return c; }

function erode3(a: Uint8Array, w: number, h: number, d: number): Uint8Array<ArrayBuffer> {
  const o = new Uint8Array(a.length), P = w * h;
  for (let k = 1; k < d - 1; k++) for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
    const m = i + w * (j + h * k);
    o[m] = a[m] & a[m - 1] & a[m + 1] & a[m - w] & a[m + w] & a[m - P] & a[m + P];
  }
  return o;
}

function dilate3(a: Uint8Array, w: number, h: number, d: number): Uint8Array<ArrayBuffer> {
  const o = new Uint8Array(a.length), P = w * h;
  for (let k = 0; k < d; k++) for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const m = i + w * (j + h * k);
    if (!a[m]) continue;
    o[m] = 1;
    if (i > 0) o[m - 1] = 1; if (i < w - 1) o[m + 1] = 1;
    if (j > 0) o[m - w] = 1; if (j < h - 1) o[m + w] = 1;
    if (k > 0) o[m - P] = 1; if (k < d - 1) o[m + P] = 1;
  }
  return o;
}

function flood3(a: Uint8Array, start: number, out: Uint8Array, w: number, h: number, d: number, stack: Int32Array): void {
  const P = w * h;
  let sp = 0;
  out[start] = 1; stack[sp++] = start;
  const push = (q: number) => { if (a[q] && !out[q]) { out[q] = 1; stack[sp++] = q; } };
  while (sp) {
    const m = stack[--sp];
    const i = m % w, j = Math.floor(m / w) % h, k = Math.floor(m / P);
    if (i > 0) push(m - 1); if (i < w - 1) push(m + 1);
    if (j > 0) push(m - w); if (j < h - 1) push(m + w);
    if (k > 0) push(m - P); if (k < d - 1) push(m + P);
  }
}

/** Fill a slice to the convex hull of its pixels (monotone chain). */
function hullFill(a: Uint8Array, w: number, h: number): void {
  const pts: number[] = [];
  for (let y = 0; y < h; y++) {
    let x0 = -1, x1 = -1;
    for (let x = 0; x < w; x++) if (a[x + w * y]) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 >= 0) { pts.push(x0, y); if (x1 !== x0) pts.push(x1, y); }
  }
  const n = pts.length / 2;
  if (n < 3) return;
  const idx = Array.from({ length: n }, (_, i) => i).sort((p, q) => pts[2 * p] - pts[2 * q] || pts[2 * p + 1] - pts[2 * q + 1]);
  const crossZ = (o: number, p: number, q: number) => (pts[2 * p] - pts[2 * o]) * (pts[2 * q + 1] - pts[2 * o + 1]) - (pts[2 * p + 1] - pts[2 * o + 1]) * (pts[2 * q] - pts[2 * o]);
  const lower: number[] = [], upper: number[] = [];
  for (const i of idx) { while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop(); lower.push(i); }
  for (let t = idx.length - 1; t >= 0; t--) { const i = idx[t]; while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop(); upper.push(i); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 3) return;
  let ymin = Infinity, ymax = -Infinity;
  for (const i of hull) { ymin = Math.min(ymin, pts[2 * i + 1]); ymax = Math.max(ymax, pts[2 * i + 1]); }
  for (let y = ymin; y <= ymax; y++) {
    // Intersect the row with the hull edges.
    let xl = Infinity, xr = -Infinity;
    for (let e = 0; e < hull.length; e++) {
      const p = hull[e], q = hull[(e + 1) % hull.length];
      const y0 = pts[2 * p + 1], y1 = pts[2 * q + 1], x0 = pts[2 * p], x1 = pts[2 * q];
      if ((y < Math.min(y0, y1)) || (y > Math.max(y0, y1))) continue;
      if (y0 === y1) { xl = Math.min(xl, x0, x1); xr = Math.max(xr, x0, x1); continue; }
      const x = x0 + ((y - y0) * (x1 - x0)) / (y1 - y0);
      xl = Math.min(xl, x); xr = Math.max(xr, x);
    }
    for (let x = Math.ceil(xl - 1e-6); x <= Math.floor(xr + 1e-6); x++) if (x >= 0 && x < w) a[x + w * y] = 1;
  }
}
