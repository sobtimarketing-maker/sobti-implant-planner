// One interactive slice view: draws a slice with window/level, crosshair,
// orientation letters and scale bar; handles touch, stylus, mouse and wheel.
import type { Volume } from '../core/volume/volume';
import { extractSlice, ORIENT, pixelToVoxel, sliceCount, sliceIndex, ViewKind, voxelToPixel, WindowLut } from '../render/mpr';

export type DragMode = 'scroll' | 'window';

export interface ViewHost {
  volume: Volume;
  cursor: [number, number, number];
  wc: number;
  ww: number;
  dragMode: DragMode;
  showNumbers: boolean;
  setCursor(c: [number, number, number]): void;
  setWindow(wc: number, ww: number): void;
}

const LABEL: Record<ViewKind, string> = { axial: 'Axial', coronal: 'Coronal', sagittal: 'Sagittal' };

export class ViewCanvas {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: HTMLCanvasElement;
  private imgCtx: CanvasRenderingContext2D;
  private imageData: ImageData | null = null;
  private sliceBuf: Int16Array | undefined;
  private lut = new WindowLut();
  private zoom = 1;
  private pan: [number, number] = [0, 0];
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: { kind: 'none' | 'drag' | 'pinch'; startX: number; startY: number; moved: boolean; startIdx: number; wc: number; ww: number; dist: number; zoom: number; mid: [number, number]; pan: [number, number] } | null = null;
  private dirty = true;
  private ro: ResizeObserver;

  private compact: boolean;

  constructor(readonly kind: ViewKind, private host: ViewHost, opts: { compact?: boolean } = {}) {
    this.compact = !!opts.compact;
    this.el = document.createElement('div');
    this.el.className = 'view' + (opts.compact ? ' compact' : '');
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', `${LABEL[kind]} CBCT slice`);
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.img = document.createElement('canvas');
    this.imgCtx = this.img.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.invalidate());
    this.ro.observe(this.el);
    if (!opts.compact) this.bindInput();
  }

  dispose(): void { this.ro.disconnect(); }

  invalidate(): void { this.dirty = true; }

  resetView(): void { this.zoom = 1; this.pan = [0, 0]; this.invalidate(); }

  /** Draw if anything changed. Called from the host's animation frame. */
  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const v = this.host.volume;
    const rect = this.el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(rect.width * dpr));
    const H = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const idx = sliceIndex(this.kind, this.host.cursor);
    const s = extractSlice(v, this.kind, idx, this.sliceBuf);
    this.sliceBuf = s.data;
    if (!this.imageData || this.imageData.width !== s.w || this.imageData.height !== s.h) {
      this.img.width = s.w; this.img.height = s.h;
      this.imageData = this.imgCtx.createImageData(s.w, s.h);
    }
    this.lut.set(this.host.wc, this.host.ww);
    this.lut.apply(s.data, new Uint32Array(this.imageData.data.buffer));
    this.imgCtx.putImageData(this.imageData, 0, 0);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050B16';
    ctx.fillRect(0, 0, W, H);
    const g = this.geometry(s.w, s.h, s.pxW, s.pxH, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, g.x, g.y, g.w, g.h);

    // Crosshair
    const [cx, cy] = voxelToPixel(v, this.kind, this.host.cursor);
    const px = g.x + (cx + 0.5) * g.sx, py = g.y + (cy + 0.5) * g.sy;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = 'rgba(251, 174, 73, 0.75)';
    ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.beginPath();
    ctx.moveTo(g.x, py); ctx.lineTo(g.x + g.w, py);
    ctx.moveTo(px, g.y); ctx.lineTo(px, g.y + g.h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Orientation letters
    const [l, r, t, b] = ORIENT[this.kind];
    ctx.fillStyle = 'rgba(234, 240, 250, 0.85)';
    ctx.font = `600 ${(this.compact ? 10 : 13) * dpr}px Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.fillText(l, 10 * dpr, H / 2);
    ctx.textAlign = 'right'; ctx.fillText(r, W - 10 * dpr, H / 2);
    ctx.textAlign = 'center'; ctx.fillText(t, W / 2, 14 * dpr); ctx.fillText(b, W / 2, H - 14 * dpr);

    // Scale bar (10 mm)
    const mmPx = g.sx / s.pxW;
    const bar = 10 * mmPx;
    if (!this.compact && bar > 20 && bar < W * 0.6) {
      const x0 = W - 16 * dpr - bar, y0 = 40 * dpr;
      ctx.strokeStyle = '#EAF0FA';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + bar, y0); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.font = `500 ${11 * dpr}px Inter, system-ui, sans-serif`;
      ctx.fillText('10 mm', x0 + bar / 2, y0 + 12 * dpr);
    }
  }

  private geometry(w: number, h: number, pxW: number, pxH: number, W: number, H: number) {
    // Fit physical size (mm) into the canvas, then apply zoom and pan.
    const mmW = w * pxW, mmH = h * pxH;
    const fit = Math.min(W / mmW, H / mmH) * this.zoom;
    const dw = mmW * fit, dh = mmH * fit;
    const dpr = W / Math.max(1, this.el.getBoundingClientRect().width);
    return { x: (W - dw) / 2 + this.pan[0] * dpr, y: (H - dh) / 2 + this.pan[1] * dpr, w: dw, h: dh, sx: dw / w, sy: dh / h };
  }

  /** CSS-pixel point in the element to image pixel. */
  private toImage(clientX: number, clientY: number): [number, number] {
    const v = this.host.volume;
    const rect = this.el.getBoundingClientRect();
    const W = this.canvas.width, H = this.canvas.height;
    const dpr = W / Math.max(1, rect.width);
    const idx = sliceIndex(this.kind, this.host.cursor);
    const s = { w: 0, h: 0, pxW: 0, pxH: 0 };
    if (this.kind === 'axial') Object.assign(s, { w: v.dims[0], h: v.dims[1], pxW: v.spacing[0], pxH: v.spacing[1] });
    else if (this.kind === 'coronal') Object.assign(s, { w: v.dims[0], h: v.dims[2], pxW: v.spacing[0], pxH: v.spacing[2] });
    else Object.assign(s, { w: v.dims[1], h: v.dims[2], pxW: v.spacing[1], pxH: v.spacing[2] });
    void idx;
    const g = this.geometry(s.w, s.h, s.pxW, s.pxH, W, H);
    const x = ((clientX - rect.left) * dpr - g.x) / g.sx;
    const y = ((clientY - rect.top) * dpr - g.y) / g.sy;
    return [Math.floor(x), Math.floor(y)];
  }

  private setCursorFromPoint(clientX: number, clientY: number): void {
    const v = this.host.volume;
    const [x, y] = this.toImage(clientX, clientY);
    const idx = sliceIndex(this.kind, this.host.cursor);
    const c = pixelToVoxel(v, this.kind, idx, x, y);
    const cl = (a: number, n: number) => Math.max(0, Math.min(n - 1, a));
    this.host.setCursor([cl(c[0], v.dims[0]), cl(c[1], v.dims[1]), cl(c[2], v.dims[2])]);
  }

  private stepSlice(delta: number): void {
    const c = [...this.host.cursor] as [number, number, number];
    const axis = this.kind === 'axial' ? 2 : this.kind === 'coronal' ? 1 : 0;
    const n = sliceCount(this.host.volume, this.kind);
    c[axis] = Math.max(0, Math.min(n - 1, c[axis] + delta));
    this.host.setCursor(c);
  }

  private bindInput(): void {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.gesture = {
          kind: 'drag', startX: e.clientX, startY: e.clientY, moved: false,
          startIdx: sliceIndex(this.kind, this.host.cursor), wc: this.host.wc, ww: this.host.ww,
          dist: 0, zoom: this.zoom, mid: [0, 0], pan: [...this.pan] as [number, number],
        };
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.gesture = {
          kind: 'pinch', startX: 0, startY: 0, moved: true, startIdx: 0, wc: 0, ww: 0,
          dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom,
          mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], pan: [...this.pan] as [number, number],
        };
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId) || !this.gesture) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = this.gesture;
      if (g.kind === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom = Math.max(0.5, Math.min(12, g.zoom * (d / Math.max(1, g.dist))));
        const mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        this.pan = [g.pan[0] + mid[0] - g.mid[0], g.pan[1] + mid[1] - g.mid[1]];
        this.invalidate();
        return;
      }
      if (g.kind !== 'drag') return;
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
      if (!g.moved && Math.hypot(dx, dy) < 8) return;
      g.moved = true;
      if (this.host.dragMode === 'window') {
        this.host.setWindow(Math.round(g.wc - dy * 6), Math.max(50, Math.round(g.ww + dx * 10)));
      } else {
        const n = sliceCount(this.host.volume, this.kind);
        const rect = this.el.getBoundingClientRect();
        const target = Math.round(g.startIdx - (dy / rect.height) * n * 1.2);
        this.stepSlice(target - sliceIndex(this.kind, this.host.cursor));
      }
    });
    const end = (e: PointerEvent) => {
      const g = this.gesture;
      if (g && g.kind === 'drag' && !g.moved && this.pointers.size === 1) this.setCursorFromPoint(e.clientX, e.clientY);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) this.gesture = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.gesture = null; });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        this.zoom = Math.max(0.5, Math.min(12, this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        this.invalidate();
      } else {
        this.stepSlice(e.deltaY > 0 ? 1 : -1);
      }
    }, { passive: false });
    el.addEventListener('dblclick', () => this.resetView());
  }
}
