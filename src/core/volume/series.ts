// Series assembly from per-slice headers: group, sort along the slice normal,
// derive spacing, check consistency.
import { DicomDataset, T, UNCOMPRESSED_TS } from '../dicom/parser';
import { cross, dot, Vec3 } from './volume';

export interface SliceHeader {
  source: number;          // index into the caller's file/entry list
  seriesUid: string;
  rows: number;
  cols: number;
  ipp: Vec3;
  iop: [number, number, number, number, number, number];
  pixelSpacing: [number, number]; // [row spacing, column spacing]
  bitsAllocated: number;
  pixelRepresentation: number;
  slope: number;
  intercept: number;
  transferSyntax: string;
  littleEndian: boolean;
  frames: number;
  instance: number;
}

export interface StudyMeta {
  patientName?: string;
  patientId?: string;
  birthDate?: string;
  sex?: string;
  studyDate?: string;
  studyUid?: string;
  manufacturer?: string;
  model?: string;
  institution?: string;
  modality?: string;
  kvp?: number;
  windowCenter?: number;
  windowWidth?: number;
  description?: string;
}

export function readSliceHeader(ds: DicomDataset, source: number): SliceHeader | null {
  const rows = ds.number(T.Rows);
  const cols = ds.number(T.Columns);
  if (!rows || !cols) return null; // not an image (e.g. DICOMDIR)
  const ps = ds.numbers(T.PixelSpacing) ?? [1, 1];
  const iop = (ds.numbers(T.ImageOrientationPatient) ?? [1, 0, 0, 0, 1, 0]) as SliceHeader['iop'];
  const ipp = (ds.numbers(T.ImagePositionPatient) ?? [0, 0, 0]) as Vec3;
  return {
    source,
    seriesUid: ds.string(T.SeriesInstanceUID) ?? 'unknown',
    rows, cols,
    ipp: [ipp[0], ipp[1], ipp[2]],
    iop,
    pixelSpacing: [ps[0], ps[1] ?? ps[0]],
    bitsAllocated: ds.number(T.BitsAllocated) ?? 16,
    pixelRepresentation: ds.number(T.PixelRepresentation) ?? 0,
    slope: ds.number(T.RescaleSlope) ?? 1,
    intercept: ds.number(T.RescaleIntercept) ?? 0,
    transferSyntax: ds.transferSyntax,
    littleEndian: ds.littleEndian,
    frames: ds.number(T.NumberOfFrames) ?? 1,
    instance: ds.number(T.InstanceNumber) ?? 0,
  };
}

export function readStudyMeta(ds: DicomDataset): StudyMeta {
  return {
    patientName: ds.string(T.PatientName)?.replace(/\^+/g, ' ').trim(),
    patientId: ds.string(T.PatientID),
    birthDate: ds.string(T.PatientBirthDate),
    sex: ds.string(T.PatientSex),
    studyDate: ds.string(T.StudyDate),
    studyUid: ds.string(T.StudyInstanceUID),
    manufacturer: ds.string(T.Manufacturer),
    model: ds.string(T.ManufacturerModelName),
    institution: ds.string(T.InstitutionName),
    modality: ds.string(T.Modality),
    kvp: ds.number(T.KVP),
    windowCenter: ds.number(T.WindowCenter),
    windowWidth: ds.number(T.WindowWidth),
    description: ds.string(T.SeriesDescription) ?? ds.string(T.StudyDescription),
  };
}

export interface Series {
  uid: string;
  slices: SliceHeader[];   // sorted ascending along normal
  rows: number;
  cols: number;
  spacing: Vec3;           // [col spacing (i), row spacing (j), slice spacing (k)]
  origin: Vec3;
  rowDir: Vec3;
  colDir: Vec3;
  normal: Vec3;
  warnings: string[];
}

export function assembleSeries(headers: SliceHeader[]): Series[] {
  const groups = new Map<string, SliceHeader[]>();
  for (const h of headers) {
    const key = `${h.seriesUid}|${h.rows}x${h.cols}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(h);
  }
  const out: Series[] = [];
  for (const [key, slices] of groups) {
    const s0 = slices[0];
    const rowDir: Vec3 = [s0.iop[0], s0.iop[1], s0.iop[2]];
    const colDir: Vec3 = [s0.iop[3], s0.iop[4], s0.iop[5]];
    const normal = cross(rowDir, colDir);
    const warnings: string[] = [];
    if (!UNCOMPRESSED_TS.has(s0.transferSyntax)) {
      warnings.push(`Compressed images (${s0.transferSyntax}) are not supported in this build.`);
    }
    if (slices.some((s) => s.frames > 1)) warnings.push('Multi-frame images are not supported in this build.');
    const pos = (s: SliceHeader) => dot(s.ipp, normal);
    slices.sort((a, b) => pos(a) - pos(b) || a.instance - b.instance);
    // Drop exact duplicates in position.
    const uniq: SliceHeader[] = [];
    for (const s of slices) {
      if (uniq.length && Math.abs(pos(s) - pos(uniq[uniq.length - 1])) < 1e-4) continue;
      uniq.push(s);
    }
    if (uniq.length < slices.length) warnings.push(`${slices.length - uniq.length} duplicate slice(s) ignored.`);
    let dz = s0.pixelSpacing[0];
    if (uniq.length > 1) {
      const gaps: number[] = [];
      for (let n = 1; n < uniq.length; n++) gaps.push(pos(uniq[n]) - pos(uniq[n - 1]));
      gaps.sort((a, b) => a - b);
      dz = gaps[gaps.length >> 1];
      if (gaps[gaps.length - 1] - gaps[0] > dz * 0.1) warnings.push('Slice spacing is not uniform; distances may be approximate.');
    }
    if (uniq.some((s) => s.iop.some((v, n) => Math.abs(v - s0.iop[n]) > 1e-3))) {
      warnings.push('Slices have different orientations (gantry tilt).');
    }
    out.push({
      uid: key.split('|')[0],
      slices: uniq,
      rows: s0.rows,
      cols: s0.cols,
      spacing: [s0.pixelSpacing[1], s0.pixelSpacing[0], dz],
      origin: uniq[0].ipp,
      rowDir, colDir, normal,
      warnings,
    });
  }
  out.sort((a, b) => b.slices.length - a.slices.length);
  return out;
}
