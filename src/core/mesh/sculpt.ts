// Brush editing of a scan mesh (scan mm): smooth, build up, take away,
// flatten, paint a selection to cut out, close holes. Each brush dab moves
// the vertices within the brush radius with a soft falloff; "locked"
// vertices (e.g. the teeth, when protected) never move.
import type { Vec3 } from '../volume/volume';
import type { TriMesh } from './mesh';
import { cutOut, fillHoles, holeLoops, HoleLoop } from './extract';

export type BrushKind = 'smooth' | 'add' | 'remove' | 'flatten' | 'select' | 'unselect';

export class EditableMesh {
  pos: Float32Array;
  idx: Uint32Array;
  /** Painted selection (1 = selected), per vertex. */
  sel: Uint8Array;
  private start!: Uint32Array; private list!: Uint32Array;     // vertex neighbours
  private fstart!: Uint32Array; private flist!: Uint32Array;   // vertex faces
  private cells = new Map<number, number[]>();
  private readonly cell = 2;
  version = 0;

  constructor(m: TriMesh) {
    this.pos = new Float32Array(m.positions);
    this.idx = new Uint32Array(m.indices);
    this.sel = new Uint8Array(this.pos.length / 3);
    this.rebuild();
  }

  get vertexCount() { return this.pos.length / 3; }
  mesh(): TriMesh { return { positions: this.pos, indices: this.idx }; }

  /** Recompute neighbours, faces and the vertex grid (after a change of triangles, or a long stroke). */
  rebuild(): void {
    const n = this.vertexCount, I = this.idx;
    const cnt = new Uint32Array(n + 1), fc = new Uint32Array(n + 1);
    for (let t = 0; t < I.length; t++) { cnt[I[t] + 1] += 2; fc[I[t] + 1]++; }
    for (let i = 0; i < n; i++) { cnt[i + 1] += cnt[i]; fc[i + 1] += fc[i]; }
    const list = new Uint32Array(cnt[n]), flist = new Uint32Array(fc[n]), f1 = cnt.slice(0, n), f2 = fc.slice(0, n);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      list[f1[a]++] = b; list[f1[a]++] = c; list[f1[b]++] = a; list[f1[b]++] = c; list[f1[c]++] = a; list[f1[c]++] = b;
      flist[f2[a]++] = t; flist[f2[b]++] = t; flist[f2[c]++] = t;
    }
    this.start = cnt; this.list = list; this.fstart = fc; this.flist = flist;
    this.regrid();
  }
  regrid(): void {
    this.cells.clear();
    this.tri = null;
    const P = this.pos, c = this.cell;
    const used = new Uint8Array(this.vertexCount);
    for (let t = 0; t < this.idx.length; t++) used[this.idx[t]] = 1;
    for (let i = 0; i < this.vertexCount; i++) {
      if (!used[i]) continue;
      const k = this.key(Math.floor(P[i * 3] / c), Math.floor(P[i * 3 + 1] / c), Math.floor(P[i * 3 + 2] / c));
      let l = this.cells.get(k); if (!l) { l = []; this.cells.set(k, l); } l.push(i);
    }
  }
  // Triangle grid for fast rays (built on first use after a change).
  private tri: Map<number, number[]> | null = null;
  private box: { min: Vec3; max: Vec3 } = { min: [0, 0, 0], max: [0, 0, 0] };
  private readonly tc = 1.5;
  private triGrid(): Map<number, number[]> {
    if (this.tri) return this.tri;
    const g = new Map<number, number[]>(), P = this.pos, I = this.idx, c = this.tc;
    const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < I.length; t += 3) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let e = 0; e < 3; e++) { const v = I[t + e] * 3; x0 = Math.min(x0, P[v]); x1 = Math.max(x1, P[v]); y0 = Math.min(y0, P[v + 1]); y1 = Math.max(y1, P[v + 1]); z0 = Math.min(z0, P[v + 2]); z1 = Math.max(z1, P[v + 2]); }
      mn[0] = Math.min(mn[0], x0); mn[1] = Math.min(mn[1], y0); mn[2] = Math.min(mn[2], z0); mx[0] = Math.max(mx[0], x1); mx[1] = Math.max(mx[1], y1); mx[2] = Math.max(mx[2], z1);
      for (let z = Math.floor(z0 / c); z <= Math.floor(z1 / c); z++) for (let y = Math.floor(y0 / c); y <= Math.floor(y1 / c); y++) for (let x = Math.floor(x0 / c); x <= Math.floor(x1 / c); x++) {
        const k = this.key(x, y, z); let l = g.get(k); if (!l) { l = []; g.set(k, l); } l.push(t);
      }
    }
    this.box = { min: mn, max: mx };
    return (this.tri = g);
  }
  /** First hit along a ray (scan mm), Infinity if none. Walks the triangle grid. */
  ray(o: Vec3, d: Vec3): number {
    const g = this.triGrid(), { min, max } = this.box, c = this.tc, P = this.pos, I = this.idx;
    let t0 = 0, t1 = Infinity;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) { if (o[a] < min[a] || o[a] > max[a]) return Infinity; continue; }
      let u = (min[a] - o[a]) / d[a], v = (max[a] - o[a]) / d[a];
      if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    }
    if (t0 > t1) return Infinity;
    const seen = new Set<number>(); let best = Infinity;
    const step = c * 0.5;
    for (let t = t0; t <= t1 + step; t += step) {
      if (best < t - c * 1.8) break;
      const x = Math.floor((o[0] + d[0] * t) / c), y = Math.floor((o[1] + d[1] * t) / c), z = Math.floor((o[2] + d[2] * t) / c);
      const l = g.get(this.key(x, y, z)); if (!l) continue;
      for (const tr of l) {
        if (seen.has(tr)) continue; seen.add(tr);
        const a = I[tr] * 3, b = I[tr + 1] * 3, cc = I[tr + 2] * 3;
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[cc] - P[a], e2y = P[cc + 1] - P[a + 1], e2z = P[cc + 2] - P[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
        const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist > 0 && dist < best) best = dist;
      }
    }
    return best;
  }
  private key(x: number, y: number, z: number) { return (x + 1024) + (y + 1024) * 2048 + (z + 1024) * 4194304; }

  /** Vertices within r of p, with their distance. */
  near(p: Vec3, r: number): { i: number; d: number }[] {
    const c = this.cell, n = Math.ceil(r / c), P = this.pos, out: { i: number; d: number }[] = [];
    const cx = Math.floor(p[0] / c), cy = Math.floor(p[1] / c), cz = Math.floor(p[2] / c);
    for (let dz = -n; dz <= n; dz++) for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) {
      const l = this.cells.get(this.key(cx + dx, cy + dy, cz + dz));
      if (!l) continue;
      for (const i of l) { const d = Math.hypot(P[i * 3] - p[0], P[i * 3 + 1] - p[1], P[i * 3 + 2] - p[2]); if (d <= r) out.push({ i, d }); }
    }
    return out;
  }

  private faceNormal(t: number): Vec3 {
    const P = this.pos, I = this.idx, a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  }
  /** Area-weighted normal of the surface under the brush. */
  private areaNormal(vs: number[]): Vec3 {
    const n: Vec3 = [0, 0, 0], seen = new Set<number>();
    for (const v of vs) for (let k = this.fstart[v]; k < this.fstart[v + 1]; k++) {
      const t = this.flist[k]; if (seen.has(t)) continue; seen.add(t);
      const f = this.faceNormal(t); n[0] += f[0]; n[1] += f[1]; n[2] += f[2];
    }
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  }

  /**
   * One dab of the brush at p (scan mm), radius r, strength 0..1.
   * Returns the number of vertices it touched.
   */
  dab(kind: BrushKind, p: Vec3, r: number, strength: number, locked?: (i: number) => boolean): number {
    const hits = this.near(p, r).filter((h) => !locked?.(h.i));
    if (!hits.length) return 0;
    const P = this.pos, w = (d: number) => { const x = 1 - (d / r) ** 2; return x * x; };
    if (kind === 'select' || kind === 'unselect') { for (const h of hits) this.sel[h.i] = kind === 'select' ? 1 : 0; this.version++; return hits.length; }
    if (kind === 'smooth') {
      for (let pass = 0; pass < 2; pass++) {
        const upd: number[] = [];
        for (const h of hits) {
          const v = h.i; let x = 0, y = 0, z = 0, k = 0;
          for (let j = this.start[v]; j < this.start[v + 1]; j++) { const u = this.list[j]; x += P[u * 3]; y += P[u * 3 + 1]; z += P[u * 3 + 2]; k++; }
          if (!k) { upd.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); continue; }
          const a = 0.6 * strength * w(h.d);
          upd.push(P[v * 3] + a * (x / k - P[v * 3]), P[v * 3 + 1] + a * (y / k - P[v * 3 + 1]), P[v * 3 + 2] + a * (z / k - P[v * 3 + 2]));
        }
        hits.forEach((h, n) => { P[h.i * 3] = upd[n * 3]; P[h.i * 3 + 1] = upd[n * 3 + 1]; P[h.i * 3 + 2] = upd[n * 3 + 2]; });
      }
    } else {
      const nrm = this.areaNormal(hits.map((h) => h.i));
      if (kind === 'flatten') {
        let cx = 0, cy = 0, cz = 0, ws = 0;
        for (const h of hits) { const ww = w(h.d); cx += P[h.i * 3] * ww; cy += P[h.i * 3 + 1] * ww; cz += P[h.i * 3 + 2] * ww; ws += ww; }
        cx /= ws; cy /= ws; cz /= ws;
        for (const h of hits) {
          const v = h.i, d = (P[v * 3] - cx) * nrm[0] + (P[v * 3 + 1] - cy) * nrm[1] + (P[v * 3 + 2] - cz) * nrm[2];
          const a = 0.5 * strength * w(h.d) * d;
          P[v * 3] -= nrm[0] * a; P[v * 3 + 1] -= nrm[1] * a; P[v * 3 + 2] -= nrm[2] * a;
        }
      } else {
        // About 0.06 mm per dab at full strength in the middle of the brush.
        const amt = (kind === 'add' ? 1 : -1) * 0.06 * strength * Math.max(0.6, r / 2.5);
        for (const h of hits) { const a = amt * w(h.d), v = h.i; P[v * 3] += nrm[0] * a; P[v * 3 + 1] += nrm[1] * a; P[v * 3 + 2] += nrm[2] * a; }
      }
    }
    this.version++;
    return hits.length;
  }

  selectedCount(): number { let n = 0; for (let i = 0; i < this.sel.length; i++) n += this.sel[i]; return n; }
  clearSelection(): void { this.sel.fill(0); this.version++; }

  /** Cut the painted area out (and close it over if `close`). */
  cutSelection(close: boolean, o: Vec3, fixed?: (i: number) => boolean): void {
    const before = holeLoops(this.mesh());
    const outer = before[0] ? new Set(before[0].loop) : new Set<number>();
    const cut = cutOut(this.mesh(), this.sel);
    let m: TriMesh = cut;
    if (close) {
      const I = this.idx, rim = new Set<number>();
      for (let t = 0; t < I.length; t += 3) if (this.sel[I[t]] || this.sel[I[t + 1]] || this.sel[I[t + 2]]) for (let e = 0; e < 3; e++) if (!this.sel[I[t + e]]) rim.add(I[t + e]);
      const loops = holeLoops(cut).filter((h) => h.loop.some((v) => rim.has(v)) && h.loop.filter((v) => outer.has(v)).length <= h.loop.length / 2);
      m = fillHoles(cut, loops.map((h) => h.loop), o, { sag: 0.2, fixed });
    } else m = compact(cut);
    this.replace(m);
  }

  /** Holes in the surface, without the scan's own outer edge. */
  holes(): HoleLoop[] { return holeLoops(this.mesh()).slice(1); }

  /** Close the given holes with a smooth patch. */
  closeHoles(hs: HoleLoop[], o: Vec3): void {
    if (!hs.length) return;
    this.replace(fillHoles(this.mesh(), hs.map((h) => h.loop), o, { sag: 0, band: 2 }));
  }

  replace(m: TriMesh): void {
    this.pos = new Float32Array(m.positions); this.idx = new Uint32Array(m.indices);
    this.sel = new Uint8Array(this.pos.length / 3);
    this.rebuild(); this.version++;
  }
}

/** Drop vertices no triangle uses. */
export function compact(m: TriMesh): TriMesh {
  const map = new Int32Array(m.positions.length / 3).fill(-1), out: number[] = [], idx = new Uint32Array(m.indices.length);
  for (let t = 0; t < m.indices.length; t++) {
    const v = m.indices[t];
    if (map[v] < 0) { map[v] = out.length / 3; out.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); }
    idx[t] = map[v];
  }
  return { positions: new Float32Array(out), indices: idx };
}
