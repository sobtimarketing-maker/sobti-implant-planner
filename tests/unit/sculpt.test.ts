import { describe, expect, it } from 'vitest';
import { EditableMesh } from '../../src/core/mesh/sculpt';
import type { TriMesh } from '../../src/core/mesh/mesh';

function sheet(bump = 0): TriMesh {
  const n = 50, p: number[] = [], f: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const x = -10 + i * 0.4, y = -10 + j * 0.4; p.push(x, y, bump && i === 25 && j === 25 ? bump : 0); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; f.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1); }
  return { positions: new Float32Array(p), indices: new Uint32Array(f) };
}
const zAt = (e: EditableMesh, x: number, y: number) => { let best = 0, bd = Infinity; for (let i = 0; i < e.vertexCount; i++) { const d = (e.pos[i * 3] - x) ** 2 + (e.pos[i * 3 + 1] - y) ** 2; if (d < bd) { bd = d; best = e.pos[i * 3 + 2]; } } return best; };

describe('scan brushes', () => {
  it('smooths a spike down', () => {
    const e = new EditableMesh(sheet(3));
    for (let k = 0; k < 10; k++) e.dab('smooth', [0, 0, 1], 3, 1);
    expect(zAt(e, 0, 0)).toBeLessThan(0.5);
  });
  it('builds up and takes away along the surface normal, softly', () => {
    const e = new EditableMesh(sheet());
    for (let k = 0; k < 10; k++) e.dab('add', [0, 0, 0], 2.5, 1);
    const mid = zAt(e, 0, 0), side = zAt(e, 2, 0);
    expect(mid).toBeGreaterThan(0.4);
    expect(side).toBeLessThan(mid);
    expect(zAt(e, 5, 5)).toBe(0);
    for (let k = 0; k < 20; k++) e.dab('remove', [0, 0, mid], 2.5, 1);
    expect(zAt(e, 0, 0)).toBeLessThan(mid - 0.5);
  });
  it('never moves locked vertices', () => {
    const e = new EditableMesh(sheet(3));
    const locked = (i: number) => e.pos[i * 3] > 0;
    const before = Array.from(e.pos);
    for (let k = 0; k < 5; k++) e.dab('smooth', [0, 0, 0], 3, 1, locked);
    for (let i = 0; i < e.vertexCount; i++) if (before[i * 3] > 0) expect(e.pos[i * 3 + 2]).toBe(before[i * 3 + 2]);
  });
  it('cuts a painted area out, finds the hole and closes it', () => {
    const e = new EditableMesh(sheet());
    e.dab('select', [0, 0, 0], 2, 1);
    expect(e.selectedCount()).toBeGreaterThan(50);
    e.cutSelection(false, [0, 0, 1]);
    const hs = e.holes();
    expect(hs.length).toBe(1);
    expect(hs[0].perimeter).toBeGreaterThan(8);
    e.closeHoles(hs, [0, 0, 1]);
    expect(e.holes().length).toBe(0);
    expect(Math.abs(zAt(e, 0, 0))).toBeLessThan(0.05);
  });
});

it('finds the surface along a ray like the brute-force test', () => {
  const e = new EditableMesh(sheet(3));
  expect(e.ray([1.1, -0.7, 10], [0, 0, -1])).toBeCloseTo(10, 4);
  expect(e.ray([30, 0, 10], [0, 0, -1])).toBe(Infinity);
  const flat = new EditableMesh(sheet()), d = Math.SQRT1_2;
  expect(flat.ray([-5, 0, 5], [d, 0, -d])).toBeCloseTo(5 * Math.SQRT2, 3);
});
