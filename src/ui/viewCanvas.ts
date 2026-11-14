// One interactive view: an oblique plane through the cursor, drawn with
// window/level, the other planes' lines, orientation letters, scale bar and
// measurements. Handles touch, stylus, mouse and wheel.
import type { Vec3, Volume } from '../core/volume/volume';
import { ORIENT, ViewKind, WindowLut } from '../render/mpr';
import { add, cross, Frame, len, planeFor, rotate, rotateFrame, samplePlane, scale, sub, volumeCenter } from '../render/oblique';
import { dot } from '../core/volume/volume';
import { DoubleTap } from './doubleTap';

export type Tool = 'scroll' | 'window' | 'tilt' | 'measure';

export interface Measurement { id: string; a: Vec3; b: Vec3; view: ViewKind }

export interface ViewHost {
  base: Volume;                 // working volume (extent, step size)
  vols(): Volume[];             // finest first
  cursor: Vec3;                 // world LPS mm
  frame: Frame;
  /** In-plane rotation per view that keeps a tilted view's own image upright. */
  spin: Record<ViewKind, number>;
  wc: number;
  ww: number;
  tool: Tool;
  showNumbers: boolean;
  measurements: Measurement[];
  setCursor(p: Vec3): void;
  setWindow(wc: number, ww: number): void;
  setFrame(f: Frame, spin?: Record<ViewKind, number>): void;
  addMeasurement(a: Vec3, b: Vec3, view: ViewKind): void;
  setInteracting(on: boolean): void;
  interacting: boolean;
}

export const VIEW_COLOR: Record<ViewKind, string> = { axial: '#FBAE49', coronal: '#5BE3A0', sagittal: '#7FB2FF' };
const LABEL: Record<ViewKind, string> = { axial: 'Axial', coronal: 'Coronal', sagittal: 'Sagittal' };

export class ViewCanvas {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: HTMLCanvasElement;
  private imgCtx: CanvasRenderingContext2D;
  private imageData: ImageData | null = null;
  private buf = new Int16Array(0);
  private lut = new WindowLut();
  private zoom = 1;
  private pan: [number, number] = [0, 0]; // mm along u, v
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: null | {
    kind: 'drag' | 'pinch'; x0: number; y0: number; moved: boolean;
    cursor: Vec3; frame: Frame; spin: Record<ViewKind, number>; wc: number; ww: number;
    dist: number; zoom: number; mid: [number, number]; pan: [number, number];
    a?: Vec3; b?: Vec3;
  } = null;
  private dirty = true;
  private ro: ResizeObserver;
  private compact: boolean;
  private center: Vec3;
  private dbl = new DoubleTap();
  private onDoubleTap?: () => void;

  /** onDoubleTap: what a double tap does (default: reset zoom and pan). */
  constructor(readonly kind: ViewKind, private host: ViewHost, opts: { compact?: boolean; onDoubleTap?: () => void } = {}) {
    this.compact = !!opts.compact;
    this.onDoubleTap = opts.onDoubleTap;
    this.center = volumeCenter(host.base);
    this.el = document.createElement('div');
    this.el.className = 'view' + (this.compact ? ' compact' : '');
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', `${LABEL[kind]} CBCT slice`);
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.img = document.createElement('canvas');
    this.imgCtx = this.img.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.invalidate());
    this.ro.observe(this.el);
    if (!this.compact) this.bindInput();
  }

  dispose(): void { this.ro.disconnect(); }
  invalidate(): void { this.dirty = true; }
  resetView(): void { this.zoom = 1; this.pan = [0, 0]; this.invalidate(); }
  get plane() {
    const p = planeFor(this.kind, this.host.frame);
    const a = this.host.spin[this.kind];
    return a ? { u: rotate(p.u, p.n, -a), v: rotate(p.v, p.n, -a), n: p.n } : p;
  }

  /** Geometry of the current plane on screen. */
  private geom() {
    const rect = this.el.getBoundingClientRect();
    const cssW = Math.max(1, rect.width), cssH = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(cssW * dpr)), H = Math.max(1, Math.round(cssH * dpr));
    const b = this.host.base;
    const extent = Math.max(b.dims[0] * b.spacing[0], b.dims[1] * b.spacing[1], b.dims[2] * b.spacing[2]);
    const mmPerCss = extent / Math.min(cssW, cssH) / this.zoom;
    // Sample grid: device pixels, halved while interacting, capped for speed.
    const q = this.host.interacting && !this.compact ? 0.5 : 1;
    const cap = this.compact ? 320 : 1024;
    const s = Math.min(q, cap / Math.max(W, H));
    const sw = Math.max(1, Math.round(W * s)), sh = Math.max(1, Math.round(H * s));
    const px = (cssW * mmPerCss) / sw; // mm per sample pixel
    const pl = this.plane;
    // Display centre: volume centre shifted by pan, moved onto the plane through the cursor.
    const c0 = add(this.center, add(scale(pl.u, this.pan[0]), scale(pl.v, this.pan[1])));
    const D = add(c0, scale(pl.n, dot(sub(this.host.cursor, c0), pl.n)));
    return { W, H, dpr, sw, sh, px, pl, D, k: W / sw, mmPerCss };
  }

  private toScreen(g: ReturnType<ViewCanvas['geom']>, p: Vec3): [number, number] {
    const d = sub(p, g.D);
    return [(dot(d, g.pl.u) / g.px + g.sw / 2) * g.k, (dot(d, g.pl.v) / g.px + g.sh / 2) * g.k];
  }

  private toWorld(clientX: number, clientY: number): Vec3 {
    const g = this.geom();
    const r = this.el.getBoundingClientRect();
    const x = ((clientX - r.left) * g.dpr) / g.k - g.sw / 2;
    const y = ((clientY - r.top) * g.dpr) / g.k - g.sh / 2;
    return add(g.D, add(scale(g.pl.u, x * g.px), scale(g.pl.v, y * g.px)));
  }

  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const g = this.geom();
    if (this.canvas.width !== g.W || this.canvas.height !== g.H) { this.canvas.width = g.W; this.canvas.height = g.H; }
    if (this.buf.length !== g.sw * g.sh) this.buf = new Int16Array(g.sw * g.sh);
    const origin = add(g.D, add(scale(g.pl.u, (-g.sw / 2 + 0.5) * g.px), scale(g.pl.v, (-g.sh / 2 + 0.5) * g.px)));
    samplePlane(this.host.vols(), origin, g.pl.u, g.pl.v, g.px, g.sw, g.sh, this.buf, !this.host.interacting);
    if (!this.imageData || this.imageData.width !== g.sw || this.imageData.height !== g.sh) {
      this.img.width = g.sw; this.img.height = g.sh;
      this.imageData = this.imgCtx.createImageData(g.sw, g.sh);
    }
    let hasData = false;
    for (let i = 0; i < this.buf.length; i += 7) if (this.buf[i] > -900) { hasData = true; break; }
    this.lut.set(this.host.wc, this.host.ww);
    this.lut.apply(this.buf, new Uint32Array(this.imageData.data.buffer));
    this.imgCtx.putImageData(this.imageData, 0, 0);

    const ctx = this.ctx, dpr = g.dpr, W = g.W, H = g.H;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, 0, 0, W, H);

    // Other planes through the cursor: line direction = n × n_other.
    const [cx, cy] = this.toScreen(g, this.host.cursor);
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash(this.compact ? [] : [6 * dpr, 6 * dpr]);
    for (const other of ['axial', 'coronal', 'sagittal'] as ViewKind[]) {
      if (other === this.kind) continue;
      const dir = cross(g.pl.n, planeFor(other, this.host.frame).n);
      const du = dot(dir, g.pl.u), dv = dot(dir, g.pl.v);
      const l = Math.hypot(du, dv);
      if (l < 1e-6) continue;
      const ext = (W + H) * 2;
      ctx.strokeStyle = VIEW_COLOR[other] + 'CC';
      ctx.beginPath();
      ctx.moveTo(cx - (du / l) * ext, cy - (dv / l) * ext);
      ctx.lineTo(cx + (du / l) * ext, cy + (dv / l) * ext);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (!this.compact) {
      ctx.strokeStyle = VIEW_COLOR[this.kind];
      ctx.beginPath(); ctx.arc(cx, cy, 5 * dpr, 0, Math.PI * 2); ctx.stroke();
    }

    // Measurements lying in this plane (both ends within 0.75 mm).
    if (!this.compact && this.host.showNumbers) {
      const list = [...this.host.measurements];
      const live = this.gesture?.a && this.gesture.b ? { id: 'live', a: this.gesture.a, b: this.gesture.b, view: this.kind } : null;
      if (live) list.push(live);
      for (const m of list) {
        const off = (p: Vec3) => Math.abs(dot(sub(p, g.D), g.pl.n));
        if (off(m.a) > 0.75 || off(m.b) > 0.75) continue;
        const [ax, ay] = this.toScreen(g, m.a), [bx, by] = this.toScreen(g, m.b);
        ctx.strokeStyle = '#FBAE49';
        ctx.fillStyle = '#FBAE49';
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        for (const [x, y] of [[ax, ay], [bx, by]]) { ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2); ctx.fill(); }
        const txt = `${len(sub(m.b, m.a)).toFixed(1)} mm`;
        ctx.font = `600 ${13 * dpr}px Inter, system-ui, sans-serif`;
        const tw = ctx.measureText(txt).width;
        const mx = (ax + bx) / 2 + 8 * dpr, my = (ay + by) / 2 - 8 * dpr;
        ctx.fillStyle = 'rgba(14,42,87,.85)';
        ctx.fillRect(mx - 4 * dpr, my - 12 * dpr, tw + 8 * dpr, 18 * dpr);
        ctx.fillStyle = '#FBAE49';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(txt, mx, my - 3 * dpr);
      }
    }

    // Orientation letters (from the plane's dominant LPS direction).
    const [l, r, t, b] = this.letters(g.pl.u, g.pl.v);
    ctx.fillStyle = 'rgba(234, 240, 250, 0.85)';
    ctx.font = `600 ${(this.compact ? 10 : 13) * dpr}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.fillText(l, 10 * dpr, H / 2);
    ctx.textAlign = 'right'; ctx.fillText(r, W - 10 * dpr, H / 2);
    ctx.textAlign = 'center'; ctx.fillText(t, W / 2, 14 * dpr); ctx.fillText(b, W / 2, H - 14 * dpr);

    if (!hasData) {
      ctx.fillStyle = 'rgba(234, 240, 250, 0.75)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `500 ${(this.compact ? 11 : 14) * dpr}px Inter, system-ui, sans-serif`;
      ctx.fillText('Outside the scan', W / 2, H / 2 - (this.compact ? 0 : 10 * dpr));
      if (!this.compact) ctx.fillText('Tap on the jaw in another view', W / 2, H / 2 + 12 * dpr);
    }

    // Scale bar: 10 mm, or 5 / 1 mm when zoomed in.
    if (!this.compact) {
      const mmPx = (g.k / g.px);
      const mm = 10 * mmPx < W * 0.3 ? 10 : 5 * mmPx < W * 0.3 ? 5 : 1;
      const bar = mm * mmPx;
      const x0 = W - 16 * dpr - bar, y0 = 40 * dpr;
      ctx.strokeStyle = '#EAF0FA';
      ctx.fillStyle = '#EAF0FA';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + bar, y0); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = `500 ${11 * dpr}px Inter, system-ui, sans-serif`;
      ctx.fillText(`${mm} mm`, x0 + bar / 2, y0 + 12 * dpr);
    }
  }

  private letters(u: Vec3, v: Vec3): [string, string, string, string] {
    const name = (d: Vec3, positive: boolean) => {
      const a = [Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2])];
      const ax = a.indexOf(Math.max(...a));
      const pos = (d[ax] > 0) === positive;
      return ax === 0 ? (pos ? 'L' : 'R') : ax === 1 ? (pos ? 'P' : 'A') : (pos ? 'S' : 'I');
    };
    const base = ORIENT[this.kind];
    void base;
    return [name(u, false), name(u, true), name(v, false), name(v, true)];
  }

  private stepAlongNormal(mm: number): void {
    this.host.setCursor(add(this.host.cursor, scale(this.plane.n, mm)));
  }

  private bindInput(): void {
    const el = this.canvas;
    el.style.touchAction = 'none';
    const step = () => Math.min(...this.host.base.spacing);
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const common = { cursor: [...this.host.cursor] as Vec3, frame: this.host.frame, spin: { ...this.host.spin }, wc: this.host.wc, ww: this.host.ww, zoom: this.zoom, pan: [...this.pan] as [number, number] };
      if (this.pointers.size === 1) {
        this.gesture = { kind: 'drag', x0: e.clientX, y0: e.clientY, moved: false, dist: 0, mid: [0, 0], ...common };
        if (this.host.tool === 'measure' && this.host.showNumbers) { const p = this.toWorld(e.clientX, e.clientY); this.gesture.a = p; }
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.gesture = { kind: 'pinch', x0: 0, y0: 0, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], ...common };
      }
      this.host.setInteracting(true);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId) || !this.gesture) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = this.gesture;
      if (g.kind === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom = Math.max(0.5, Math.min(40, g.zoom * (d / Math.max(1, g.dist))));
        const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        const mm = this.geom().mmPerCss;
        this.pan = [g.pan[0] - (mid[0] - g.mid[0]) * mm, g.pan[1] - (mid[1] - g.mid[1]) * mm];
        this.invalidate();
        this.host.setCursor(this.host.cursor); // redraw
        return;
      }
      if (g.kind !== 'drag') return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (!g.moved && Math.hypot(dx, dy) < 8) return;
      g.moved = true;
      switch (this.host.tool) {
        case 'window':
          this.host.setWindow(Math.round(g.wc - dy * 6), Math.max(50, Math.round(g.ww + dx * 10)));
          break;
        case 'tilt': {
          // Rotate the other planes about this view's normal, around the cursor.
          const r = this.el.getBoundingClientRect();
          const gg = this.geom();
          const [cx, cy] = this.toScreen(gg, this.host.cursor).map((v) => v / gg.dpr);
          const a0 = Math.atan2(g.y0 - r.top - cy, g.x0 - r.left - cx);
          const a1 = Math.atan2(e.clientY - r.top - cy, e.clientX - r.left - cx);
          const da = a1 - a0;
          this.host.setFrame(rotateFrame(g.frame, planeFor(this.kind, g.frame).n, da), { ...g.spin, [this.kind]: g.spin[this.kind] + da });
          break;
        }
        case 'measure':
          if (g.a) { g.b = this.toWorld(e.clientX, e.clientY); this.invalidate(); this.host.setCursor(this.host.cursor); }
          break;
        default: {
          const n = this.plane.n;
          const target = -dy * 0.25 * step() * 2;
          const now = dot(sub(this.host.cursor, g.cursor), n);
          this.stepAlongNormal(target - now);
        }
      }
    });
    const end = (e: PointerEvent) => {
      const g = this.gesture;
      if (g && g.kind === 'drag') {
        if (!g.moved && this.pointers.size === 1) {
          if (this.dbl.tap(e.clientX, e.clientY)) {
            if (this.onDoubleTap) this.onDoubleTap();
            else { this.resetView(); this.host.setCursor(this.host.cursor); }
          } else if (this.host.tool !== 'measure') this.host.setCursor(this.toWorld(e.clientX, e.clientY));
        } else this.dbl.clear();
        if (g.a && g.b && len(sub(g.b, g.a)) >= 0.3) this.host.addMeasurement(g.a, g.b, this.kind);
      }
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) { this.gesture = null; this.host.setInteracting(false); }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.gesture = null; this.host.setInteracting(false); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) { this.zoom = Math.max(0.5, Math.min(40, this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); this.invalidate(); this.host.setCursor(this.host.cursor); }
      else this.stepAlongNormal((e.deltaY > 0 ? 1 : -1) * step());
    }, { passive: false });
  }
}
