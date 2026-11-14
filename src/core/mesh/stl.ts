// Own STL reader, binary and ASCII. STL repeats each corner per triangle;
// corners at the same position are merged so the mesh is connected.
import { F32Builder, TriMesh, U32Builder } from './mesh';

export function parseStl(buf: ArrayBuffer): TriMesh {
  const bytes = new Uint8Array(buf);
  const dv = new DataView(buf);
  const isBinary = bytes.length >= 84 && 84 + dv.getUint32(80, true) * 50 === bytes.length;
  const pos = new F32Builder(), idx = new U32Builder();
  const map = new Map<string, number>();
  const vert = (x: number, y: number, z: number) => {
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let i = map.get(key);
    if (i === undefined) { i = pos.n / 3; map.set(key, i); pos.push3(x, y, z); }
    return i;
  };
  if (isBinary) {
    const n = dv.getUint32(80, true);
    for (let t = 0; t < n; t++) {
      const o = 84 + t * 50 + 12;
      const a = vert(dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true));
      const b = vert(dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true));
      const c = vert(dv.getFloat32(o + 24, true), dv.getFloat32(o + 28, true), dv.getFloat32(o + 32, true));
      if (a !== b && b !== c && a !== c) idx.push3(a, b, c);
    }
  } else {
    const text = new TextDecoder().decode(bytes);
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    const tri: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      tri.push(vert(+m[1], +m[2], +m[3]));
      if (tri.length === 3) { if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) idx.push3(tri[0], tri[1], tri[2]); tri.length = 0; }
    }
  }
  return { positions: pos.done(), indices: idx.done() };
}

/** Binary STL writer (for export later). */
export function writeStl(m: TriMesh, header = 'Sobti implant planner'): ArrayBuffer {
  const n = m.indices.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  for (let i = 0; i < Math.min(80, header.length); i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, n, true);
  const p = m.positions;
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50;
    const a = m.indices[t * 3] * 3, b = m.indices[t * 3 + 1] * 3, c = m.indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    [a, b, c].forEach((q, k) => { for (let j = 0; j < 3; j++) dv.setFloat32(o + 12 + k * 12 + j * 4, p[q + j], true); });
  }
  return buf;
}
