// Step 2: Orientation. Option E hero view + 3 thumbnails (guided), or the
// Option D grid (expert). Views are oblique planes through one cursor.
import type { AppState } from '../../app/state';
import { newId, type CaseRecord } from '../../core/case/model';
import { dot, Vec3, Volume } from '../../core/volume/volume';
import { autoWindow, ViewKind, WINDOW_PRESETS } from '../../render/mpr';
import { contains, Frame, IDENTITY, len, planeFor, sampleWorld, sub, tiltDeg, volumeCenter } from '../../render/oblique';
import { h, icon } from '../dom';
import { Tool, VIEW_COLOR, ViewCanvas, ViewHost } from '../viewCanvas';

const KINDS: ViewKind[] = ['axial', 'coronal', 'sagittal'];
const NAMES: Record<ViewKind, string> = { axial: 'Axial', coronal: 'Coronal', sagittal: 'Sagittal' };
export const ROI_SIZE_MM: Vec3 = [40, 40, 40];

export interface RoiControl {
  volume(): Volume | null;
  status(): string;             // '' | 'loading…' | error text
  canLoad(): boolean;           // source file still open in this session
  request(center: Vec3): void;
  clear(): void;
}

export interface ViewerHandle { el: HTMLElement; dispose(): void; refresh(): void }

export function renderViewer(s: AppState, c: CaseRecord, onChange: () => void, expert: { on: boolean; toggle(): void }, roi: RoiControl): ViewerHandle {
  const v = s.volume!;
  let hero: ViewKind = 'axial';
  let raf = 0;
  const center = volumeCenter(v);
  const init = c.view && c.view.ww ? c.view : { ...autoWindow(v), point: undefined, frame: undefined };
  const startPoint: Vec3 = (c.view?.point as Vec3) ?? [center[0], center[1], center[2] - 0.1 * v.dims[2] * v.spacing[2]];
  const host: ViewHost = {
    base: v,
    vols: () => { const r = roi.volume(); return r ? [r, v] : [v]; },
    cursor: startPoint,
    frame: (init.frame as Frame) ?? IDENTITY,
    spin: { axial: 0, coronal: 0, sagittal: 0, ...(c.view?.spin ?? {}) },
    wc: init.wc, ww: init.ww,
    tool: 'scroll',
    showNumbers: s.mode !== 'patient',
    measurements: c.measurements,
    interacting: false,
    setCursor(p) { host.cursor = p; changed(); },
    setWindow(wc, ww) { host.wc = wc; host.ww = ww; changed(); },
    setFrame(f, spin) { host.frame = f; host.spin = spin ?? { axial: 0, coronal: 0, sagittal: 0 }; changed(); },
    addMeasurement(a, b, view) { c.measurements.push({ id: newId(), a, b, view }); changed(); drawMeasureList(); },
    setInteracting(on) { if (host.interacting !== on) { host.interacting = on; if (!on) changed(); } },
  };
  const views = new Map<ViewKind, ViewCanvas>();
  const thumbs = new Map<ViewKind, ViewCanvas>();
  const all = () => [...views.values(), ...thumbs.values()];

  let saveTimer = 0;
  const changed = () => {
    c.view = { wc: host.wc, ww: host.ww, point: host.cursor, frame: host.frame, spin: host.spin };
    if (!saveTimer) saveTimer = window.setTimeout(() => { saveTimer = 0; onChange(); }, 250);
    all().forEach((x) => x.invalidate());
    schedule();
  };
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; all().forEach((x) => x.draw()); updatePanel(); });
  };

  // ---- side panel
  const readout = h('div', { class: 'readout' });
  const roiBox = h('div', { class: 'roi-box' });
  const measureList = h('div', { class: 'measure-list' });
  const slider = h('input', { type: 'range', min: 0, max: 1, step: 'any', value: 0, 'aria-label': 'Slice position' }) as HTMLInputElement;
  const sliderLabel = h('span', { class: 'slider-label' });
  const halfSpan = 0.5 * Math.hypot(v.dims[0] * v.spacing[0], v.dims[1] * v.spacing[1], v.dims[2] * v.spacing[2]);
  slider.min = String(-halfSpan); slider.max = String(halfSpan);
  slider.addEventListener('input', () => {
    const n = planeFor(hero, host.frame).n;
    const now = dot(sub(host.cursor, center), n);
    const d = +slider.value - now;
    host.setCursor([host.cursor[0] + n[0] * d, host.cursor[1] + n[1] * d, host.cursor[2] + n[2] * d]);
  });
  slider.addEventListener('pointerdown', () => host.setInteracting(true));
  slider.addEventListener('pointerup', () => host.setInteracting(false));

  const presetBtns = WINDOW_PRESETS.map((p) => h('button', { class: 'chip', onclick: () => host.setWindow(p.wc, p.ww) }, p.label));
  const autoBtn = h('button', { class: 'chip', onclick: () => { const a = autoWindow(v); host.setWindow(a.wc, a.ww); } }, 'Auto');
  const tools: [Tool, string][] = [['scroll', 'Scroll'], ['window', 'Brightness'], ['tilt', 'Tilt'], ['measure', 'Measure']];
  const toolBtns = h('div', { class: 'tool-grid', role: 'group', 'aria-label': 'Drag action' },
    tools.filter(([t]) => host.showNumbers || t !== 'measure').map(([t, l]) => h('button', {
      class: `tool${host.tool === t ? ' on' : ''}`, 'aria-pressed': String(host.tool === t),
      onclick: (e: Event) => {
        host.tool = t;
        [...(e.currentTarget as HTMLElement).parentElement!.children].forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); });
      },
    }, l)));

  function drawMeasureList() {
    if (!host.showNumbers) { measureList.replaceChildren(); return; }
    measureList.replaceChildren(
      ...c.measurements.map((m, i) => h('div', { class: 'measure-row' },
        h('button', {
          class: 'measure-go', 'aria-label': `Show measurement ${i + 1}`,
          onclick: () => { host.cursor = [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2, (m.a[2] + m.b[2]) / 2]; hero = m.view; mountHero?.(); changed(); },
        }, h('span', { class: 'dot', style: `background:${VIEW_COLOR[m.view]}` }), `${len(sub(m.b, m.a)).toFixed(1)} mm`, h('span', { class: 'muted small' }, ` ${NAMES[m.view]}`)),
        h('button', { class: 'icon-btn small', 'aria-label': `Delete measurement ${i + 1}`, onclick: () => { c.measurements.splice(i, 1); changed(); drawMeasureList(); } }, icon('trash', 16)),
      )),
    );
  }

  let lastRoiKey = '';
  function updatePanel() {
    const n = planeFor(hero, host.frame).n;
    const off = dot(sub(host.cursor, center), n);
    if (!host.interacting || document.activeElement !== slider) slider.value = String(off);
    sliderLabel.textContent = `${off >= 0 ? '+' : ''}${off.toFixed(1)} mm`;
    const r = roi.volume();
    const inRoi = !!r && contains(r, host.cursor);
    const roiKey = `${!!r}|${inRoi}|${roi.status()}|${roi.canLoad()}`;
    if (roiKey !== lastRoiKey) {
      lastRoiKey = roiKey;
      roiBox.replaceChildren(h('div', null,
        h('h3', null, 'Full detail'),
        r ? h('div', { class: inRoi ? 'ok-line' : 'muted small' }, inRoi ? `Showing ${r.spacing[0].toFixed(2)} mm detail here` : 'Point is outside the detail box') : null,
        roi.status() ? h('div', { class: roi.status().endsWith('…') ? 'muted small' : 'warn-line' }, roi.status()) : null,
        h('div', { class: 'row-btns' },
          h('button', {
            class: 'btn secondary', disabled: !roi.canLoad() || roi.status().endsWith('…'),
            onclick: () => roi.request(host.cursor),
          }, icon('scan', 18), r ? 'Move detail box here' : 'Load full detail here'),
          r ? h('button', { class: 'icon-btn', 'aria-label': 'Remove full detail', onclick: () => roi.clear() }, icon('trash', 16)) : null,
        ),
        !roi.canLoad() ? h('p', { class: 'muted small' }, 'Open the scan file again in step 1 to read full detail after reopening a case.') : null,
      ));
    }
    if (!host.showNumbers) { readout.replaceChildren(); return; }
    const hu = sampleWorld(host.vols(), host.cursor);
    const tilt = tiltDeg(host.frame);
    readout.replaceChildren(h('dl', null,
      h('dt', null, 'Density'), h('dd', null, `${hu} HU`),
      h('dt', null, 'Point (mm)'), h('dd', null, host.cursor.map((x) => x.toFixed(1)).join(', ')),
      h('dt', null, 'Tilt'), h('dd', null, tilt < 0.1 ? 'none' : `${tilt.toFixed(1)}°`),
      h('dt', null, 'Window'), h('dd', null, `${host.wc} / ${host.ww}`),
    ));
  }

  const panel = h('aside', { class: 'side-card card' },
    h('h2', null, 'Check the scan'),
    h('p', { class: 'muted small' }, 'Tap to line up the views. Pinch to zoom, double-tap to reset.'),
    h('h3', null, 'Drag does'), toolBtns,
    h('h3', null, 'Brightness'), h('div', { class: 'chips' }, autoBtn, presetBtns),
    h('button', { class: 'btn secondary slim', onclick: () => host.setFrame(IDENTITY) }, icon('reset', 16), 'Straighten views'),
    readout,
    roiBox,
    host.showNumbers ? h('h3', null, 'Measurements') : null,
    measureList,
    s.mode === 'doctor' && c.study ? h('details', { class: 'tech' },
      h('summary', null, 'Volume details'),
      h('dl', null,
        h('dt', null, 'Source'), h('dd', null, `${c.study.sourceDims.join(' × ')} @ ${c.study.sourceSpacing[0].toFixed(2)} mm`),
        h('dt', null, 'Working'), h('dd', null, `${v.dims.join(' × ')} @ ${v.spacing[0].toFixed(2)} mm (÷${v.factor}, tier ${c.study.tier})`),
        h('dt', null, 'Memory'), h('dd', null, `${((v.data.byteLength + (roi.volume()?.data.byteLength ?? 0)) / 1048576).toFixed(0)} MB`),
        h('dt', null, 'Load time'), h('dd', null, `${(c.study.loadMs / 1000).toFixed(1)} s`),
      )) : null,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn secondary', onclick: expert.toggle }, icon('grid'), expert.on ? 'Guided layout' : 'Expert grid'),
  );

  let el: HTMLElement;
  let mountHero: (() => void) | null = null;
  if (!expert.on) {
    const heroWrap = h('div', { class: 'hero' });
    const heroBadge = h('span', { class: 'badge' });
    const thumbRow = h('div', { class: 'thumbs' });
    mountHero = () => {
      views.forEach((vc) => vc.dispose());
      views.clear();
      const vc = new ViewCanvas(hero, host);
      views.set(hero, vc);
      heroBadge.textContent = NAMES[hero];
      heroBadge.style.borderLeft = `4px solid ${VIEW_COLOR[hero]}`;
      heroWrap.replaceChildren(vc.el, heroBadge,
        h('div', { class: 'hero-slider' }, h('span', null, 'Slide through'), slider, sliderLabel));
      thumbRow.replaceChildren(...KINDS.map((k) => {
        let t = thumbs.get(k);
        if (!t) { t = new ViewCanvas(k, host, { compact: true }); thumbs.set(k, t); }
        return h('button', {
          class: `thumb${k === hero ? ' active' : ''}`, 'aria-label': `Show ${NAMES[k]} view`,
          onclick: () => { hero = k; mountHero!(); changed(); },
        }, t.el, h('span', { class: 'badge small', style: `border-left:3px solid ${VIEW_COLOR[k]}` }, NAMES[k]));
      }));
    };
    mountHero();
    el = h('div', { class: 'viewer guided' }, h('div', { class: 'viewer-main' }, heroWrap, thumbRow), panel);
  } else {
    const grid = h('div', { class: 'grid4' });
    for (const k of KINDS) {
      const vc = new ViewCanvas(k, host);
      views.set(k, vc);
      grid.append(h('div', { class: 'cell', onpointerdown: () => { hero = k; } }, vc.el, h('span', { class: 'badge', style: `border-left:4px solid ${VIEW_COLOR[k]}` }, NAMES[k])));
    }
    grid.append(h('div', { class: 'cell placeholder' }, h('span', null, '3D view arrives in Session 4')));
    el = h('div', { class: 'viewer expert' }, grid, panel);
  }
  drawMeasureList();
  updatePanel();
  const ro = new ResizeObserver(() => { all().forEach((x) => x.invalidate()); schedule(); });
  ro.observe(el);
  schedule();
  return {
    el,
    refresh() { lastRoiKey = ''; changed(); },
    dispose() { ro.disconnect(); cancelAnimationFrame(raf); if (saveTimer) { clearTimeout(saveTimer); onChange(); } all().forEach((x) => x.dispose()); },
  };
}
