import { describe, expect, it } from 'vitest';
import { IDENTITY, planeFor, rotateFrame, samplePlane, sampleWorld } from '../../src/render/oblique';
import { dot, voxelToWorld } from '../../src/core/volume/volume';
import { CbctSource, loadCbct, loadRoi } from '../../src/workers/loader';
import { extractSlice } from '../../src/render/mpr';
import { makeDicom, makeZip } from '../fixtures';

async function phantom(f = 'H' as const) {
  // Value encodes position so any sampling error shows: HU = x + 20*y + 400*k - 1000 + 1000
  const files = Array.from({ length: 20 }, (_, k) => makeDicom({ rows: 20, cols: 20, z: k * 0.5, spacing: 0.5, pixel: (x, y) => 1000 + x + 20 * y + 400 * k, intercept: -1000 }));
  let src: CbctSource | null = null;
  const blob = await makeZip(files.map((d, i) => ({ name: `${i}.dcm`, data: d })));
  const r = await loadCbct([new File([blob], 'p.zip')], { tier: f, ramGb: 16, keep: (s) => { src = s; } });
  return { v: r.volume, src: src! };
}

describe('oblique MPR', () => {
  it('identity axial plane equals the axis-aligned slice', async () => {
    const { v } = await phantom();
    const pl = planeFor('axial', IDENTITY);
    const k = 7;
    const origin = voxelToWorld(v, 0, 0, k);
    const out = new Int16Array(v.dims[0] * v.dims[1]);
    samplePlane([v], origin, pl.u, pl.v, v.spacing[0], v.dims[0], v.dims[1], out, true);
    expect(Array.from(out)).toEqual(Array.from(extractSlice(v, 'axial', k).data));
  });

  it('trilinear sampling interpolates between voxels', async () => {
    const { v } = await phantom();
    const a = voxelToWorld(v, 3, 4, 5), b = voxelToWorld(v, 4, 4, 5);
    const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    expect(sampleWorld([v], mid)).toBe(Math.round(3.5 + 80 + 2000));
  });

  it('keeps frames orthonormal after many rotations', () => {
    let f = IDENTITY;
    for (let i = 0; i < 500; i++) f = rotateFrame(f, i % 2 ? f.ez : f.ex, 0.013);
    expect(dot(f.ex, f.ey)).toBeCloseTo(0, 9);
    expect(dot(f.ex, f.ex)).toBeCloseTo(1, 9);
    expect(dot(f.ez, f.ez)).toBeCloseTo(1, 9);
  });
});

describe('full-resolution region', () => {
  it('reads a box at source resolution that agrees with the source data', async () => {
    const { v, src } = await phantom();
    const c = voxelToWorld(v, 10, 10, 10);
    const roi = await loadRoi(src, c, [4, 4, 4]);
    expect(roi.spacing[0]).toBeCloseTo(0.5);
    expect(roi.dims).toEqual([9, 9, 9]);
    // Same world point, same HU in both volumes (working volume is full-res here).
    const p = voxelToWorld(roi, 2, 3, 4);
    expect(sampleWorld([roi], p)).toBe(sampleWorld([v], p));
  });

  it('clamps the box at the volume edge', async () => {
    const { v, src } = await phantom();
    const roi = await loadRoi(src, voxelToWorld(v, 0, 0, 0), [4, 4, 4]);
    expect(roi.dims).toEqual([9, 9, 9]);
    expect(roi.origin).toEqual(v.origin);
  });
});
