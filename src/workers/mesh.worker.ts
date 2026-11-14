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
    const kind = name.endsWith('.stl') ? 'stl' : name.endsWith('.obj') ? 'obj' : await sniff(file);
    if (kind === 'stl') full = parseStl(await file.arrayBuffer());
    else if (kind === 'obj') full = await parseObjStream(file.stream(), (n) => post({ id, type: 'progress', done: n, total: file.size }));
    else throw new Error('This file is not a scan. Choose an .stl or .obj file from the scanner.');
    if (full.indices.length < 30) throw new Error('No surface found in this file.');
    const display = decimate(full, 40000);
    const same = display === full;
    post({ id, type: 'done', full, display: same ? null : display }, same ? buffers(full) : [...buffers(full), ...buffers(display)]);
  } catch (e) {
    post({ id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};

/** Tablet pickers sometimes hide the extension: look at the start of the file instead. */
async function sniff(file: File): Promise<'stl' | 'obj' | null> {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (head.length >= 84) {
    const n = new DataView(head.buffer).getUint32(80, true);
    if (84 + n * 50 === file.size) return 'stl';
  }
  const text = new TextDecoder().decode(head);
  if (/^\s*solid\b/.test(text) && /facet|endsolid/.test(text)) return 'stl';
  if (/^v\s+-?[\d.]/m.test(text)) return 'obj';
  return null;
}
