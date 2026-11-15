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

/** Triangles that touch a selected vertex are dropped. Vertex numbers stay the same (unused ones remain until a fill or `compact`). */
export function cutOut(m: TriMesh, sel: Uint8Array): TriMesh {
  const I = m.indices, kept: number[] = [];
  for (let t = 0; t < I.length; t += 3) if (!(sel[I[t]] || sel[I[t + 1]] || sel[I[t + 2]])) kept.push(I[t], I[t + 1], I[t + 2]);
  return { positions: m.positions, indices: new Uint32Array(kept) };
}

export interface HoleLoop { loop: number[]; perimeter: number; centre: Vec3 }

/**
 * Open edges chained into loops (each walked against its triangles, so a fill
 * faces the same way as the surface). The scan's own outer edge is one of them.
 */
export function holeLoops(m: TriMesh): HoleLoop[] {
  const I = m.indices, P = m.positions, count = new Map<number, number>();
  const nv = P.length / 3, key = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const k = key(I[t + e], I[t + (e + 1) % 3]); count.set(k, (count.get(k) ?? 0) + 1); }
  const next = new Map<number, number>();
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
    const x = I[t + e], y = I[t + (e + 1) % 3];
    if (count.get(key(x, y)) === 1) next.set(y, x);
  }
  const out: HoleLoop[] = [], seen = new Set<number>();
  for (const s0 of next.keys()) {
    if (seen.has(s0)) continue;
    const loop: number[] = [];
    let v: number | undefined = s0;
    while (v !== undefined && !seen.has(v)) { seen.add(v); loop.push(v); v = next.get(v); }
    if (v !== s0 || loop.length < 3) continue;
    let per = 0; const c: Vec3 = [0, 0, 0];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3;
      per += Math.hypot(P[a] - P[b], P[a + 1] - P[b + 1], P[a + 2] - P[b + 2]);
      c[0] += P[a] / loop.length; c[1] += P[a + 1] / loop.length; c[2] += P[a + 2] / loop.length;
    }
    out.push({ loop, perimeter: per, centre: c });
  }
  return out.sort((a, b) => b.perimeter - a.perimeter);
}

export interface FillOptions {
  /** Dip in the middle of the patch (mm), as a healed socket. */
  sag?: number;
  /** Vertices that must not move (e.g. the neighbouring teeth). */
  fixed?: (i: number) => boolean;
  /** Rings of surface around the hole that are smoothed with the patch. */
  band?: number;
}

/** Cut the selected vertices out and close each hole with a gently sagging gum surface. */
export function removeAndFill(m: TriMesh, sel: Uint8Array, o: Vec3, sag = 0.4, fixed?: (i: number) => boolean, band = 3): TriMesh {
  const cut = cutOut(m, sel);
  // Only the holes this cut made: loops that run along a dropped triangle.
  const I = m.indices, rim = new Set<number>();
  for (let t = 0; t < I.length; t += 3) if (sel[I[t]] || sel[I[t + 1]] || sel[I[t + 2]]) for (let e = 0; e < 3; e++) if (!sel[I[t + e]]) rim.add(I[t + e]);
  const loops = holeLoops(cut).filter((h) => h.loop.some((v) => rim.has(v)));
  // The scan's outer edge can touch a cut near the border: never fill the largest loop of the scan.
  const outer = holeLoops(m)[0];
  const skip = outer ? new Set(outer.loop) : new Set<number>();
  return fillHoles(cut, loops.filter((h) => !(h.loop.filter((v) => skip.has(v)).length > h.loop.length / 2)).map((h) => h.loop), o, { sag, fixed, band });
}

/**
 * Close the given loops: rings from the rim towards the middle, the middle at
 * the low (gum) level of the rim, inner rings following an ever smoother
 * outline; then the patch heights and a band of surface around it are
 * smoothed. Returns a compact mesh.
 */
export function fillHoles(m: TriMesh, loops: number[][], o: Vec3, opt: FillOptions = {}): TriMesh {
  const sag = opt.sag ?? 0.4, fixed = opt.fixed, band = opt.band ?? 3;
  const P = m.positions;
  const kept = Array.from(m.indices);
  const pos = Array.from(P), idx = kept;
  const nOrig = P.length / 3, fillR = new Map<number, number>();
  const rimSet = new Set<number>();
  const H = (i: number) => pos[i * 3] * o[0] + pos[i * 3 + 1] * o[1] + pos[i * 3 + 2] * o[2];
  for (const loop of loops) {
    const N = loop.length;
    const c: Vec3 = [0, 0, 0];
    for (const v of loop) rimSet.add(v);
    for (const v of loop) { c[0] += pos[v * 3] / N; c[1] += pos[v * 3 + 1] / N; c[2] += pos[v * 3 + 2] / N; }
    // Gum level for the middle: low on the rim (the rim also climbs the neighbouring teeth).
    const hs = loop.filter((v) => !fixed?.(v)).map(H).sort((x, y) => x - y);
    const all = loop.map(H).sort((x, y) => x - y);
    const hc = (hs.length >= 3 ? hs : all)[Math.floor((hs.length >= 3 ? hs : all).length * 0.3)];
    const ch = c[0] * o[0] + c[1] * o[1] + c[2] * o[2];
    // Rim smoothed around the loop over a window: inner rings follow ever smoother outlines,
    // so the jagged cut edge does not echo inwards as creases.
    const rx = loop.map((v) => pos[v * 3]), ry = loop.map((v) => pos[v * 3 + 1]), rz = loop.map((v) => pos[v * 3 + 2]), rh = loop.map(H);
    const smoothRim = (w: number) => {
      if (w < 1) return { x: rx, y: ry, z: rz, h: rh };
      const x: number[] = [], y: number[] = [], z: number[] = [], h: number[] = [];
      for (let i = 0; i < N; i++) {
        let sx = 0, sy = 0, sz = 0, sh = 0;
        for (let d = -w; d <= w; d++) { const j = (i + d + N) % N; sx += rx[j]; sy += ry[j]; sz += rz[j]; sh += rh[j]; }
        const k = 2 * w + 1; x.push(sx / k); y.push(sy / k); z.push(sz / k); h.push(sh / k);
      }
      return { x, y, z, h };
    };
    const K = Math.max(4, Math.min(14, Math.round(Math.sqrt(N))));
    const rings: number[][] = [loop];
    for (let k = 1; k < K; k++) {
      const r = 1 - k / K, ring: number[] = [];
      const sm = smoothRim(Math.min(Math.floor(N / 2) - 1, Math.round((1 - r) * N / 5)));
      const s3 = r * r * r; // drop quickly from the rim to the gum level
      for (let i = 0; i < N; i++) {
        const h = hc + (sm.h[i] - hc) * s3;
        const fx = c[0] + (sm.x[i] - c[0]) * r, fy = c[1] + (sm.y[i] - c[1]) * r, fz = c[2] + (sm.z[i] - c[2]) * r;
        const cur = fx * o[0] + fy * o[1] + fz * o[2];
        fillR.set(pos.length / 3, r);
        ring.push(pos.length / 3); pos.push(fx + o[0] * (h - cur), fy + o[1] * (h - cur), fz + o[2] * (h - cur));
      }
      rings.push(ring);
    }
    const centre = pos.length / 3;
    fillR.set(centre, 0);
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
    // Face the same way as the surface around the hole (its faces at the rim); the
    // opposing-jaw direction only decides when there is no surface to go by.
    const loopSet = new Set(loop);
    let rx2 = 0, ry2 = 0, rz2 = 0;
    for (let t = 0; t < kept.length; t += 3) {
      if (!loopSet.has(kept[t]) && !loopSet.has(kept[t + 1]) && !loopSet.has(kept[t + 2])) continue;
      const a = kept[t] * 3, b = kept[t + 1] * 3, d = kept[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[d] - pos[a], vy = pos[d + 1] - pos[a + 1], vz = pos[d + 2] - pos[a + 2];
      rx2 += uy * vz - uz * vy; ry2 += uz * vx - ux * vz; rz2 += ux * vy - uy * vx;
    }
    const ref: Vec3 = Math.hypot(rx2, ry2, rz2) > 1e-9 ? [rx2, ry2, rz2] : o;
    if (sx * ref[0] + sy * ref[1] + sz * ref[2] < 0) for (let t = 0; t < tris.length; t += 3) { const x = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = x; }
    idx.push(...tris);
  }
  // Smooth the patch and the gum around the rim (not the neighbouring teeth).
  const nv = pos.length / 3, adj: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + (e + 1) % 3]; adj[a].push(b); adj[b].push(a); }
  const move = new Uint8Array(nv);
  for (const v of fillR.keys()) move[v] = 1;
  let front = [...rimSet];
  for (let ring = 0; ring <= band && front.length; ring++) {
    const nextF: number[] = [];
    for (const v of front) {
      if (v < nOrig && fixed?.(v)) continue;
      if (!move[v]) { move[v] = 2; }
      if (ring < band) for (const w of adj[v]) if (!move[w] && w < nOrig) nextF.push(w);
    }
    front = nextF;
  }
  const mv: number[] = []; for (let v = 0; v < nv; v++) if (move[v]) mv.push(v);
  const tmp = new Float64Array(nv * 3);
  for (let it = 0; it < 40; it++) {
    for (const v of mv) {
      const nb = adj[v]; let x = 0, y = 0, z = 0;
      for (const w of nb) { x += pos[w * 3]; y += pos[w * 3 + 1]; z += pos[w * 3 + 2]; }
      const k = nb.length || 1;
      let dx = x / k - pos[v * 3], dy = y / k - pos[v * 3 + 1], dz = z / k - pos[v * 3 + 2];
      if (move[v] === 1) { const along = dx * o[0] + dy * o[1] + dz * o[2]; dx = o[0] * along; dy = o[1] * along; dz = o[2] * along; }
      const lam = move[v] === 1 ? 0.6 : 0.3;
      tmp[v * 3] = pos[v * 3] + lam * dx; tmp[v * 3 + 1] = pos[v * 3 + 1] + lam * dy; tmp[v * 3 + 2] = pos[v * 3 + 2] + lam * dz;
    }
    for (const v of mv) { pos[v * 3] = tmp[v * 3]; pos[v * 3 + 1] = tmp[v * 3 + 1]; pos[v * 3 + 2] = tmp[v * 3 + 2]; }
  }
  // A gentle dip towards the middle, as a healed socket.
  for (const [v, r] of fillR) { const d = sag * (1 - r * r); pos[v * 3] -= o[0] * d; pos[v * 3 + 1] -= o[1] * d; pos[v * 3 + 2] -= o[2] * d; }

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
