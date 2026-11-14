// Simple triangle meshes for the 3D view, in world mm.
import type { Vec3 } from '../../core/volume/volume';
import type { SurfaceMesh } from './engine';

/** Unit sphere (radius 1 at the origin). */
export function sphereMesh(rings = 10, segs = 16): SurfaceMesh {
  const pos: number[] = [], idx: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const th = (r / rings) * Math.PI;
    for (let s = 0; s <= segs; s++) {
      const ph = (s / segs) * Math.PI * 2;
      pos.push(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th));
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < segs; s++) {
    const a = r * (segs + 1) + s, b = a + segs + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Tube along a centreline with a radius per point, closed at both ends. */
export function tubeMesh(pts: { p: Vec3; r: number }[], sides = 12): SurfaceMesh {
  const n = pts.length;
  if (n < 2) return { positions: new Float32Array(0), indices: new Uint32Array(0) };
  const pos: number[] = [], idx: number[] = [];
  let prevU: Vec3 | null = null;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)].p, b = pts[Math.min(n - 1, i + 1)].p;
    let t: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const tl = Math.hypot(...t) || 1; t = [t[0] / tl, t[1] / tl, t[2] / tl];
    // A side vector kept steady along the tube (parallel transport).
    let u: Vec3 = prevU ?? (Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
    const d = u[0] * t[0] + u[1] * t[1] + u[2] * t[2];
    u = [u[0] - d * t[0], u[1] - d * t[1], u[2] - d * t[2]];
    const ul = Math.hypot(...u) || 1; u = [u[0] / ul, u[1] / ul, u[2] / ul];
    prevU = u;
    const w: Vec3 = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    const { p, r } = pts[i];
    for (let s = 0; s < sides; s++) {
      const ang = (s / sides) * Math.PI * 2, c = Math.cos(ang) * r, sn = Math.sin(ang) * r;
      pos.push(p[0] + u[0] * c + w[0] * sn, p[1] + u[1] * c + w[1] * sn, p[2] + u[2] * c + w[2] * sn);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) {
    const a = i * sides + s, b = i * sides + ((s + 1) % sides), c = a + sides, d = b + sides;
    idx.push(a, c, b, b, c, d);
  }
  // End caps.
  for (const [ring, centre] of [[0, pts[0].p], [n - 1, pts[n - 1].p]] as [number, Vec3][]) {
    const ci = pos.length / 3;
    pos.push(...centre);
    for (let s = 0; s < sides; s++) idx.push(ci, ring * sides + s, ring * sides + ((s + 1) % sides));
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
