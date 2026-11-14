// Trimmed ICP: refine a rigid fit of scan points onto CBCT surface points.
// Nearest neighbours through a uniform hash grid (1 mm cells).
import type { Vec3, Volume } from '../volume/volume';
import { voxelToWorld } from '../volume/volume';
import { apply, fitRigid, M4, mul, rotateAbout, topEigenvector, translate } from './rigid';

export class PointGrid {
  private cells = new Map<number, number[]>();
  constructor(readonly pts: Float32Array, private cell = 1) {
    for (let i = 0; i < pts.length / 3; i++) {
      const k = this.key(Math.floor(pts[i * 3] / cell), Math.floor(pts[i * 3 + 1] / cell), Math.floor(pts[i * 3 + 2] / cell));
      let c = this.cells.get(k); if (!c) { c = []; this.cells.set(k, c); } c.push(i);
    }
  }
  private key(x: number, y: number, z: number) { return (x + 2048) + (y + 2048) * 4096 + (z + 2048) * 16777216; }
  get size() { return this.pts.length / 3; }
  /** Nearest point within maxDist (mm); returns index or -1. */
  nearest(p: Vec3, maxDist: number): { i: number; d: number } {
    const c = this.cell, r = Math.ceil(maxDist / c);
    const cx = Math.floor(p[0] / c), cy = Math.floor(p[1] / c), cz = Math.floor(p[2] / c);
    let best = -1, bd = maxDist * maxDist;
    for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const list = this.cells.get(this.key(cx + dx, cy + dy, cz + dz));
      if (!list) continue;
      for (const i of list) {
        const ex = this.pts[i * 3] - p[0], ey = this.pts[i * 3 + 1] - p[1], ez = this.pts[i * 3 + 2] - p[2];
        const d = ex * ex + ey * ey + ez * ez;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return { i: best, d: Math.sqrt(bd) };
  }
  private _n: Float32Array | null = null;
  /** Surface normals (unit, sign-free) from the spread of neighbours within `r` mm. */
  normals(r = 1.6): Float32Array {
    if (this._n) return this._n;
    const P = this.pts, n = new Float32Array(P.length), c = this.cell, cr = Math.ceil(r / c), r2 = r * r;
    for (let i = 0; i < P.length / 3; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c);
      let k = 0, sx = 0, sy = 0, sz = 0, xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
      for (let dz = -cr; dz <= cr; dz++) for (let dy = -cr; dy <= cr; dy++) for (let dx = -cr; dx <= cr; dx++) {
        const list = this.cells.get(this.key(cx + dx, cy + dy, cz + dz));
        if (!list) continue;
        for (const j of list) {
          const ex = P[j * 3] - x, ey = P[j * 3 + 1] - y, ez = P[j * 3 + 2] - z;
          if (ex * ex + ey * ey + ez * ez > r2) continue;
          k++; sx += ex; sy += ey; sz += ez; xx += ex * ex; xy += ex * ey; xz += ex * ez; yy += ey * ey; yz += ey * ez; zz += ez * ez;
        }
      }
      if (k < 4) continue; // left as zero: no reliable normal
      const mx = sx / k, my = sy / k, mz = sz / k;
      const C = [[xx / k - mx * mx, xy / k - mx * my, xz / k - mx * mz], [0, yy / k - my * my, yz / k - my * mz], [0, 0, zz / k - mz * mz]];
      C[1][0] = C[0][1]; C[2][0] = C[0][2]; C[2][1] = C[1][2];
      const t = C[0][0] + C[1][1] + C[2][2] + 1e-6;
      // Smallest eigenvector of C = largest of (t·I − C).
      const e = topEigenvector([[t - C[0][0], -C[0][1], -C[0][2], 0], [-C[1][0], t - C[1][1], -C[1][2], 0], [-C[2][0], -C[2][1], t - C[2][2], 0], [0, 0, 0, -1]]);
      const l = Math.hypot(e[0], e[1], e[2]) || 1;
      n[i * 3] = e[0] / l; n[i * 3 + 1] = e[1] / l; n[i * 3 + 2] = e[2] / l;
    }
    return (this._n = n);
  }
}

/** Solve a small dense system (Gauss with partial pivoting); null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** One point-to-plane step: small rotation + translation that best slides points onto the planes. */
function planeStep(pairs: { s: Vec3; t: Vec3; n: Vec3 }[]): M4 | null {
  const A = Array.from({ length: 6 }, () => new Array(6).fill(0)), b = new Array(6).fill(0);
  for (const { s, t, n } of pairs) {
    const a = [s[1] * n[2] - s[2] * n[1], s[2] * n[0] - s[0] * n[2], s[0] * n[1] - s[1] * n[0], n[0], n[1], n[2]];
    const r = (t[0] - s[0]) * n[0] + (t[1] - s[1]) * n[1] + (t[2] - s[2]) * n[2];
    for (let i = 0; i < 6; i++) { b[i] += a[i] * r; for (let j = 0; j < 6; j++) A[i][j] += a[i] * a[j]; }
  }
  for (let i = 0; i < 6; i++) A[i][i] += 1e-6 * pairs.length; // keeps flat stretches solvable
  const x = solve(A, b);
  if (!x) return null;
  const ang = Math.hypot(x[0], x[1], x[2]);
  const R = ang > 1e-12 ? rotateAbout([x[0] / ang, x[1] / ang, x[2] / ang], ang * 180 / Math.PI, [0, 0, 0]) : translate([0, 0, 0]);
  return mul(translate([x[3], x[4], x[5]]), R);
}

/**
 * CBCT tooth surface points: voxels at or above `iso` with a neighbour below
 * it, close (2 voxels) to something tooth-bright (≥ `tooth`), optionally only
 * within `radius` mm of given centres.
 */
export function toothSurfacePoints(v: Volume, iso: number, tooth: number, centres?: Vec3[], radius = 12): Float32Array {
  const [nx, ny, nz] = v.dims, d = v.data;
  const out: number[] = [];
  const r2 = radius * radius;
  for (let k = 2; k < nz - 2; k++) for (let j = 2; j < ny - 2; j++) for (let i = 2; i < nx - 2; i++) {
    const m = i + nx * (j + ny * k);
    if (d[m] < iso) continue;
    if (d[m - 1] >= iso && d[m + 1] >= iso && d[m - nx] >= iso && d[m + nx] >= iso && d[m - nx * ny] >= iso && d[m + nx * ny] >= iso) continue;
    let bright = false;
    for (let dk = -2; dk <= 2 && !bright; dk++) for (let dj = -2; dj <= 2 && !bright; dj++) for (let di = -2; di <= 2; di++) if (d[m + di + nx * (dj + ny * dk)] >= tooth) { bright = true; break; }
    if (!bright) continue;
    const p = voxelToWorld(v, i, j, k);
    if (centres && !centres.some((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2 < r2)) continue;
    out.push(p[0], p[1], p[2]);
  }
  return new Float32Array(out);
}

export interface IcpResult { m: M4; rms: number; inliers: number; iterations: number }

/**
 * Refine m (scan -> world) so the scan points sit on the target surface.
 * Each round keeps the closest `keep` share of pairs within maxDist.
 */
export function icp(src: Vec3[], target: PointGrid, m0: M4, o: { iterations?: number; maxDist?: number; keep?: number } = {}): IcpResult {
  const iters = o.iterations ?? 30, keep = o.keep ?? 0.8;
  let maxDist = o.maxDist ?? 2;
  let m = m0.slice(), rms = Infinity, inl = 0, it = 0;
  for (; it < iters; it++) {
    const pairs: { s: Vec3; t: Vec3; d: number; i: number }[] = [];
    for (const s of src) {
      const w = apply(m, s);
      const n = target.nearest(w, maxDist);
      if (n.i < 0) continue;
      const tp = target.pts;
      pairs.push({ s: w, t: [tp[n.i * 3], tp[n.i * 3 + 1], tp[n.i * 3 + 2]], d: n.d, i: n.i });
    }
    if (pairs.length < 10) break;
    pairs.sort((a, b) => a.d - b.d);
    const use = pairs.slice(0, Math.max(10, Math.floor(pairs.length * keep)));
    // Point-to-plane where the target has normals (slides along the surface, so it
    // converges in far fewer rounds); point-to-point as the fallback.
    const N = target.normals();
    const withN = use.filter((p) => p.i >= 0 && (N[p.i * 3] || N[p.i * 3 + 1] || N[p.i * 3 + 2]));
    const delta = (withN.length >= 10 ? planeStep(withN.map((p) => ({ s: p.s, t: p.t, n: [N[p.i * 3], N[p.i * 3 + 1], N[p.i * 3 + 2]] as Vec3 }))) : null)
      ?? fitRigid(use.map((p) => p.s), use.map((p) => p.t));
    m = mul(delta, m);
    const nr = Math.sqrt(use.reduce((a, p) => a + p.d * p.d, 0) / use.length);
    inl = use.length;
    const done = Math.abs(rms - nr) < 1e-4;
    rms = nr;
    maxDist = Math.max(0.6, Math.min(maxDist, rms * 3));
    if (done) break;
  }
  // Final rms with the final transform.
  let s2 = 0, n = 0;
  const ds: number[] = [];
  for (const s of src) { const r = target.nearest(apply(m, s), 1.5); if (r.i >= 0) ds.push(r.d); }
  ds.sort((a, b) => a - b);
  for (const d of ds.slice(0, Math.floor(ds.length * keep))) { s2 += d * d; n++; }
  return { m, rms: n ? Math.sqrt(s2 / n) : rms, inliers: inl, iterations: it };
}
