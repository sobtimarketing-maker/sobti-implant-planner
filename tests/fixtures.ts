// Synthetic test data generated in code (no patient data in the repo).

type El = { group: number; elem: number; vr: string; value: Uint8Array };

const enc = (s: string) => {
  const b = new TextEncoder().encode(s.length % 2 ? s + ' ' : s);
  return b;
};
const uid = (s: string) => { const b = new TextEncoder().encode(s.length % 2 ? s + '\0' : s); return b; };
const u16 = (n: number, le = true) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, le); return b; };

export interface SliceSpec {
  rows: number;
  cols: number;
  z: number;
  spacing?: number;
  series?: string;
  instance?: number;
  pixel: (x: number, y: number) => number; // stored value (before rescale)
  intercept?: number;
  transferSyntax?: 'explicit' | 'implicit' | 'bigendian';
  signed?: boolean;
  withPreamble?: boolean;
  extraSequence?: boolean;
}

export function makeDicom(s: SliceSpec): Uint8Array {
  const ts = s.transferSyntax ?? 'explicit';
  const le = ts !== 'bigendian';
  const explicit = ts !== 'implicit';
  const tsUid = ts === 'explicit' ? '1.2.840.10008.1.2.1' : ts === 'implicit' ? '1.2.840.10008.1.2' : '1.2.840.10008.1.2.2';
  const sp = s.spacing ?? 0.5;
  const px = new Uint8Array(s.rows * s.cols * 2);
  const dv = new DataView(px.buffer);
  for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) {
    const v = s.pixel(x, y);
    if (s.signed) dv.setInt16((y * s.cols + x) * 2, v, le);
    else dv.setUint16((y * s.cols + x) * 2, v, le);
  }
  const els: El[] = [
    { group: 0x0008, elem: 0x0060, vr: 'CS', value: enc('CT') },
    { group: 0x0008, elem: 0x0070, vr: 'LO', value: enc('TestCo') },
    { group: 0x0010, elem: 0x0010, vr: 'PN', value: enc('Doe^Jane') },
    { group: 0x0010, elem: 0x0030, vr: 'DA', value: enc('19800102') },
    { group: 0x0020, elem: 0x000e, vr: 'UI', value: uid(s.series ?? '1.2.3.4') },
    { group: 0x0020, elem: 0x0013, vr: 'IS', value: enc(String(s.instance ?? 1)) },
    { group: 0x0020, elem: 0x0032, vr: 'DS', value: enc(`-10\\-20\\${s.z}`) },
    { group: 0x0020, elem: 0x0037, vr: 'DS', value: enc('1\\0\\0\\0\\1\\0') },
    { group: 0x0028, elem: 0x0010, vr: 'US', value: u16(s.rows, le) },
    { group: 0x0028, elem: 0x0011, vr: 'US', value: u16(s.cols, le) },
    { group: 0x0028, elem: 0x0030, vr: 'DS', value: enc(`${sp}\\${sp}`) },
    { group: 0x0028, elem: 0x0100, vr: 'US', value: u16(16, le) },
    { group: 0x0028, elem: 0x0101, vr: 'US', value: u16(16, le) },
    { group: 0x0028, elem: 0x0103, vr: 'US', value: u16(s.signed ? 1 : 0, le) },
    { group: 0x0028, elem: 0x1052, vr: 'DS', value: enc(String(s.intercept ?? -1000)) },
    { group: 0x0028, elem: 0x1053, vr: 'DS', value: enc('1') },
    { group: 0x7fe0, elem: 0x0010, vr: 'OW', value: px },
  ];
  const parts: Uint8Array[] = [];
  if (s.withPreamble !== false) {
    parts.push(new Uint8Array(128), new TextEncoder().encode('DICM'));
    const tsVal = uid(tsUid);
    parts.push(element({ group: 2, elem: 0x10, vr: 'UI', value: tsVal }, true, true));
  }
  if (s.extraSequence) {
    // Undefined-length sequence with one undefined-length item containing a Rows tag that must be ignored.
    const inner = element({ group: 0x0028, elem: 0x0010, vr: 'US', value: u16(999, le) }, explicit, le);
    const seqHead = new Uint8Array(explicit ? 12 : 8);
    const sv = new DataView(seqHead.buffer);
    sv.setUint16(0, 0x0008, le); sv.setUint16(2, 0x1140, le);
    if (explicit) { seqHead[4] = 0x53; seqHead[5] = 0x51; sv.setUint32(8, 0xffffffff, le); } else sv.setUint32(4, 0xffffffff, le);
    const tagOnly = (g: number, e: number, len: number) => { const b = new Uint8Array(8); const d = new DataView(b.buffer); d.setUint16(0, g, le); d.setUint16(2, e, le); d.setUint32(4, len, le); return b; };
    parts.push(seqHead, tagOnly(0xfffe, 0xe000, 0xffffffff), inner, tagOnly(0xfffe, 0xe00d, 0), tagOnly(0xfffe, 0xe0dd, 0));
  }
  for (const e of els) parts.push(element(e, explicit, le));
  return concat(parts);
}

function element(e: El, explicit: boolean, le: boolean): Uint8Array {
  const long = ['OB', 'OW', 'SQ', 'UN', 'UT'].includes(e.vr);
  const head = new Uint8Array(explicit ? (long ? 12 : 8) : 8);
  const dv = new DataView(head.buffer);
  dv.setUint16(0, e.group, le);
  dv.setUint16(2, e.elem, le);
  if (explicit) {
    head[4] = e.vr.charCodeAt(0); head[5] = e.vr.charCodeAt(1);
    if (long) dv.setUint32(8, e.value.length, le); else dv.setUint16(6, e.value.length, le);
  } else dv.setUint32(4, e.value.length, le);
  return concat([head, e.value]);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// --- ZIP writer (test-only) ---
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function deflateRaw(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function makeZip(files: { name: string; data: Uint8Array }[], deflate = true): Promise<Blob> {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const comp = deflate ? await deflateRaw(f.data) : f.data;
    const crc = crc32(f.data);
    const lh = new Uint8Array(30); const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(8, deflate ? 8 : 0, true);
    l.setUint32(14, crc, true); l.setUint32(18, comp.length, true); l.setUint32(22, f.data.length, true); l.setUint16(26, name.length, true);
    locals.push(lh, name, comp);
    const ch = new Uint8Array(46); const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(10, deflate ? 8 : 0, true);
    c.setUint32(16, crc, true); c.setUint32(20, comp.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = concat(central);
  const end = new Uint8Array(22); const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cd.length, true); e.setUint32(16, offset, true);
  return new Blob([concat(locals), cd, end]);
}

/** A small phantom: a bright sphere (1000 HU) in air, n slices of size x size. */
export function phantomSlices(n = 16, size = 32, spacing = 0.5): Uint8Array[] {
  const c = (size - 1) / 2, cz = (n - 1) / 2, r = size / 4;
  const out: Uint8Array[] = [];
  for (let k = 0; k < n; k++) {
    out.push(makeDicom({
      rows: size, cols: size, z: k * spacing, spacing, instance: n - k,
      pixel: (x, y) => (Math.hypot(x - c, y - c, k - cz) <= r ? 2000 : 0),
    }));
  }
  return out;
}
