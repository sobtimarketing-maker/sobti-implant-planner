// Scan editor: brush tools on a mouth scan for doctors and staff.
// One finger paints with the chosen tool, two fingers turn and zoom.
// Tools are named by what the user wants to fix (rough, too low, too high,
// cut through, holes, a tooth to take out). Teeth can be protected so the
// gum can be worked without touching them. Undo/redo, changes map, save or
// cancel; the untouched scan is always kept and can be brought back.
import type { Vec3 } from '../core/volume/volume';
import type { TriMesh } from '../core/mesh/mesh';
import type { StoredScan } from '../core/store/db';
import type { M4 } from '../core/register/rigid';
import { apply, inverseRigid } from '../core/register/rigid';
import { BrushKind, compact, EditableMesh } from '../core/mesh/sculpt';
import { removeAndFill, selectTooth } from '../core/mesh/extract';
import { decimate } from '../core/mesh/decimate';
import { PointGrid } from '../core/register/icp';
import type { SceneSurface } from '../render/vr/engine';
import { getEngine } from '../render/vr/engine';
import { sphereMesh } from '../render/vr/shapes';
import { h, icon } from './dom';

export type EditTool = 'smooth' | 'add' | 'remove' | 'flatten' | 'cut' | 'holes' | 'tooth';
const TOOLS: { id: EditTool; label: string; help: string }[] = [
  { id: 'smooth', label: 'Smooth', help: 'Rough, bumpy or sharp area: rub over it.' },
  { id: 'add', label: 'Build up', help: 'Dent or too low: rub over it to add material.' },
  { id: 'remove', label: 'Take away', help: 'Bump or too high: rub over it to remove material.' },
  { id: 'flatten', label: 'Flatten', help: 'Make an area level, e.g. a ridge.' },
  { id: 'cut', label: 'Cut out', help: 'Paint the part to cut through (it turns red), then cut it out, with or without closing the hole.' },
  { id: 'holes', label: 'Close holes', help: 'Tap next to a hole to close it, or close all small holes at once.' },
  { id: 'tooth', label: 'Take a tooth out', help: 'Tap the tooth: it turns red. Check only that tooth is red, then take it out. The gum is closed over.' },
];
const SIZES = [{ label: 'S', r: 1 }, { label: 'M', r: 2.5 }, { label: 'L', r: 4.5 }];
const STRENGTHS = [{ label: 'Gentle', s: 0.35 }, { label: 'Normal', s: 0.7 }, { label: 'Strong', s: 1 }];

export interface ScanEditorHost {
  arch: 'upper' | 'lower';
  scan: StoredScan;
  /** Scan mm -> world mm. */
  m: M4;
  /** Unit world direction towards the opposing jaw for this scan. */
  towards: Vec3;
  /** CBCT tooth tests for a tap (world) on a mesh: the tapped tooth and the other teeth. */
  toothTests(mesh: TriMesh, world: Vec3): { mine?: (i: number) => boolean; other?: (i: number) => boolean };
  /** CBCT tooth surface around the whole jaw (world), or null without a CBCT. */
  teethGrid(): PointGrid | null;
  original(): Promise<StoredScan | null>;
  showNumbers: boolean;
  redraw(): void;
  panel(): void;
  save(s: StoredScan, keepOriginal: StoredScan): Promise<void>;
  close(): void;
}

export class ScanEditor {
  readonly e: EditableMesh;
  tool: EditTool = 'smooth';
  size = 1;
  strength = 1;
  protect = true;
  showChanges = false;
  message = '';
  busy = '';
  private undo: { pos: Float32Array; idx: Uint32Array }[] = [];
  private redo: { pos: Float32Array; idx: Uint32Array }[] = [];
  private lastDab: Vec3 | null = null;
  private brushAt: Vec3 | null = null;
  private stroking = false;
  private toothR = 5.5;
  private toothTap: Vec3 | null = null;
  private locked: Int8Array;
  private changes: Uint8Array | null = null;
  private changesVersion = -1;
  private origGrid: PointGrid | null = null;
  private inv: M4;
  private oScan: Vec3;
  private sphere = sphereMesh();
  dirty = false;

  constructor(private host: ScanEditorHost) {
    this.e = new EditableMesh(host.scan.full);
    this.locked = new Int8Array(this.e.vertexCount).fill(-1);
    this.inv = inverseRigid(host.m);
    const a = apply(this.inv, [0, 0, 0]), b = apply(this.inv, host.towards);
    this.oScan = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  }

  /** World ray onto the scan being edited. */
  ray(ro: Vec3, rd: Vec3): number {
    const o = apply(this.inv, ro), e = apply(this.inv, [ro[0] + rd[0], ro[1] + rd[1], ro[2] + rd[2]]);
    return this.e.ray(o, [e[0] - o[0], e[1] - o[1], e[2] - o[2]]);
  }

  // ---------- painting
  painting(): boolean { return !this.busy; }
  paint(phase: 'start' | 'move' | 'end', w: Vec3 | null): void {
    const r = SIZES[this.size].r;
    if (phase === 'end') {
      if (this.stroking) { this.stroking = false; this.e.regrid(); this.changesVersion = -1; this.host.panel(); }
      this.lastDab = null; this.host.redraw(); return;
    }
    if (!w) return;
    const p = apply(this.inv, w);
    this.brushAt = w;
    if (this.tool === 'holes') { if (phase === 'start') this.closeHoleNear(p); return; }
    if (this.tool === 'tooth') { if (phase === 'start') this.pickTooth(w, p); return; }
    if (phase === 'start') { this.snapshot(); this.stroking = true; this.lastDab = null; }
    if (this.lastDab && Math.hypot(p[0] - this.lastDab[0], p[1] - this.lastDab[1], p[2] - this.lastDab[2]) < r * 0.25) return;
    const kind: BrushKind = this.tool === 'cut' ? 'select' : this.tool;
    const lock = this.protect && kind !== 'select' ? (i: number) => this.isLocked(i) : undefined;
    this.e.dab(kind, p, r, STRENGTHS[this.strength].s, lock);
    this.lastDab = p; this.dirty = true;
    if (this.tool === 'cut') this.host.panel();
    this.host.redraw();
  }

  private isLocked(i: number): boolean {
    if (this.locked.length !== this.e.vertexCount) this.locked = new Int8Array(this.e.vertexCount).fill(-1);
    const c = this.locked[i];
    if (c >= 0) return c === 1;
    const g = this.host.teethGrid();
    const P = this.e.pos, w = apply(this.host.m, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const on = !!g && g.nearest(w, 0.9).i >= 0;
    this.locked[i] = on ? 1 : 0;
    return on;
  }

  // ---------- undo
  private snapshot(): void {
    this.undo.push({ pos: this.e.pos.slice(), idx: this.e.idx });
    if (this.undo.length > 25) this.undo.shift();
    this.redo = [];
  }
  private restore(s: { pos: Float32Array; idx: Uint32Array }): void {
    if (s.idx === this.e.idx) { this.e.pos = s.pos; this.e.regrid(); this.e.version++; }
    else { this.e.replace({ positions: s.pos, indices: s.idx }); this.locked = new Int8Array(this.e.vertexCount).fill(-1); }
  }
  doUndo(): void { const s = this.undo.pop(); if (!s) return; this.redo.push({ pos: this.e.pos.slice(), idx: this.e.idx }); this.restore(s); this.after('Undone.'); }
  doRedo(): void { const s = this.redo.pop(); if (!s) return; this.undo.push({ pos: this.e.pos.slice(), idx: this.e.idx }); this.restore(s); this.after('Redone.'); }
  private after(msg: string): void { this.message = msg; this.changesVersion = -1; this.dirty = true; this.host.panel(); this.host.redraw(); }
  private topology(f: () => void, msg: string): void {
    this.snapshot();
    f();
    this.locked = new Int8Array(this.e.vertexCount).fill(-1);
    this.after(msg);
  }

  // ---------- cut, holes, tooth
  cut(close: boolean): void {
    if (!this.e.selectedCount()) return;
    this.topology(() => this.e.cutSelection(close, this.oScan, this.protect ? (i) => this.isLocked(i) : undefined), close ? 'Cut out and closed.' : 'Cut out. Use Close holes to close it later.');
  }
  private closeHoleNear(p: Vec3): void {
    const hs = this.e.holes();
    let best = null as null | (typeof hs)[number], bd = Infinity;
    for (const hl of hs) {
      // Distance to the nearest rim point.
      for (const v of hl.loop) { const d = Math.hypot(this.e.pos[v * 3] - p[0], this.e.pos[v * 3 + 1] - p[1], this.e.pos[v * 3 + 2] - p[2]); if (d < bd) { bd = d; best = hl; } }
    }
    if (!best || bd > 6) { this.message = 'No hole there. Tap right next to the hole.'; this.host.panel(); return; }
    const hl = best;
    this.topology(() => this.e.closeHoles([hl], this.oScan), 'Hole closed.');
  }
  closeAll(maxMm: number): void {
    const hs = this.e.holes().filter((x) => x.perimeter <= maxMm);
    if (!hs.length) { this.message = `No holes under ${maxMm} mm around.`; this.host.panel(); return; }
    this.topology(() => this.e.closeHoles(hs, this.oScan), `${hs.length} hole${hs.length > 1 ? 's' : ''} closed.`);
  }
  holeCount(): { small: number; all: number } { const hs = this.e.holes(); return { small: hs.filter((x) => x.perimeter <= 30).length, all: hs.length }; }

  private pickTooth(w: Vec3, p: Vec3): void {
    this.toothTap = w;
    const tests = this.host.toothTests(this.e.mesh(), w);
    this.e.sel = selectTooth(this.e.mesh(), { seed: p, o: this.oScan, radius: this.toothR }, tests.mine);
    this.e.version++;
    this.message = this.e.selectedCount() ? '' : 'No tooth found there. Tap on the crown of the tooth.';
    this.host.panel(); this.host.redraw();
  }
  toothSize(d: number): void { this.toothR = Math.max(3, Math.min(9, this.toothR + d)); if (this.toothTap) this.pickTooth(this.toothTap, apply(this.inv, this.toothTap)); }
  takeToothOut(): void {
    if (!this.toothTap || !this.e.selectedCount()) return;
    const tests = this.host.toothTests(this.e.mesh(), this.toothTap);
    this.topology(() => this.e.replace(removeAndFill(this.e.mesh(), this.e.sel, this.oScan, 0.4, tests.other)), 'Tooth taken out and the gum closed over.');
    this.toothTap = null;
  }

  async startAgain(): Promise<void> {
    const o = await this.host.original();
    if (!o) { this.message = 'This is already the original scan.'; this.host.panel(); return; }
    this.topology(() => this.e.replace(o.full), 'Back to the original scan. Save to keep it that way.');
  }

  async save(): Promise<void> {
    this.busy = 'Saving the scan…'; this.host.panel();
    await new Promise((r) => setTimeout(r, 30));
    const full = compact(this.e.mesh());
    const stored: StoredScan = { full, display: decimate(full, 40000) };
    await this.host.save(stored, this.host.scan);
    this.busy = ''; this.dirty = false;
    this.host.close();
  }

  setTool(t: EditTool): void {
    this.tool = t; this.message = '';
    if (t !== 'cut' && t !== 'tooth' && this.e.selectedCount()) this.e.clearSelection();
    if (t !== 'tooth') this.toothTap = null;
    this.host.panel(); this.host.redraw();
  }

  // ---------- drawing
  private changeColours(): Uint8Array | null {
    if (!this.showChanges) return null;
    if (this.changesVersion === this.e.version && this.changes) return this.changes;
    if (!this.origGrid) this.origGrid = new PointGrid(this.host.scan.full.positions, 1);
    const n = this.e.vertexCount, P = this.e.pos, col = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = this.origGrid.nearest([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], 1);
      const d = r.i < 0 ? 1 : r.d, t = Math.min(1, d / 0.5);
      col[i * 3] = Math.round(230 + 10 * t); col[i * 3 + 1] = Math.round(184 - 120 * t); col[i * 3 + 2] = Math.round(189 - 140 * t);
      if (d < 0.02) { col[i * 3] = 230; col[i * 3 + 1] = 184; col[i * 3 + 2] = 189; }
    }
    this.changes = col; this.changesVersion = this.e.version;
    return col;
  }
  surfaces(base: [number, number, number]): SceneSurface[] {
    const key = `edit:${this.host.arch}:${this.e.version}:`;
    const sel = this.e.sel, hasSel = this.e.selectedCount() > 0;
    const changes = this.stroking ? null : this.changeColours();
    let colors: Uint8Array | undefined;
    if (hasSel || changes) {
      colors = changes ? changes.slice() : new Uint8Array(this.e.vertexCount * 3);
      for (let i = 0; i < this.e.vertexCount; i++) {
        if (sel[i]) { colors[i * 3] = 235; colors[i * 3 + 1] = 70; colors[i * 3 + 2] = 80; }
        else if (!changes) { colors[i * 3] = base[0] * 255; colors[i * 3 + 1] = base[1] * 255; colors[i * 3 + 2] = base[2] * 255; }
      }
    }
    const m = { positions: this.e.pos, indices: this.e.idx, colors };
    // Free the GPU copies of earlier edit states.
    const eng = getEngine();
    eng.keepMeshes(new Set([...eng.meshKeys()].filter((k) => !k.startsWith('edit:') || k.startsWith(key))));
    const out: SceneSurface[] = [{ key: colors ? `${key}c${changes ? 1 : 0}` : key, color: base, mesh: () => m, model: this.host.m, vertexColors: !!colors }];
    if (this.brushAt && this.tool !== 'holes' && this.tool !== 'tooth') out.push({ key: 'sphere', color: [0.36, 0.7, 1], mesh: () => this.sphere, at: [...this.brushAt, SIZES[this.size].r * 0.18] as [number, number, number, number] });
    return out;
  }

  // ---------- panel
  panelBody(): HTMLElement[] {
    const t = TOOLS.find((x) => x.id === this.tool)!;
    const out: HTMLElement[] = [];
    out.push(h('p', { class: 'muted small' }, 'One finger works on the scan, two fingers turn and zoom.'));
    out.push(h('div', { class: 'tool-grid', role: 'group', 'aria-label': 'Scan tool' }, TOOLS.map((x) => h('button', { class: `tool-btn${x.id === this.tool ? ' on' : ''}`, 'aria-pressed': String(x.id === this.tool), onclick: () => this.setTool(x.id) }, x.label))));
    out.push(h('p', { class: 'tool-help' }, t.help));
    if (['smooth', 'add', 'remove', 'flatten', 'cut'].includes(this.tool)) {
      out.push(h('div', { class: 'tune-row' }, h('span', { class: 'tune-label' }, 'Brush'),
        h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Brush size' }, SIZES.map((z, i) => h('button', { class: i === this.size ? 'on' : '', 'aria-label': `Brush size ${z.label}`, onclick: () => { this.size = i; this.host.panel(); } }, z.label)))));
      if (this.tool !== 'cut') out.push(h('div', { class: 'tune-row' }, h('span', { class: 'tune-label' }, 'Strength'),
        h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Strength' }, STRENGTHS.map((z, i) => h('button', { class: i === this.strength ? 'on' : '', onclick: () => { this.strength = i; this.host.panel(); } }, z.label)))));
    }
    if (this.tool === 'cut') {
      const n = this.e.selectedCount();
      out.push(h('div', { class: 'row-btns' },
        h('button', { class: 'btn primary', disabled: !n || !!this.busy, onclick: () => this.cut(true) }, 'Cut out and close'),
        h('button', { class: 'btn secondary', disabled: !n, onclick: () => this.cut(false) }, 'Cut through'),
        h('button', { class: 'btn secondary', disabled: !n, onclick: () => { this.e.clearSelection(); this.host.panel(); this.host.redraw(); } }, 'Clear red')));
    }
    if (this.tool === 'holes') {
      const c = this.holeCount();
      out.push(h('div', { class: 'stat' }, c.all ? `${c.all} hole${c.all > 1 ? 's' : ''} in the scan (${c.small} small)` : 'No holes in the scan'),
        h('button', { class: 'btn primary', disabled: !c.small, onclick: () => this.closeAll(30) }, 'Close all small holes'));
    }
    if (this.tool === 'tooth' && this.toothTap && this.e.selectedCount()) {
      out.push(h('div', { class: 'tune-row' }, h('span', { class: 'tune-label' }, 'Area'), this.host.showNumbers ? h('span', { class: 'tune-value' }, `${(this.toothR * 2).toFixed(0)} mm`) : h('span'),
        h('button', { class: 'chip', onclick: () => this.toothSize(-0.5) }, 'Smaller'), h('button', { class: 'chip', onclick: () => this.toothSize(0.5) }, 'Larger')),
        h('button', { class: 'btn primary', onclick: () => this.takeToothOut() }, 'Take this tooth out'));
    }
    out.push(h('div', { class: 'nudge' },
      h('button', { class: `chip${this.protect ? ' on' : ''}`, 'aria-pressed': String(this.protect), onclick: () => { this.protect = !this.protect; this.host.panel(); } }, this.protect ? 'Teeth protected' : 'Teeth not protected'),
      h('button', { class: `chip${this.showChanges ? ' on' : ''}`, onclick: () => { this.showChanges = !this.showChanges; this.host.panel(); this.host.redraw(); } }, 'Show changes')));
    if (this.showChanges) out.push(h('p', { class: 'muted small' }, 'Orange to red: changed (up to 0.5 mm or more). Pink: as scanned.'));
    out.push(h('div', { class: 'row-btns' },
      h('button', { class: 'btn secondary', disabled: !this.undo.length, onclick: () => this.doUndo() }, icon('reset', 16), 'Undo'),
      h('button', { class: 'btn secondary', disabled: !this.redo.length, onclick: () => this.doRedo() }, 'Redo')));
    out.push(h('div', { class: 'row-btns' },
      h('button', { class: 'btn primary', disabled: !this.dirty || !!this.busy, onclick: () => { void this.save(); } }, icon('check', 16), 'Save scan'),
      h('button', { class: 'btn secondary', disabled: !!this.busy, onclick: () => this.host.close() }, 'Cancel')));
    out.push(h('button', { class: 'btn secondary small', disabled: !!this.busy, onclick: () => { void this.startAgain(); } }, 'Start again from the original scan'));
    if (this.busy) out.push(h('div', { class: 'ok-line small' }, this.busy));
    if (this.message) out.push(h('div', { class: /No |not/.test(this.message) ? 'warn-line' : 'ok-line small' }, this.message));
    return out;
  }
}
