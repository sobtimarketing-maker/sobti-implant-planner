// Fast display copy of a mesh by vertex clustering: snap vertices to a grid,
// merge each cell into one vertex (mean position), drop collapsed triangles.
// The cell size is searched so the result lands near the target face count.
import { bounds, TriMesh } from './mesh';

export function decimate(m: TriMesh, targetFaces = 40000): TriMesh {
  const nf = m.indices.length / 3;
  if (nf <= targetFaces) return m;
  const { min, max } = bounds(m.positions);
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  // Area scales with 1/cell²: start from the ratio, refine twice.
  let cell = ext / 400;
  let out = cluster(m, cell, min);
  for (let it = 0; it < 4; it++) {
    const f = out.indices.length / 3;
    if (Math.abs(f - targetFaces) < targetFaces * 0.15) break;
    cell *= Math.sqrt(f / targetFaces);
    out = cluster(m, cell, min);
  }
  return out;
}

function cluster(m: TriMesh, cell: number, min: number[]): TriMesh {
  const p = m.positions, nv = p.length / 3;
  const map = new Map<number, number>();
  const remap = new Uint32Array(nv);
  const acc: number[] = [], cnt: number[] = [], col: number[] = [];
  for (let i = 0; i < nv; i++) {
    const x = Math.floor((p[i * 3] - min[0]) / cell), y = Math.floor((p[i * 3 + 1] - min[1]) / cell), z = Math.floor((p[i * 3 + 2] - min[2]) / cell);
    const key = x + y * 4096 + z * 16777216;
    let c = map.get(key);
    if (c === undefined) { c = cnt.length; map.set(key, c); acc.push(0, 0, 0); cnt.push(0); col.push(0, 0, 0); }
    acc[c * 3] += p[i * 3]; acc[c * 3 + 1] += p[i * 3 + 1]; acc[c * 3 + 2] += p[i * 3 + 2]; cnt[c]++;
    if (m.colors) { col[c * 3] += m.colors[i * 3]; col[c * 3 + 1] += m.colors[i * 3 + 1]; col[c * 3 + 2] += m.colors[i * 3 + 2]; }
    remap[i] = c;
  }
  const positions = new Float32Array(acc.length);
  for (let c = 0; c < cnt.length; c++) for (let a = 0; a < 3; a++) positions[c * 3 + a] = acc[c * 3 + a] / cnt[c];
  const idx: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = remap[m.indices[t]], b = remap[m.indices[t + 1]], c = remap[m.indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    const s = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(s)) continue;
    seen.add(s);
    idx.push(a, b, c);
  }
  const out: TriMesh = { positions, indices: new Uint32Array(idx) };
  if (m.colors) out.colors = new Uint8Array(col.map((v, i) => Math.round(v / cnt[Math.floor(i / 3)])));
  return out;
}
