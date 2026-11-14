import { expect, it } from 'vitest';
import { removeAndFill, selectTooth } from '../../src/core/mesh/extract';
import type { TriMesh } from '../../src/core/mesh/mesh';

// Gum sheet 30 × 30 mm (0.5 mm grid) with a tooth-like bump 7 mm tall, radius ~4 mm.
function jaw(): TriMesh {
  const n = 60, p: number[] = [], f: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = -15 + i * 0.5, y = -15 + j * 0.5, r = Math.hypot(x, y);
    p.push(x, y, r < 4 ? 7 * Math.min(1, (4 - r) / 1) : 0);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; f.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1); }
  return { positions: new Float32Array(p), indices: new Uint32Array(f) };
}
const borderEdges = (m: TriMesh) => {
  const c = new Map<string, number>(); const I = m.indices;
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = I[t + e], b = I[t + (e + 1) % 3]; const k = a < b ? `${a},${b}` : `${b},${a}`; c.set(k, (c.get(k) ?? 0) + 1); }
  return [...c.values()].filter((x) => x === 1).length;
};

it('cuts a tooth out of the scan and closes the hole with gum', () => {
  const m = jaw();
  const o: [number, number, number] = [0, 0, 1];
  const sel = selectTooth(m, { seed: [0, 0, 7], o, radius: 5.5 }, (i) => m.positions[i * 3 + 2] > 0.3);
  const count = sel.reduce((a, b) => a + b, 0);
  expect(count).toBeGreaterThan(150);
  const out = removeAndFill(m, sel, o);
  let top = -Infinity; for (let i = 2; i < out.positions.length; i += 3) top = Math.max(top, out.positions[i]);
  expect(top).toBeLessThan(0.5);
  expect(borderEdges(out)).toBe(borderEdges(m)); // only the sheet's own outer edge stays open
  // Fill faces up, like the gum.
  const I = out.indices, P = out.positions; let up = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; up += (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]); }
  expect(up).toBeGreaterThan(0);
});
