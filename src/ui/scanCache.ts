// Mouth-scan meshes for the open case, read once from storage and shared by
// every screen that shows them.
import { getScan, StoredScan } from '../core/store/db';

type Arch = 'upper' | 'lower';
let caseId = '';
const meshes = new Map<Arch, StoredScan>();
const pending = new Map<Arch, Promise<void>>();
const listeners = new Set<() => void>();

export function scanMeshes(id: string): Map<Arch, StoredScan> {
  if (id !== caseId) { caseId = id; meshes.clear(); pending.clear(); }
  for (const a of ['lower', 'upper'] as Arch[]) {
    if (meshes.has(a) || pending.has(a)) continue;
    pending.set(a, getScan(id, a).then((m) => { if (m && caseId === id) { meshes.set(a, m); listeners.forEach((f) => f()); } }).catch(() => undefined));
  }
  return meshes;
}

export function setScanMesh(id: string, arch: Arch, m: StoredScan | null): void {
  if (id !== caseId) { caseId = id; meshes.clear(); pending.clear(); }
  if (m) meshes.set(arch, m); else meshes.delete(arch);
  pending.set(arch, Promise.resolve());
  listeners.forEach((f) => f());
}

export function onScansChanged(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }
