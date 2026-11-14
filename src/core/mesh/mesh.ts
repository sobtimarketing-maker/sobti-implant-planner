// Triangle mesh in millimetres (scan coordinates until registered).
export interface TriMesh {
  positions: Float32Array;   // xyz per vertex
  indices: Uint32Array;      // 3 per triangle
  colors?: Uint8Array;       // rgb per vertex, if the file had them
}

export function bounds(p: Float32Array): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { const v = p[i + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
  return { min, max };
}

/** Grow-only typed array builders (avoid huge JS number arrays). */
export class F32Builder {
  a = new Float32Array(1 << 16); n = 0;
  push3(x: number, y: number, z: number) { if (this.n + 3 > this.a.length) this.grow(); this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z; }
  private grow() { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
  done() { return this.a.slice(0, this.n); }
}
export class U32Builder {
  a = new Uint32Array(1 << 16); n = 0;
  push3(x: number, y: number, z: number) { if (this.n + 3 > this.a.length) this.grow(); this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z; }
  private grow() { const b = new Uint32Array(this.a.length * 2); b.set(this.a); this.a = b; }
  done() { return this.a.slice(0, this.n); }
}
export class U8Builder {
  a = new Uint8Array(1 << 16); n = 0;
  push3(x: number, y: number, z: number) { if (this.n + 3 > this.a.length) this.grow(); this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z; }
  private grow() { const b = new Uint8Array(this.a.length * 2); b.set(this.a); this.a = b; }
  done() { return this.a.slice(0, this.n); }
}
