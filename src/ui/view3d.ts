// A 3D view on screen. Rendering happens in the shared engine; this class
// owns a 2D canvas, a camera and the touch handling, and copies the
// engine's picture across after each render.
//
// Touch: drag to turn, pinch to zoom, two fingers to move, tap to put the
// point on what you tapped, double tap to reset (or what the owner wants).
import type { Vec3, Volume } from '../core/volume/volume';
import { Camera, ClipMode, getEngine, RenderOpts, SceneSurface } from '../render/vr/engine';
import { PRESET_LABELS, PresetId } from '../render/vr/presets';
import { volumeCenter } from '../render/oblique';
import { DoubleTap } from './doubleTap';
import { h } from './dom';

export interface View3DHost {
  base: Volume;
  /** Show the CBCT volume (default: the shared look setting). */
  volume?(): boolean;
  /** Distance along a world ray to the nearest picked surface (Infinity if none). */
  pickSurface?(ro: Vec3, rd: Vec3): number;
  /** Where the camera starts (default: the whole volume). */
  home?(): { center: Vec3; size: number };
  /** A fixed cut for this view (instead of the shared one at the point). */
  clip?(): { mode: ClipMode; at: Vec3 } | null;
  cursor(): Vec3 | null;
  setCursor?(p: Vec3): void;
  surfaces(): SceneSurface[];
  interacting?(): boolean;
}

/** Look and cut, shared by every 3D view so a thumbnail matches the big view. */
export const look3d: { preset: PresetId; clip: ClipMode; scan: boolean; listeners: Set<() => void> } = { preset: 'bone', clip: 'none', scan: true, listeners: new Set() };
function setLook(p: Partial<Pick<typeof look3d, 'preset' | 'clip' | 'scan'>>) { Object.assign(look3d, p); look3d.listeners.forEach((f) => f()); }

const VIEWS: [string, number, number][] = [['Front', 0, 0], ['Right', -90, 0], ['Left', 90, 0], ['Top', 0, 89], ['Below', 0, -89]];
const CLIPS: [ClipMode, string][] = [['none', 'All'], ['lower', 'Hide above point'], ['upper', 'Hide below point'], ['front', 'Cut front']];

export class View3D {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cam: Camera;
  private dirty = true;
  private moving = false;
  private refineTimer = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private g: null | { kind: 'one' | 'two'; x0: number; y0: number; last: [number, number]; moved: boolean; dist: number; mid: [number, number]; cam: Camera } = null;
  private dbl = new DoubleTap();
  private ro: ResizeObserver;
  private bar: HTMLElement | null = null;
  private onLook = () => { this.drawBar(); this.invalidate(); this.draw(); };
  private narrow = false;
  private barOpen = false;

  constructor(private host: View3DHost, private o: { compact?: boolean; onDoubleTap?: () => void; label?: string; bar?: boolean } = {}) {
    this.el = document.createElement('div');
    this.el.className = 'view view3d' + (o.compact ? ' compact' : '');
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', o.label ?? '3D view');
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.cam = this.homeCamera();
    getEngine().setVolume(host.base);
    this.ro = new ResizeObserver(() => {
      const n = this.el.getBoundingClientRect().width < 640;
      if (n !== this.narrow) { this.narrow = n; this.drawBar(); }
      this.invalidate(); this.draw();
    });
    this.ro.observe(this.el);
    look3d.listeners.add(this.onLook);
    if (!o.compact) this.bind();
    if (!o.compact && o.bar !== false) { this.bar = h('div', { class: 'v3d-bar' }); this.el.append(this.bar); this.drawBar(); }
  }

  dispose(): void { this.ro.disconnect(); look3d.listeners.delete(this.onLook); clearTimeout(this.refineTimer); }
  invalidate(): void { this.dirty = true; }
  resetView(): void { this.cam = this.homeCamera(); this.invalidate(); }
  /** Point the camera from a direction (deg). */
  look(yawDeg: number, pitchDeg: number): void { this.cam = { ...this.cam, yaw: (yawDeg * Math.PI) / 180, pitch: (pitchDeg * Math.PI) / 180 }; this.invalidate(); }

  private fitPending = true;
  private homeCamera(): Camera {
    const b = this.host.base;
    const fov = (30 * Math.PI) / 180;
    const hm = this.host.home?.();
    this.fitPending = true;
    if (hm) return { target: hm.center, yaw: this.cam?.yaw ?? 0, pitch: this.cam?.pitch ?? 0, dist: (hm.size / 2 / Math.tan(fov / 2)) * 1.1, fov };
    const ext = Math.hypot(b.dims[0] * b.spacing[0], b.dims[1] * b.spacing[1], b.dims[2] * b.spacing[2]);
    return { target: volumeCenter(b), yaw: 0, pitch: 0, dist: (ext / 2 / Math.tan(fov / 2)) * 0.7, fov };
  }

  private drawBar(): void {
    if (!this.bar) return;
    const chip = (label: string, on: boolean, fn: () => void) => h('button', { class: `chip${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: (e: Event) => { e.stopPropagation(); fn(); } }, label);
    if (this.narrow && !this.barOpen) {
      this.bar.replaceChildren(h('div', { class: 'v3d-row' }, chip('3D options', false, () => { this.barOpen = true; this.drawBar(); })));
      return;
    }
    this.bar.replaceChildren(
      h('div', { class: 'v3d-row', role: 'group', 'aria-label': '3D look' },
        ...PRESET_LABELS.map(([id, l]) => chip(l, look3d.scan && look3d.preset === id, () => setLook({ preset: id, scan: true }))),
        chip('Outlines only', !look3d.scan, () => setLook({ scan: !look3d.scan })),
        h('span', { class: 'v3d-gap' }),
        ...CLIPS.map(([id, l]) => chip(l, look3d.clip === id, () => setLook({ clip: id })))),
      h('div', { class: 'v3d-row', role: 'group', 'aria-label': '3D direction' },
        ...VIEWS.map(([l, yaw, pitch]) => chip(l, false, () => { this.cam = { ...this.cam, yaw: (yaw * Math.PI) / 180, pitch: (pitch * Math.PI) / 180 }; this.invalidate(); this.draw(); })),
        chip('Centre on point', false, () => { const c = this.host.cursor(); if (c) { this.cam = { ...this.cam, target: [...c] as Vec3 }; this.invalidate(); this.draw(); } }),
        this.narrow ? chip('Close', false, () => { this.barOpen = false; this.drawBar(); }) : null),
    );
  }

  private opts(fast: boolean): RenderOpts & { cssW: number; cssH: number } {
    const r = this.el.getBoundingClientRect();
    const cssW = Math.max(1, r.width), cssH = Math.max(1, r.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    let k = this.o.compact ? Math.min(dpr, 320 / Math.max(cssW, cssH)) : dpr;
    if (fast) k *= 0.5;
    return {
      cssW, cssH,
      width: Math.round(cssW * k), height: Math.round(cssH * k),
      camera: this.cam, preset: look3d.preset,
      ...(() => { const fc = this.host.clip?.(); return fc ? { clip: fc.mode, cursor: fc.at } : { clip: look3d.clip, cursor: this.host.cursor() }; })(),
      surfaces: this.host.surfaces(), fast, volume: this.host.volume ? this.host.volume() : look3d.scan,
    };
  }

  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const fast = this.moving || !!this.host.interacting?.();
    // Fit the home view to the view's shape once it has a size.
    if (this.fitPending) {
      const r = this.el.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) {
        this.fitPending = false;
        const aspect = r.width / r.height;
        if (aspect < 1) this.cam = { ...this.cam, dist: this.cam.dist / aspect };
      }
    }
    const o = this.opts(fast);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(o.cssW * dpr), H = Math.round(o.cssH * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const eng = getEngine();
    let src: ReturnType<typeof eng.render> = null;
    try { src = eng.render(o); } catch (e) { eng.error = (e as Error).message; }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!src) {
      ctx.fillStyle = '#050B16'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(234,240,250,.8)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `500 ${13 * dpr}px Inter, system-ui, sans-serif`;
      ctx.fillText(eng.error || '3D is starting…', W / 2, H / 2);
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = fast ? 'low' : 'high';
    ctx.drawImage(eng.canvas, src.sx, src.sy, src.w, src.h, 0, 0, W, H);
    // Sharpen after the movement stops.
    if (fast) {
      clearTimeout(this.refineTimer);
      this.refineTimer = window.setTimeout(() => { if (!this.moving && !this.host.interacting?.()) { this.dirty = true; this.draw(); } }, 180);
    }
  }

  private bind(): void {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const cam = { ...this.cam, target: [...this.cam.target] as Vec3 };
      if (this.pointers.size === 1) this.g = { kind: 'one', x0: e.clientX, y0: e.clientY, last: [e.clientX, e.clientY], moved: false, dist: 0, mid: [0, 0], cam };
      else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.g = { kind: 'two', x0: 0, y0: 0, last: [0, 0], moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], cam };
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId) || !this.g) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = this.g;
      if (g.kind === 'two' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        const dist = Math.max(20, Math.min(2000, g.cam.dist * (g.dist / Math.max(1, d))));
        this.cam = { ...g.cam, dist, target: this.panned(g.cam, mid[0] - g.mid[0], mid[1] - g.mid[1]) };
        this.moving = true; this.invalidate(); this.draw();
        return;
      }
      if (g.kind !== 'one') return;
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 8) return;
      g.moved = true;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      this.cam = { ...g.cam, yaw: g.cam.yaw - dx * 0.008, pitch: Math.max(-1.55, Math.min(1.55, g.cam.pitch + dy * 0.008)) };
      this.moving = true; this.invalidate(); this.draw();
    });
    const end = (e: PointerEvent) => {
      const g = this.g;
      if (g && g.kind === 'one' && !g.moved && this.pointers.size === 1) {
        if (this.dbl.tap(e.clientX, e.clientY)) {
          if (this.o.onDoubleTap) this.o.onDoubleTap(); else { this.resetView(); this.draw(); }
        } else this.pick(e.clientX, e.clientY);
      } else if (g?.moved) this.dbl.clear();
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) {
        this.g = null;
        if (this.moving) { this.moving = false; this.invalidate(); this.draw(); }
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.g = null; if (this.moving) { this.moving = false; this.invalidate(); this.draw(); } });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam = { ...this.cam, dist: Math.max(20, Math.min(2000, this.cam.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1))) };
      this.invalidate(); this.draw();
    }, { passive: false });
  }

  /** Move the camera target by a screen drag (css px). */
  private panned(c: Camera, dx: number, dy: number): Vec3 {
    const r = this.el.getBoundingClientRect();
    const mmPerPx = (2 * c.dist * Math.tan(c.fov / 2)) / Math.max(1, r.height);
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const right: Vec3 = [cy, sy, 0];
    const up: Vec3 = [-sy * sp, cy * sp, cp];
    return [0, 1, 2].map((i) => c.target[i] - right[i] * dx * mmPerPx + up[i] * dy * mmPerPx) as Vec3;
  }

  private pick(cx: number, cy: number): void {
    if (!this.host.setCursor) return;
    const r = this.el.getBoundingClientRect();
    const o = this.opts(false);
    const p = getEngine().pick({ ...o, width: o.cssW, height: o.cssH }, cx - r.left, cy - r.top, this.host.pickSurface);
    if (p) this.host.setCursor(p);
  }
}
