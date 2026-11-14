import { applyTheme, brandBlock } from '../ui/theme';
import { h, icon, clear } from '../ui/dom';
import { AppState, loadPrefs, Mode, savePrefs, STEPS } from './state';
import { probeDevice, Tier, TIERS } from '../core/volume/budget';
import { autosaver, getCase, getVolume, putCase, putVolume } from '../core/store/db';
import { CaseRecord, caseTitle, dicomDate, newCase, sitesSummary } from '../core/case/model';
import type { LoadProgress, LoadResult } from '../workers/loader';
import { renderHome } from '../ui/screens/home';
import { renderIntake } from '../ui/screens/intake';
import { renderScans } from '../ui/screens/scans';
import { renderCrowns } from '../ui/screens/crowns';
import { renderAnatomy } from '../ui/screens/anatomy';
import { renderViewer, RoiControl, ROI_SIZE_MM, ViewerHandle } from '../ui/screens/viewer';
import type { Volume } from '../core/volume/volume';
import { footer, modeSwitch, stepper } from '../ui/screens/common';

applyTheme();
const root = document.getElementById('app')!;
const prefs = loadPrefs();
const state: AppState = { device: probeDevice(), ...prefs, current: null, volume: null };
const saver = autosaver();
let viewer: ViewerHandle | null = null;
// The loader worker stays alive after a load (for this case) so full-detail
// regions can be read from the same file. Closing the case ends it.
let loader: { worker: Worker; caseId: string } | null = null;
const roiState = { volume: null as Volume | null, status: '', reqId: 0 };

function endLoader() {
  loader?.worker.terminate();
  loader = null;
  roiState.volume = null; roiState.status = '';
}

const roiControl: RoiControl = {
  volume: () => roiState.volume,
  status: () => roiState.status,
  canLoad: () => !!loader && loader.caseId === state.current?.id,
  clear: () => { roiState.volume = null; roiState.status = ''; viewer?.refresh(); },
  request(center) {
    if (!loader) return;
    const id = ++roiState.reqId;
    roiState.status = 'Reading full detail…';
    viewer?.refresh();
    loader.worker.postMessage({ type: 'roi', id, center, sizeMm: ROI_SIZE_MM });
  },
};
let expert = false;
let savedAt = '';
const load = { busy: false, progress: 0, message: '', error: '' };

function setMode(m: Mode) {
  state.mode = m;
  savePrefs(state);
  document.body.dataset.mode = m;
  render();
}

function tier(): Tier { return state.tierOverride ?? state.device.tier; }

async function render() {
  viewer?.dispose();
  viewer = null;
  clear(root);
  document.body.dataset.mode = state.mode;
  if (!state.current) {
    if (state.mode === 'patient') { state.mode = 'staff'; document.body.dataset.mode = 'staff'; }
    await renderHome(root, state, {
      newCase: async () => { const c = newCase(); await putCase(c); openCase(c); },
      openCase: (c) => openCase(c),
      setMode,
      rerender: render,
    });
    return;
  }
  renderWorkspace(state.current);
}

async function openCase(c: CaseRecord) {
  state.current = (await getCase(c.id)) ?? c;
  state.volume = null;
  if (loader && loader.caseId !== c.id) endLoader();
  load.error = '';
  if (state.current.study) {
    const cached = await getVolume(state.current.id);
    if (cached) state.volume = { ...cached.info, data: cached.data };
    else state.current.step = 0; // volume cache gone: ask to reopen the scan
  }
  render();
}

function changed() {
  if (!state.current) return;
  saver.save(state.current);
  savedAt = 'saved just now';
  const title = document.querySelector('.workspace .h-title');
  if (title && state.mode !== 'patient') title.textContent = caseTitle(state.current);
  const el = document.querySelector('.save-state');
  if (el) el.textContent = `${sitesSummary(state.current)} · ${savedAt}`;
}

function goStep(i: number) {
  const c = state.current!;
  if (!STEPS[i]?.ready) return;
  if (i >= 1 && !state.volume) return;
  c.step = i;
  changed();
  render();
}

function renderWorkspace(c: CaseRecord) {
  const maxReached = state.volume ? 4 : 0;
  const step = Math.min(c.step, maxReached);
  let body: HTMLElement;
  if (step === 0) {
    body = renderIntake(state, c, { changed, loadFiles, next: () => goStep(1) }, load);
  } else {
    viewer = step === 4
      ? renderCrowns(state, c, changed)
      : step === 3
      ? renderScans(state, c, changed, roiControl)
      : step === 2
      ? renderAnatomy(state, c, changed, roiControl)
      : renderViewer(state, c, changed, { on: expert, toggle: () => { expert = !expert; render(); } }, roiControl);
    body = viewer.el;
  }
  const dark = step === 1 && expert;
  root.append(h('div', { class: `screen workspace${dark ? ' navy' : ''}` },
    h('header', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back to cases', onclick: async () => { await saver.flush(); state.current = null; state.volume = null; endLoader(); render(); } }, icon('back')),
      h('div', { class: 'topbar-title' },
        h('span', { class: 'h-title' }, state.mode === 'patient' ? 'Your treatment plan' : caseTitle(c)),
        h('span', { class: 'muted save-state' }, `${sitesSummary(c)}${savedAt ? ` · ${savedAt}` : ''}`)),
      h('div', { class: 'spacer' }),
      modeSwitch(state.mode, setMode),
      state.mode === 'doctor' ? tierPicker() : null,
      brandBlock(),
    ),
    stepper(step, maxReached, goStep),
    h('main', { class: 'workspace-body' }, body),
    footer(),
  ));
}

function tierPicker(): HTMLElement {
  return h('label', { class: 'tier-pick', title: 'Working quality for new scans' },
    h('span', { class: 'muted small' }, 'Quality'),
    h('select', {
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value;
        state.tierOverride = v === 'auto' ? null : (v as Tier);
        savePrefs(state);
      },
    },
    h('option', { value: 'auto', selected: !state.tierOverride }, `Auto (${TIERS[state.device.tier].label})`),
    (['H', 'M', 'L'] as Tier[]).map((t) => h('option', { value: t, selected: state.tierOverride === t }, `${TIERS[t].label} ${TIERS[t].targetMm} mm`))));
}

function loadFiles(files: File[]) {
  const c = state.current!;
  load.busy = true; load.progress = 0; load.message = 'Starting'; load.error = '';
  render();
  endLoader();
  const worker = new Worker('load.worker.js');
  const t = tier();
  worker.onmessage = async (ev: MessageEvent) => {
    const m = ev.data as { type: string; id?: number; progress?: LoadProgress; result?: LoadResult; volume?: Volume; message?: string };
    if (m.type === 'roi' && m.volume) {
      if (m.id !== roiState.reqId) return; // superseded
      roiState.volume = m.volume; roiState.status = '';
      viewer?.refresh();
      return;
    }
    if (m.type === 'roi-progress' && m.progress) {
      roiState.status = `Reading full detail… ${Math.round((100 * m.progress.done) / m.progress.total)}%`;
      viewer?.refresh();
      return;
    }
    if (m.type === 'error' && m.id !== undefined) {
      roiState.status = m.message ?? 'Could not read full detail.';
      viewer?.refresh();
      return;
    }
    if (m.type === 'progress' && m.progress) {
      const p = m.progress;
      load.progress = p.phase === 'headers' ? 0.15 * (p.done / p.total) : p.phase === 'pixels' ? 0.15 + 0.85 * (p.done / p.total) : load.progress;
      load.message = `${p.message}… ${p.phase === 'pixels' || p.phase === 'headers' ? `${p.done} / ${p.total}` : ''}`;
      const bar = document.querySelector<HTMLElement>('.progress .bar span');
      const msg = document.querySelector<HTMLElement>('.progress .muted');
      if (bar) bar.style.width = `${Math.round(load.progress * 100)}%`;
      if (msg) msg.textContent = load.message;
    } else if (m.type === 'done' && m.result) {
      loader = { worker, caseId: c.id }; // keep for full-detail reads
      const r = m.result;
      const { data, ...info } = r.volume;
      state.volume = r.volume;
      c.study = {
        seriesUid: r.seriesUid, sourceName: r.sourceName, sliceCount: r.sliceCount,
        sourceDims: r.volume.sourceDims, sourceSpacing: r.volume.sourceSpacing,
        workingDims: r.volume.dims, workingSpacing: r.volume.spacing,
        factor: r.volume.factor, tier: t, meta: r.meta, warnings: r.warnings,
        loadedAt: new Date().toISOString(), loadMs: r.ms,
      };
      c.view = undefined;
      c.measurements = [];
      // Fill empty patient fields from the scan header; staff confirm them on screen.
      const p = c.patient;
      if (!p.name && r.meta.patientName) p.name = r.meta.patientName;
      if (!p.dob && r.meta.birthDate) p.dob = dicomDate(r.meta.birthDate);
      if (!p.patientId && r.meta.patientId) p.patientId = r.meta.patientId;
      if (!p.sex && r.meta.sex && /^[FMO]$/.test(r.meta.sex)) p.sex = r.meta.sex as 'F' | 'M' | 'O';
      load.busy = false;
      c.step = 1;
      await putCase(c);
      putVolume(c.id, { info, data }).catch(() => { /* cache is optional */ });
      render();
    } else if (m.type === 'error') {
      worker.terminate();
      load.busy = false;
      load.error = m.message ?? 'Could not open the scan.';
      render();
    }
  };
  worker.onerror = (e) => { worker.terminate(); load.busy = false; load.error = e.message || 'The loader stopped unexpectedly.'; render(); };
  worker.postMessage({ type: 'load', files, tier: t, ramGb: state.device.ramGb, max3d: state.device.max3dTexture || undefined });
}

window.addEventListener('pagehide', () => { saver.flush(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) saver.flush(); });

// Platform check: the engine needs a recent WebView (Chrome 103+ equivalent).
const missing = [
  typeof DecompressionStream === 'undefined' && 'DecompressionStream',
  typeof Worker === 'undefined' && 'Web Workers',
  typeof indexedDB === 'undefined' && 'IndexedDB',
].filter(Boolean);
if (missing.length) {
  root.append(h('div', { class: 'splash' }, h('div', { class: 'card', role: 'alert' },
    h('h2', null, 'Please update Android System WebView'),
    h('p', null, `This device's WebView is too old (missing ${missing.join(', ')}). Update "Android System WebView" and "Chrome" from the Play Store, then reopen the app.`))));
} else {
  // Splash while the first screen loads.
  root.append(h('div', { class: 'splash' }, brandBlock()));
  render();
}
