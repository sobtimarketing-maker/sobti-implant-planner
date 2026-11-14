// Own ZIP reader. Reads only the central directory up front, then individual
// entries on demand from a Blob/File (File.slice never loads the whole file).
// Inflate uses the platform DecompressionStream('deflate-raw') (WebView 103+).

export interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

async function readRange(blob: Blob, start: number, end: number): Promise<DataView> {
  const buf = await blob.slice(start, end).arrayBuffer();
  return new DataView(buf);
}

function u64(dv: DataView, off: number): number {
  const lo = dv.getUint32(off, true);
  const hi = dv.getUint32(off + 4, true);
  return hi * 2 ** 32 + lo;
}

export async function isZip(blob: Blob): Promise<boolean> {
  if (blob.size < 4) return false;
  const dv = await readRange(blob, 0, 4);
  return dv.getUint32(0, true) === SIG_LOC;
}

export async function listEntries(blob: Blob): Promise<ZipEntry[]> {
  const tailLen = Math.min(blob.size, 22 + 65535 + 20);
  const tailStart = blob.size - tailLen;
  const tail = await readRange(blob, tailStart, blob.size);
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP file (end record missing)');
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);
  // ZIP64
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === SIG_EOCD64_LOC) {
      const eocd64Off = u64(tail, loc + 8);
      const e = await readRange(blob, eocd64Off, eocd64Off + 56);
      if (e.getUint32(0, true) !== SIG_EOCD64) throw new Error('Bad ZIP64 record');
      count = u64(e, 32);
      cdSize = u64(e, 40);
      cdOffset = u64(e, 48);
    }
  }
  const cd = await readRange(blob, cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  const dec = new TextDecoder();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== SIG_CEN) throw new Error('Corrupt ZIP directory');
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localHeaderOffset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    // ZIP64 extra field
    let q = p + 46 + nameLen;
    const qEnd = q + extraLen;
    while (q + 4 <= qEnd) {
      const id = cd.getUint16(q, true);
      const len = cd.getUint16(q + 2, true);
      if (id === 0x0001) {
        let r = q + 4;
        if (size === 0xffffffff) { size = u64(cd, r); r += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(cd, r); r += 8; }
        if (localHeaderOffset === 0xffffffff) { localHeaderOffset = u64(cd, r); r += 8; }
      }
      q += 4 + len;
    }
    entries.push({ name, method, compressedSize, size, localHeaderOffset, isDirectory: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function dataStart(blob: Blob, e: ZipEntry): Promise<number> {
  const h = await readRange(blob, e.localHeaderOffset, e.localHeaderOffset + 30);
  if (h.getUint32(0, true) !== SIG_LOC) throw new Error(`Corrupt ZIP entry: ${e.name}`);
  return e.localHeaderOffset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
}

/**
 * Read an entry. With maxBytes set, only the first maxBytes of uncompressed
 * data are produced (used to read DICOM headers cheaply).
 */
export async function readEntry(blob: Blob, e: ZipEntry, maxBytes?: number): Promise<Uint8Array> {
  const start = await dataStart(blob, e);
  if (e.method === 0) {
    const n = maxBytes !== undefined ? Math.min(maxBytes, e.size) : e.size;
    return new Uint8Array(await blob.slice(start, start + n).arrayBuffer());
  }
  if (e.method !== 8) throw new Error(`ZIP method ${e.method} not supported (${e.name})`);
  const want = maxBytes !== undefined ? Math.min(maxBytes, e.size) : e.size;
  // When only a prefix is wanted, read a generous prefix of the compressed data.
  const compEnd = maxBytes !== undefined
    ? Math.min(e.compressedSize, Math.max(4096, maxBytes * 2))
    : e.compressedSize;
  const src = blob.slice(start, start + compEnd).stream();
  const reader = src.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const out = new Uint8Array(want);
  let off = 0;
  try {
    while (off < want) {
      const { value, done } = await reader.read();
      if (done) break;
      const n = Math.min(value.length, want - off);
      out.set(n === value.length ? value : value.subarray(0, n), off);
      off += n;
    }
  } catch (err) {
    // A truncated compressed prefix ends with an error once input runs out;
    // that is expected when only a header prefix was requested.
    if (maxBytes === undefined) throw err;
  } finally {
    reader.cancel().catch(() => {});
  }
  return off === want ? out : out.subarray(0, off);
}
