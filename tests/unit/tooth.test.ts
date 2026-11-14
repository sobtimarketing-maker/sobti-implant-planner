import { describe, expect, it } from 'vitest';
import { toothGrow, jawOf, rootLength } from '../../src/core/segment/toothGrow';
import { cropMask, maskAt } from '../../src/core/segment/regionGrow';
import type { Vec3, Volume } from '../../src/core/volume/volume';

// Synthetic lower tooth: a bright crown (box) above a dimmer root in bone of
// the same density as the root, with a dark gap above the crown.
function phantom(): Volume {
  const n = 120, sp = 0.3;
  const data = new Int16Array(n * n * n).fill(-1000);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = (i - 60) * sp, y = (j - 60) * sp, z = (k - 60) * sp;
    let v = -1000;
    if (z < 0) v = 1300;                                             // bone up to z = 0
    if (z >= 0 && z < 8 && Math.abs(x) < 4 && Math.abs(y) < 4.5) v = 2400; // crown
    if (z >= 0 && z < 8 && Math.abs(x - 9) < 4 && Math.abs(y) < 4.5) v = 2400; // neighbour, 1 mm away
    if (z >= 8 && z < 10) v = -800;                                  // occlusal gap
    if (z >= 10 && Math.abs(x) < 4 && Math.abs(y) < 4.5) v = 2400;   // opposing tooth
    data[i + n * (j + n * k)] = v;
  }
  return { dims: [n, n, n], spacing: [sp, sp, sp], origin: [-18, -18, -18], rowDir: [1, 0, 0], colDir: [0, 1, 0], normal: [0, 0, 1], data, factor: 1 } as unknown as Volume;
}

describe('tooth outline', () => {
  it('jaw and root length from the FDI number', () => {
    expect(jawOf(46)).toBe('lower'); expect(jawOf(16)).toBe('upper'); expect(jawOf(33)).toBe('lower');
    expect(rootLength(13)).toBe(16); expect(rootLength(46)).toBe(13);
  });
  it('outlines the crown, not the neighbour or the opposing tooth, and adds a root to the tip', () => {
    const v = phantom();
    const r = toothGrow(v, [0, 0, 4], 1900, { jaw: 'lower', rootMm: 12 })!;
    expect(r).not.toBeNull();
    expect(maskAt(r.mask, [0, 0, 4])).toBe(1);
    expect(maskAt(r.mask, [9, 0, 4])).toBe(0);       // neighbour
    expect(maskAt(r.mask, [0, 0, 12])).toBe(0);      // opposing tooth
    expect(maskAt(r.mask, [0, 0, -6])).toBe(1);      // root
    expect(maskAt(r.mask, [0, 0, -16])).toBe(0);     // past the tip
    expect(r.apex[2]).toBeLessThan(-10);
    // A tip set by the user moves the root.
    const r2 = toothGrow(v, [0, 0, 4], 1900, { jaw: 'lower', rootMm: 12, apex: [2, 0, -8] })!;
    expect(maskAt(r2.mask, [0, 0, -11])).toBe(0);
  });
  it('crops a mask without moving it', () => {
    const v = phantom();
    const r = toothGrow(v, [0, 0, 4], 1900, { jaw: 'lower', rootMm: 12 })!;
    const c = cropMask(r.mask, 0);
    for (const p of [[0, 0, 4], [0, 0, -6], [3.5, 4, 7]] as Vec3[]) expect(maskAt(c, p)).toBe(maskAt(r.mask, p));
  });
});
