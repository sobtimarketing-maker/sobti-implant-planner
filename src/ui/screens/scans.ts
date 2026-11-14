// Step 4: Add scans. Load the intraoral scans (STL or OBJ) and line the
// treating arch up with the CBCT: tap 3 to 6 matching points on both, fit
// (Horn), then fine-tune on the tooth surfaces (trimmed ICP). The opposing
// arch rides along in the scanner's bite. Check on slices with the scan
// outline and a colour map of the distance; nudge by 0.1 mm / 0.1°.
import type { AppState } from '../../app/state';
import type { CaseRecord, CaseScans } from '../../core/case/model';
import type { Vec3, Volume } from '../../core/volume/volume';
import type { TriMesh } from '../../core/mesh/mesh';
import { bounds } from '../../core/mesh/mesh';
import { distanceColors, planeSegments, rayMesh } from '../../core/mesh/raycast';
import { apply, fitRigid, M4, mul, residuals, rotateAbout, translate } from '../../core/register/rigid';
import { icp, PointGrid, toothSurfacePoints } from '../../core/register/icp';
import { putScan, StoredScan } from '../../core/store/db';
import { autoWindow } from '../../render/mpr';
import { contains, samplePlane, volumeCenter } from '../../render/oblique';
import type { SceneSurface } from '../../render/vr/engine';
import { sphereMesh } from '../../render/vr/shapes';
import { h, icon } from '../dom';
import { ImageCanvas, ImageSource } from '../imageCanvas';
import { View3D } from '../view3d';
import { onScansChanged, scanMeshes, setScanMesh } from '../scanCache';
import type { RoiControl } from './viewer';

type Arch = 'upper' | 'lower';
type Slice = 'axial' | 'coronal' | 'sagittal';
const PAIR_COLORS: [number, number, number][] = [[0.98, 0.68, 0.29], [0.36, 0.89, 0.63], [0.5, 0.7, 1], [0.9, 0.3, 0.32], [0.75, 0.55, 1], [1, 0.47, 0.78], [0.84, 0.74, 0.49], [0.4, 0.9, 0.9]];
const css = (c: number[]) => `rgb(${c.map((x) => Math.round(x * 255)).join(',')})`;
const ARCH_NAME: Record<Arch, string> = { lower: 'Lower', upper: 'Upper' };

export interface ScansHandle { el: HTMLElement; dispose(): void; refresh(): void }

export function renderScans(s: AppState, c: CaseRecord, onChange: () => void, roi: RoiControl): ScansHandle {
  const v = s.volume!;
  const vols = (): Volume[] => { const r = roi.volume(); return r ? [r, v] : [v]; };
  const planned = c.plan.sites.map((x) => x.fdi);
  const sc: CaseScans = (c.scans ??= { treating: planned.length && planned.every((f) => Math.floor(f / 10) === 1 || Math.floor(f / 10) === 2) ? 'upper' : 'lower', pairs: [] });
  const meshes = scanMeshes(c.id);
  const showNumbers = s.mode !== 'patient';
  let busy = '';
  let message = '';
  let beforeTune: { m?: M4; residuals?: number[]; surfaceRms?: number; method?: CaseScans['method'] } | null = null;
  let colourMap = false;
  let heroMode: Slice | '3d' = '3d';
  const win = c.view?.ww ? { wc: c.view.wc, ww: c.view.ww } : autoWindow(v);
  const archCentre = c.anatomy.arch?.points.length ? c.anatomy.arch.points.reduce((a, p) => [a[0] + p[0] / c.anatomy.arch!.points.length, a[1] + p[1] / c.anatomy.arch!.points.length, a[2] + p[2] / c.anatomy.arch!.points.length] as Vec3, [0, 0, 0] as Vec3) : null;
  const ctPts = () => sc.pairs.map((p) => p.ct).filter(Boolean) as Vec3[];
  let checkPt: Vec3 = ctPts()[0] ?? (archCentre ? [archCentre[0], archCentre[1], archCentre[2] + 10] : [0, 0, 0]);
  // Cut for the CBCT point view: hide the other jaw above (or below) this level.
  const vc0 = volumeCenter(v), zHalf = (v.dims[2] * v.spacing[2]) / 2;
  let cutZ = archCentre ? archCentre[2] + (sc.treating === 'lower' ? 12 : -12) : volumeCenter(v)[2];
  const save = () => onChange();
  const treatingMesh = () => meshes.get(sc.treating);

  // ---------- loading files
  const fileInputs: Record<Arch, HTMLInputElement> = { lower: fileInput('lower'), upper: fileInput('upper') };
  function fileInput(arch: Arch): HTMLInputElement {
    const inp = h('input', { type: 'file', accept: '*/*', hidden: true, 'aria-label': `${ARCH_NAME[arch]} scan file` }) as HTMLInputElement;
    inp.addEventListener('change', () => { const f = inp.files?.[0]; inp.value = ''; if (f) loadFile(arch, f); });
    return inp;
  }
  function loadFile(arch: Arch, f: File) {
    busy = `Reading ${f.name}…`; message = ''; updatePanel();
    const w = new Worker('mesh.worker.js');
    w.onmessage = async (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'progress') { busy = `Reading ${f.name}… ${Math.round((m.done / m.total) * 100)}%`; updatePanel(); return; }
      w.terminate();
      if (m.type === 'error') { busy = ''; message = m.message; updatePanel(); return; }
      const stored: StoredScan = { full: m.full, display: m.display ?? m.full };
      sc[arch] = { name: f.name, vertices: stored.full.positions.length / 3, faces: stored.full.indices.length / 3 };
      if (arch === sc.treating) { sc.m = undefined; sc.residuals = undefined; sc.surfaceRms = undefined; }
      sc.extracted = sc.extracted?.filter((e) => e.arch !== arch);
      putScan(c.id, `${arch}:orig`, null).catch(() => undefined);
      setScanMesh(c.id, arch, stored);
      busy = 'Saving…'; updatePanel();
      try { await putScan(c.id, arch, stored); } catch { message = 'The scan could not be saved on this device (storage full?). It is shown for now.'; }
      busy = '';
      message ||= `${ARCH_NAME[arch]} scan added: ${sc[arch]!.faces.toLocaleString()} triangles.`;
      save(); mount(); updatePanel();
    };
    w.onerror = (e) => { w.terminate(); busy = ''; message = e.message || 'Could not read the file.'; updatePanel(); };
    w.postMessage({ file: f, id: 1 });
  }
  async function removeScan(arch: Arch) {
    sc[arch] = undefined;
    sc.extracted = sc.extracted?.filter((e) => e.arch !== arch);
    await putScan(c.id, `${arch}:orig`, null).catch(() => undefined);
    if (arch === sc.treating) { sc.m = undefined; sc.pairs = []; sc.residuals = undefined; sc.surfaceRms = undefined; }
    setScanMesh(c.id, arch, null);
    await putScan(c.id, arch, null).catch(() => undefined);
    save(); mount(); updatePanel();
  }

  // ---------- point pairs
  const nextIndex = (side: 'scan' | 'ct') => { const i = sc.pairs.findIndex((p) => !p[side]); return i >= 0 ? i : sc.pairs.length; };
  function addPoint(side: 'scan' | 'ct', p: Vec3) {
    const i = nextIndex(side);
    if (i >= 8) { message = 'Up to 8 pairs. Undo one to change it.'; updatePanel(); return; }
    sc.pairs[i] = { ...(sc.pairs[i] ?? {}), [side]: p };
    if (side === 'ct') checkPt = p;
    message = '';
    save(); views.forEach((x) => x.invalidate()); schedule(); updatePanel();
  }
  const complete = () => sc.pairs.filter((p) => p.scan && p.ct) as { scan: Vec3; ct: Vec3 }[];
  function lineUp() {
    const pr = complete();
    if (pr.length < 3) return;
    sc.m = fitRigid(pr.map((p) => p.scan), pr.map((p) => p.ct));
    sc.residuals = residuals(sc.m, pr.map((p) => p.scan), pr.map((p) => p.ct));
    sc.surfaceRms = undefined; sc.method = 'points';
    const worst = Math.max(...sc.residuals);
    message = worst > 1.5 ? 'One point is far off (over 1.5 mm). Check it matches the same spot on both, undo it and tap again.' : 'Lined up. Check the outline on the slices, then fine-tune.';
    colourMap = false; colourKey = '';
    save(); mount(); updatePanel();
  }
  function fineTune() {
    const m0 = sc.m, tm = treatingMesh();
    if (!m0 || !tm) return;
    busy = 'Fine-tuning on the tooth surfaces…'; updatePanel();
    setTimeout(() => {
      const t0 = performance.now();
      const centres = ctPts();
      const vol = vols().find((x) => centres.every((p) => contains(x, p))) ?? v;
      // Only the implant jaw: drop CT surface beyond the biting level of the tapped points,
      // so the opposing teeth cannot pull the scan.
      const zs = centres.map((p) => p[2]);
      const lower = sc.treating === 'lower', zLim = lower ? Math.max(...zs) + 1.5 : Math.min(...zs) - 1.5;
      const all = toothSurfacePoints(vol, 800, 1500, centres, 12), keepPts: number[] = [];
      for (let i = 0; i < all.length; i += 3) if (lower ? all[i + 2] <= zLim : all[i + 2] >= zLim) keepPts.push(all[i], all[i + 1], all[i + 2]);
      const target = new PointGrid(new Float32Array(keepPts), 1);
      const scanCentres = complete().map((p) => p.scan);
      const src: Vec3[] = [];
      const P = tm.display.positions;
      for (let i = 0; i < P.length; i += 3) {
        const q: Vec3 = [P[i], P[i + 1], P[i + 2]];
        if (scanCentres.some((s0) => (s0[0] - q[0]) ** 2 + (s0[1] - q[1]) ** 2 + (s0[2] - q[2]) ** 2 < 100)) src.push(q);
      }
      busy = '';
      if (target.size < 50 || src.length < 50) { message = 'Not enough tooth surface around the points to fine-tune. Add points on clear, unfilled teeth.'; updatePanel(); return; }
      const r = icp(src, target, m0, { iterations: 40, maxDist: 1.5, keep: 0.75 });
      // Guard: the surface must fit tightly, and the tapped points may not end up far away.
      // Taps are only as good as the finger, so moderate moves are allowed but reported.
      const pr = complete();
      const res = residuals(r.m, pr.map((p) => p.scan), pr.map((p) => p.ct));
      const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
      const worst = Math.max(...res);
      if (worst > 5 || r.rms > 0.5 || r.inliers < 200) {
        message = `Fine-tune could not find a tight fit near your points (surface ${r.rms.toFixed(2)} mm, points up to ${worst.toFixed(1)} mm away), so it was not applied. Check the points.`; updatePanel(); return;
      }
      beforeTune = { m: m0, residuals: sc.residuals, surfaceRms: sc.surfaceRms, method: sc.method };
      const moved = mean(res) > mean(sc.residuals ?? [0]) + 1;
      sc.m = r.m; sc.residuals = res; sc.surfaceRms = r.rms; sc.method = 'points+surface';
      message = `Fine-tuned in ${((performance.now() - t0) / 1000).toFixed(1)} s: the scan sits within ${r.rms.toFixed(2)} mm of the CBCT teeth.`
        + (moved ? ` It moved up to ${worst.toFixed(1)} mm from your points, so check the outline on the slices. Undo if it looks wrong.` : '');
      colourKey = '';
      save(); views.forEach((x) => x.invalidate()); refreshSlices(); updatePanel();
    }, 30);
  }
  function nudge(delta: M4) {
    if (!sc.m) return;
    sc.m = mul(delta, sc.m); sc.method = 'adjusted'; beforeTune = null;
    const pr = complete();
    sc.residuals = residuals(sc.m, pr.map((p) => p.scan), pr.map((p) => p.ct));
    colourKey = '';
    save(); views.forEach((x) => x.invalidate()); refreshSlices(); updatePanel();
  }

  // ---------- 3D surfaces
  const sphere = sphereMesh();
  let colourKey = '', colourMesh: TriMesh | null = null;
  function colouredTreating(): TriMesh | null {
    const tm = treatingMesh();
    if (!tm || !sc.m) return null;
    const key = sc.m.map((x) => x.toFixed(4)).join(',');
    if (key === colourKey && colourMesh) return colourMesh;
    const centres = ctPts();
    const vol = vols().find((x) => centres.every((p) => contains(x, p))) ?? v;
    const grid = new PointGrid(toothSurfacePoints(vol, 800, 1500, centres, 25), 1);
    const P = tm.display.positions, d = new Float32Array(P.length / 3);
    for (let i = 0; i < d.length; i++) { const r = grid.nearest(apply(sc.m, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]), 2); d[i] = r.i >= 0 ? r.d : Infinity; }
    colourMesh = { positions: P, indices: tm.display.indices, colors: distanceColors(d) };
    colourKey = key;
    return colourMesh;
  }
  const pairSurfaces = (side: 'scan' | 'ct', model?: M4): SceneSurface[] => sc.pairs.flatMap((p, i) => {
    const q = p[side];
    if (!q) return [];
    const w = model ? apply(model, q) : q;
    return [{ key: 'sphere', color: PAIR_COLORS[i % PAIR_COLORS.length], mesh: () => sphere, at: [w[0], w[1], w[2], 0.7] as [number, number, number, number] }];
  });

  // ---------- views
  const views: { draw(): void; dispose(): void; invalidate(): void }[] = [];
  const heroArea = h('div', { class: 'hero' });
  const thumbRow = h('div', { class: 'thumbs four' });
  let sliceViews: { kind: Slice; view: ImageCanvas; img: ImageSource & { origin: Vec3; u: Vec3; v: Vec3 } }[] = [];

  function sliceImage(kind: Slice): ImageSource & { origin: Vec3; u: Vec3; v: Vec3 } {
    const px = 0.2, size = 70, n = Math.round(size / px);
    const u: Vec3 = kind === 'sagittal' ? [0, 1, 0] : [1, 0, 0];
    const vv: Vec3 = kind === 'axial' ? [0, 1, 0] : [0, 0, -1];
    const origin: Vec3 = [checkPt[0] - (u[0] + vv[0]) * size / 2, checkPt[1] - (u[1] + vv[1]) * size / 2, checkPt[2] - (u[2] + vv[2]) * size / 2];
    const data = new Int16Array(n * n);
    samplePlane(vols(), origin, u, vv, px, n, n, data, true);
    return { w: n, h: n, pxW: px, pxH: px, data, origin, u, v: vv };
  }
  const NORMAL: Record<Slice, Vec3> = { axial: [0, 0, 1], coronal: [0, 1, 0], sagittal: [1, 0, 0] };
  const LETTERS: Record<Slice, [string, string, string, string]> = { axial: ['R', 'L', 'A', 'P'], coronal: ['R', 'L', 'S', 'I'], sagittal: ['A', 'P', 'S', 'I'] };
  function makeSlice(kind: Slice, compact: boolean): ImageCanvas {
    const entry = { kind, view: null as unknown as ImageCanvas, img: sliceImage(kind) };
    entry.view = new ImageCanvas({
      label: `${kind} slice with the scan outline`, window: () => win, compact, letters: () => LETTERS[kind],
      draw: (ctx, map, _k, dpr) => {
        if (!sc.m) return;
        const img = entry.img;
        for (const [arch, ms] of meshes) {
          const segs = planeSegments(ms.display, sc.m, checkPt, NORMAL[kind]);
          ctx.strokeStyle = arch === sc.treating ? '#FF5FC8' : '#7FD4FF';
          ctx.lineWidth = (compact ? 1 : 1.6) * dpr;
          ctx.beginPath();
          for (let i = 0; i < segs.length; i += 6) {
            const a = toImg(img, [segs[i], segs[i + 1], segs[i + 2]]), b = toImg(img, [segs[i + 3], segs[i + 4], segs[i + 5]]);
            const [ax, ay] = map(a[0], a[1]), [bx, by] = map(b[0], b[1]);
            ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
          }
          ctx.stroke();
        }
      },
      onScroll: compact ? undefined : (d, wheel) => { const n = NORMAL[kind]; const step = (wheel ? d : d) * 0.2 * (kind === 'axial' ? 1 : -1); checkPt = [checkPt[0] + n[0] * step, checkPt[1] + n[1] * step, checkPt[2] + n[2] * step]; refreshSlices(); },
      onDoubleTap: compact ? undefined : () => { heroMode = '3d'; mount(); },
    });
    entry.view.setImage(entry.img);
    sliceViews.push(entry);
    views.push(entry.view);
    return entry.view;
  }
  const toImg = (img: { origin: Vec3; u: Vec3; v: Vec3; pxW: number }, p: Vec3): [number, number] => {
    const d: Vec3 = [p[0] - img.origin[0], p[1] - img.origin[1], p[2] - img.origin[2]];
    return [(d[0] * img.u[0] + d[1] * img.u[1] + d[2] * img.u[2]) / img.pxW, (d[0] * img.v[0] + d[1] * img.v[1] + d[2] * img.v[2]) / img.pxW];
  };
  function refreshSlices() {
    for (const e of sliceViews) { e.img = sliceImage(e.kind); e.view.setImage(e.img); }
    views.forEach((x) => x.invalidate());
    schedule();
  }

  function mount() {
    views.forEach((x) => x.dispose());
    views.length = 0; sliceViews = [];
    heroArea.classList.remove('is3d');
    const tm = treatingMesh();
    if (!tm) {
      heroArea.replaceChildren(h('div', { class: 'hero-empty' },
        icon('tooth', 40),
        h('h3', null, sc[sc.treating] ? 'Loading the scan…' : `Add the ${ARCH_NAME[sc.treating].toLowerCase()} scan`),
        h('p', { class: 'muted' }, 'Use the STL or OBJ file from the intraoral scanner. The upper scan can be added too: it follows the lower one in the bite.')));
      thumbRow.replaceChildren();
      return;
    }
    if (!sc.m) {
      // Two 3D views side by side: the scan on its own, and the CBCT.
      const b = bounds(tm.display.positions);
      const centre: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      const scanView = new View3D({
        base: v, volume: () => false, cursor: () => null, home: () => ({ center: centre, size }),
        surfaces: () => [{ key: `scanraw:${c.id}:${sc.treating}`, color: [0.9, 0.86, 0.8], mesh: () => tm.display }, ...pairSurfaces('scan')],
        pickSurface: (ro, rd) => rayMesh(tm.full, ro, rd),
        setCursor: (p) => addPoint('scan', p),
      }, { bar: false, label: 'Mouth scan in 3D: tap a point' });
      scanView.look(0, sc.treating === 'lower' ? 55 : -55);
      const ctView = new View3D({
        base: v, cursor: () => null, home: archCentre ? () => ({ center: [archCentre[0], archCentre[1], archCentre[2] + 10], size: 75 }) : undefined,
        surfaces: () => pairSurfaces('ct'),
        clip: () => ({ mode: sc.treating === 'lower' ? 'lower' : 'upper', at: [0, 0, cutZ] }),
        setCursor: (p) => addPoint('ct', p),
      }, { label: 'CBCT in 3D: tap the same point' });
      ctView.look(0, sc.treating === 'lower' ? 55 : -55);
      views.push(scanView, ctView);
      heroArea.classList.add('is3d');
      heroArea.replaceChildren(h('div', { class: 'split even' },
        h('div', { class: 'split-a' }, scanView.el, h('span', { class: 'badge' }, `Scan: tap point ${nextIndex('scan') + 1}`)),
        h('div', { class: 'split-b' }, ctView.el, h('span', { class: 'badge' }, `CBCT: tap point ${nextIndex('ct') + 1}`))));
      thumbRow.replaceChildren();
      thumbRow.className = 'thumbs none';
    } else {
      const combined = (): SceneSurface[] => {
        const out: SceneSurface[] = [];
        for (const [arch, ms] of meshes) {
          if (arch === sc.treating && colourMap) { const cm = colouredTreating(); if (cm) { out.push({ key: `scanmap:${colourKey}`, color: [1, 1, 1], mesh: () => cm, model: sc.m, vertexColors: true }); continue; } }
          out.push({ key: `scan:${c.id}:${arch}:${ms.display.indices.length}`, color: arch === sc.treating ? [0.93, 0.62, 0.78] : [0.62, 0.8, 0.95], mesh: () => ms.display, model: sc.m });
        }
        return [...out, ...pairSurfaces('ct'), { key: 'sphere', color: [0.98, 0.82, 0.3], mesh: () => sphere, at: [...checkPt, 0.9] as [number, number, number, number] }];
      };
      const host3d = { base: v, cursor: () => checkPt, surfaces: combined, setCursor: (p: Vec3) => { checkPt = p; refreshSlices(); }, home: archCentre ? () => ({ center: [archCentre[0], archCentre[1], archCentre[2] + 10] as Vec3, size: 90 }) : undefined, pickSurface: (ro: Vec3, rd: Vec3) => Math.min(...[...meshes.values()].map((ms) => rayMesh(ms.display, ro, rd, sc.m))) };
      if (heroMode === '3d') {
        const big = new View3D(host3d, { label: 'CBCT with the mouth scans' });
        views.push(big);
        heroArea.classList.add('is3d');
        heroArea.replaceChildren(big.el, h('span', { class: 'badge' }, '3D: tap a spot to check it on the slices'));
      } else {
        const big = makeSlice(heroMode, false);
        heroArea.replaceChildren(big.el, h('span', { class: 'badge' }, `${heroMode[0].toUpperCase()}${heroMode.slice(1)}: scan outline in pink. Drag to move through.`));
      }
      thumbRow.className = 'thumbs four';
      const thumbs: HTMLElement[] = (['axial', 'coronal', 'sagittal'] as Slice[]).map((k) => {
        const tv = makeSlice(k, true);
        return h('button', { class: `thumb${heroMode === k ? ' active' : ''}`, 'aria-label': `Check on the ${k} slice`, onclick: () => { heroMode = heroMode === k ? '3d' : k; mount(); } }, tv.el, h('span', { class: 'badge small' }, `${k[0].toUpperCase()}${k.slice(1)}`));
      });
      const t3 = new View3D(host3d, { compact: true });
      views.push(t3);
      thumbs.push(h('button', { class: `thumb${heroMode === '3d' ? ' active' : ''}`, 'aria-label': 'Show 3D view', onclick: () => { heroMode = '3d'; mount(); } }, t3.el, h('span', { class: 'badge small' }, '3D')));
      thumbRow.replaceChildren(...thumbs);
    }
    schedule();
  }

  let raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; views.forEach((x) => x.draw()); }); }

  // ---------- side panel
  const panel = h('aside', { class: 'side-card card' });
  function updatePanel() {
    const body: (HTMLElement | null)[] = [];
    body.push(h('p', { class: 'muted small' }, 'Add the scans from the intraoral scanner (STL or OBJ). The jaw with the implant sites is lined up with the CBCT; the other jaw follows in the bite.'));
    for (const arch of ['lower', 'upper'] as Arch[]) {
      const info = sc[arch];
      body.push(h('div', { class: 'scan-row' },
        h('div', { class: 'scan-name' }, h('strong', null, `${ARCH_NAME[arch]} scan`), h('span', { class: 'muted small' }, info ? `${info.name}${showNumbers ? ` · ${info.faces.toLocaleString()} triangles` : ''}` : 'Not added')),
        h('button', { class: 'btn secondary small', disabled: !!busy, onclick: () => fileInputs[arch].click() }, info ? 'Replace' : 'Add file'),
        info ? h('button', { class: 'icon-btn small', 'aria-label': `Remove the ${arch} scan`, disabled: !!busy, onclick: () => removeScan(arch) }, icon('trash', 16)) : null,
        fileInputs[arch]));
    }
    body.push(h('h3', null, 'Implant jaw'),
      h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Implant jaw' },
        (['lower', 'upper'] as Arch[]).map((a) => h('button', { class: sc.treating === a ? 'on' : '', 'aria-pressed': String(sc.treating === a), onclick: () => { if (sc.treating === a) return; sc.treating = a; sc.m = undefined; sc.pairs = []; sc.residuals = undefined; sc.surfaceRms = undefined; save(); mount(); updatePanel(); } }, ARCH_NAME[a]))));
    if (treatingMesh()) {
      if (!sc.m) {
        body.push(h('h3', null, 'Line up'),
          h('p', { class: 'muted small' }, 'Tap the same spot on the scan (left) and on the CBCT (right): cusp tips or the edges of front teeth, on teeth away from the gap and without big fillings. 3 to 6 pairs, spread around the arch.'),
          h('label', { class: 'field' }, h('span', null, `CBCT cut: ${sc.treating === 'lower' ? 'hide above' : 'hide below'} this level`),
            h('input', { type: 'range', min: vc0[2] - zHalf, max: vc0[2] + zHalf, step: 0.5, value: cutZ, 'aria-label': 'CBCT cut level', oninput: (e: Event) => { cutZ = +(e.target as HTMLInputElement).value; views.forEach((x) => x.invalidate()); schedule(); } })));
      } else {
        body.push(h('h3', null, 'Fit'));
      }
      body.push(h('div', { class: 'pair-list' }, sc.pairs.map((p, i) => h('div', { class: 'pair-row' },
        h('span', { class: 'dot', style: `background:${css(PAIR_COLORS[i % PAIR_COLORS.length])}` }),
        h('span', null, `Point ${i + 1}`),
        h('span', { class: 'muted small' }, `${p.scan ? 'scan ✓' : 'scan –'}  ${p.ct ? 'CBCT ✓' : 'CBCT –'}`),
        showNumbers && sc.residuals && p.scan && p.ct ? h('span', { class: `small ${(sc.residuals[complete().indexOf(p as { scan: Vec3; ct: Vec3 })] ?? 0) > 1 ? 'warn-text' : 'ok-text'}` }, `${(sc.residuals[complete().indexOf(p as { scan: Vec3; ct: Vec3 })] ?? 0).toFixed(2)} mm`) : null))));
      if (!sc.m) {
        body.push(h('div', { class: 'row-btns' },
          h('button', { class: 'btn secondary', disabled: !sc.pairs.length, onclick: () => { const last = sc.pairs[sc.pairs.length - 1]; if (last?.ct) delete last.ct; else sc.pairs.pop(); if (last && !last.scan && !last.ct) sc.pairs.pop(); save(); views.forEach((x) => x.invalidate()); schedule(); mount(); updatePanel(); } }, icon('reset', 16), 'Undo'),
          h('button', { class: 'btn secondary', disabled: !sc.pairs.length, onclick: () => { sc.pairs = []; save(); mount(); updatePanel(); } }, icon('trash', 16), 'Clear')),
          h('button', { class: 'btn primary', disabled: complete().length < 3, onclick: lineUp }, `Line up (${complete().length} pairs)`));
      } else {
        const res = sc.residuals ?? [];
        const mean = res.length ? res.reduce((a, b) => a + b, 0) / res.length : 0;
        if (showNumbers) body.push(h('div', { class: 'stat' }, `Points: ${mean.toFixed(2)} mm average`, sc.surfaceRms !== undefined ? ` · Surface: ${sc.surfaceRms.toFixed(2)} mm` : ''));
        body.push(
          h('button', { class: 'btn primary', disabled: !!busy, onclick: fineTune }, sc.method === 'points+surface' ? 'Fine-tune again' : 'Fine-tune on the teeth'),
          h('div', { class: 'row-btns' },
            h('button', { class: `btn secondary${colourMap ? ' on' : ''}`, onclick: () => { colourMap = !colourMap; views.forEach((x) => x.invalidate()); schedule(); updatePanel(); } }, colourMap ? 'Hide fit colours' : 'Show fit colours'),
            beforeTune ? h('button', { class: 'btn secondary', onclick: () => { Object.assign(sc, beforeTune); beforeTune = null; message = 'Fine-tune undone.'; colourKey = ''; save(); views.forEach((x) => x.invalidate()); refreshSlices(); updatePanel(); } }, 'Undo fine-tune') : h('span'),
            h('button', { class: 'btn secondary', onclick: () => { beforeTune = null; sc.m = undefined; sc.residuals = undefined; sc.surfaceRms = undefined; heroMode = '3d'; save(); mount(); updatePanel(); } }, icon('reset', 16), 'Redo points')),
          colourMap ? h('p', { class: 'muted small' }, 'Green: within 0.3 mm of the CBCT tooth surface. Yellow to red: up to 1 mm or more. Red along the gum is normal: gum does not show on the CBCT.') : null,
        );
        if (s.mode === 'doctor') {
          const about = (): Vec3 => { const ct = ctPts(); return ct.length ? ct.reduce((a, p) => [a[0] + p[0] / ct.length, a[1] + p[1] / ct.length, a[2] + p[2] / ct.length] as Vec3, [0, 0, 0] as Vec3) : checkPt; };
          const nb = (label: string, d: () => M4) => h('button', { class: 'chip', onclick: () => nudge(d()) }, label);
          body.push(h('details', { class: 'tech' }, h('summary', null, 'Nudge (0.1 mm / 0.1°)'),
            h('div', { class: 'nudge' },
              h('span', { class: 'muted small' }, 'Move'),
              nb('← R', () => translate([-0.1, 0, 0])), nb('L →', () => translate([0.1, 0, 0])),
              nb('Front', () => translate([0, -0.1, 0])), nb('Back', () => translate([0, 0.1, 0])),
              nb('Up', () => translate([0, 0, 0.1])), nb('Down', () => translate([0, 0, -0.1])),
              h('span', { class: 'muted small' }, 'Turn'),
              nb('Tip ↑', () => rotateAbout([1, 0, 0], 0.1, about())), nb('Tip ↓', () => rotateAbout([1, 0, 0], -0.1, about())),
              nb('Roll ↺', () => rotateAbout([0, 1, 0], 0.1, about())), nb('Roll ↻', () => rotateAbout([0, 1, 0], -0.1, about())),
              nb('Turn ↺', () => rotateAbout([0, 0, 1], 0.1, about())), nb('Turn ↻', () => rotateAbout([0, 0, 1], -0.1, about())))));
        }
      }
    }
    panel.replaceChildren(
      h('h2', null, 'Mouth scans'),
      ...body.filter(Boolean) as HTMLElement[],
      busy ? h('div', { class: 'ok-line small' }, busy) : h('span'),
      message ? h('div', { class: /far off|not|could not|Not enough|Choose|No surface/i.test(message) ? 'warn-line' : 'ok-line small' }, message) : h('span'),
    );
  }

  const el = h('div', { class: 'viewer guided' }, h('div', { class: 'viewer-main' }, heroArea, thumbRow), panel);
  const off = onScansChanged(() => { if (!views.length || (treatingMesh() && !heroArea.querySelector('canvas'))) mount(); views.forEach((x) => x.invalidate()); schedule(); });
  const ro = new ResizeObserver(() => { views.forEach((x) => x.invalidate()); schedule(); });
  ro.observe(el);
  mount();
  updatePanel();
  return {
    el,
    refresh() { refreshSlices(); },
    dispose() { cancelAnimationFrame(raf); off(); ro.disconnect(); views.forEach((x) => x.dispose()); },
  };
}
