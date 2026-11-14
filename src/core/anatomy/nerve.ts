// Mandibular canal: user points (world mm) with a radius each, turned into a
// smooth tube. Points are kept in path order: a new point is inserted where it
// lengthens the path least, so tapping order does not matter.
import { catmullRom, dist } from '../geometry/curve';
import type { Vec3 } from '../volume/volume';

export interface NervePoint { p: Vec3; r: number }
export interface Nerve { id: string; side: 'R' | 'L'; points: NervePoint[]; foramen?: Vec3 }

export const DEFAULT_NERVE_RADIUS = 1.2; // mm (canal about 2.4 mm across)

export function insertPoint(n: Nerve, pt: NervePoint): void {
  const ps = n.points;
  if (ps.length < 2) { ps.push(pt); return; }
  let best = 0, bestCost = Infinity;
  for (let i = 0; i <= ps.length; i++) {
    let cost: number;
    if (i === 0) cost = dist(pt.p, ps[0].p);
    else if (i === ps.length) cost = dist(ps[ps.length - 1].p, pt.p);
    else cost = dist(ps[i - 1].p, pt.p) + dist(pt.p, ps[i].p) - dist(ps[i - 1].p, ps[i].p);
    if (cost < bestCost) { bestCost = cost; best = i; }
  }
  ps.splice(best, 0, pt);
}

/** Dense centreline with interpolated radius (about 0.25 mm spacing). */
export function nerveTube(n: Nerve): { p: Vec3; r: number }[] {
  if (n.points.length < 2) return n.points.map((x) => ({ ...x }));
  const out: { p: Vec3; r: number }[] = [];
  const centre = catmullRom(n.points.map((x) => x.p), 24);
  const per = 24;
  for (let i = 0; i < centre.length; i++) {
    const seg = Math.min(n.points.length - 2, Math.floor(i / per));
    const f = Math.min(1, (i - seg * per) / per);
    out.push({ p: centre[i], r: n.points[seg].r + (n.points[seg + 1].r - n.points[seg].r) * f });
  }
  return out;
}

/** Shortest distance from a world point to the nerve tube surface (negative = inside). */
export function distanceToNerve(n: Nerve, q: Vec3): number {
  const t = nerveTube(n);
  let best = Infinity;
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i].p, b = t[i + 1].p;
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-9;
    const f = Math.max(0, Math.min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1] + (q[2] - a[2]) * ab[2]) / l2));
    const c: Vec3 = [a[0] + ab[0] * f, a[1] + ab[1] * f, a[2] + ab[2] * f];
    const r = t[i].r + (t[i + 1].r - t[i].r) * f;
    best = Math.min(best, dist(c, q) - r);
  }
  return best;
}

/**
 * Snap a tap to the darkest spot (canal lumen) nearby in a 2D image:
 * minimum 3×3 mean within radiusPx; only moves if clearly darker.
 */
export function snapToCanal(img: Int16Array, w: number, h: number, x: number, y: number, radiusPx: number): [number, number] {
  const mean = (cx: number, cy: number) => {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = cx + dx, yy = cy + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += img[yy * w + xx]; n++;
    }
    return n ? s / n : 0;
  };
  const x0 = Math.round(x), y0 = Math.round(y);
  const here = mean(x0, y0);
  let bx = x0, by = y0, bv = here;
  const r = Math.max(1, Math.round(radiusPx));
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r) continue;
    const v = mean(x0 + dx, y0 + dy);
    if (v < bv) { bv = v; bx = x0 + dx; by = y0 + dy; }
  }
  return here - bv > 80 ? [bx, by] : [x0, y0];
}
