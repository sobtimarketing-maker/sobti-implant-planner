import { describe, expect, it } from 'vitest';
import { anatomicCrown, LIBRARIES, SHADE_IDS } from '../../src/core/crown/anatomy';
import { typicalSize } from '../../src/core/crown/crown';

function volume(p: Float32Array, idx: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  return v;
}

describe('anatomic crown library', () => {
  const teeth = [11, 12, 13, 14, 15, 16, 17, 18, 21, 26, 31, 32, 33, 34, 35, 36, 37, 38, 46];
  it('builds every tooth in every library: closed, finite, the asked size, coloured', () => {
    for (const lib of LIBRARIES) for (const fdi of teeth) for (const buccal of [1, -1] as const) {
      const [md, bl, h] = typicalSize(fdi);
      const m = anatomicCrown(fdi, md, bl, h, buccal, lib.id, 'A2');
      expect(m.positions.every(Number.isFinite)).toBe(true);
      expect(volume(m.positions, m.indices)).toBeGreaterThan(md * bl * h * 0.3);
      let top = 0, x = 0, y = 0;
      for (let i = 0; i < m.positions.length; i += 3) { top = Math.max(top, m.positions[i + 2]); x = Math.max(x, Math.abs(m.positions[i])); y = Math.max(y, Math.abs(m.positions[i + 1])); }
      expect(top).toBeGreaterThan(h * 0.85);
      expect(top).toBeLessThan(h * 1.08);
      expect(x).toBeLessThan(md / 2 + 0.4);
      expect(y).toBeLessThan(bl / 2 + 0.4);
      expect(m.colors.length).toBe(m.positions.length);
    }
  });
  it('flat-cusp library has shallower cusps than the youthful one on back teeth', () => {
    // Cusp depth: highest tip above the central fossa (the second-last vertex).
    const depth = (lib: string) => { const m = anatomicCrown(46, 11, 10.5, 7.5, 1, lib); let t = 0; for (let i = 2; i < m.positions.length; i += 3) t = Math.max(t, m.positions[i]); return t - m.positions[m.positions.length - 4]; };
    expect(depth('implant')).toBeLessThan(depth('youthful') * 0.65);
  });
  it('shades get darker and warmer from B1 to A3.5', () => {
    const mean = (s: string) => { const m = anatomicCrown(11, 8.5, 7, 10.5, 1, 'natural', s as never); let b = 0; for (let i = 2; i < m.colors.length; i += 3) b += m.colors[i]; return b; };
    const v = SHADE_IDS.map(mean);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThan(v[i - 1]);
  });
});
