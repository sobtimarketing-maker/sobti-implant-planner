// Ray against a triangle mesh (Möller–Trumbore), brute force: about 10 ms for
// 300K triangles, fine for a tap. The ray is given in world mm; `model` maps
// mesh coordinates to world (rigid).
import type { Vec3 } from '../volume/volume';
import { apply, inverseRigid, M4 } from '../register/rigid';
import type { TriMesh } from './mesh';

export function rayMesh(m: TriMesh, ro: Vec3, rd: Vec3, model?: M4): number {
  let o = ro, d = rd;
  if (model) {
    const inv = inverseRigid(model);
    o = apply(inv, ro);
    const e = apply(inv, [ro[0] + rd[0], ro[1] + rd[1], ro[2] + rd[2]]);
    d = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
  }
  const p = m.positions, ix = m.indices;
  let best = Infinity;
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) continue;
    const inv = 1 / det;
    const tx = o[0] - p[a], ty = o[1] - p[a + 1], tz = o[2] - p[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist > 0 && dist < best) best = dist;
  }
  return best; // in units of |rd| (rd is unit in world; rigid keeps lengths)
}

/** Line segments where a mesh crosses a plane (world mm), for slice outlines. */
export function planeSegments(m: TriMesh, model: M4 | null, origin: Vec3, n: Vec3, out: number[] = []): number[] {
  const p = m.positions, ix = m.indices;
  // Signed distance per vertex (after the model transform).
  const nv = p.length / 3;
  const sd = new Float32Array(nv);
  const w = new Float32Array(p.length);
  for (let i = 0; i < nv; i++) {
    const q = model ? apply(model, [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]) : [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
    w[i * 3] = q[0]; w[i * 3 + 1] = q[1]; w[i * 3 + 2] = q[2];
    sd[i] = (q[0] - origin[0]) * n[0] + (q[1] - origin[1]) * n[1] + (q[2] - origin[2]) * n[2];
  }
  for (let t = 0; t < ix.length; t += 3) {
    const v = [ix[t], ix[t + 1], ix[t + 2]];
    const pts: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3];
      const da = sd[a], db = sd[b];
      if ((da > 0) === (db > 0)) continue;
      const f = da / (da - db);
      pts.push(w[a * 3] + (w[b * 3] - w[a * 3]) * f, w[a * 3 + 1] + (w[b * 3 + 1] - w[a * 3 + 1]) * f, w[a * 3 + 2] + (w[b * 3 + 2] - w[a * 3 + 2]) * f);
    }
    if (pts.length === 6) out.push(...pts);
  }
  return out;
}

/** Vertex colours from distances: green within ±good, to yellow, to red at bad. */
export function distanceColors(dist: Float32Array, good = 0.3, bad = 1.0): Uint8Array {
  const c = new Uint8Array(dist.length * 3);
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i];
    let r: number, g: number, b: number;
    if (!Number.isFinite(d)) { r = 150; g = 160; b = 175; }          // no CBCT surface nearby (gum)
    else if (d <= good) { r = 70; g = 200; b = 120; }
    else { const f = Math.min(1, (d - good) / (bad - good)); r = Math.round(240 * f + 230 * (1 - f)); g = Math.round(70 * f + 200 * (1 - f)); b = Math.round(60 * f + 80 * (1 - f)); }
    c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
  }
  return c;
}
