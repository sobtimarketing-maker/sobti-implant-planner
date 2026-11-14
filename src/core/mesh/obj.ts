// Own streaming OBJ reader: v (with optional r g b), f (any polygon,
// v/vt/vn forms, negative indices). Materials and textures are ignored, so a
// missing .mtl or image is fine. Text is fed in chunks.
import { F32Builder, TriMesh, U32Builder, U8Builder } from './mesh';

export class ObjParser {
  private pos = new F32Builder();
  private col = new U8Builder();
  private hasColor = false;
  private idx = new U32Builder();
  private rest = '';
  private poly: number[] = [];

  push(text: string): void {
    const s = this.rest + text;
    let start = 0;
    for (;;) {
      const nl = s.indexOf('\n', start);
      if (nl < 0) break;
      this.line(s, start, nl);
      start = nl + 1;
    }
    this.rest = s.slice(start);
  }

  finish(): TriMesh {
    if (this.rest) { this.line(this.rest, 0, this.rest.length); this.rest = ''; }
    const positions = this.pos.done();
    const m: TriMesh = { positions, indices: this.idx.done() };
    if (this.hasColor && this.col.n === positions.length) m.colors = this.col.done();
    return m;
  }

  private line(s: string, a: number, b: number): void {
    while (a < b && (s.charCodeAt(a) === 32 || s.charCodeAt(a) === 9)) a++;
    if (b - a < 2) return;
    const c0 = s.charCodeAt(a), c1 = s.charCodeAt(a + 1);
    if (c0 === 118 && (c1 === 32 || c1 === 9)) { // 'v '
      const parts = s.slice(a + 2, b).trim().split(/\s+/);
      this.pos.push3(+parts[0], +parts[1], +parts[2]);
      if (parts.length >= 6) {
        this.hasColor = true;
        const k = +parts[3] <= 1 && +parts[4] <= 1 && +parts[5] <= 1 ? 255 : 1;
        this.col.push3(Math.round(+parts[3] * k), Math.round(+parts[4] * k), Math.round(+parts[5] * k));
      } else this.col.push3(200, 200, 200);
    } else if (c0 === 102 && (c1 === 32 || c1 === 9)) { // 'f '
      const nv = this.pos.n / 3;
      const parts = s.slice(a + 2, b).trim().split(/\s+/);
      const poly = this.poly; poly.length = 0;
      for (const p of parts) {
        const sl = p.indexOf('/');
        let i = parseInt(sl < 0 ? p : p.slice(0, sl), 10);
        if (Number.isNaN(i)) continue;
        i = i < 0 ? nv + i : i - 1;
        poly.push(i);
      }
      for (let k = 1; k + 1 < poly.length; k++) this.idx.push3(poly[0], poly[k], poly[k + 1]);
    }
  }
}

export async function parseObjStream(stream: ReadableStream<Uint8Array>, onBytes?: (n: number) => void): Promise<TriMesh> {
  const p = new ObjParser();
  const dec = new TextDecoder();
  const reader = stream.getReader();
  let n = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    n += value.byteLength;
    p.push(dec.decode(value, { stream: true }));
    onBytes?.(n);
  }
  p.push(dec.decode());
  return p.finish();
}
