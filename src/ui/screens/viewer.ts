// Step 2: Orientation. Option E hero view + 3 thumbnails (guided), or the
// Option D grid (expert). Tap sets the crosshair; drag scrolls or windows.
import type { AppState } from '../../app/state';
import type { CaseRecord } from '../../core/case/model';
import { sampleNearest, voxelToWorld } from '../../core/volume/volume';
import { autoWindow, sliceCount, sliceIndex, ViewKind, WINDOW_PRESETS } from '../../render/mpr';
import { h, icon } from '../dom';
import { DragMode, ViewCanvas, ViewHost } from '../viewCanvas';

const KINDS: ViewKind[] = ['axial', 'coronal', 'sagittal'];
const NAMES: Record<ViewKind, string> = { axial: 'Axial', coronal: 'Coronal', sagittal: 'Sagittal' };

export interface ViewerHandle { el: HTMLElement; dispose(): void }

export function renderViewer(s: AppState, c: CaseRecord, onChange: () => void, expert: { on: boolean; toggle(): void }): ViewerHandle {
  const v = s.volume!;
  let hero: ViewKind = 'axial';
  let raf = 0;
  const init = c.view && c.view.ww ? c.view : { ...autoWindow(v), cursor: undefined };
  const host: ViewHost = {
    volume: v,
    cursor: (c.view?.cursor as [number, number, number]) ?? [v.dims[0] >> 1, v.dims[1] >> 1, Math.round(v.dims[2] * 0.4)],
    wc: init.wc, ww: init.ww,
    dragMode: 'scroll',
    showNumbers: s.mode !== 'patient',
    setCursor(cur) { host.cursor = cur; changed(); },
    setWindow(wc, ww) { host.wc = wc; host.ww = ww; changed(); },
  };
  const views = new Map<ViewKind, ViewCanvas>();
  const thumbs = new Map<ViewKind, ViewCanvas>();

  const changed = () => {
    c.view = { wc: host.wc, ww: host.ww, cursor: host.cursor };
    onChange();
    for (const vc of [...views.values(), ...thumbs.values()]) vc.invalidate();
    updatePanel();
    schedule();
  };
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      for (const vc of [...views.values(), ...thumbs.values()]) vc.draw();
    });
  };

  // ---- side panel
  const readout = h('div', { class: 'readout' });
  const slider = h('input', { type: 'range', min: 0, max: 1, value: 0, 'aria-label': 'Slice' }) as HTMLInputElement;
  const sliderLabel = h('span', { class: 'slider-label' });
  slider.addEventListener('input', () => {
    const cur = [...host.cursor] as [number, number, number];
    const axis = hero === 'axial' ? 2 : hero === 'coronal' ? 1 : 0;
    cur[axis] = +slider.value;
    host.setCursor(cur);
  });
  const presetBtns = WINDOW_PRESETS.map((p) => h('button', { class: 'chip', onclick: () => host.setWindow(p.wc, p.ww) }, p.label));
  const autoBtn = h('button', { class: 'chip', onclick: () => { const a = autoWindow(v); host.setWindow(a.wc, a.ww); } }, 'Auto');
  const modeBtns = h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Drag action' },
    ([['scroll', 'Scroll slices'], ['window', 'Brightness']] as [DragMode, string][]).map(([m, l]) => h('button', {
      class: host.dragMode === m ? 'on' : '', 'aria-pressed': String(host.dragMode === m),
      onclick: (e: Event) => {
        host.dragMode = m;
        [...(e.currentTarget as HTMLElement).parentElement!.children].forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); });
      },
    }, l)));

  function updatePanel() {
    const n = sliceCount(v, hero);
    slider.max = String(n - 1);
    slider.value = String(sliceIndex(hero, host.cursor));
    sliderLabel.textContent = `${+slider.value + 1} / ${n}`;
    if (!host.showNumbers) { readout.replaceChildren(); return; }
    const w = voxelToWorld(v, ...host.cursor);
    const hu = sampleNearest(v, ...host.cursor);
    readout.replaceChildren(
      h('dl', null,
        h('dt', null, 'Point (mm)'), h('dd', null, w.map((x) => x.toFixed(1)).join(', ')),
        h('dt', null, 'Density'), h('dd', null, `${hu} HU`),
        h('dt', null, 'Window'), h('dd', null, `${host.wc} / ${host.ww}`),
      ));
  }

  const panel = h('aside', { class: 'side-card card' },
    h('h2', null, 'Check the scan'),
    h('p', { class: 'muted small' }, 'Tap a point to line up all three views. Drag to scroll. Pinch to zoom, double-tap to reset.'),
    h('h3', null, 'Drag does'), modeBtns,
    h('h3', null, 'Brightness presets'), h('div', { class: 'chips' }, autoBtn, presetBtns),
    readout,
    s.mode === 'doctor' && c.study ? h('details', { class: 'tech' },
      h('summary', null, 'Volume details'),
      h('dl', null,
        h('dt', null, 'Source'), h('dd', null, `${c.study.sourceDims.join(' × ')} @ ${c.study.sourceSpacing[0].toFixed(2)} mm`),
        h('dt', null, 'Working'), h('dd', null, `${v.dims.join(' × ')} @ ${v.spacing[0].toFixed(2)} mm (÷${v.factor}, tier ${c.study.tier})`),
        h('dt', null, 'Memory'), h('dd', null, `${(v.data.byteLength / 1048576).toFixed(0)} MB`),
        h('dt', null, 'Load time'), h('dd', null, `${(c.study.loadMs / 1000).toFixed(1)} s`),
      )) : null,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn secondary', onclick: expert.toggle }, icon('grid'), expert.on ? 'Guided layout' : 'Expert grid'),
  );

  let el: HTMLElement;
  if (!expert.on) {
    const heroWrap = h('div', { class: 'hero' });
    const heroBadge = h('span', { class: 'badge' });
    const thumbRow = h('div', { class: 'thumbs' });
    const mountHero = () => {
      views.forEach((vc) => vc.dispose());
      views.clear();
      const vc = new ViewCanvas(hero, host);
      views.set(hero, vc);
      heroBadge.textContent = NAMES[hero];
      heroWrap.replaceChildren(vc.el, heroBadge,
        h('div', { class: 'hero-slider' }, h('span', null, 'Slide through'), slider, sliderLabel));
      thumbRow.replaceChildren(...KINDS.map((k) => {
        let t = thumbs.get(k);
        if (!t) { t = new ViewCanvas(k, host, { compact: true }); thumbs.set(k, t); }
        return h('button', {
          class: `thumb${k === hero ? ' active' : ''}`, 'aria-label': `Show ${NAMES[k]} view`,
          onclick: () => { hero = k; mountHero(); changed(); },
        }, t.el, h('span', { class: 'badge small' }, NAMES[k]));
      }));
    };
    mountHero();
    el = h('div', { class: 'viewer guided' }, h('div', { class: 'viewer-main' }, heroWrap, thumbRow), panel);
  } else {
    const grid = h('div', { class: 'grid4' });
    for (const k of KINDS) {
      const vc = new ViewCanvas(k, host);
      views.set(k, vc);
      grid.append(h('div', { class: 'cell' }, vc.el, h('span', { class: 'badge' }, NAMES[k])));
    }
    grid.append(h('div', { class: 'cell placeholder' }, h('span', null, '3D view arrives in Session 4')));
    el = h('div', { class: 'viewer expert' }, grid, panel);
  }
  updatePanel();
  const ro = new ResizeObserver(() => { [...views.values(), ...thumbs.values()].forEach((x) => x.invalidate()); schedule(); });
  ro.observe(el);
  schedule();
  return {
    el,
    dispose() { ro.disconnect(); cancelAnimationFrame(raf); [...views.values(), ...thumbs.values()].forEach((x) => x.dispose()); },
  };
}
