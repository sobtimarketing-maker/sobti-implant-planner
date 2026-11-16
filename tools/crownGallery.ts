// Dev tool: renders every crown form in every library with the app's own engine,
// for checking the anatomy by eye. Not part of the app bundle.
import { Engine3D, SceneSurface } from '../src/render/vr/engine';
import { anatomicCrown, LIBRARIES, ShadeId } from '../src/core/crown/anatomy';
import { typicalSize } from '../src/core/crown/crown';

const q = new URLSearchParams(location.search);
const teeth = (q.get('teeth') ?? '11,12,13,14,15,16,17').split(',').map(Number);
const view = q.get('view') ?? 'buccal';
const shade = (q.get('shade') ?? 'A2') as ShadeId;
const libs = q.get('lib') ? LIBRARIES.filter((l) => l.id === q.get('lib')) : LIBRARIES;
const W = 1600, H = 380 * libs.length;
const e = new Engine3D();
e.setVolume({ dims: [2, 2, 2], spacing: [1, 1, 1], origin: [0, 0, 0], rowDir: [1, 0, 0], colDir: [0, 1, 0], normal: [0, 0, 1], factor: 1, sourceDims: [2, 2, 2], sourceSpacing: [1, 1, 1], data: new Int16Array(8).fill(-1000) });
const surfaces: SceneSurface[] = [];
let x0 = 0;
const rowGap = 16;
libs.forEach((lib, row) => {
  let x = 0;
  for (const fdi of teeth) {
    const [md, bl, h] = typicalSize(fdi);
    const m = anatomicCrown(fdi, md, bl, h, 1, lib.id, shade);
    const P = m.positions, out = new Float32Array(P.length);
    const cx = x + md / 2, cz = -row * rowGap;
    for (let i = 0; i < P.length; i += 3) {
      // Mesial to the left as seen from the cheek; cheek towards the viewer (-y).
      out[i] = cx + P[i]; out[i + 1] = -P[i + 1]; out[i + 2] = cz + P[i + 2];
      if (view === 'occlusal') { out[i + 1] = cz + P[i + 1] * 1; out[i + 2] = P[i + 2]; }
    }
    surfaces.push({ key: `${lib.id}:${fdi}`, color: [1, 1, 1], mesh: () => ({ positions: out, indices: m.indices, colors: m.colors }), vertexColors: true, material: 'enamel' });
    x += md + 1.5;
  }
  x0 = Math.max(x0, x);
});
const midZ = -((libs.length - 1) * rowGap) / 2;
const fov = 0.5, half = Math.tan(fov / 2);
const fit = Math.max((x0 / 2 + 4) / (half * (W / H)), (libs.length * rowGap) / 2 / half);
const camera = view === 'occlusal'
  ? { target: [x0 / 2, midZ, 4] as [number, number, number], yaw: 0, pitch: 1.5, dist: fit, fov }
  : { target: [x0 / 2, 0, midZ + 4] as [number, number, number], yaw: 0, pitch: Number(q.get('pitch') ?? 0.25), dist: fit * 1.05, fov };
document.body.style.cssText = 'margin:0;background:#050b16';
e.canvas.style.cssText = `width:${W}px;height:${H}px`;
document.body.append(e.canvas);
e.render({ width: W, height: H, camera, preset: 'bone' as never, clip: 'none' as never, cursor: null, surfaces, fast: false, volume: false });
const labels = document.createElement('div');
labels.style.cssText = 'position:absolute;left:8px;top:0;color:#cfd8e6;font:14px sans-serif';
labels.innerHTML = libs.map((l, i) => `<div style="position:absolute;top:${(H / libs.length) * i + 8}px;white-space:nowrap">${l.label}</div>`).join('');
document.body.append(labels);
(window as unknown as { done: boolean }).done = true;
