// Generic interactive image view (panoramic, cross-section, arch slice):
// shows an Int16 HU image with window/level and an optional label overlay,
// draws caller overlays, and reports taps and drags in image pixels.

import { WindowLut } from '../render/mpr';
import { DoubleTap } from './doubleTap';

export interface ImageSource {
  w: number; h: number;
  pxW: number; pxH: number;     // mm per image pixel
  data: Int16Array;
  overlay?: Uint8Array;         // 0 = none, n = palette colour n
}

export interface ImageCanvasOpts {
  label: string;
  window(): { wc: number; ww: number };
  letters?(): [string, string, string, string];
  /** Draw on top; map converts image px to canvas px; k = canvas px per image px. */
  draw?(ctx: CanvasRenderingContext2D, map: (x: number, y: number) => [number, number], k: number, dpr: number): void;
  onTap?(x: number, y: number): void;
  /** Return true on 'start' to take the drag (else it scrolls or pans). */
  onDrag?(phase: 'start' | 'move' | 'end', x: number, y: number): boolean;
  /** Vertical drag / wheel steps (in image px for drags, ±1 for wheel). */
  onScroll?(delta: number, wheel: boolean): void;
  compact?: boolean;
  /** What a double tap does (default: reset zoom and pan). */
  onDoubleTap?(): void;
  /**
   * Hold a single tap back 300 ms so that a double tap does not also count as
   * a tap. Use where a tap adds something (a nerve point, a tooth).
   */
  deferTap?: boolean;
}

export const OVERLAY_COLORS = [
  [0, 0, 0], [91, 227, 160], [127, 178, 255], [239, 176, 92], [229, 72, 77], [213, 188, 124], [190, 140, 255], [255, 120, 200],
];

export class ImageCanvas {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img = document.createElement('canvas');
  private imgCtx = this.img.getContext('2d')!;
  private imageData: ImageData | null = null;
  private src: ImageSource | null = null;
  private lut = new WindowLut();
  private contentDirty = true;
  private dirty = true;
  private zoom = 1;
  private pan: [number, number] = [0, 0]; // css px
  private pointers = new Map<number, { x: number; y: number }>();
  private g: null | { kind: 'one' | 'pinch'; x0: number; y0: number; last: [number, number]; moved: boolean; captured: boolean; dist: number; zoom: number; mid: [number, number]; pan: [number, number] } = null;
  private ro: ResizeObserver;
  private dbl = new DoubleTap();
  private tapTimer = 0;

  constructor(private o: ImageCanvasOpts) {
    this.el = document.createElement('div');
    this.el.className = 'view' + (o.compact ? ' compact' : '');
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', o.label);
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => { this.dirty = true; requestAnimationFrame(() => this.draw()); });
    this.ro.observe(this.el);
    if (!o.compact) this.bind();
  }

  dispose(): void { this.ro.disconnect(); clearTimeout(this.tapTimer); }
  setImage(src: ImageSource | null): void { this.src = src; this.contentDirty = true; this.dirty = true; }
  invalidate(): void { this.dirty = true; }
  invalidateContent(): void { this.contentDirty = true; this.dirty = true; }
  resetView(): void { this.zoom = 1; this.pan = [0, 0]; this.dirty = true; }

  private layout() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    const s = this.src;
    if (!s) return { r, dpr, W, H, x: 0, y: 0, k: 1, ky: 1 };
    const mmW = s.w * s.pxW, mmH = s.h * s.pxH;
    const fit = Math.min(W / mmW, H / mmH) * this.zoom; // canvas px per mm
    const dw = mmW * fit, dh = mmH * fit;
    return { r, dpr, W, H, x: (W - dw) / 2 + this.pan[0] * dpr, y: (H - dh) / 2 + this.pan[1] * dpr, k: dw / s.w, ky: dh / s.h };
  }

  /** Client point to image pixel (float). */
  toImage(cx: number, cy: number): [number, number] {
    const L = this.layout();
    return [((cx - L.r.left) * L.dpr - L.x) / L.k, ((cy - L.r.top) * L.dpr - L.y) / L.ky];
  }

  draw(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const L = this.layout();
    if (this.canvas.width !== L.W || this.canvas.height !== L.H) { this.canvas.width = L.W; this.canvas.height = L.H; }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050B16';
    ctx.fillRect(0, 0, L.W, L.H);
    const s = this.src;
    if (!s) return;
    const { wc, ww } = this.o.window();
    const key = `${wc}|${ww}`;
    if (this.contentDirty || key !== (this.img as unknown as { key?: string }).key) {
      this.contentDirty = false;
      (this.img as unknown as { key?: string }).key = key;
      if (!this.imageData || this.imageData.width !== s.w || this.imageData.height !== s.h) {
        this.img.width = s.w; this.img.height = s.h;
        this.imageData = this.imgCtx.createImageData(s.w, s.h);
      }
      this.lut.set(wc, ww);
      const px = new Uint32Array(this.imageData.data.buffer);
      this.lut.apply(s.data, px);
      if (s.overlay) {
        const ov = s.overlay;
        for (let i = 0; i < ov.length; i++) {
          const c = ov[i];
          if (!c) continue;
          const [r, g, b] = OVERLAY_COLORS[c % OVERLAY_COLORS.length];
          const grey = px[i] & 0xff;
          const a = 0.45;
          px[i] = 0xff000000 | (Math.round(b * a + grey * (1 - a)) << 16) | (Math.round(g * a + grey * (1 - a)) << 8) | Math.round(r * a + grey * (1 - a));
        }
      }
      this.imgCtx.putImageData(this.imageData, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.img, L.x, L.y, s.w * L.k, s.h * L.ky);
    const map = (x: number, y: number): [number, number] => [L.x + x * L.k, L.y + y * L.ky];
    this.o.draw?.(ctx, map, L.k, L.dpr);
    const lt = this.o.letters?.();
    if (lt) {
      ctx.fillStyle = 'rgba(234, 240, 250, 0.85)';
      ctx.font = `600 ${(this.o.compact ? 10 : 13) * L.dpr}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left'; ctx.fillText(lt[0], 10 * L.dpr, L.H / 2);
      ctx.textAlign = 'right'; ctx.fillText(lt[1], L.W - 10 * L.dpr, L.H / 2);
      ctx.textAlign = 'center'; ctx.fillText(lt[2], L.W / 2, 14 * L.dpr); ctx.fillText(lt[3], L.W / 2, L.H - 14 * L.dpr);
    }
    if (!this.o.compact) {
      const mmPx = L.k / s.pxW;
      const mm = 10 * mmPx < L.W * 0.3 ? 10 : 5 * mmPx < L.W * 0.3 ? 5 : 1;
      const bar = mm * mmPx, x0 = L.W - 16 * L.dpr - bar, y0 = 40 * L.dpr;
      ctx.strokeStyle = '#EAF0FA'; ctx.fillStyle = '#EAF0FA'; ctx.lineWidth = 2 * L.dpr;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + bar, y0); ctx.stroke();
      ctx.textAlign = 'center'; ctx.font = `500 ${11 * L.dpr}px Inter, system-ui, sans-serif`;
      ctx.fillText(`${mm} mm`, x0 + bar / 2, y0 + 12 * L.dpr);
    }
  }

  private handleTap(cx: number, cy: number, ix: number, iy: number): void {
    const custom = this.o.onDoubleTap;
    if (this.dbl.tap(cx, cy)) {
      clearTimeout(this.tapTimer); this.tapTimer = 0;
      if (custom) custom(); else { this.resetView(); this.draw(); }
      return;
    }
    if (!this.o.deferTap) { this.o.onTap?.(ix, iy); return; }
    clearTimeout(this.tapTimer);
    this.tapTimer = window.setTimeout(() => { this.tapTimer = 0; this.o.onTap?.(ix, iy); }, 300);
  }

  private bind(): void {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        const [ix, iy] = this.toImage(e.clientX, e.clientY);
        const captured = !!this.o.onDrag?.('start', ix, iy);
        this.g = { kind: 'one', x0: e.clientX, y0: e.clientY, last: [e.clientX, e.clientY], moved: false, captured, dist: 0, zoom: this.zoom, mid: [0, 0], pan: [...this.pan] as [number, number] };
      } else if (this.pointers.size === 2) {
        if (this.g?.captured) this.o.onDrag?.('end', ...this.toImage(e.clientX, e.clientY));
        const [a, b] = [...this.pointers.values()];
        this.g = { kind: 'pinch', x0: 0, y0: 0, last: [0, 0], moved: true, captured: false, dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom, mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], pan: [...this.pan] as [number, number] };
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId) || !this.g) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = this.g;
      if (g.kind === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        this.zoom = Math.max(0.5, Math.min(20, g.zoom * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, g.dist)));
        this.pan = [g.pan[0] + (a.x + b.x) / 2 - g.mid[0], g.pan[1] + (a.y + b.y) / 2 - g.mid[1]];
        this.dirty = true; this.draw();
        return;
      }
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 8) return;
      g.moved = true;
      if (g.captured) { this.o.onDrag?.('move', ...this.toImage(e.clientX, e.clientY)); return; }
      if (this.o.onScroll) {
        const L = this.layout();
        this.o.onScroll(((e.clientY - g.last[1]) * L.dpr) / L.ky, false);
      } else {
        this.pan = [this.pan[0] + e.clientX - g.last[0], this.pan[1] + e.clientY - g.last[1]];
        this.dirty = true; this.draw();
      }
      g.last = [e.clientX, e.clientY];
    });
    const end = (e: PointerEvent) => {
      const g = this.g;
      if (g && g.kind === 'one') {
        const [ix, iy] = this.toImage(e.clientX, e.clientY);
        if (g.captured) this.o.onDrag?.('end', ix, iy);
        else if (!g.moved) this.handleTap(e.clientX, e.clientY, ix, iy);
        if (g.moved) this.dbl.clear();
      }
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) this.g = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.g = null; });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey || !this.o.onScroll) { this.zoom = Math.max(0.5, Math.min(20, this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); this.dirty = true; this.draw(); }
      else this.o.onScroll(e.deltaY > 0 ? 1 : -1, true);
    }, { passive: false });
  }
}
