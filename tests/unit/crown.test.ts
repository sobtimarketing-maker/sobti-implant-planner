import { describe, expect, it } from 'vitest';
import { buildUnit, crownTemplate, fitHeights, kindOf, meshHit, nearbyMesh, newSpan, occlusalAxis, seatOnGum, unitCentres } from '../../src/core/crown/crown';
import type { TriMesh } from '../../src/core/mesh/mesh';
import type { Vec3 } from '../../src/core/volume/volume';

// Flat sheet at height z, x/y from -30..30, facing either way (ray test is two-sided).
function sheet(z: number): TriMesh {
  const p: number[] = [], f: number[] = [], n = 30;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) p.push(-30 + i * 2, -30 + j * 2, z);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; f.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1); }
  return { positions: new Float32Array(p), indices: new Uint32Array(f) };
}
// Signed volume: positive when every triangle faces out.
function volume(m: TriMesh): number {
  const P = m.positions, I = m.indices; let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  return v;
}

describe('crown shapes', () => {
  it('maps tooth numbers to kinds', () => {
    expect([46, 45, 43, 41, 17, 24].map(kindOf)).toEqual(['molar', 'premolar', 'canine', 'incisor', 'molar', 'premolar']);
  });
  it('builds closed, outward-facing crowns of the asked size', () => {
    for (const k of ['molar', 'premolar', 'canine', 'incisor'] as const) {
      const m = crownTemplate(k, 10, 9, 7.5, 1);
      const v = volume(m);
      expect(v).toBeGreaterThan(150);
      let mx = 0, top = 0;
      for (let i = 0; i < m.positions.length; i += 3) { mx = Math.max(mx, Math.abs(m.positions[i])); top = Math.max(top, m.positions[i + 2]); }
      expect(mx).toBeLessThanOrEqual(5.001);
      expect(mx).toBeGreaterThan(4.5);
      expect(top).toBeGreaterThan(6.8);
      expect(top).toBeLessThan(8.2);
    }
  });
});

describe('crown fitting', () => {
  const gum = sheet(0), opp = sheet(9);
  const o: Vec3 = [0, 0, 1];
  it('finds the occlusal axis of a flat arch', () => {
    const pts: number[] = [];
    for (let a = 0; a < Math.PI; a += 0.01) for (let z = 0; z < 8; z += 1) pts.push(25 * Math.cos(a), -25 * Math.sin(a), z);
    const ax = occlusalAxis(new Float32Array(pts), [0, -10, 30], [0, 0, 1]);
    expect(ax[2]).toBeGreaterThan(0.99);
  });
  it('splits a bridge gap by tooth size, seats it on the gum and meets the opposing teeth', () => {
    const span = newSpan('s', [-10, 0, 5], [10, 0, 5], [45, 46], o, [0, -20, 0]);
    expect(span.buccal).toBe(1);
    expect(span.units[0].md + span.units[1].md).toBeCloseTo(20, 4);
    expect(span.units[1].md).toBeGreaterThan(span.units[0].md);
    const c = unitCentres(span);
    expect(c[0][0]).toBeLessThan(c[1][0]);
    seatOnGum(span, meshHit(nearbyMesh(gum, null, [0, 0, 0], 40)));
    for (const u of span.units) expect(u.origin[2]).toBeCloseTo(-0.3, 3);
    const hit = meshHit(nearbyMesh(opp, null, [0, 0, 0], 40));
    const r = fitHeights(span, hit);
    expect(r.touched).toBe(2);
    for (const u of span.units) {
      const b = buildUnit(span, u, hit);
      expect(b.contact).toBeGreaterThan(-0.05);
      expect(b.contact).toBeLessThan(0.1);
    }
  });
  it('grinds where the crown would push into the opposing teeth', () => {
    const span = newSpan('s', [-5, 0, 5], [5, 0, 5], [46], o, [0, -20, 0]);
    seatOnGum(span, meshHit(gum));
    span.units[0].height = 12; // far too tall: 3 mm into the opposing sheet
    const hit = meshHit(opp);
    const b = buildUnit(span, span.units[0], hit);
    let top = -Infinity; for (let i = 2; i < b.mesh.positions.length; i += 3) top = Math.max(top, b.mesh.positions[i]);
    expect(top).toBeLessThanOrEqual(9.001);
    span.adapt = false;
    const raw = buildUnit(span, span.units[0], hit);
    expect(raw.contact).toBeLessThan(-1.5);
  });
});
