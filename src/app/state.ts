import type { CaseRecord } from '../core/case/model';
import type { DeviceProfile, Tier } from '../core/volume/budget';
import type { Volume } from '../core/volume/volume';

export type Mode = 'staff' | 'doctor' | 'patient';

export interface AppState {
  device: DeviceProfile;
  mode: Mode;
  tierOverride: Tier | null;
  current: CaseRecord | null;
  volume: Volume | null;
}

const MODE_KEY = 'planner.mode';
const TIER_KEY = 'planner.tier';

export function loadPrefs(): Pick<AppState, 'mode' | 'tierOverride'> {
  let mode: Mode = 'staff';
  let tierOverride: Tier | null = null;
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === 'doctor' || m === 'staff') mode = m; // patient view never persists
    const t = localStorage.getItem(TIER_KEY);
    if (t === 'H' || t === 'M' || t === 'L') tierOverride = t;
  } catch { /* storage unavailable */ }
  return { mode, tierOverride };
}

export function savePrefs(s: AppState): void {
  try {
    if (s.mode !== 'patient') localStorage.setItem(MODE_KEY, s.mode);
    if (s.tierOverride) localStorage.setItem(TIER_KEY, s.tierOverride);
    else localStorage.removeItem(TIER_KEY);
  } catch { /* ignore */ }
}

export const STEPS = [
  { label: 'Case & scan', ready: true },
  { label: 'Orientation', ready: true },
  { label: 'Arch and nerve', ready: false },
  { label: 'Add scans', ready: false },
  { label: 'Plan implant', ready: false },
  { label: 'Report', ready: false },
];
