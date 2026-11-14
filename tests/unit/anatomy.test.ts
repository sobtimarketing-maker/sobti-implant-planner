import { describe, expect, it } from 'vitest';
import { catmullRom, resample } from '../../src/core/geometry/curve';
import { archGeometry, crossSectionPlane, panoToWorld, worldToPano } from '../../src/render/pano';
import { maskAt, packMask, regionGrow, unpackMask } from '../../src/core/segment/regionGrow';
import { surfaceNets } from '../../src/core/segment/surfaceNets';
import { distanceToNerve, insertPoint, Nerve, snapToCanal } from '../../src/core/anatomy/nerve';
import type { Vec3, Volume } from '../../src/core/volume/volume';

function vol(n = 40, sp = 0.5, f: (i: number, j: number, k: number) => number = () => -1000): Volume {
  const data = new Int16Array(n * n * n);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[i + n * (j + n * k)] = f(i, j, k);
  return { dims: [n, n, n], spacing: [sp, sp, sp], origin: [0, 0, 0], rowDir: [1, 0, 0], colDir: [0, 1, 0], normal: [0, 0, 1], factor: 1, sourceDims: [n, n, n], sourceSpacing: [sp, sp, sp], data };
}

describe('curves', () => {
  it('resamples a straight line at equal steps', () => {
    const c = resample(catmullRom([[0, 0, 0], [5, 0, 0], [10, 0, 0]]), 0.5);
    expect(c.length).toBeCloseTo(10, 3);
    expect(c.pos.length).toBe(21);
    expect(c.tan[10][0]).toBeCloseTo(1);
  });
});

describe('panoramic geometry', () => {
  // A U-shaped arch opening posteriorly (+y), drawn left to right to test reversal.
  const arch: Vec3[] = [[15, 15, 10], [10, 5, 10], [0, 2, 10], [-10, 5, 10], [-15, 15, 10]];
  const g = archGeometry(arch, vol(), 0.5)!;
  it('runs patient right to left with buccal normals', () => {
    expect(g.curve.pos[0][0]).toBeLessThan(g.curve.pos[g.w - 1][0]);
    const mid = Math.floor(g.w / 2);
    expect(g.normal[mid][1]).toBeLessThan(-0.9); // anterior = -y
  });
  it('maps pano pixels to world and back', () => {
    const p = panoToWorld(g, 30, 12, 1.5);
    const q = worldToPano(g, p);
    expect(q.x).toBe(30);
    expect(q.y).toBeCloseTo(12, 6);
    expect(q.depth).toBeCloseTo(1.5, 1);
  });
  it('cross-section plane is perpendicular to the arch', () => {
    const pl = crossSectionPlane(g, 40);
    const t = g.curve.tan[40];
    expect(Math.abs(pl.u[0] * t[0] + pl.u[1] * t[1])).toBeLessThan(0.05);
    expect(Math.abs(pl.n[0] * t[0] + pl.n[1] * t[1])).toBeGreaterThan(0.95);
  });
});

describe('tooth outlining', () => {
  const r = 6;
  const v = vol(40, 0.5, (i, j, k) => (Math.hypot(i - 20, j - 20, k - 20) <= r ? 2500 : Math.hypot(i - 34, j - 20, k - 20) <= 3 ? 2500 : 100));
  it('grows only the connected region above threshold', () => {
    const m = regionGrow(v, [10, 10, 10], 1500)!;
    const expected = 4 / 3 * Math.PI * r ** 3;
    expect(m.count).toBeGreaterThan(expected * 0.85);
    expect(m.count).toBeLessThan(expected * 1.15);
    expect(maskAt(m, [10, 10, 10])).toBe(1);
    expect(maskAt(m, [17, 10, 10])).toBe(0); // the separate small sphere
    expect(regionGrow(v, [1, 1, 1], 1500)).toBeNull();
  });
  it('packs and unpacks masks losslessly', () => {
    const m = regionGrow(v, [10, 10, 10], 1500)!;
    const u = unpackMask(JSON.parse(JSON.stringify(packMask(m))));
    expect(Array.from(u.data)).toEqual(Array.from(m.data));
  });
  it('builds a closed surface', () => {
    const m = regionGrow(v, [10, 10, 10], 1500)!;
    const mesh = surfaceNets(m);
    expect(mesh.indices.length).toBeGreaterThan(300);
    const edges = new Map<string, number>();
    for (let t = 0; t < mesh.indices.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = mesh.indices[t + e], b = mesh.indices[t + ((e + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    expect([...edges.values()].every((c) => c === 2)).toBe(true);
    // Vertices lie close to the sphere surface (radius 3 mm, centre 10,10,10).
    let maxErr = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const d = Math.hypot(mesh.positions[i] - 10, mesh.positions[i + 1] - 10, mesh.positions[i + 2] - 10);
      maxErr = Math.max(maxErr, Math.abs(d - 3.25));
    }
    expect(maxErr).toBeLessThan(0.6);
  });
});

describe('nerve', () => {
  it('orders points along the path regardless of tap order', () => {
    const n: Nerve = { id: 'n', side: 'R', points: [] };
    for (const x of [0, 20, 10, 5, 15]) insertPoint(n, { p: [x, 0, 0], r: 1 });
    expect(n.points.map((p) => p.p[0])).toEqual([0, 5, 10, 15, 20]);
  });
  it('measures distance to the tube surface', () => {
    const n: Nerve = { id: 'n', side: 'R', points: [0, 10, 20].map((x) => ({ p: [x, 0, 0] as Vec3, r: 1 })) };
    expect(distanceToNerve(n, [10, 3, 0])).toBeCloseTo(2, 1);
    expect(distanceToNerve(n, [10, 0.5, 0])).toBeLessThan(0);
  });
  it('snaps to a nearby dark canal', () => {
    const w = 20, h = 20;
    const img = new Int16Array(w * h).fill(800);
    for (let y = 9; y <= 11; y++) for (let x = 12; x <= 14; x++) img[y * w + x] = 100;
    expect(snapToCanal(img, w, h, 10, 10, 5)).toEqual([13, 10]);
    expect(snapToCanal(new Int16Array(w * h).fill(800), w, h, 10, 10, 5)).toEqual([10, 10]);
  });
});
