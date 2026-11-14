import { describe, expect, it } from 'vitest';
import { parseObjStream } from '../../src/core/mesh/obj';
import { parseStl, writeStl } from '../../src/core/mesh/stl';
import { decimate } from '../../src/core/mesh/decimate';
import { rayMesh, planeSegments } from '../../src/core/mesh/raycast';
import { apply, fitRigid, residuals, rotateAbout, mul, translate, inverseRigid, I4 } from '../../src/core/register/rigid';
import { icp, PointGrid } from '../../src/core/register/icp';
import type { TriMesh } from '../../src/core/mesh/mesh';
import type { Vec3 } from '../../src/core/volume/volume';

const stream = (s: string, chunk = 7): ReadableStream<Uint8Array> => {
  const b = new TextEncoder().encode(s);
  let o = 0;
  return new ReadableStream({ pull(c) { if (o >= b.length) { c.close(); return; } c.enqueue(b.slice(o, o + chunk)); o += chunk; } });
};
// Unit cube-ish grid plane: n x n quads in z = 0, spacing 1 mm.
function plane(n: number): TriMesh {
  const p: number[] = [], f: number[] = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) p.push(x, y, 0);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = y * (n + 1) + x; f.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1); }
  return { positions: new Float32Array(p), indices: new Uint32Array(f) };
}
const close = (a: Vec3, b: Vec3, tol: number) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol));

describe('scan files', () => {
  it('reads OBJ quads, slash forms, negative indices and split chunks', async () => {
    const m = await parseObjStream(stream('# c\nmtllib x.mtl\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nf 1/1 2/1 3/1 4/1\nf -4//1 -2//1 -1//1\n'));
    expect(m.positions.length).toBe(12);
    expect(m.indices.length).toBe(9);
    expect(Array.from(m.indices.slice(6))).toEqual([0, 2, 3]);
  });
  it('writes and reads binary STL with shared vertices', () => {
    const m = plane(3);
    const back = parseStl(writeStl(m));
    expect(back.indices.length).toBe(m.indices.length);
    expect(back.positions.length).toBe(m.positions.length);
  });
  it('reads ASCII STL', () => {
    const s = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';
    const m = parseStl(new TextEncoder().encode(s).buffer as ArrayBuffer);
    expect(m.indices.length).toBe(3);
  });
  it('decimates to about the target and keeps the outline size', () => {
    const m = plane(200);
    const d = decimate(m, 5000);
    expect(d.indices.length / 3).toBeLessThan(12000);
    let mx = 0; for (let i = 0; i < d.positions.length; i += 3) mx = Math.max(mx, d.positions[i]);
    expect(mx).toBeGreaterThan(195);
  });
});

describe('ray and slice', () => {
  it('hits a plane, also through a model transform', () => {
    const m = plane(10);
    expect(rayMesh(m, [5, 5, 10], [0, 0, -1])).toBeCloseTo(10, 4);
    expect(rayMesh(m, [5, 5, 10], [0, 0, -1], translate([0, 0, 3]))).toBeCloseTo(7, 4);
    expect(rayMesh(m, [50, 5, 10], [0, 0, -1])).toBe(Infinity);
  });
  it('cuts a plane into segments along the line', () => {
    const segs = planeSegments(plane(10), null, [0, 4.5, 0], [0, 1, 0]);
    expect(segs.length).toBeGreaterThan(0);
    for (let i = 1; i < segs.length; i += 3) expect(segs[i]).toBeCloseTo(4.5, 4);
  });
});

describe('line-up', () => {
  const truth = mul(translate([12, -30, 5]), rotateAbout([0.3, 0.2, 1], 17, [0, 0, 0]));
  const pts: Vec3[] = [[0, 0, 0], [40, 5, 2], [20, 30, -3], [-10, 18, 6]];
  it('recovers a rigid move from three or more points', () => {
    const m = fitRigid(pts, pts.map((p) => apply(truth, p)));
    pts.forEach((p) => close(apply(m, p), apply(truth, p), 1e-4));
    expect(Math.max(...residuals(m, pts, pts.map((p) => apply(truth, p))))).toBeLessThan(1e-4);
    close(apply(mul(inverseRigid(m), m), [3, 4, 5]), [3, 4, 5], 1e-6);
  });
  it('fine-tune pulls a 1 mm off start onto the surface', () => {
    // Curved, bumpy surface so the fit is unique.
    const src: Vec3[] = [];
    for (let x = -15; x <= 15; x += 0.7) for (let y = -10; y <= 10; y += 0.7) src.push([x, y, 0.02 * x * x + 2 * Math.sin(x / 3) * Math.cos(y / 4)]);
    const tgt = new Float32Array(src.flatMap((p) => apply(truth, p)));
    const off = mul(translate([0.8, -0.6, 0.5]), mul(truth, rotateAbout([0, 0, 1], 1.5, [0, 0, 0])));
    const r = icp(src, new PointGrid(tgt, 1), off, { iterations: 40, maxDist: 3, keep: 0.9 });
    expect(r.rms).toBeLessThan(0.4);
    close(apply(r.m, [5, 5, 0]), apply(truth, [5, 5, 0]), 0.1);
    expect(I4.length).toBe(16);
  });
});
