// Own IndexedDB wrapper: cases (JSON) and cached working volumes (binary).
import { CaseRecord, migrateCase } from '../case/model';
import type { VolumeInfo } from '../volume/volume';

const DB_NAME = 'implant-planner';
const DB_VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cases')) db.createObjectStore('cases', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('volumes')) db.createObjectStore('volumes');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export async function listCases(): Promise<CaseRecord[]> {
  const all = await tx<CaseRecord[]>('cases', 'readonly', (s) => s.getAll() as IDBRequest<CaseRecord[]>);
  return all.map(migrateCase).sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function getCase(id: string): Promise<CaseRecord | undefined> {
  const c = await tx<CaseRecord | undefined>('cases', 'readonly', (s) => s.get(id));
  return c ? migrateCase(c) : undefined;
}

export async function putCase(c: CaseRecord): Promise<void> {
  c.modified = new Date().toISOString();
  await tx('cases', 'readwrite', (s) => s.put(c));
}

export async function deleteCase(id: string): Promise<void> {
  await tx('cases', 'readwrite', (s) => s.delete(id));
  await tx('volumes', 'readwrite', (s) => s.delete(id));
}

export interface CachedVolume { info: VolumeInfo; data: Int16Array }

export async function putVolume(caseId: string, v: CachedVolume): Promise<void> {
  await tx('volumes', 'readwrite', (s) => s.put(v, caseId));
}

export async function getVolume(caseId: string): Promise<CachedVolume | undefined> {
  return tx<CachedVolume | undefined>('volumes', 'readonly', (s) => s.get(caseId));
}

/** Debounced autosave: call often, writes at most every `ms`. */
export function autosaver(ms = 600) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: CaseRecord | null = null;
  const flush = async () => {
    timer = null;
    if (latest) { const c = latest; latest = null; await putCase(c); }
  };
  return {
    save(c: CaseRecord) { latest = c; if (!timer) timer = setTimeout(flush, ms); },
    flush,
  };
}
