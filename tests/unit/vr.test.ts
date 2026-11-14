import { describe, expect, it } from 'vitest';
import { cameraEye, clipPlane, texToWorld, vertexNormals, viewProj } from '../../src/render/vr/engine';
import { invert, multiply, transformPoint, identity } from '../../src/render/vr/mat4';
import { firstVisible, toStored, transferTable } from '../../src/render/vr/presets';
import { sphereMesh, tubeMesh } from '../../src/render/vr/shapes';
import type { Volume } from '../../src/core/volume/volume';

const vol = { dims: [10, 20, 30], spacing: [0.5, 0.5, 0.4], origin: [-10, 5, 2], rowDir: [1, 0, 0], colDir: [0, 1, 0], normal: [0, 0, 1] } as unknown as Volume;

describe('3D engine maths', () => {
  it('maps texture coordinates to voxel centres in world mm', () => {
    const m = texToWorld(vol);
    const p0 = transformPoint(m, [0.5 / 10, 0.5 / 20, 0.5 / 30]);
    expect(p0[0]).toBeCloseTo(-10); expect(p0[1]).toBeCloseTo(5); expect(p0[2]).toBeCloseTo(2);
    const p1 = transformPoint(m, [9.5 / 10, 19.5 / 20, 29.5 / 30]);
    expect(p1[0]).toBeCloseTo(-10 + 9 * 0.5); expect(p1[2]).toBeCloseTo(2 + 29 * 0.4);
    const back = transformPoint(invert(m), p1);
    expect(back[0]).toBeCloseTo(0.95);
  });
  it('front camera sits anterior (-y) with superior up', () => {
    const { eye, up } = cameraEye({ target: [0, 0, 0], yaw: 0, pitch: 0, dist: 100, fov: 0.5 });
    expect(eye[1]).toBeCloseTo(-100); expect(up[2]).toBeCloseTo(1);
    const right = cameraEye({ target: [0, 0, 0], yaw: -Math.PI / 2, pitch: 0, dist: 100, fov: 0.5 }).eye;
    expect(right[0]).toBeCloseTo(-100); // patient right is -x in LPS
  });
  it('projects the target to the screen centre', () => {
    const vp = viewProj({ target: [3, 4, 5], yaw: 0.3, pitch: 0.2, dist: 150, fov: 0.5 }, 1.5);
    const p = transformPoint(vp, [3, 4, 5]);
    expect(Math.abs(p[0])).toBeLessThan(1e-4); expect(Math.abs(p[1])).toBeLessThan(1e-4);
    const i = multiply(vp, invert(vp));
    const id = identity();
    for (let k = 0; k < 16; k++) expect(i[k]).toBeCloseTo(id[k], 4);
  });
  it('clip planes hide the right side of the point', () => {
    const at: [number, number, number] = [0, 10, -5];
    const hidden = (mode: Parameters<typeof clipPlane>[0], p: number[]) => { const c = clipPlane(mode, at)!; return c[0] * p[0] + c[1] * p[1] + c[2] * p[2] + c[3] > 0; };
    expect(hidden('lower', [0, 0, 0])).toBe(true);    // above the point
    expect(hidden('lower', [0, 0, -10])).toBe(false);
    expect(hidden('upper', [0, 0, -10])).toBe(true);
    expect(hidden('front', [0, 0, 0])).toBe(true);    // anterior (smaller y)
    expect(hidden('front', [0, 20, 0])).toBe(false);
    expect(clipPlane('none', at)).toBeNull();
  });
  it('transfer tables: air is clear, enamel is opaque', () => {
    for (const p of ['bone', 'teeth', 'skin'] as const) {
      const t = transferTable(p);
      expect(t[toStored(-1000) * 4 + 3]).toBe(0);
      expect(t[toStored(3000) * 4 + 3]).toBeGreaterThan(200);
      expect(firstVisible(t)).toBeGreaterThan(0);
    }
    expect(firstVisible(transferTable('skin'))).toBeLessThan(firstVisible(transferTable('teeth')));
  });
  it('builds closed tubes and spheres with unit normals', () => {
    const t = tubeMesh([{ p: [0, 0, 0], r: 1 }, { p: [0, 10, 0], r: 1 }, { p: [5, 15, 0], r: 1.2 }], 8);
    expect(t.positions.length / 3).toBe(3 * 8 + 2);
    expect(t.indices.length / 3).toBe(2 * 8 * 2 + 2 * 8);
    const n = vertexNormals(sphereMesh());
    for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 3);
  });
});
