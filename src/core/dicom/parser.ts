// Own DICOM Part-10 parser. Handles explicit/implicit VR, little/big endian,
// undefined-length sequences and items. Pixel data is located, not copied.

export const TS = {
  ImplicitLE: '1.2.840.10008.1.2',
  ExplicitLE: '1.2.840.10008.1.2.1',
  DeflatedLE: '1.2.840.10008.1.2.1.99',
  ExplicitBE: '1.2.840.10008.1.2.2',
} as const;

export const UNCOMPRESSED_TS = new Set<string>([TS.ImplicitLE, TS.ExplicitLE, TS.ExplicitBE]);

// Tags as (group << 16 | element)
export const T = {
  TransferSyntaxUID: 0x00020010,
  SOPClassUID: 0x00080016,
  SOPInstanceUID: 0x00080018,
  StudyDate: 0x00080020,
  Modality: 0x00080060,
  Manufacturer: 0x00080070,
  InstitutionName: 0x00080080,
  StudyDescription: 0x00081030,
  SeriesDescription: 0x0008103e,
  ManufacturerModelName: 0x00081090,
  PatientName: 0x00100010,
  PatientID: 0x00100020,
  PatientBirthDate: 0x00100030,
  PatientSex: 0x00100040,
  SliceThickness: 0x00180050,
  KVP: 0x00180060,
  StudyInstanceUID: 0x0020000d,
  SeriesInstanceUID: 0x0020000e,
  InstanceNumber: 0x00200013,
  ImagePositionPatient: 0x00200032,
  ImageOrientationPatient: 0x00200037,
  SamplesPerPixel: 0x00280002,
  PhotometricInterpretation: 0x00280004,
  NumberOfFrames: 0x00280008,
  Rows: 0x00280010,
  Columns: 0x00280011,
  PixelSpacing: 0x00280030,
  BitsAllocated: 0x00280100,
  BitsStored: 0x00280101,
  PixelRepresentation: 0x00280103,
  WindowCenter: 0x00281050,
  WindowWidth: 0x00281051,
  RescaleIntercept: 0x00281052,
  RescaleSlope: 0x00281053,
  PixelData: 0x7fe00010,
} as const;

const ITEM = 0xfffee000;
const ITEM_DELIM = 0xfffee00d;
const SEQ_DELIM = 0xfffee0dd;

const LONG_VR = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'SV', 'UC', 'UN', 'UR', 'UT', 'UV']);
const STRING_VR = new Set(['AE', 'AS', 'CS', 'DA', 'DS', 'DT', 'IS', 'LO', 'LT', 'PN', 'SH', 'ST', 'TM', 'UC', 'UI', 'UR', 'UT']);

// Implicit-VR dictionary for every tag we read.
const IMPLICIT_VR: Record<number, string> = {
  [T.TransferSyntaxUID]: 'UI', [T.SOPClassUID]: 'UI', [T.SOPInstanceUID]: 'UI', [T.StudyDate]: 'DA',
  [T.Modality]: 'CS', [T.Manufacturer]: 'LO', [T.InstitutionName]: 'LO', [T.StudyDescription]: 'LO',
  [T.SeriesDescription]: 'LO', [T.ManufacturerModelName]: 'LO', [T.PatientName]: 'PN', [T.PatientID]: 'LO',
  [T.PatientBirthDate]: 'DA', [T.PatientSex]: 'CS', [T.SliceThickness]: 'DS', [T.KVP]: 'DS',
  [T.StudyInstanceUID]: 'UI', [T.SeriesInstanceUID]: 'UI', [T.InstanceNumber]: 'IS',
  [T.ImagePositionPatient]: 'DS', [T.ImageOrientationPatient]: 'DS', [T.SamplesPerPixel]: 'US',
  [T.PhotometricInterpretation]: 'CS', [T.NumberOfFrames]: 'IS', [T.Rows]: 'US', [T.Columns]: 'US',
  [T.PixelSpacing]: 'DS', [T.BitsAllocated]: 'US', [T.BitsStored]: 'US', [T.PixelRepresentation]: 'US',
  [T.WindowCenter]: 'DS', [T.WindowWidth]: 'DS', [T.RescaleIntercept]: 'DS', [T.RescaleSlope]: 'DS',
  [T.PixelData]: 'OW',
};

export interface Element {
  tag: number;
  vr: string;
  offset: number; // value offset in the buffer
  length: number; // -1 = undefined (encapsulated pixel data)
}

export class DicomDataset {
  constructor(
    readonly bytes: Uint8Array,
    readonly elements: Map<number, Element>,
    readonly transferSyntax: string,
    readonly littleEndian: boolean,
    /** true if the buffer ended before PixelData was reached */
    readonly truncated: boolean,
  ) {}

  has(tag: number): boolean { return this.elements.has(tag); }

  string(tag: number): string | undefined {
    const e = this.elements.get(tag);
    if (!e || e.length <= 0) return undefined;
    if (e.offset + e.length > this.bytes.length) return undefined;
    let s = '';
    const b = this.bytes;
    for (let i = e.offset; i < e.offset + e.length; i++) s += String.fromCharCode(b[i]);
    return s.replace(/[\0 ]+$/, '').replace(/^ +/, '');
  }

  numbers(tag: number): number[] | undefined {
    const e = this.elements.get(tag);
    if (!e) return undefined;
    if (STRING_VR.has(e.vr)) {
      const s = this.string(tag);
      if (s === undefined || s === '') return undefined;
      return s.split('\\').map((x) => parseFloat(x));
    }
    const dv = new DataView(this.bytes.buffer, this.bytes.byteOffset + e.offset, e.length);
    const le = this.littleEndian;
    const out: number[] = [];
    switch (e.vr) {
      case 'US': for (let i = 0; i + 2 <= e.length; i += 2) out.push(dv.getUint16(i, le)); break;
      case 'SS': for (let i = 0; i + 2 <= e.length; i += 2) out.push(dv.getInt16(i, le)); break;
      case 'UL': for (let i = 0; i + 4 <= e.length; i += 4) out.push(dv.getUint32(i, le)); break;
      case 'SL': for (let i = 0; i + 4 <= e.length; i += 4) out.push(dv.getInt32(i, le)); break;
      case 'FL': for (let i = 0; i + 4 <= e.length; i += 4) out.push(dv.getFloat32(i, le)); break;
      case 'FD': for (let i = 0; i + 8 <= e.length; i += 8) out.push(dv.getFloat64(i, le)); break;
      default: return undefined;
    }
    return out;
  }

  number(tag: number): number | undefined {
    const n = this.numbers(tag);
    return n && n.length ? n[0] : undefined;
  }
}

export class DicomError extends Error {}

/**
 * Parse a DICOM byte buffer. If the buffer is only a prefix of the file,
 * parsing stops cleanly and `truncated` is set unless PixelData was reached.
 */
export function parseDicom(bytes: Uint8Array, opts: { stopAtPixelData?: boolean } = {}): DicomDataset {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const elements = new Map<number, Element>();
  let p = 0;
  const hasPreamble = bytes.length >= 132 && bytes[128] === 0x44 && bytes[129] === 0x49 && bytes[130] === 0x43 && bytes[131] === 0x4d;
  let ts: string = TS.ExplicitLE;
  if (hasPreamble) {
    p = 132;
    // File meta group (0002) is always explicit VR little endian.
    while (p + 8 <= bytes.length && dv.getUint16(p, true) === 0x0002) {
      const r = readElement(dv, p, true, true);
      if (!r) break;
      elements.set(r.el.tag, r.el);
      p = r.next;
    }
    const tsEl = elements.get(T.TransferSyntaxUID);
    if (tsEl) {
      let s = '';
      for (let i = tsEl.offset; i < tsEl.offset + tsEl.length; i++) s += String.fromCharCode(bytes[i]);
      ts = s.replace(/[\0 ]+$/, '');
    }
  } else {
    // No preamble: guess explicit vs implicit from the first element.
    if (bytes.length < 8) throw new DicomError('Not a DICOM file');
    const vr = String.fromCharCode(bytes[4], bytes[5]);
    ts = /^[A-Z]{2}$/.test(vr) ? TS.ExplicitLE : TS.ImplicitLE;
  }
  if (ts === TS.DeflatedLE) throw new DicomError('Deflated transfer syntax is not supported yet');
  const explicit = ts !== TS.ImplicitLE;
  const le = ts !== TS.ExplicitBE;
  let truncated = true;
  let depth = 0; // nesting inside undefined-length sequences/items
  while (p + 8 <= bytes.length) {
    const r = readElement(dv, p, explicit, le);
    if (!r) break;
    const el = r.el;
    if (el.tag === ITEM_DELIM || el.tag === SEQ_DELIM) {
      depth = Math.max(0, depth - 1);
    } else if (el.length === -1 && el.tag !== T.PixelData) {
      depth++; // stepping into an undefined-length sequence or item
    } else if (el.tag === T.PixelData && depth === 0) {
      elements.set(el.tag, el);
      truncated = false;
      if (opts.stopAtPixelData) break;
    } else if (depth === 0 && (el.tag >>> 16) !== 0xfffe) {
      // Keep top-level elements only (sequence contents are skipped).
      if (!elements.has(el.tag)) elements.set(el.tag, el);
    }
    if (r.next > bytes.length) break;
    p = r.next;
  }
  if (!elements.has(T.PixelData) && p >= bytes.length - 8 && !opts.stopAtPixelData) truncated = false;
  return new DicomDataset(bytes, elements, ts, le, truncated && !elements.has(T.PixelData));
}

function readTag(dv: DataView, p: number, le: boolean): number {
  return ((dv.getUint16(p, le) << 16) | dv.getUint16(p + 2, le)) >>> 0;
}

/** Read one element at p; returns null if the buffer ends inside the header. */
function readElement(dv: DataView, p: number, explicit: boolean, le: boolean): { el: Element; next: number } | null {
  const tag = readTag(dv, p, le);
  if (tag === ITEM || tag === ITEM_DELIM || tag === SEQ_DELIM) {
    if (p + 8 > dv.byteLength) return null;
    const len = dv.getUint32(p + 4, le);
    // Item delimiters have no value; items of undefined length are walked into.
    const next = tag === ITEM && len !== 0xffffffff ? p + 8 + len : p + 8;
    return { el: { tag, vr: 'NONE', offset: p + 8, length: len === 0xffffffff ? -1 : len }, next };
  }
  let vr: string;
  let len: number;
  let off: number;
  if (explicit) {
    vr = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5));
    if (LONG_VR.has(vr)) {
      if (p + 12 > dv.byteLength) return null;
      len = dv.getUint32(p + 8, le);
      off = p + 12;
    } else {
      len = dv.getUint16(p + 6, le);
      off = p + 8;
    }
  } else {
    vr = IMPLICIT_VR[tag] ?? 'UN';
    len = dv.getUint32(p + 4, le);
    off = p + 8;
  }
  if (len === 0xffffffff) {
    if (tag === T.PixelData) {
      return { el: { tag, vr, offset: off, length: -1 }, next: dv.byteLength };
    }
    // Undefined-length sequence: step inside; items and delimiters are walked.
    return { el: { tag, vr: 'SQ', offset: off, length: -1 }, next: off };
  }
  return { el: { tag, vr, offset: off, length: len }, next: off + len };
}
