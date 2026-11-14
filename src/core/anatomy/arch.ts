// Suggest an arch on one axial level: cast rays from behind the jaw through
// the bone and take the middle of the bone along each ray. The user then
// checks and drags the points.
import type { Vec3, Volume } from '../volume/volume';
import { samplePlane, volumeCenter } from '../../render/oblique';

export function suggestArch(v: Volume, z: number, count = 9): Vec3[] {
  const px = Math.max(0.4, Math.min(...v.spacing));
  const vc = volumeCenter(v);
  const ext = Math.max(v.dims[0] * v.spacing[0], v.dims[1] * v.spacing[1]);
  const n = Math.round(ext / px);
  const origin: Vec3 = [vc[0] - ext / 2, vc[1] - ext / 2, z];
  const img = new Int16Array(n * n);
  samplePlane([v], origin, [1, 0, 0], [0, 1, 0], px, n, n, img, false);
  // Bone threshold: half of the bright end of this slice, at least 300 HU.
  const sorted = Array.from(img).filter((x) => x > -500).sort((a, b) => a - b);
  if (sorted.length < 100) return [];
  const t = Math.max(300, sorted[Math.floor(sorted.length * 0.97)] * 0.5);
  let sx = 0, cnt = 0;
  const ys: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (img[y * n + x] > t) { sx += x; cnt++; ys.push(y); }
  if (cnt < 50) return [];
  ys.sort((a, b) => a - b);
  const ox = sx / cnt, oy = ys[Math.floor(ys.length * 0.95)];
  const pts: Vec3[] = [];
  for (let s = 0; s < count; s++) {
    // From patient right (screen left, angle 180°) over the front (270°) to patient left (360°).
    const a = ((185 + (170 * s) / (count - 1)) * Math.PI) / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const hits: number[] = [];
    for (let r = 2; r < n; r++) {
      const x = Math.round(ox + dx * r), y = Math.round(oy + dy * r);
      if (x < 0 || y < 0 || x >= n || y >= n) break;
      if (img[y * n + x] > t) hits.push(r);
    }
    if (hits.length < 3) continue;
    // Take the first continuous run of bone (the jaw), its middle.
    let end = 0;
    while (end + 1 < hits.length && hits[end + 1] - hits[end] <= 3) end++;
    const r = (hits[0] + hits[end]) / 2;
    pts.push([origin[0] + (ox + dx * r) * px, origin[1] + (oy + dy * r) * px, z]);
  }
  return pts;
}
