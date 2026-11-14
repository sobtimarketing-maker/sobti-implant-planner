// Virtual extraction on a mouth scan: pick a tooth, cut it out of the mesh
// and close the hole with a smooth gum surface. Works in the scan's own mm.
import type { Vec3 } from '../volume/volume';
import type { TriMesh } from './mesh';

export interface ToothPick {
  /** Tapped point on the tooth (scan mm). */
  seed: Vec3;
  /** Unit axis towards the opposing jaw (scan frame). */
  o: Vec3;
  /** Largest distance from the seed across the tooth (mm), measured flat. */
  radius: number;
}

/** Vertex neighbours as compressed rows. */
function neighbours(m: TriMesh): { start: Uint32Array; list: Uint32Array } {
  const n = m.positions.length / 3, I = m.indices, count = new Uint32Array(n + 1);
  for (let t = 0; t < I.length; t++) count[I[t] + 1] += 2;
  for (let i = 0; i < n; i++) count[i + 1] += count[i];
  const list = new Uint32Array(count[n]), fill = count.slice(0, n);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    list[fill[a]++] = b; list[fill[a]++] = c; list[fill[b]++] = a; list[fill[b]++] = c; list[fill[c]++] = a; list[fill[c]++] = b;
  }
  return { start: count, list };
}

/**
 * Vertices of the tooth under the seed: grown across the mesh from the
 * nearest vertex, staying within the radius (measured across the jaw) and on
 * vertices `isTooth` accepts. Without a test, everything up to 7 mm below the
 * seed counts as tooth.
 */
export function selectTooth(m: TriMesh, pick: ToothPick, isTooth?: (i: number) => boolean): Uint8Array {
  const P = m.positions, n = P.length / 3, sel = new Uint8Array(n);
  const { seed, o, radius } = pick;
  let start = -1, bd = Infinity;
  for (let i = 0; i < n; i++) { const d = (P[i * 3] - seed[0]) ** 2 + (P[i * 3 + 1] - seed[1]) ** 2 + (P[i * 3 + 2] - seed[2]) ** 2; if (d < bd) { bd = d; start = i; } }
  if (start < 0 || bd > 4) return sel;
  const seedH = seed[0] * o[0] + seed[1] * o[1] + seed[2] * o[2];
  const ok = (i: number) => {
    const dx = P[i * 3] - seed[0], dy = P[i * 3 + 1] - seed[1], dz = P[i * 3 + 2] - seed[2];
    const along = dx * o[0] + dy * o[1] + dz * o[2];
    const fx = dx - along * o[0], fy = dy - along * o[1], fz = dz - along * o[2];
    if (fx * fx + fy * fy + fz * fz > radius * radius) return false;
    const hgt = P[i * 3] * o[0] + P[i * 3 + 1] * o[1] + P[i * 3 + 2] * o[2];
    if (hgt < seedH - 12) return false;
    return isTooth ? isTooth(i) : hgt > seedH - 7;
  };
  const { start: st, list } = neighbours(m);
  const queue = [start]; sel[start] = 1;
  while (queue.length) {
    const v = queue.pop()!;
    for (let k = st[v]; k < st[v + 1]; k++) { const w = list[k]; if (!sel[w] && ok(w)) { sel[w] = 1; queue.push(w); } }
  }
  // Close pinholes: take in vertices whose neighbours are mostly taken.
  for (let pass = 0; pass < 2; pass++) {
    const add: number[] = [];
    for (let v = 0; v < n; v++) {
      if (sel[v]) continue;
      let k = 0, t = 0;
      for (let j = st[v]; j < st[v + 1]; j++) { t++; if (sel[list[j]]) k++; }
      if (t && k / t > 0.6) add.push(v);
    }
    for (const v of add) sel[v] = 1;
  }
  return sel;
}

/** Cut the selected vertices out and close each hole with a gently sagging gum surface. */
export function removeAndFill(m: TriMesh, sel: Uint8Array, o: Vec3, sag = 0.4): TriMesh {
  const P = m.positions, I = m.indices;
  const kept: number[] = [], removedEdges = new Map<string, [number, number]>();
  const ek = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (sel[a] || sel[b] || sel[c]) {
      for (const [x, y] of [[a, b], [b, c], [c, a]]) removedEdges.set(ek(x, y), [x, y]);
    } else kept.push(a, b, c);
  }
  // Hole rim: edges of kept triangles that a removed triangle also used.
  // Walk them in the kept triangles' direction, reversed, so the fill faces the same way.
  const next = new Map<number, number>();
  for (let t = 0; t < kept.length; t += 3) {
    const tri = [kept[t], kept[t + 1], kept[t + 2]];
    for (let e = 0; e < 3; e++) {
      const x = tri[e], y = tri[(e + 1) % 3];
      if (removedEdges.has(ek(x, y))) next.set(y, x);
    }
  }
  const loops: number[][] = [], seen = new Set<number>();
  for (const s0 of next.keys()) {
    if (seen.has(s0)) continue;
    const loop: number[] = [];
    let v: number | undefined = s0;
    while (v !== undefined && !seen.has(v)) { seen.add(v); loop.push(v); v = next.get(v); }
    if (v === s0 && loop.length >= 3) loops.push(loop);
  }
  const pos = Array.from(P), idx = kept.slice();
  const H = (i: number) => pos[i * 3] * o[0] + pos[i * 3 + 1] * o[1] + pos[i * 3 + 2] * o[2];
  for (const loop of loops) {
    const N = loop.length;
    const c: Vec3 = [0, 0, 0]; let hc = 0;
    for (const v of loop) { c[0] += pos[v * 3] / N; c[1] += pos[v * 3 + 1] / N; c[2] += pos[v * 3 + 2] / N; hc += H(v) / N; }
    hc -= sag;
    const ch = c[0] * o[0] + c[1] * o[1] + c[2] * o[2];
    const K = Math.max(2, Math.min(8, Math.round(Math.sqrt(N) / 2)));
    const rings: number[][] = [loop];
    for (let k = 1; k < K; k++) {
      const r = 1 - k / K, ring: number[] = [];
      for (const v of loop) {
        const hb = H(v), s = r * r * (3 - 2 * r);
        const h = hc + (hb - hc) * s;
        // Flat position scaled towards the centre, then put at the blended height.
        const fx = c[0] + (pos[v * 3] - c[0]) * r, fy = c[1] + (pos[v * 3 + 1] - c[1]) * r, fz = c[2] + (pos[v * 3 + 2] - c[2]) * r;
        const cur = fx * o[0] + fy * o[1] + fz * o[2];
        ring.push(pos.length / 3); pos.push(fx + o[0] * (h - cur), fy + o[1] * (h - cur), fz + o[2] * (h - cur));
      }
      rings.push(ring);
    }
    const centre = pos.length / 3;
    pos.push(c[0] + o[0] * (hc - ch), c[1] + o[1] * (hc - ch), c[2] + o[2] * (hc - ch));
    const tris: number[] = [];
    for (let k = 0; k < rings.length; k++) for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, a = rings[k][i], b = rings[k][j];
      if (k + 1 < rings.length) { const d = rings[k + 1][i], e = rings[k + 1][j]; tris.push(a, b, e, a, e, d); }
      else tris.push(a, b, centre);
    }
    // Face the opposing jaw like the gum around it.
    let sx = 0, sy = 0, sz = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t] * 3, b = tris[t + 1] * 3, d = tris[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[d] - pos[a], vy = pos[d + 1] - pos[a + 1], vz = pos[d + 2] - pos[a + 2];
      sx += uy * vz - uz * vy; sy += uz * vx - ux * vz; sz += ux * vy - uy * vx;
    }
    if (sx * o[0] + sy * o[1] + sz * o[2] < 0) for (let t = 0; t < tris.length; t += 3) { const x = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = x; }
    idx.push(...tris);
  }
  // Drop vertices no triangle uses any more.
  const map = new Int32Array(pos.length / 3).fill(-1), out: number[] = [];
  const outIdx = new Uint32Array(idx.length);
  for (let t = 0; t < idx.length; t++) {
    const v = idx[t];
    if (map[v] < 0) { map[v] = out.length / 3; out.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); }
    outIdx[t] = map[v];
  }
  return { positions: new Float32Array(out), indices: outIdx };
}
