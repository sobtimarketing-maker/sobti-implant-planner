// Step 5: Design crowns (crown-down). On the lined-up mouth scans, tap the
// mesial and distal contact points on the neighbouring teeth; the app places
// a crown (or a bridge of several) of the right tooth type in the gap, sits
// it on the gum and brings it up to the opposing teeth. Fine-tune size,
// height, turn, position and bite; contacts show in colour.
import type { AppState } from '../../app/state';
import type { CaseRecord } from '../../core/case/model';
import { newId, toothName } from '../../core/case/model';
import type { Vec3 } from '../../core/volume/volume';
import type { TriMesh } from '../../core/mesh/mesh';
import { rayMesh } from '../../core/mesh/raycast';
import {
  biteColors, buildUnit, heightHit, BuiltCrown, CrownSpan, fitHeights, isUpper, KIND_LABEL, kindOf, meshHit, nearbyMesh, newSpan,
  occlusalAxis, resizeUnits, seatOnGum, typicalSize, unitCentres,
} from '../../core/crown/crown';
import type { SceneSurface } from '../../render/vr/engine';
import { sphereMesh } from '../../render/vr/shapes';
import { h, icon } from '../dom';
import { View3D } from '../view3d';
import { onScansChanged, scanMeshes, setScanMesh } from '../scanCache';
import { ScanEditor } from '../scanEditor';
import { PointGrid, toothSurfacePoints } from '../../core/register/icp';
import { getScan, putScan } from '../../core/store/db';
import { toothGrow } from '../../core/segment/toothGrow';
import { maskAt } from '../../core/segment/regionGrow';
import { sampleWorld } from '../../render/oblique';
import { LIBRARIES, libraryOf, SHADE_IDS, SHADES } from '../../core/crown/anatomy';

type Arch = 'upper' | 'lower';
type Pick = 'idle' | 'mesial' | 'distal' | 'edit';
export interface CrownsHandle { el: HTMLElement; dispose(): void; refresh(): void }

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dist2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export function renderCrowns(s: AppState, c: CaseRecord, onChange: () => void): CrownsHandle {
  const v = s.volume!;
  const sc = c.scans;
  const pr = (c.prosthetic ??= { spans: [] });
  const meshes = scanMeshes(c.id);
  const showNumbers = s.mode !== 'patient';
  const doctor = s.mode === 'doctor';
  let pick: Pick = pr.spans.length ? 'idle' : 'mesial';
  let pendingMesial: Vec3 | null = null;
  let sel: { span: string; unit: number } | null = pr.spans.length ? { span: pr.spans[0].id, unit: 0 } : null;
  let showOpp = true, showCt = false, showBite = false;
  let message = '';
  const save = () => onChange();
  const treating = (): Arch => sc?.treating ?? 'lower';
  const other = (): Arch => (treating() === 'lower' ? 'upper' : 'lower');

  // ---------- geometry helpers (world mm), cached per scan fit
  let geoKey = '';
  let worldTreat: Float32Array | null = null, archCentre: Vec3 = [0, 0, 0], occl: Vec3 = [0, 0, 1];
  const near = new Map<string, { gum: TriMesh; opp: TriMesh | null }>();
  function geometry(): boolean {
    const tm = meshes.get(treating());
    if (!sc?.m || !tm) return false;
    const key = `${sc.m.map((x) => x.toFixed(4)).join(',')}:${meshes.has(other())}`;
    if (key === geoKey) return true;
    geoKey = key; near.clear(); oppHits.clear(); built.clear();
    const M = sc.m, P = tm.display.positions, W = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2]; W[i] = M[0] * x + M[4] * y + M[8] * z + M[12]; W[i + 1] = M[1] * x + M[5] * y + M[9] * z + M[13]; W[i + 2] = M[2] * x + M[6] * y + M[10] * z + M[14]; }
    worldTreat = W;
    let cx = 0, cy = 0, cz = 0; const n = W.length / 3;
    for (let i = 0; i < W.length; i += 3) { cx += W[i]; cy += W[i + 1]; cz += W[i + 2]; }
    archCentre = [cx / n, cy / n, cz / n];
    let towards: Vec3 | null = null;
    const om = meshes.get(other());
    if (om) {
      const Q = om.display.positions; let ox = 0, oy = 0, oz = 0; const k = Q.length / 3;
      for (let i = 0; i < Q.length; i += 3) { const x = Q[i], y = Q[i + 1], z = Q[i + 2]; ox += M[0] * x + M[4] * y + M[8] * z + M[12]; oy += M[1] * x + M[5] * y + M[9] * z + M[13]; oz += M[2] * x + M[6] * y + M[10] * z + M[14]; }
      towards = [ox / k, oy / k, oz / k];
    }
    occl = occlusalAxis(W, towards, treating() === 'lower' ? [0, 0, 1] : [0, 0, -1]);
    return true;
  }
  function nearFor(span: CrownSpan): { gum: TriMesh; opp: TriMesh | null } {
    let e = near.get(span.id);
    const mid = scale(add(span.mesial, span.distal), 0.5);
    if (!e) {
      const tm = meshes.get(treating())!, om = meshes.get(other());
      const r = 18 + Math.sqrt(dist2(span.mesial, span.distal)) / 2;
      e = { gum: nearbyMesh(tm.full, sc!.m!, mid, r), opp: om ? nearbyMesh(om.full, sc!.m!, mid, r) : null };
      near.set(span.id, e);
    }
    return e;
  }
  const oppHits = new Map<string, ReturnType<typeof heightHit>>();
  const oppHit = (span: CrownSpan) => {
    const n = nearFor(span);
    if (!n.opp || !n.opp.indices.length) return null;
    let f = oppHits.get(span.id);
    if (!f) { f = heightHit(n.opp, span.o, scale(add(span.mesial, span.distal), 0.5), 18 + Math.sqrt(dist2(span.mesial, span.distal)) / 2); oppHits.set(span.id, f); }
    return f;
  };

  // ---------- crowns
  const built = new Map<string, BuiltCrown>();
  const unitKey = (span: CrownSpan, i: number) => { const u = span.units[i]; return `crown:${span.id}:${i}:${[u.fdi, u.md, u.bl, u.height, u.turn, u.shiftM, u.shiftB, ...u.origin, span.bite, span.adapt ? 1 : 0, span.buccal].map((x) => (+x).toFixed(3)).join(',')}:${span.library ?? 'natural'}:${span.shade ?? 'A2'}`; };
  function crown(span: CrownSpan, i: number): { key: string; b: BuiltCrown } {
    const key = unitKey(span, i);
    let b = built.get(key);
    if (!b) { b = buildUnit(span, span.units[i], oppHit(span)); built.set(key, b); }
    return { key, b };
  }
  function prune() {
    const keep = new Set(pr.spans.flatMap((sp) => sp.units.map((_, i) => unitKey(sp, i))));
    for (const k of built.keys()) if (!keep.has(k)) built.delete(k);
  }

  function teethFor(mesial: Vec3, distal: Vec3): number[] {
    const mid = scale(add(mesial, distal), 0.5);
    const left = mid[0] > archCentre[0]; // LPS: +x is the patient's left
    const quad = treating() === 'upper' ? (left ? 2 : 1) : (left ? 3 : 4);
    const taken = new Set(pr.spans.flatMap((sp) => sp.units.map((u) => u.fdi)));
    const planned = c.plan.sites.map((x) => x.fdi).filter((f) => Math.floor(f / 10) === quad && !taken.has(f)).sort((a, b) => a - b);
    const L = Math.sqrt(dist2(mesial, distal));
    if (planned.length) {
      // Keep the planned teeth that fit the gap (about one per typical width).
      let sum = 0; const out: number[] = [];
      for (const f of planned) { if (out.length && sum + typicalSize(f)[0] * 0.6 > L) break; out.push(f); sum += typicalSize(f)[0]; }
      return out;
    }
    const first = quad * 10 + (L >= 8.5 ? 6 : 5);
    const n = Math.max(1, Math.round(L / typicalSize(first)[0]));
    return Array.from({ length: n }, (_, i) => Math.min(quad * 10 + 8, first + i));
  }
  function placeSpan(mesial: Vec3, distal: Vec3) {
    const fdis = teethFor(mesial, distal);
    const span = newSpan(newId(), mesial, distal, fdis, occl, archCentre);
    span.library = pr.library; span.shade = pr.shade;
    if (Math.sqrt(dist2(mesial, distal)) < 3) { message = 'The two points are too close. Tap the contact point on each neighbouring tooth.'; return; }
    fit(span, true);
    // Say so when planned teeth in this quadrant were left out (the gap was shorter than they need).
    const quad = Math.floor(fdis[0] / 10), placed = new Set([...pr.spans.flatMap((x) => x.units.map((u) => u.fdi)), ...fdis]);
    const left = c.plan.sites.map((x) => x.fdi).filter((f) => Math.floor(f / 10) === quad && !placed.has(f)).sort((a, b) => a - b);
    if (left.length) message += ` ${left.join(' and ')} ${left.length > 1 ? 'are' : 'is'} also planned but did not fit between these points: add ${left.length > 1 ? 'them' : 'it'} with "Teeth in the gap", or tap a wider gap.`;
    pr.spans.push(span);
    sel = { span: span.id, unit: 0 };
    pick = 'idle';
    save();
  }
  function fit(span: CrownSpan, fresh = false) {
    near.delete(span.id); oppHits.delete(span.id);
    seatOnGum(span, meshHit(nearFor(span).gum));
    const opp = oppHit(span);
    const r = fitHeights(span, opp);
    const n = span.units.length;
    const what = n > 1 ? `Bridge of ${n} (${span.units.map((u) => u.fdi).join(', ')})` : `Crown ${span.units[0].fdi}`;
    message = !opp ? `${what} placed. Add the ${other()} scan to fit the bite.`
      : r.touched === n ? `${what} placed: sitting on the gum and meeting the opposing teeth.`
      : `${what} placed. ${n - r.touched} of ${n} did not reach the opposing teeth; check the height.`;
    if (!fresh) save();
  }

  // ---------- virtual extraction (scan mm; the untouched scan is kept as '<arch>:orig')
  const busy = '';
  /**
   * Tooth tests from the CBCT for one tap: `mine` = on the tapped tooth (its
   * crown outlined in the CBCT, separate from the neighbours), `other` = on
   * any other tooth (kept still). Falls back to "on any tooth surface".
   */
  function toothTests(m: TriMesh, world: Vec3, jaw: Arch): { mine?: (i: number) => boolean; other?: (i: number) => boolean } {
    const grid = new PointGrid(toothSurfacePoints(v, 800, 1500, [world], 12), 1);
    const M = sc!.m!, P = m.positions;
    const W = (i: number): Vec3 => { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]; };
    const onTooth = grid.size >= 100 ? (i: number) => grid.nearest(W(i), 1.2).i >= 0 : undefined;
    // Seed inside the crown: step in from the tapped surface until the CBCT is tooth-bright.
    const inward = jaw === treating() ? scale(occl, -1) : occl;
    let seed: Vec3 | null = null;
    for (const d of [0.8, 1.5, 2.5, 3.5]) { const q = add(world, scale(inward, d)); if (sampleWorld([v], q) >= 1500) { seed = q; break; } }
    const crown = seed ? toothGrow(v, seed, 1500, { jaw, rootMm: 2, crownOnly: true }) : null;
    if (!crown || !onTooth) return { mine: onTooth };
    const mask = crown.mask, R = 1.2;
    const near = (p: Vec3) => {
      if (maskAt(mask, p)) return true;
      for (const [dx, dy, dz] of [[R, 0, 0], [-R, 0, 0], [0, R, 0], [0, -R, 0], [0, 0, R], [0, 0, -R]]) if (maskAt(mask, [p[0] + dx, p[1] + dy, p[2] + dz])) return true;
      return false;
    };
    return { mine: (i) => near(W(i)), other: (i) => onTooth(i) && !near(W(i)) };
  }
  // ---------- scan editor (the untouched scan is kept as '<arch>:orig')
  let editor: ScanEditor | null = null;
  let editArch: Arch = treating();
  let teethGridCache: { key: string; g: PointGrid | null } | null = null;
  function openEditor(arch: Arch) {
    const ms = meshes.get(arch);
    if (!ms || !sc?.m) return;
    editArch = arch;
    const towards = arch === treating() ? occl : scale(occl, -1);
    editor = new ScanEditor({
      arch, scan: ms, m: sc.m, towards, showNumbers,
      toothTests: (m, w) => toothTests(m, w, arch),
      teethGrid: () => {
        const key = `${arch}:${geoKey}`;
        if (teethGridCache?.key !== key) {
          // CBCT tooth surface along the whole jaw: centres every ~200th scan vertex.
          const P = ms.display.positions, M = sc.m!, centres: Vec3[] = [];
          for (let i = 0; i < P.length / 3; i += 200) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; centres.push([M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]); }
          const pts = toothSurfacePoints(v, 800, 1500, centres, 6);
          teethGridCache = { key, g: pts.length > 300 ? new PointGrid(pts, 1) : null };
        }
        return teethGridCache.g;
      },
      original: async () => (await getScan(c.id, `${arch}:orig`).catch(() => undefined)) ?? null,
      redraw: () => { hero?.invalidate(); schedule(); },
      panel: () => updatePanel(),
      save: async (stored, current) => {
        const hadOrig = await getScan(c.id, `${arch}:orig`).catch(() => undefined);
        setScanMesh(c.id, arch, stored);
        try {
          if (!hadOrig) await putScan(c.id, `${arch}:orig`, current);
          await putScan(c.id, arch, stored);
          message = 'Scan saved. Crowns and the guide use the edited scan; the original is kept.';
        } catch { message = 'The edited scan could not be saved on this device (storage full?). It is shown for now.'; }
      },
      close: () => { editor = null; pick = 'idle'; showOpp = true; mount(); updatePanel(); },
    });
    pick = 'edit'; showOpp = false; message = '';
    mount(); updatePanel();
  }

  // ---------- tap handling
  const pickScan = (ro: Vec3, rd: Vec3): number => {
    if (pick === 'edit' && editor) return editor.ray(ro, rd);
    const tm = meshes.get(treating());
    let best = tm && sc?.m ? rayMesh(tm.display, ro, rd, sc.m) : Infinity;
    if (pick === 'idle') for (const sp of pr.spans) sp.units.forEach((_, i) => { best = Math.min(best, rayMesh(crown(sp, i).b.mesh, ro, rd)); });
    if (showOpp && pick === 'idle') { const om = meshes.get(other()); if (om && sc?.m) best = Math.min(best, rayMesh(om.display, ro, rd, sc.m)); }
    return best;
  };
  function tapped(p: Vec3) {
    if (pick === 'edit') return;
    if (pick === 'mesial') { pendingMesial = p; pick = 'distal'; message = ''; }
    else if (pick === 'distal' && pendingMesial) { placeSpan(pendingMesial, p); pendingMesial = null; mount(); }
    else {
      // Select the nearest crown under the tap.
      let best: { span: string; unit: number; d: number } | null = null;
      for (const sp of pr.spans) unitCentres(sp).forEach((ctr, i) => {
        const o = sp.units[i].origin, mid = add(o, scale(sp.o, sp.units[i].height / 2));
        const d = Math.min(dist2(p, ctr), dist2(p, mid));
        if (d < 64 && (!best || d < best.d)) best = { span: sp.id, unit: i, d };
      });
      if (best) sel = { span: (best as { span: string }).span, unit: (best as { unit: number }).unit };
    }
    hero?.invalidate(); schedule(); updatePanel();
  }

  // ---------- scene
  const sphere = sphereMesh();
  /** Selected crown: a light blue cast so it stands out but still looks like a tooth. */
  const tints = new WeakMap<Uint8Array, Uint8Array>();
  const selTint = (c: Uint8Array) => { let t = tints.get(c); if (!t) { t = new Uint8Array(c.length); for (let i = 0; i < c.length; i += 3) { t[i] = c[i] * 0.95; t[i + 1] = c[i + 1] * 0.98; t[i + 2] = Math.min(255, c[i + 2] * 1.03 + 6); } tints.set(c, t); } return t; };
  function surfaces(): SceneSurface[] {
    const out: SceneSurface[] = [];
    if (!geometry()) return out;
    if (pick === 'edit' && editor) return editor.surfaces([0.9, 0.72, 0.74]);
    for (const [arch, ms] of meshes) {
      if (arch !== treating() && (!showOpp || pick !== 'idle')) continue;
      out.push({ key: `scan:${c.id}:${arch}:${ms.display.indices.length}`, color: arch === treating() ? [0.9, 0.72, 0.74] : [0.66, 0.78, 0.92], mesh: () => ms.display, model: sc!.m });
    }
    for (const sp of pr.spans) sp.units.forEach((_, i) => {
      const { key, b } = crown(sp, i);
      const isSel = sel?.span === sp.id && sel.unit === i;
      if (showBite) out.push({ key: `${key}:bite`, color: [1, 1, 1], mesh: () => ({ ...b.mesh, colors: biteColors(b.gap, sp.bite) }), vertexColors: true });
      else out.push({ key: `${key}:${isSel ? 's' : 'n'}`, color: [1, 1, 1], mesh: () => isSel ? { ...b.mesh, colors: selTint(b.mesh.colors) } : b.mesh, vertexColors: true, material: 'enamel' });
    });
    const sel0 = selSpan();
    if (sel0 && pick === 'idle') for (const p of [sel0.mesial, sel0.distal]) out.push({ key: 'sphere', color: [0.36, 0.7, 1], mesh: () => sphere, at: [...p, 0.45] as [number, number, number, number] });
    if (pendingMesial) out.push({ key: 'sphere', color: [0.98, 0.68, 0.29], mesh: () => sphere, at: [...pendingMesial, 0.55] as [number, number, number, number] });
    return out;
  }
  const selSpan = () => pr.spans.find((x) => x.id === sel?.span) ?? null;
  const selUnit = () => { const sp = selSpan(); return sp && sel ? sp.units[sel.unit] ?? null : null; };

  // ---------- views
  let hero: View3D | null = null;
  const heroArea = h('div', { class: 'hero is3d' });
  function homeView(): { center: Vec3; size: number } {
    const sp = selSpan();
    if (sp && pick === 'idle') { const u = sp.units[Math.min(sel!.unit, sp.units.length - 1)]; return { center: add(u.origin, scale(sp.o, u.height / 2)), size: 26 + 8 * (sp.units.length - 1) }; }
    return { center: add(archCentre, scale(occl, 4)), size: 70 };
  }
  function lookFrom(d: Vec3) {
    if (!hero) return;
    hero.resetView();
    hero.look((Math.atan2(d[0], -d[1]) * 180) / Math.PI, (Math.asin(Math.max(-0.999, Math.min(0.999, d[2]))) * 180) / Math.PI);
    hero.draw();
  }
  function lookAt(which: 'bite' | 'cheek' | 'tongue' | 'front') {
    const sp = selSpan();
    const o = sp?.o ?? occl;
    if (which === 'bite') { showOpp = false; lookFrom(o); }
    else if (which === 'front') lookFrom(add(scale([0, -1, 0], 1), scale(o, 0.5)));
    else if (sp) { const side = which === 'cheek' ? sp.buccal : -sp.buccal; const d = add(scale(sp.b, side), scale(o, 0.35)); const l = Math.hypot(...d); lookFrom([d[0] / l, d[1] / l, d[2] / l]); }
    updatePanel();
  }
  function mount() {
    hero?.dispose(); hero = null;
    if (!sc?.m || !meshes.get(treating())) {
      heroArea.classList.remove('is3d');
      heroArea.replaceChildren(h('div', { class: 'hero-empty' }, icon('tooth', 40),
        h('h3', null, sc?.m && sc[treating()] ? 'Loading the scans…' : 'Line up the mouth scans first'),
        h('p', { class: 'muted' }, 'Crowns are designed on the mouth scans. Go back to "Add scans", add the scan of the implant jaw and line it up with the CBCT.')));
      return;
    }
    geometry();
    heroArea.classList.add('is3d');
    hero = new View3D({
      base: v, volume: () => showCt && pick !== 'edit', cursor: () => null, home: homeView, surfaces, pickSurface: pickScan, setCursor: tapped,
      painting: () => pick === 'edit' && !!editor?.painting(), paint: (ph, p) => editor?.paint(ph, p),
    }, { label: 'Crown design in 3D', bar: false });
    heroArea.replaceChildren(hero.el, h('span', { class: 'badge' }, badgeText()));
    if (pick !== 'idle') lookFrom(add(scale(occl, 0.85), [0, -0.5, 0]));
    else lookAt('cheek');
    schedule();
  }
  const badgeText = () => pick === 'edit' ? (editor?.moveView ? 'One finger turns the scan. Two fingers zoom and move.' : 'One finger uses the tool. Two fingers zoom, move and twist.') : pick === 'mesial' ? 'Tap the contact point on the tooth in front of the gap (mesial)'
    : pick === 'distal' ? 'Now tap the contact point on the tooth behind the gap (distal)'
    : 'Tap a crown to choose it. Drag to turn, pinch to zoom.';

  let raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; const b = heroArea.querySelector('.badge'); if (b) b.textContent = badgeText(); hero?.draw(); }); }
  function redraw() { prune(); hero?.invalidate(); schedule(); updatePanel(); }

  // ---------- panel
  const panel = h('aside', { class: 'side-card card' });
  function stepRow(label: string, value: string, minus: () => void, plus: () => void, minusLabel = '−', plusLabel = '+') {
    return h('div', { class: 'tune-row' },
      h('span', { class: 'tune-label' }, label),
      showNumbers ? h('span', { class: 'tune-value' }, value) : h('span'),
      h('button', { class: 'chip', 'aria-label': `${label} ${minusLabel}`, onclick: () => { minus(); save(); redraw(); } }, minusLabel),
      h('button', { class: 'chip', 'aria-label': `${label} ${plusLabel}`, onclick: () => { plus(); save(); redraw(); } }, plusLabel));
  }
  function updatePanel() {
    const body: (HTMLElement | null)[] = [];
    if (!sc?.m || !meshes.get(treating())) {
      panel.replaceChildren(h('h2', null, 'Crowns'), h('p', { class: 'muted small' }, 'Needs the lined-up mouth scan of the implant jaw.'));
      return;
    }
    body.push(h('p', { class: 'muted small' }, 'Crown first, implant after: the implant is planned under the crown. Tap the contact points on the teeth either side of the gap.'));
    if (pick === 'edit' && editor) {
      const both = meshes.has('upper') && meshes.has('lower');
      panel.replaceChildren(h('h2', null, 'Edit the scan'),
        both ? h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Scan to edit' }, (['lower', 'upper'] as Arch[]).map((a) => h('button', { class: editArch === a ? 'on' : '', onclick: () => { if (editArch !== a && !editor?.dirty) openEditor(a); } }, a === 'lower' ? 'Lower scan' : 'Upper scan'))) : h('span'),
        ...editor.panelBody(),
        message ? h('div', { class: 'ok-line small' }, message) : h('span'));
      return;
    } else if (pick !== 'idle') {
      body.push(h('div', { class: 'ok-line small' }, pick === 'mesial' ? '1. Tap the mesial contact point (tooth in front of the gap).' : '2. Tap the distal contact point (tooth behind the gap).'),
        h('button', { class: 'btn secondary', onclick: () => { pick = 'idle'; pendingMesial = null; mount(); updatePanel(); } }, 'Cancel'));
    } else {
      body.push(h('button', { class: 'btn primary', onclick: () => { pick = 'mesial'; pendingMesial = null; message = ''; mount(); updatePanel(); } }, icon('plus', 18), pr.spans.length ? 'Add another crown or bridge' : 'Add a crown or bridge'),
        h('button', { class: 'btn secondary', onclick: () => openEditor(treating()) }, icon('tooth', 18), 'Edit the scan (smooth, cut, take a tooth out)'));
    }
    if (pr.spans.length) {
      body.push(h('h3', null, 'Crowns'), h('div', { class: 'pair-list' }, pr.spans.flatMap((sp) => sp.units.map((u, i) => h('button', {
        class: `pair-row unit-row${sel?.span === sp.id && sel.unit === i ? ' on' : ''}`,
        onclick: () => { sel = { span: sp.id, unit: i }; pick = 'idle'; mount(); updatePanel(); },
      }, h('strong', null, String(u.fdi)), h('span', null, `${KIND_LABEL[kindOf(u.fdi)]}${sp.units.length > 1 ? ` · bridge ${sp.units.map((x) => x.fdi).join('-')}` : ''}`))))));
    }
    const sp = selSpan(), u = selUnit();
    if (sp && u && pick === 'idle') {
      const b = crown(sp, sel!.unit).b;
      const contact = Number.isFinite(b.contact) ? b.contact : null;
      body.push(h('h3', null, `Tooth ${u.fdi}: ${toothName(u.fdi)}`));
      if (showNumbers) body.push(h('div', { class: 'stat' }, contact === null ? 'No opposing tooth in reach' : contact - sp.bite <= 0.05 ? 'Touching the opposing teeth' : `${(contact).toFixed(2)} mm from the opposing teeth`));
      if (b.ground > 0.4) body.push(h('div', { class: 'warn-line' }, `Little room to the opposing tooth: the crown is ground down by up to ${b.ground.toFixed(1)} mm to fit.${showNumbers ? ` Height ${u.height.toFixed(1)} mm.` : ''}`));
      body.push(h('div', { class: 'segmented small view-pick', role: 'group', 'aria-label': 'Look from' },
        h('button', { onclick: () => lookAt('cheek') }, 'Cheek'), h('button', { onclick: () => lookAt('bite') }, 'Bite'), h('button', { onclick: () => lookAt('tongue') }, 'Tongue')));
      const t = typicalSize(u.fdi);
      body.push(h('div', { class: 'tune' },
        stepRow('Width', `${u.md.toFixed(1)} mm`, () => { u.md = Math.max(t[0] * 0.5, u.md - 0.2); }, () => { u.md = Math.min(t[0] * 1.5, u.md + 0.2); }),
        stepRow('Cheek to tongue', `${u.bl.toFixed(1)} mm`, () => { u.bl = Math.max(t[1] * 0.5, u.bl - 0.2); }, () => { u.bl = Math.min(t[1] * 1.5, u.bl + 0.2); }),
        stepRow('Height', `${u.height.toFixed(1)} mm`, () => { u.height = Math.max(t[2] * 0.4, u.height - 0.2); }, () => { u.height = Math.min(t[2] * 1.7, u.height + 0.2); }),
        stepRow('Turn', `${u.turn.toFixed(0)}°`, () => { u.turn -= 2; }, () => { u.turn += 2; }, '↺', '↻'),
        stepRow('Cheek / tongue', `${u.shiftB >= 0 ? '+' : ''}${u.shiftB.toFixed(1)} mm`, () => { u.shiftB -= 0.2; }, () => { u.shiftB += 0.2; }, 'Tongue', 'Cheek'),
        stepRow('Front / back', `${u.shiftM >= 0 ? '+' : ''}${u.shiftM.toFixed(1)} mm`, () => { u.shiftM -= 0.2; }, () => { u.shiftM += 0.2; }, 'Front', 'Back'),
        stepRow('Bite', sp.bite === 0 ? 'light touch' : sp.bite > 0 ? `${sp.bite.toFixed(2)} mm gap` : `${(-sp.bite).toFixed(2)} mm firmer`, () => { sp.bite = Math.max(-0.3, +(sp.bite - 0.05).toFixed(2)); }, () => { sp.bite = Math.min(1, +(sp.bite + 0.05).toFixed(2)); }, 'Firmer', 'Lighter'),
      ));
      body.push(h('div', { class: 'row-btns' },
        h('button', { class: 'btn secondary', onclick: () => { fit(sp); redraw(); } }, icon('reset', 16), 'Fit to bite again'),
        h('button', { class: `btn secondary${sp.adapt ? ' on' : ''}`, 'aria-pressed': String(sp.adapt), onclick: () => { sp.adapt = !sp.adapt; save(); redraw(); } }, sp.adapt ? 'Grinding to bite: on' : 'Grinding to bite: off')));
      // Crown library (shape style) and shade, for the whole crown or bridge.
      const lib = libraryOf(sp.library);
      const setLook = (l?: string, sh?: string) => {
        if (l) sp.library = pr.library = l as typeof sp.library;
        if (sh) sp.shade = pr.shade = sh as typeof sp.shade;
        if (l) fit(sp); save(); redraw();
      };
      body.push(h('h3', null, 'Crown library'),
        h('div', { class: 'lib-grid', role: 'group', 'aria-label': 'Crown library' }, LIBRARIES.map((x) => h('button', { class: `tool-btn${x.id === lib.id ? ' on' : ''}`, 'aria-pressed': String(x.id === lib.id), onclick: () => setLook(x.id) }, x.label))),
        h('p', { class: 'tool-help' }, lib.help),
        h('div', { class: 'tune-row' }, h('span', { class: 'tune-label' }, 'Shade'),
          h('div', { class: 'shade-row', role: 'group', 'aria-label': 'Shade' }, SHADE_IDS.map((id) => {
            const c = SHADES[id].map((x) => Math.round(x * 255)).join(',');
            return h('button', { class: `shade${(sp.shade ?? 'A2') === id ? ' on' : ''}`, 'aria-pressed': String((sp.shade ?? 'A2') === id), style: `--shade:rgb(${c})`, onclick: () => setLook(undefined, id) }, id);
          }))));
      // Teeth in this span.
      const quad = Math.floor(sp.units[0].fdi / 10);
      body.push(h('details', { class: 'tech' }, h('summary', null, sp.units.length > 1 ? 'Bridge teeth' : 'Tooth number and bridge'),
        stepRow('First tooth', String(sp.units[0].fdi), () => { const f = sp.units[0].fdi; if (f % 10 > 1) resizeUnits(sp, sp.units.map((x) => x.fdi - 1)); }, () => { const last = sp.units[sp.units.length - 1].fdi; if (last % 10 < 8) resizeUnits(sp, sp.units.map((x) => x.fdi + 1)); }),
        stepRow('Teeth in the gap', String(sp.units.length), () => { if (sp.units.length > 1) { resizeUnits(sp, sp.units.slice(0, -1).map((x) => x.fdi)); fit(sp); } }, () => { const last = sp.units[sp.units.length - 1].fdi; if (last % 10 < 8 && sp.units.length < 4) { resizeUnits(sp, [...sp.units.map((x) => x.fdi), last + 1]); fit(sp); } }),
        h('p', { class: 'muted small' }, `Quadrant ${quad}. More than one tooth makes a bridge between the two contact points.`)));
      body.push(h('div', { class: 'row-btns' },
        h('button', { class: 'btn secondary', onclick: () => { pick = 'mesial'; pendingMesial = null; pr.spans = pr.spans.filter((x) => x !== sp); sel = null; save(); message = 'Tap the two contact points again.'; mount(); updatePanel(); } }, 'Redo contact points'),
        h('button', { class: 'btn secondary', onclick: () => { pr.spans = pr.spans.filter((x) => x !== sp); sel = pr.spans[0] ? { span: pr.spans[0].id, unit: 0 } : null; if (!pr.spans.length) pick = 'mesial'; save(); message = 'Removed.'; mount(); updatePanel(); } }, icon('trash', 16), sp.units.length > 1 ? 'Remove bridge' : 'Remove crown')));
    }
    body.push(h('h3', null, 'Show'), h('div', { class: 'nudge' },
      h('button', { class: `chip${showOpp ? ' on' : ''}`, onclick: () => { showOpp = !showOpp; redraw(); } }, `${other() === 'upper' ? 'Upper' : 'Lower'} jaw`),
      h('button', { class: `chip${showBite ? ' on' : ''}`, onclick: () => { showBite = !showBite; redraw(); } }, 'Bite colours'),
      h('button', { class: `chip${showCt ? ' on' : ''}`, onclick: () => { showCt = !showCt; redraw(); } }, 'CBCT')),
      showBite ? h('p', { class: 'muted small' }, 'Red: touching the opposing teeth. Yellow to green: close (up to 1 mm). Ivory: clear.') : null);
    if (doctor && sp) body.push(h('p', { class: 'muted small' }, `Long axis ${sp.o.map((x) => x.toFixed(2)).join(', ')} · ${isUpper(sp.units[0].fdi) ? 'upper' : 'lower'} jaw`));
    panel.replaceChildren(h('h2', null, 'Crowns'), ...(body.filter(Boolean) as HTMLElement[]),
      busy ? h('div', { class: 'ok-line small' }, busy) : h('span'),
      message ? h('div', { class: /not fit|too close|did not|Add the|No tooth|Could not/i.test(message) ? 'warn-line' : 'ok-line small' }, message) : h('span'));
  }

  const el = h('div', { class: 'viewer guided' }, h('div', { class: 'viewer-main' }, heroArea), panel);
  const off = onScansChanged(() => { geoKey = ''; mount(); updatePanel(); });
  mount();
  updatePanel();
  return {
    el,
    refresh() { hero?.invalidate(); schedule(); },
    dispose() { cancelAnimationFrame(raf); off(); hero?.dispose(); },
  };
}
