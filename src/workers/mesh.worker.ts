/// <reference lib="webworker" />
// Mouth-scan reader worker: OBJ or STL file -> full mesh + display copy.
import { parseObjStream } from '../core/mesh/obj';
import { parseStl } from '../core/mesh/stl';
import { decimate } from '../core/mesh/decimate';
import type { TriMesh } from '../core/mesh/mesh';

const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);
const buffers = (m: TriMesh) => [m.positions.buffer, m.indices.buffer, ...(m.colors ? [m.colors.buffer] : [])] as ArrayBuffer[];

self.onmessage = async (ev: MessageEvent<{ file: File; id: number }>) => {
  const { file, id } = ev.data;
  try {
    const name = file.name.toLowerCase();
    let full: TriMesh;
    if (name.endsWith('.stl')) full = parseStl(await file.arrayBuffer());
    else if (name.endsWith('.obj')) full = await parseObjStream(file.stream(), (n) => post({ id, type: 'progress', done: n, total: file.size }));
    else throw new Error('Choose an .stl or .obj file.');
    if (full.indices.length < 30) throw new Error('No surface found in this file.');
    const display = decimate(full, 40000);
    const same = display === full;
    post({ id, type: 'done', full, display: same ? null : display }, same ? buffers(full) : [...buffers(full), ...buffers(display)]);
  } catch (e) {
    post({ id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
