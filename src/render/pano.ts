// Panoramic (curved) reformat and cross-sections along the arch.
// The arch lies in an axial plane. Arch samples run from patient right to
// patient left; the normal N points buccal (outward); pano rows run from the
// top of the volume (superior) downward.
import { catmullRom, resample, SampledCurve } from '../core/geometry/curve';
import type { Vec3, Volume } from '../core/volume/volume';
import { volumeCenter } from './oblique';

export interface PanoGeom {
  curve: SampledCurve;
  normal: Vec3[];    // buccal, unit, in the axial plane
  zTop: number;
  px: number;        // mm per pano pixel (both axes)
  w: number;
  h: number;
}

export function archGeometry(points: Vec3[], base: Volume, px: number): PanoGeom | null {
  if (points.length < 3) return null;
  let pts = points.slice();
  if (pts[0][0] > pts[pts.length - 1][0]) pts = pts.reverse(); // run R -> L (x increases to patient left)
  const curve = resample(catmullRom(pts), px);
  // Buccal normal = tangent × (0,0,1), flattened to the axial plane. For an
  // R->L arch this points anterior at the incisors and outward at the molars.
  const normal = curve.tan.map((t): Vec3 => { const n: Vec3 = [t[1], -t[0], 0]; const l = Math.hypot(n[0], n[1]) || 1; return [n[0] / l, n[1] / l, 0]; });
  // Make sure normal points away from the arch's centroid (buccal).
  const c = curve.pos.reduce((a, p) => [a[0] + p[0], a[1] + p[1], 0] as Vec3, [0, 0, 0] as Vec3).map((x) => x / curve.pos.length);
  const mid = Math.floor(curve.pos.length / 2);
  const out = (curve.pos[mid][0] - c[0]) * normal[mid][0] + (curve.pos[mid][1] - c[1]) * normal[mid][1];
  if (out < 0) normal.forEach((n) => { n[0] = -n[0]; n[1] = -n[1]; });
  const vc = volumeCenter(base);
  const zExtent = base.dims[2] * base.spacing[2];
  const zTop = vc[2] + zExtent / 2;
  return { curve, normal, zTop, px, w: curve.pos.length, h: Math.round(zExtent / px) };
}

export function panoToWorld(g: PanoGeom, x: number, y: number, depth = 0): Vec3 {
  const i = Math.max(0, Math.min(g.w - 1, Math.round(x)));
  const p = g.curve.pos[i], n = g.normal[i];
  return [p[0] + n[0] * depth, p[1] + n[1] * depth, g.zTop - y * g.px];
}

/** World point to pano (x, y) and its buccal depth from the curve. */
export function worldToPano(g: PanoGeom, p: Vec3): { x: number; y: number; depth: number } {
  let best = 0, bd = Infinity;
  for (let i = 0; i < g.w; i++) {
    const q = g.curve.pos[i];
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  const q = g.curve.pos[best], n = g.normal[best];
  return { x: best, y: (g.zTop - p[2]) / g.px, depth: (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1] };
}

/** Mean of samples across the slab (thickness mm, centred on the curve). */
export function renderPano(vols: Volume[], g: PanoGeom, slabMm: number, out: Int16Array, sample: (vols: Volume[], p: Vec3) => number): void {
  const steps = Math.max(1, Math.round(slabMm / Math.max(g.px, 0.3)));
  const d0 = -slabMm / 2, dd = steps > 1 ? slabMm / (steps - 1) : 0;
  for (let x = 0; x < g.w; x++) {
    const p = g.curve.pos[x], n = g.normal[x];
    for (let y = 0; y < g.h; y++) {
      const z = g.zTop - y * g.px;
      let acc = 0;
      for (let s = 0; s < steps; s++) {
        const d = steps > 1 ? d0 + s * dd : 0;
        acc += sample(vols, [p[0] + n[0] * d, p[1] + n[1] * d, z]);
      }
      out[y * g.w + x] = Math.round(acc / steps);
    }
  }
}

/**
 * Cross-section plane at arch sample i: screen right = lingual (-N),
 * screen down = inferior, normal = along the arch.
 */
export function crossSectionPlane(g: PanoGeom, i: number): { center: Vec3; u: Vec3; v: Vec3; n: Vec3 } {
  const k = Math.max(0, Math.min(g.w - 1, i));
  const N = g.normal[k];
  const u: Vec3 = [-N[0], -N[1], 0];
  const v: Vec3 = [0, 0, -1];
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return { center: g.curve.pos[k], u, v, n };
}

/** Fast nearest-neighbour sampler on one volume (for the panoramic slab). */
export function nearestSampler(v: Volume): (vols: Volume[], p: Vec3) => number {
  const [nx, ny, nz] = v.dims;
  const o = v.origin, r = v.rowDir, c = v.colDir, n = v.normal;
  const sx = 1 / v.spacing[0], sy = 1 / v.spacing[1], sz = 1 / v.spacing[2];
  const d = v.data;
  return (_vols, p) => {
    const a = p[0] - o[0], b = p[1] - o[1], e = p[2] - o[2];
    const i = Math.round((a * r[0] + b * r[1] + e * r[2]) * sx);
    const j = Math.round((a * c[0] + b * c[1] + e * c[2]) * sy);
    const k = Math.round((a * n[0] + b * n[1] + e * n[2]) * sz);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1000;
    return d[i + nx * (j + ny * k)];
  };
}
