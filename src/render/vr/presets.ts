// Transfer functions for the 3D view: HU -> colour and opacity.
// The volume texture stores (HU + HU_MIN offset) / HU_SPAN in 8 bits (16 HU per step).
export const HU_MIN = -1000;
export const HU_SPAN = 4080;

export type PresetId = 'bone' | 'teeth' | 'skin';
// Control points: [HU, r, g, b, alpha] (alpha per 0.5 mm of travel).
const POINTS: Record<PresetId, number[][]> = {
  bone: [[-1000, 0, 0, 0, 0], [250, 0.55, 0.42, 0.33, 0], [500, 0.78, 0.68, 0.55, 0.08], [900, 0.93, 0.88, 0.78, 0.35], [1600, 0.97, 0.95, 0.9, 0.7], [2500, 1, 1, 1, 0.95], [3080, 1, 1, 1, 1]],
  teeth: [[-1000, 0, 0, 0, 0], [500, 0.6, 0.5, 0.4, 0], [1100, 0.75, 0.66, 0.55, 0.02], [1700, 0.95, 0.92, 0.85, 0.35], [2300, 1, 1, 0.98, 0.9], [3080, 1, 1, 1, 1]],
  skin: [[-1000, 0, 0, 0, 0], [-600, 0.75, 0.5, 0.42, 0], [-350, 0.86, 0.64, 0.55, 0.12], [100, 0.9, 0.7, 0.6, 0.25], [400, 0.92, 0.82, 0.72, 0.35], [1000, 0.96, 0.93, 0.86, 0.8], [3080, 1, 1, 1, 1]],
};

export const PRESET_LABELS: [PresetId, string][] = [['bone', 'Bone'], ['teeth', 'Teeth'], ['skin', 'Skin']];

/** 256-entry RGBA8 table over the stored 8-bit value. */
export function transferTable(id: PresetId): Uint8Array {
  const pts = POINTS[id];
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const hu = HU_MIN + (i / 255) * HU_SPAN;
    let k = 0;
    while (k < pts.length - 2 && pts[k + 1][0] < hu) k++;
    const a = pts[k], b = pts[k + 1];
    const f = Math.max(0, Math.min(1, (hu - a[0]) / (b[0] - a[0] || 1)));
    for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.round((a[c + 1] + (b[c + 1] - a[c + 1]) * f) * 255);
  }
  return out;
}

/** Lowest stored value with any opacity (for empty-space skipping). */
export function firstVisible(table: Uint8Array): number {
  for (let i = 0; i < 256; i++) if (table[i * 4 + 3] > 1) return i;
  return 255;
}

export function toStored(hu: number): number { return Math.max(0, Math.min(255, Math.round(((hu - HU_MIN) / HU_SPAN) * 255))); }
