// Double-tap detection from pointer taps. WebView touch input does not
// reliably fire 'dblclick' when touch-action is 'none', so views count taps
// themselves: two taps within 350 ms and 40 css px make a double tap.
export class DoubleTap {
  private last: { t: number; x: number; y: number } | null = null;
  /** Feed one completed tap; returns true when it completes a double tap. */
  tap(x: number, y: number, t = performance.now()): boolean {
    const l = this.last;
    if (l && t - l.t < 350 && Math.hypot(x - l.x, y - l.y) < 40) { this.last = null; return true; }
    this.last = { t, x, y };
    return false;
  }
  clear(): void { this.last = null; }
}
