// Step 3: Arch and nerve. Draw the arch on an axial slice, then use the
// panoramic + cross-section to trace the mandibular canal and outline teeth.
import type { AppState } from '../../app/state';
import { CaseRecord, LOWER, newId, toothName, UPPER } from '../../core/case/model';
import { jawOf, rootLength, toothGrow } from '../../core/segment/toothGrow';
import { DEFAULT_NERVE_RADIUS, insertPoint, Nerve, nerveTube, snapToCanal } from '../../core/anatomy/nerve';
import { maskAt, Mask, maskVolumeMm3, packMask, unpackMask } from '../../core/segment/regionGrow';
import { Vec3, Volume } from '../../core/volume/volume';
import { autoWindow, WINDOW_PRESETS } from '../../render/mpr';
import { contains, samplePlane, sampleWorld, volumeCenter } from '../../render/oblique';
import { archGeometry, crossSectionPlane, nearestSampler, PanoGeom, renderPano, worldToPano } from '../../render/pano';
import { h, icon } from '../dom';
import { ImageCanvas, ImageSource } from '../imageCanvas';
import type { RoiControl } from './viewer';
import { suggestArch } from '../../core/anatomy/arch';

type Mode = 'arch' | 'nerve' | 'teeth';
const NERVE_COLOR = '#E5484D';
const CS_W = 40, CS_H = 50; // cross-section field of view, mm

export interface AnatomyHandle { el: HTMLElement; dispose(): void; refresh(): void }

export function renderAnatomy(s: AppState, c: CaseRecord, onChange: () => void, roi: RoiControl): AnatomyHandle {
  const v = s.volume!;
  const an = c.anatomy;
  const vc = volumeCenter(v);
  const zExtent = v.dims[2] * v.spacing[2];
  const px = Math.min(...v.spacing);
  const showNumbers = s.mode !== 'patient';
  const win = c.view?.ww ? { wc: c.view.wc, ww: c.view.ww } : autoWindow(v);
  const getWin = () => win;

  let mode: Mode = an.arch && an.arch.points.length >= 3 ? 'nerve' : 'arch';
  let zArch = an.arch?.points[0]?.[2] ?? vc[2] - zExtent * 0.15;
  const arch = () => (an.arch ??= { points: [], slabMm: 10 });
  let geom: PanoGeom | null = null;
  let pano: ImageSource | null = null;
  let posIdx = 0;
  let posZ = zArch;
  let side: 'R' | 'L' = 'R';
  let radius = DEFAULT_NERVE_RADIUS;
  let lastPoint: Vec3 | null = null;
  let message = '';
  const planned = c.plan.sites.map((x) => x.fdi).sort((a, b) => a - b);
  // Teeth worth outlining: the neighbours of each planned implant site.
  const neighbours = [...new Set(planned.flatMap((f) => [f - 1, f + 1]).filter((f) => f % 10 >= 1 && f % 10 <= 8 && !planned.includes(f)))];
  const nextTooth = () => neighbours.find((f) => !an.teeth.some((t) => t.fdi === f));
  let toothFdi = nextTooth() ?? (planned.length ? planned[0] - 1 : 45);
  let apexFor: string | null = null;   // tooth id waiting for a root-tip tap
  let selTooth: string | null = null;  // tooth the root-tip button acts on
  // Default outline level: 90th percentile of bone-and-tooth voxels, which sits
  // between cortical bone and dentin on typical scans. Adjustable.
  let threshold = (() => {
    const d = v.data, vals: number[] = [];
    for (let i = 0; i < d.length; i += 97) if (d[i] > 300) vals.push(d[i]);
    vals.sort((a, b) => a - b);
    return vals.length ? Math.round(vals[Math.floor(vals.length * 0.9)] / 50) * 50 : 1800;
  })();
  const masks = new Map<string, Mask>();
  const maskOf = (t: CaseRecord['anatomy']['teeth'][number]) => { let m = masks.get(t.id); if (!m) { m = unpackMask(t.mask); masks.set(t.id, m); } return m; };
  const vols = (): Volume[] => { const r = roi.volume(); return r ? [r, v] : [v]; };
  const save = () => onChange();

  // ---------- geometry and images
  function rebuildGeom() {
    const a = an.arch;
    geom = a && a.points.length >= 3 ? archGeometry(a.points, v, px) : null;
    pano = null;
    if (geom) posIdx = Math.max(0, Math.min(geom.w - 1, posIdx || Math.floor(geom.w * 0.2)));
  }
  function panoImage(): ImageSource | null {
    if (!geom) return null;
    if (pano) return pano;
    const data = new Int16Array(geom.w * geom.h);
    renderPano([v], geom, arch().slabMm, data, nearestSampler(v));
    const overlay = new Uint8Array(geom.w * geom.h);
    an.teeth.forEach((t, ti) => {
      const m = maskOf(t);
      for (let x = 0; x < geom!.w; x++) {
        const p = geom!.curve.pos[x];
        for (let y = 0; y < geom!.h; y++) if (maskAt(m, [p[0], p[1], geom!.zTop - y * geom!.px])) overlay[y * geom!.w + x] = (ti % 7) + 1;
      }
    });
    pano = { w: geom.w, h: geom.h, pxW: geom.px, pxH: geom.px, data, overlay };
    return pano;
  }
  function crossImage(offsetMm = 0): (ImageSource & { origin: Vec3; u: Vec3; v: Vec3; px: number }) | null {
    if (!geom) return null;
    const i = Math.round(posIdx + offsetMm / geom.px);
    const pl = crossSectionPlane(geom, i);
    const center: Vec3 = [pl.center[0], pl.center[1], posZ];
    const r = roi.volume();
    const cpx = r && contains(r, center) ? Math.max(r.spacing[0], CS_W / 400) : px;
    const w = Math.round(CS_W / cpx), hh = Math.round(CS_H / cpx);
    const origin: Vec3 = [
      center[0] - pl.u[0] * (w / 2) * cpx - pl.v[0] * (hh / 2) * cpx,
      center[1] - pl.u[1] * (w / 2) * cpx - pl.v[1] * (hh / 2) * cpx,
      center[2] - pl.u[2] * (w / 2) * cpx - pl.v[2] * (hh / 2) * cpx,
    ];
    const data = new Int16Array(w * hh);
    samplePlane(vols(), origin, pl.u, pl.v, cpx, w, hh, data, true);
    let overlay: Uint8Array | undefined;
    if (an.teeth.length) {
      overlay = new Uint8Array(w * hh);
      an.teeth.forEach((t, ti) => {
        const m = maskOf(t);
        for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
          const p: Vec3 = [origin[0] + (pl.u[0] * x + pl.v[0] * y) * cpx, origin[1] + (pl.u[1] * x + pl.v[1] * y) * cpx, origin[2] + (pl.u[2] * x + pl.v[2] * y) * cpx];
          if (maskAt(m, p)) overlay![y * w + x] = (ti % 7) + 1;
        }
      });
    }
    return { w, h: hh, pxW: cpx, pxH: cpx, data, overlay, origin, u: pl.u, v: pl.v, px: cpx };
  }
  function axialImage(): ImageSource & { origin: Vec3 } {
    const ext = Math.max(v.dims[0] * v.spacing[0], v.dims[1] * v.spacing[1]);
    const n = Math.round(ext / px);
    const origin: Vec3 = [vc[0] - ext / 2, vc[1] - ext / 2, zArch];
    const data = new Int16Array(n * n);
    samplePlane([v], origin, [1, 0, 0], [0, 1, 0], px, n, n, data, true);
    return { w: n, h: n, pxW: px, pxH: px, data, origin };
  }

  // ---------- overlays
  const nerveFor = (sd: 'R' | 'L'): Nerve => {
    let n = an.nerves.find((x) => x.side === sd);
    if (!n) { n = { id: newId(), side: sd, points: [] }; an.nerves.push(n); }
    return n;
  };

  function drawAxialOverlay(img: ImageSource & { origin: Vec3 }) {
    return (ctx: CanvasRenderingContext2D, map: (x: number, y: number) => [number, number], k: number, dpr: number) => {
      const toImg = (p: Vec3): [number, number] => map((p[0] - img.origin[0]) / px, (p[1] - img.origin[1]) / px);
      if (geom) {
        const slab = arch().slabMm / 2;
        for (const [off, alpha, dash] of [[0, 1, false], [slab, 0.5, true], [-slab, 0.5, true]] as const) {
          ctx.strokeStyle = `rgba(251,174,73,${alpha})`;
          ctx.lineWidth = (off ? 1 : 2) * dpr;
          ctx.setLineDash(dash ? [5 * dpr, 5 * dpr] : []);
          ctx.beginPath();
          geom.curve.pos.forEach((p, i) => {
            const q = toImg([p[0] + geom!.normal[i][0] * off, p[1] + geom!.normal[i][1] * off, p[2]]);
            if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
          });
          ctx.stroke();
        }
        ctx.setLineDash([]);
        // Cross-section position
        const pl = crossSectionPlane(geom, posIdx);
        const a = toImg([pl.center[0] - pl.u[0] * 15, pl.center[1] - pl.u[1] * 15, 0]);
        const b = toImg([pl.center[0] + pl.u[0] * 15, pl.center[1] + pl.u[1] * 15, 0]);
        ctx.strokeStyle = '#5BE3A0'; ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      for (const n of an.nerves) {
        const t = nerveTube(n);
        ctx.strokeStyle = NERVE_COLOR; ctx.lineWidth = Math.max(2 * dpr, (2 * (n.points[0]?.r ?? 1) / px) * k);
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        t.forEach((q, i) => { const s2 = toImg(q.p); if (i) ctx.lineTo(s2[0], s2[1]); else ctx.moveTo(s2[0], s2[1]); });
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      (an.arch?.points ?? []).forEach((p, i) => {
        const [x, y] = toImg(p);
        ctx.fillStyle = '#FBAE49';
        ctx.beginPath(); ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0E2A57'; ctx.font = `700 ${10 * dpr}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x, y);
      });
    };
  }

  function drawPanoOverlay(ctx: CanvasRenderingContext2D, map: (x: number, y: number) => [number, number], k: number, dpr: number) {
    if (!geom) return;
    for (const n of an.nerves) {
      const t = nerveTube(n);
      if (!t.length) continue;
      ctx.strokeStyle = NERVE_COLOR; ctx.globalAlpha = 0.75; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2 * dpr, (2 * t[0].r / geom.px) * k);
      ctx.beginPath();
      t.forEach((q, i) => { const pp = worldToPano(geom!, q.p); const [x, y] = map(pp.x, pp.y); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke(); ctx.globalAlpha = 1;
      for (const q of n.points) { const pp = worldToPano(geom, q.p); const [x, y] = map(pp.x, pp.y); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2); ctx.fill(); }
      if (n.foramen) { const pp = worldToPano(geom, n.foramen); const [x, y] = map(pp.x, pp.y); ring(ctx, x, y, 9 * dpr, '#FBAE49', dpr); }
    }
    const [x, y] = map(posIdx, (geom.zTop - posZ) / geom.px);
    ctx.strokeStyle = '#5BE3A0'; ctx.lineWidth = 2 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(x, map(0, 0)[1]); ctx.lineTo(x, map(0, geom.h)[1]); ctx.stroke(); ctx.setLineDash([]);
    ring(ctx, x, y, 5 * dpr, '#5BE3A0', dpr);
    // Planned sites: label the pano with tooth numbers where outlined teeth sit.
    an.teeth.forEach((t) => { const pp = worldToPano(geom!, t.seed); const [tx, ty] = map(pp.x, pp.y); label(ctx, String(t.fdi), tx, ty - 24 * dpr, dpr); });
  }

  function drawCrossOverlay(img: ReturnType<typeof crossImage>) {
    return (ctx: CanvasRenderingContext2D, map: (x: number, y: number) => [number, number], k: number, dpr: number) => {
      if (!img || !geom) return;
      const toImg = (p: Vec3): [number, number] => {
        const d: Vec3 = [p[0] - img.origin[0], p[1] - img.origin[1], p[2] - img.origin[2]];
        return map((d[0] * img.u[0] + d[1] * img.u[1] + d[2] * img.u[2]) / img.px, (d[0] * img.v[0] + d[1] * img.v[1] + d[2] * img.v[2]) / img.px);
      };
      const pl = crossSectionPlane(geom, posIdx);
      const sd = (p: Vec3) => (p[0] - pl.center[0]) * pl.n[0] + (p[1] - pl.center[1]) * pl.n[1] + (p[2] - pl.center[2]) * pl.n[2];
      for (const n of an.nerves) {
        const t = nerveTube(n);
        for (let i = 0; i < t.length - 1; i++) {
          const a = sd(t[i].p), b = sd(t[i + 1].p);
          if ((a > 0) === (b > 0)) continue;
          const f = a / (a - b);
          const p: Vec3 = [t[i].p[0] + (t[i + 1].p[0] - t[i].p[0]) * f, t[i].p[1] + (t[i + 1].p[1] - t[i].p[1]) * f, t[i].p[2] + (t[i + 1].p[2] - t[i].p[2]) * f];
          const r = (t[i].r / img.px) * k;
          const [x, y] = toImg(p);
          ctx.fillStyle = 'rgba(229,72,77,0.35)'; ctx.strokeStyle = NERVE_COLOR; ctx.lineWidth = 2 * dpr;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        for (const q of n.points) if (Math.abs(sd(q.p)) < 0.5) { const [x, y] = toImg(q.p); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2); ctx.fill(); }
        if (n.foramen && Math.abs(sd(n.foramen)) < 1) { const [x, y] = toImg(n.foramen); ring(ctx, x, y, 10 * dpr, '#FBAE49', dpr); }
      }
      // Arch centre marker
      const [cx, cy] = toImg([pl.center[0], pl.center[1], posZ]);
      ctx.strokeStyle = 'rgba(251,174,73,.8)'; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(cx - 8 * dpr, cy); ctx.lineTo(cx + 8 * dpr, cy); ctx.moveTo(cx, cy - 8 * dpr); ctx.lineTo(cx, cy + 8 * dpr); ctx.stroke();
      if (lastPoint && Math.abs(sd(lastPoint)) < 0.5) { const [x, y] = toImg(lastPoint); ring(ctx, x, y, 6 * dpr, '#FFFFFF', dpr); }
    };
  }

  // ---------- views
  const views: ImageCanvas[] = [];
  let heroArea = h('div', { class: 'hero' });
  const thumbRow = h('div', { class: 'thumbs' });
  const slider = h('input', { type: 'range', step: 'any', 'aria-label': 'Position' }) as HTMLInputElement;
  const sliderLabel = h('span', { class: 'slider-label' });
  let axialView: ImageCanvas | null = null, panoView: ImageCanvas | null = null, crossView: ImageCanvas | null = null;
  let crossCur: ReturnType<typeof crossImage> = null;
  const thumbsCs: { view: ImageCanvas; off: number }[] = [];
  let axialImg: ReturnType<typeof axialImage> | null = null;

  function mount() {
    views.forEach((x) => x.dispose());
    views.length = 0; thumbsCs.length = 0;
    axialView = panoView = crossView = null;
    if (mode === 'arch') {
      axialImg = axialImage();
      axialView = new ImageCanvas({
        label: 'Axial slice for the arch', window: getWin, letters: () => ['R', 'L', 'A', 'P'],
        draw: (ctx, map, k, dpr) => drawAxialOverlay(axialImg!)(ctx, map, k, dpr),
        onTap: (x, y) => {
          const p: Vec3 = [axialImg!.origin[0] + x * px, axialImg!.origin[1] + y * px, zArch];
          arch().points.push(p); afterArchEdit();
        },
        onDrag: (phase, x, y) => dragArchPoint(phase, x, y),
        onScroll: (d, wheel) => { zArch += wheel ? -d * px : -d * px; refreshAxial(); },
      });
      axialView.setImage(axialImg);
      views.push(axialView);
      heroArea.replaceChildren(axialView.el, h('span', { class: 'badge' }, 'Axial: tap along the jaw'),
        h('div', { class: 'hero-slider' }, h('span', null, 'Level'), slider, sliderLabel));
      slider.min = String(vc[2] - zExtent / 2); slider.max = String(vc[2] + zExtent / 2); slider.value = String(zArch);
      sliderLabel.textContent = `${zArch.toFixed(1)} mm`;
      slider.oninput = () => { zArch = +slider.value; refreshAxial(); };
      // thumbnails: pano and cross-section
      const pv = new ImageCanvas({ label: 'Panoramic', window: getWin, compact: true, draw: drawPanoOverlay });
      pv.setImage(panoImage());
      const cs = crossImage();
      const cv = new ImageCanvas({ label: 'Cross-section', window: getWin, compact: true, draw: drawCrossOverlay(cs) });
      cv.setImage(cs);
      views.push(pv, cv);
      thumbRow.className = 'thumbs two';
      thumbRow.replaceChildren(
        h('button', { class: 'thumb', 'aria-label': 'Open panoramic', disabled: !geom, onclick: () => setMode('nerve') }, pv.el, h('span', { class: 'badge small' }, geom ? 'Panoramic' : 'Panoramic (draw the arch first)')),
        h('button', { class: 'thumb', 'aria-label': 'Open cross-section', disabled: !geom, onclick: () => setMode('nerve') }, cv.el, h('span', { class: 'badge small' }, 'Cross-section')),
      );
    } else {
      panoView = new ImageCanvas({
        label: 'Panoramic', window: getWin, letters: () => ['R', 'L', 'S', 'I'], draw: drawPanoOverlay,
        onTap: (x, y) => { posIdx = Math.max(0, Math.min(geom!.w - 1, Math.round(x))); posZ = geom!.zTop - y * geom!.px; refreshCross(); panoView!.invalidate(); schedule(); },
        onDoubleTap: () => toggleBig('a'),
      });
      panoView.setImage(panoImage());
      crossCur = crossImage();
      crossView = new ImageCanvas({
        label: 'Cross-section', window: getWin, letters: () => ['Buccal', 'Lingual', 'S', 'I'],
        draw: (ctx, map, k, dpr) => drawCrossOverlay(crossCur)(ctx, map, k, dpr),
        onTap: (x, y) => crossTap(x, y),
        onDoubleTap: () => toggleBig('b'), deferTap: true,
        onScroll: (d, wheel) => { if (wheel) { posIdx = clampIdx(posIdx + d); refreshCross(); } },
      });
      crossView.setImage(crossCur);
      views.push(panoView, crossView);
      const split = h('div', { class: 'split' + (bigOne ? ` only-${bigOne}` : '') },
          h('div', { class: 'split-a' }, panoView.el, h('span', { class: 'badge' }, 'Panoramic: tap to go there')),
          h('div', { class: 'split-b' }, crossView.el, h('span', { class: 'badge' }, mode === 'nerve' ? 'Cross-section: tap the canal' : 'Cross-section: tap inside a tooth')));
      heroArea.replaceChildren(split,
        h('div', { class: 'hero-slider' }, h('span', null, 'Along the arch'), slider, sliderLabel));
      slider.min = '0'; slider.max = String(geom!.w - 1); slider.value = String(posIdx);
      slider.oninput = () => { posIdx = clampIdx(+slider.value); refreshCross(); };
      thumbRow.className = 'thumbs';
      const ax = new ImageCanvas({ label: 'Axial arch', window: getWin, compact: true, draw: (ctx, map, k, dpr) => drawAxialOverlay(axialImg!)(ctx, map, k, dpr) });
      axialImg = axialImage();
      ax.setImage(axialImg);
      views.push(ax);
      const thumbs: HTMLElement[] = [h('button', { class: 'thumb', 'aria-label': 'Edit the arch', onclick: () => setMode('arch') }, ax.el, h('span', { class: 'badge small' }, 'Arch'))];
      for (const off of [-2, 2]) {
        const img = crossImage(off);
        const tv = new ImageCanvas({ label: `Cross-section ${off} mm`, window: getWin, compact: true, draw: (ctx, map, k, dpr) => drawCrossOverlay(crossImage(off))(ctx, map, k, dpr) });
        tv.setImage(img);
        views.push(tv);
        thumbsCs.push({ view: tv, off });
        thumbs.push(h('button', { class: 'thumb', 'aria-label': `Move ${off} mm along the arch`, onclick: () => { posIdx = clampIdx(posIdx + off / geom!.px); refreshCross(); } }, tv.el, h('span', { class: 'badge small' }, `${off > 0 ? '+' : ''}${off} mm`)));
      }
      thumbRow.replaceChildren(...thumbs);
      updateSliderLabel();
    }
    schedule();
  }

  // Double tap the panoramic (a) or cross-section (b) to fill the big area
  // with it; double tap again to show both.
  let bigOne: 'a' | 'b' | null = null;
  function toggleBig(which: 'a' | 'b') {
    bigOne = bigOne === which ? null : which;
    const split = heroArea.querySelector('.split');
    split?.classList.remove('only-a', 'only-b');
    if (bigOne) split?.classList.add(`only-${bigOne}`);
    panoView?.resetView(); crossView?.resetView();
    views.forEach((x) => x.invalidate());
    schedule();
  }

  const clampIdx = (i: number) => Math.max(0, Math.min((geom?.w ?? 1) - 1, Math.round(i)));
  function updateSliderLabel() { if (geom && mode !== 'arch') sliderLabel.textContent = `${(posIdx * geom.px).toFixed(1)} / ${geom.curve.length.toFixed(0)} mm`; }

  let raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; views.forEach((x) => x.draw()); }); }
  function refreshAxial() {
    axialImg = axialImage();
    axialView?.setImage(axialImg);
    slider.value = String(zArch);
    sliderLabel.textContent = `${zArch.toFixed(1)} mm`;
    schedule();
  }
  function refreshCross() {
    if (!geom) return;
    crossCur = crossImage();
    crossView?.setImage(crossCur);
    for (const t of thumbsCs) t.view.setImage(crossImage(t.off));
    panoView?.invalidate();
    slider.value = String(posIdx);
    updateSliderLabel();
    schedule();
  }
  function afterArchEdit() {
    rebuildGeom(); save(); mount(); updatePanel();
  }

  let dragIdx = -1;
  function dragArchPoint(phase: 'start' | 'move' | 'end', x: number, y: number): boolean {
    const pts = an.arch?.points ?? [];
    if (phase === 'start') {
      const p: Vec3 = [axialImg!.origin[0] + x * px, axialImg!.origin[1] + y * px, zArch];
      dragIdx = pts.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 3);
      return dragIdx >= 0;
    }
    if (dragIdx < 0) return false;
    pts[dragIdx] = [axialImg!.origin[0] + x * px, axialImg!.origin[1] + y * px, zArch];
    if (phase === 'end') { dragIdx = -1; afterArchEdit(); } else { axialView?.invalidate(); schedule(); }
    return true;
  }

  function crossTap(x: number, y: number) {
    const img = crossCur;
    if (!img) return;
    if (mode === 'nerve') {
      const [sx, sy] = snapToCanal(img.data, img.w, img.h, x, y, 1.5 / img.px);
      const p: Vec3 = [img.origin[0] + (img.u[0] * sx + img.v[0] * sy) * img.px, img.origin[1] + (img.u[1] * sx + img.v[1] * sy) * img.px, img.origin[2] + (img.u[2] * sx + img.v[2] * sy) * img.px];
      insertPoint(nerveFor(side), { p, r: radius });
      lastPoint = p;
      message = sx !== Math.round(x) || sy !== Math.round(y) ? 'Point snapped to the canal.' : '';
      save(); refreshCross(); updatePanel();
    } else if (mode === 'teeth' && apexFor) {
      const t = an.teeth.find((q) => q.id === apexFor);
      apexFor = null;
      if (!t) return;
      const p: Vec3 = [img.origin[0] + (img.u[0] * x + img.v[0] * y) * img.px, img.origin[1] + (img.u[1] * x + img.v[1] * y) * img.px, img.origin[2] + (img.u[2] * x + img.v[2] * y) * img.px];
      t.apex = p;
      growTooth(t.seed, t.id);
    } else if (mode === 'teeth') {
      // Seed at the brightest spot within 1 mm of the tap (inside the dentin).
      const r = Math.max(1, Math.round(1 / img.px));
      let bx = Math.round(x), by = Math.round(y), bv = -Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
        if (dx * dx + dy * dy > r * r || xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) continue;
        if (img.data[yy * img.w + xx] > bv) { bv = img.data[yy * img.w + xx]; bx = xx; by = yy; }
      }
      x = bx; y = by;
      const p: Vec3 = [img.origin[0] + (img.u[0] * x + img.v[0] * y) * img.px, img.origin[1] + (img.u[1] * x + img.v[1] * y) * img.px, img.origin[2] + (img.u[2] * x + img.v[2] * y) * img.px];
      growTooth(p);
    }
  }

  function growTooth(seed: Vec3, replaceId?: string) {
    const vol = vols().find((x) => contains(x, seed)) ?? v;
    const hu = sampleWorld([vol], seed);
    const old = an.teeth.find((t) => t.id === replaceId);
    const fdi = old?.fdi ?? toothFdi;
    const r = toothGrow(vol, seed, threshold, { jaw: jawOf(fdi), rootMm: rootLength(fdi), apex: old?.apex });
    if (!r) { message = `That spot is ${hu} HU, below the outline level (${threshold} HU). Tap inside the tooth or lower the level.`; updatePanel(); return; }
    const m = r.mask;
    const entry: CaseRecord['anatomy']['teeth'][number] = { id: replaceId ?? newId(), fdi, seed, threshold, volumeMm3: maskVolumeMm3(m), mask: packMask(m), apex: old?.apex };
    masks.set(entry.id, m);
    const i = an.teeth.findIndex((t) => t.id === replaceId);
    if (i >= 0) an.teeth[i] = entry; else an.teeth.push(entry);
    selTooth = entry.id;
    message = r.wide
      ? `Tooth ${fdi} outlined, but the crown may touch the next tooth. If it looks too wide, raise the outline level and redo it.`
      : `Tooth ${fdi} outlined (${entry.volumeMm3.toFixed(0)} mm³). ${entry.apex ? 'Root ends at the tip you set.' : 'Root length is typical for this tooth; set the root tip if it is off.'}`;
    if (!replaceId) toothFdi = nextTooth() ?? toothFdi;
    lastPoint = seed;
    pano = null;
    save(); panoView?.setImage(panoImage()); refreshCross(); updatePanel();
  }

  function setMode(m: Mode) {
    if (m !== 'arch' && !geom) return;
    mode = m; message = '';
    mount(); updatePanel();
  }

  // ---------- side panel
  const panel = h('aside', { class: 'side-card card' });
  function updatePanel() {
    const a = an.arch;
    const tabs = h('div', { class: 'tool-grid three', role: 'group', 'aria-label': 'Task' },
      ([['arch', 'Arch'], ['nerve', 'Nerve'], ['teeth', 'Teeth']] as [Mode, string][]).map(([m, l]) => h('button', {
        class: `tool${mode === m ? ' on' : ''}`, 'aria-pressed': String(mode === m), disabled: m !== 'arch' && !geom, onclick: () => setMode(m),
      }, l)));
    const body: (HTMLElement | null)[] = [];
    if (mode === 'arch') {
      body.push(
        h('p', { class: 'muted small' }, 'Move the level to the middle of the roots. Tap 5 to 8 points along the centre of the jaw, from the patient\'s right to left. Drag a point to move it.'),
        h('button', { class: 'btn secondary', onclick: () => {
          const pts = suggestArch(v, zArch);
          if (pts.length < 3) { message = 'No jaw found at this level. Move the level into the jaw bone and try again.'; updatePanel(); return; }
          arch().points = pts; message = 'Arch suggested. Check it follows the middle of the jaw and drag any point that is off.'; afterArchEdit();
        } }, icon('tooth', 18), 'Suggest arch at this level'),
        h('div', { class: 'stat' }, `${a?.points.length ?? 0} points`, geom ? ` · ${geom.curve.length.toFixed(0)} mm` : ''),
        h('h3', null, 'Panoramic thickness'),
        h('div', { class: 'chips' }, [5, 10, 15, 20].map((mm) => h('button', { class: `chip${arch().slabMm === mm ? ' on' : ''}`, onclick: () => { arch().slabMm = mm; pano = null; save(); mount(); updatePanel(); } }, `${mm} mm`))),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn secondary', disabled: !a?.points.length, onclick: () => { a?.points.pop(); afterArchEdit(); } }, icon('reset', 16), 'Undo point'),
          h('button', { class: 'btn secondary', disabled: !a?.points.length, onclick: () => { if (a) a.points = []; afterArchEdit(); } }, icon('trash', 16), 'Clear')),
        geom ? h('button', { class: 'btn primary', onclick: () => setMode('nerve') }, 'Trace the nerve', icon('next')) : null,
      );
    } else if (mode === 'nerve') {
      const nr = an.nerves.find((n) => n.side === 'R'), nl = an.nerves.find((n) => n.side === 'L');
      body.push(
        h('p', { class: 'muted small' }, 'Tap the canal on the panoramic to go there, then tap its centre in the cross-section. Add a point every 5 to 10 mm, from the mental foramen back to the ramus. Double-tap a view to make it big, and again to go back.'),
        h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Nerve side' },
          ([['R', `Right (${nr?.points.length ?? 0})`], ['L', `Left (${nl?.points.length ?? 0})`]] as const).map(([sd, l]) => h('button', { class: side === sd ? 'on' : '', 'aria-pressed': String(side === sd), onclick: () => { side = sd; updatePanel(); } }, l))),
        h('h3', null, 'Canal radius'),
        h('div', { class: 'chips' }, [1.0, 1.2, 1.5].map((r) => h('button', { class: `chip${radius === r ? ' on' : ''}`, onclick: () => { radius = r; const n = an.nerves.find((x) => x.side === side); n?.points.forEach((q) => { q.r = r; }); save(); refreshCross(); updatePanel(); } }, `${r.toFixed(1)} mm`))),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn secondary', disabled: !lastPoint, onclick: () => { const n = nerveFor(side); n.foramen = lastPoint!; save(); refreshCross(); message = 'Mental foramen marked.'; updatePanel(); } }, 'Mark foramen here')),
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn secondary', onclick: () => { const n = nerveFor(side); const i = n.points.findIndex((q) => q.p === lastPoint); n.points.splice(i >= 0 ? i : n.points.length - 1, 1); lastPoint = null; save(); refreshCross(); updatePanel(); } }, icon('reset', 16), 'Undo'),
          h('button', { class: 'btn secondary', onclick: () => { an.nerves = an.nerves.filter((n) => n.side !== side); save(); refreshCross(); updatePanel(); } }, icon('trash', 16), 'Delete nerve')),
        roiButtons(),
      );
    } else {
      const fdis = [...LOWER, ...UPPER];
      body.push(
        h('p', { class: 'muted small' }, 'Optional. Outline the teeth next to each implant site so the plan can keep a safe distance from them. Pick the tooth number, then tap the middle of its crown on the cross-section. Double-tap a view to make it big.'),
        h('label', { class: 'field' }, h('span', null, 'Tooth'),
          h('select', { onchange: (e: Event) => { toothFdi = +(e.target as HTMLSelectElement).value; } },
            fdis.map((f) => h('option', { value: f, selected: f === toothFdi }, `${f} · ${toothName(f)}`)))),
        h('label', { class: 'field' }, h('span', null, `Outline level: ${threshold} HU`),
          h('input', { type: 'range', min: 300, max: 4000, step: 50, value: threshold, oninput: (e: Event) => { threshold = +(e.target as HTMLInputElement).value; (e.target as HTMLElement).previousElementSibling!.textContent = `Outline level: ${threshold} HU`; } })),
        h('div', { class: 'measure-list' }, an.teeth.map((t, i) => h('div', { class: 'measure-row' },
          h('button', { class: `measure-go${selTooth === t.id ? ' on' : ''}`, 'aria-label': `Select tooth ${t.fdi}`, onclick: () => { selTooth = t.id; apexFor = null; updatePanel(); } }, h('span', { class: 'dot', style: `background:rgb(${[91, 227, 160, 127, 178, 255, 239, 176, 92, 229, 72, 77, 213, 188, 124, 190, 140, 255, 255, 120, 200].slice((i % 7) * 3, (i % 7) * 3 + 3).join(',')})` }), `Tooth ${t.fdi}`, showNumbers ? h('span', { class: 'muted small' }, ` ${t.volumeMm3.toFixed(0)} mm³`) : null),
          h('button', { class: 'icon-btn small', 'aria-label': `Redo tooth ${t.fdi} at the current level`, onclick: () => growTooth(t.seed, t.id) }, icon('reset', 16)),
          h('button', { class: 'icon-btn small', 'aria-label': `Delete tooth ${t.fdi}`, onclick: () => { an.teeth.splice(i, 1); masks.delete(t.id); pano = null; save(); mount(); updatePanel(); } }, icon('trash', 16)),
        ))),
        (() => {
          const t = an.teeth.find((q) => q.id === selTooth) ?? an.teeth[an.teeth.length - 1];
          if (!t) return null;
          return h('div', { class: 'row-btns' },
            h('button', { class: `btn secondary${apexFor === t.id ? ' on' : ''}`, onclick: () => { apexFor = apexFor === t.id ? null : t.id; message = apexFor ? `Tap the root tip of tooth ${t.fdi} on the cross-section.` : ''; updatePanel(); } },
              apexFor === t.id ? 'Cancel' : `Set root tip, tooth ${t.fdi}`));
        })(),
        roiButtons(),
      );
    }
    panel.replaceChildren(
      h('h2', null, 'Arch and nerve'),
      tabs,
      ...body.filter(Boolean) as HTMLElement[],
      message ? h('div', { class: message.includes('below') || message.includes('touch') || message.startsWith('No jaw') ? 'warn-line' : 'ok-line small' }, message) : h('span'),
      h('h3', null, 'Brightness'),
      h('div', { class: 'chips' }, [{ label: 'Auto', ...autoWindow(v) }, ...WINDOW_PRESETS.slice(0, 2)].map((p) => h('button', { class: 'chip', onclick: () => { win.wc = p.wc; win.ww = p.ww; views.forEach((x) => x.invalidateContent()); schedule(); } }, p.label))),
    );
  }
  function roiButtons(): HTMLElement {
    const r = roi.volume();
    const here = geom ? ([...crossSectionPlane(geom, posIdx).center.slice(0, 2), posZ] as Vec3) : null;
    return h('div', null,
      h('h3', null, 'Full detail'),
      h('div', { class: 'muted small' }, r && here && contains(r, here) ? `Sharp ${r.spacing[0].toFixed(2)} mm detail at this spot.` : roi.status() || 'Load 0.15 mm detail at this spot for exact tracing.'),
      h('button', { class: 'btn secondary', disabled: !roi.canLoad() || !here || roi.status().endsWith('…'), onclick: () => here && roi.request(here) }, icon('scan', 18), 'Load full detail here'));
  }

  rebuildGeom();
  if (geom && an.nerves.length) { const p = an.nerves[0].points[0]?.p; if (p) { const q = worldToPano(geom, p); posIdx = q.x; posZ = p[2]; } }
  mount();
  updatePanel();
  const el = h('div', { class: 'viewer guided' }, h('div', { class: 'viewer-main' }, heroArea, thumbRow), panel);
  return {
    el,
    refresh() { if (mode !== 'arch') refreshCross(); updatePanel(); },
    dispose() { cancelAnimationFrame(raf); views.forEach((x) => x.dispose()); },
  };
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, dpr: number) {
  ctx.strokeStyle = color; ctx.lineWidth = 2 * dpr;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, dpr: number) {
  ctx.font = `700 ${11 * dpr}px Inter, sans-serif`;
  const w = ctx.measureText(text).width + 10 * dpr;
  ctx.fillStyle = 'rgba(14,42,87,.85)';
  ctx.fillRect(x - w / 2, y - 9 * dpr, w, 18 * dpr);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
