// Arch and nerve curves: centripetal Catmull-Rom through user points, then
// resampled at equal arc length. All points in LPS mm.
import type { Vec3 } from '../volume/volume';

export interface SampledCurve {
  step: number;          // mm between samples
  length: number;        // total arc length, mm
  pos: Vec3[];
  tan: Vec3[];           // unit tangent
}

export function catmullRom(points: Vec3[], perSeg = 16): Vec3[] {
  if (points.length < 2) return points.slice();
  const p = [extrap(points[1], points[0]), ...points, extrap(points[points.length - 2], points[points.length - 1])];
  const out: Vec3[] = [];
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const t0 = 0;
    const t1 = t0 + Math.sqrt(dist(p0, p1)) + 1e-6;
    const t2 = t1 + Math.sqrt(dist(p1, p2)) + 1e-6;
    const t3 = t2 + Math.sqrt(dist(p2, p3)) + 1e-6;
    for (let s = 0; s < perSeg; s++) {
      const t = t1 + ((t2 - t1) * s) / perSeg;
      const a1 = lerpT(p0, p1, t0, t1, t), a2 = lerpT(p1, p2, t1, t2, t), a3 = lerpT(p2, p3, t2, t3, t);
      const b1 = lerpT(a1, a2, t0, t2, t), b2 = lerpT(a2, a3, t1, t3, t);
      out.push(lerpT(b1, b2, t1, t2, t));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function resample(poly: Vec3[], step: number): SampledCurve {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + dist(poly[i - 1], poly[i]));
  const length = cum[cum.length - 1];
  const n = Math.max(2, Math.floor(length / step) + 1);
  const pos: Vec3[] = [];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const s = Math.min(length, k * step);
    while (seg < poly.length - 1 && cum[seg] < s) seg++;
    const a = poly[seg - 1], b = poly[seg];
    const f = (s - cum[seg - 1]) / Math.max(1e-9, cum[seg] - cum[seg - 1]);
    pos.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
  }
  const tan: Vec3[] = pos.map((_, k) => {
    const a = pos[Math.max(0, k - 1)], b = pos[Math.min(n - 1, k + 1)];
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...d) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  });
  return { step, length, pos, tan };
}

/** Closest sample index to p, measured in the xy plane (for an axial arch). */
export function nearestIndexXY(c: SampledCurve, p: Vec3): { index: number; dist: number } {
  let best = 0, bd = Infinity;
  for (let i = 0; i < c.pos.length; i++) {
    const d = (c.pos[i][0] - p[0]) ** 2 + (c.pos[i][1] - p[1]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { index: best, dist: Math.sqrt(bd) };
}

export function dist(a: Vec3, b: Vec3): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function extrap(a: Vec3, b: Vec3): Vec3 { return [2 * b[0] - a[0], 2 * b[1] - a[1], 2 * b[2] - a[2]]; }
function lerpT(a: Vec3, b: Vec3, ta: number, tb: number, t: number): Vec3 {
  const f = (t - ta) / (tb - ta);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
