// Device tiering and memory budget (spec section 2).

export type Tier = 'H' | 'M' | 'L';

export const TIERS: Record<Tier, { label: string; targetMm: number; note: string }> = {
  H: { label: 'High', targetMm: 0.3, note: '8 GB RAM or more' },
  M: { label: 'Medium', targetMm: 0.45, note: '6 GB RAM' },
  L: { label: 'Light', targetMm: 0.6, note: '4 GB RAM / phones' },
};

export const MEMORY_CAP_FRACTION = 0.35;

export interface DeviceProfile {
  ramGb: number;           // best estimate of device RAM
  ramSource: 'native' | 'browser' | 'assumed';
  cores: number;
  webgl2: boolean;
  max3dTexture: number;
  floatTextures: boolean;
  tier: Tier;
}

export function tierForRam(ramGb: number): Tier {
  // Browsers cap navigator.deviceMemory at 8, so 8 means "8 or more".
  if (ramGb >= 8) return 'H';
  if (ramGb >= 6) return 'M';
  return 'L';
}

/** Integer downsample factor that reaches at least the tier's target voxel size. */
export function factorFor(tier: Tier, sourceSpacingMm: number): number {
  return Math.max(1, Math.round(TIERS[tier].targetMm / sourceSpacingMm));
}

export function budgetBytes(ramGb: number): number {
  return ramGb * 1024 ** 3 * MEMORY_CAP_FRACTION;
}

/** Working-volume bytes (Int16) for dims reduced by factor f. */
export function workingBytes(dims: [number, number, number], f: number): number {
  return Math.ceil(dims[0] / f) * Math.ceil(dims[1] / f) * Math.ceil(dims[2] / f) * 2;
}

/**
 * Pick the factor for this device: start from the tier and step down
 * (coarser) until the working volume plus headroom fits the budget.
 * Headroom covers the ROI (about 60 MB), meshes and the GPU copy.
 */
export function chooseFactor(tier: Tier, dims: [number, number, number], spacing: number, ramGb: number, max3d = 2048): number {
  let f = factorFor(tier, spacing);
  const budget = budgetBytes(ramGb);
  const headroom = 160 * 1024 ** 2;
  while (f < 8 && (workingBytes(dims, f) * 2 + headroom > budget || Math.ceil(Math.max(...dims) / f) > max3d)) f++;
  return f;
}

export function probeDevice(nativeRamGb?: number): DeviceProfile {
  const nav = navigator as Navigator & { deviceMemory?: number };
  let ramGb = 4;
  let ramSource: DeviceProfile['ramSource'] = 'assumed';
  if (nativeRamGb) { ramGb = nativeRamGb; ramSource = 'native'; }
  else if (nav.deviceMemory) { ramGb = nav.deviceMemory; ramSource = 'browser'; }
  let webgl2 = false, max3dTexture = 0, floatTextures = false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (gl) {
      webgl2 = true;
      max3dTexture = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number;
      floatTextures = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('OES_texture_float_linear');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch { /* no WebGL */ }
  return {
    ramGb, ramSource,
    cores: nav.hardwareConcurrency ?? 4,
    webgl2, max3dTexture, floatTextures,
    tier: tierForRam(ramGb),
  };
}
