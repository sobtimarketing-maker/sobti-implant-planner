// Versioned case schema. Everything about a case lives here (spec step 1);
// the working volume is cached separately and never embedded.
import type { StudyMeta } from '../volume/series';
import type { Tier } from '../volume/budget';
import type { Vec3 } from '../volume/volume';

export const CASE_SCHEMA = 1;

/** Bit-packed segmentation mask (see core/segment/regionGrow packMask). */
export interface StoredMask { origin: Vec3; spacing: Vec3; dims: Vec3; rowDir: Vec3; colDir: Vec3; normal: Vec3; count: number; bits: string }

export type Treatment = 'implant' | 'crown' | 'bridge-pontic' | 'extraction' | 'graft' | 'sinus-lift';

export const TREATMENTS: { id: Treatment; label: string }[] = [
  { id: 'implant', label: 'Implant + crown' },
  { id: 'bridge-pontic', label: 'Bridge pontic' },
  { id: 'crown', label: 'Crown only' },
  { id: 'extraction', label: 'Extraction' },
  { id: 'graft', label: 'Bone graft' },
  { id: 'sinus-lift', label: 'Sinus lift' },
];

export interface PlannedSite {
  fdi: number;
  treatment: Treatment;
  notes: string;
}

export interface MedicalFlags {
  diabetes: boolean;
  smoker: boolean;
  bisphosphonates: boolean;
  anticoagulants: boolean;
  cardiac: boolean;
  radiotherapy: boolean;
  pregnancy: boolean;
  allergies: string;
  other: string;
}

export interface CaseStudy {
  seriesUid: string;
  sourceName: string;
  sliceCount: number;
  sourceDims: Vec3;
  sourceSpacing: Vec3;
  workingDims: Vec3;
  workingSpacing: Vec3;
  factor: number;
  tier: Tier;
  meta: StudyMeta;
  warnings: string[];
  loadedAt: string;
  loadMs: number;
}

export interface CaseRecord {
  schema: number;
  id: string;
  created: string;
  modified: string;
  status: 'draft' | 'planning' | 'approved';
  step: number;
  patient: {
    name: string;
    dob: string;
    sex: '' | 'F' | 'M' | 'O';
    patientId: string;
    phone: string;
    email: string;
    referredBy: string;
    complaint: string;
    medical: MedicalFlags;
  };
  plan: {
    sites: PlannedSite[];
    prosthesis: 'single-crowns' | 'splinted-crowns' | 'bridge' | 'overdenture' | 'full-arch';
    retention: 'screw' | 'cement' | 'undecided';
    implantSystem: string;
    guideType: 'tooth-supported' | 'tissue-supported' | 'bone-supported' | 'none';
    surgeon: string;
    surgeryDate: string;
    notes: string;
  };
  study?: CaseStudy;
  view?: { wc: number; ww: number; point?: Vec3; frame?: { ex: Vec3; ey: Vec3; ez: Vec3 }; spin?: { axial: number; coronal: number; sagittal: number } };
  anatomy: {
    arch?: { points: Vec3[]; slabMm: number };
    nerves: { id: string; side: 'R' | 'L'; points: { p: Vec3; r: number }[]; foramen?: Vec3 }[];
    /** apex: root tip set by the user (else a typical root length is used). */
    teeth: { id: string; fdi: number; seed: Vec3; threshold: number; volumeMm3: number; mask: StoredMask; apex?: Vec3 }[];
  };
  measurements: { id: string; a: Vec3; b: Vec3; view: 'axial' | 'coronal' | 'sagittal'; label?: string }[];
  /** Mouth scans (meshes are stored separately) and their fit to the CBCT. */
  scans?: CaseScans;
  /** Crown-down design: single crowns and bridges, in world LPS mm (see core/crown/crown.ts). */
  prosthetic?: { spans: CrownSpan[] };
}

import type { CrownSpan } from '../crown/crown';

export interface ScanFileInfo { name: string; vertices: number; faces: number }
export interface CaseScans {
  upper?: ScanFileInfo;
  lower?: ScanFileInfo;
  /** The arch with the implant sites: it is lined up; the other arch follows in the bite. */
  treating: 'upper' | 'lower';
  /** Matching points: on the scan (scan mm) and on the CBCT (world LPS mm). */
  pairs: { scan?: Vec3; ct?: Vec3 }[];
  /** Scan mm -> world LPS mm (column-major 4×4), once lined up. */
  m?: number[];
  /** Error per pair after the fit (mm), and the fine-tune surface error. */
  residuals?: number[];
  surfaceRms?: number;
  method?: 'points' | 'points+surface' | 'adjusted';
}

export function newId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function newCase(): CaseRecord {
  const now = new Date().toISOString();
  return {
    schema: CASE_SCHEMA,
    id: newId(),
    created: now,
    modified: now,
    status: 'draft',
    step: 0,
    patient: {
      name: '', dob: '', sex: '', patientId: '', phone: '', email: '', referredBy: '', complaint: '',
      medical: {
        diabetes: false, smoker: false, bisphosphonates: false, anticoagulants: false,
        cardiac: false, radiotherapy: false, pregnancy: false, allergies: '', other: '',
      },
    },
    plan: {
      sites: [], prosthesis: 'single-crowns', retention: 'screw', implantSystem: '',
      guideType: 'tooth-supported', surgeon: '', surgeryDate: '', notes: '',
    },
    anatomy: { nerves: [], teeth: [] },
    measurements: [],
  };
}

/** Bring older saved cases up to the current schema. */
export function migrateCase(raw: unknown): CaseRecord {
  const c = raw as CaseRecord;
  const fresh = newCase();
  return {
    ...fresh, ...c,
    schema: CASE_SCHEMA,
    patient: { ...fresh.patient, ...c.patient, medical: { ...fresh.patient.medical, ...(c.patient?.medical ?? {}) } },
    plan: { ...fresh.plan, ...c.plan },
    anatomy: { arch: c.anatomy?.arch, nerves: c.anatomy?.nerves ?? [], teeth: c.anatomy?.teeth ?? [] },
    measurements: c.measurements ?? [],
    // Session 1 stored a voxel cursor; it is dropped (views re-centre).
    view: c.view ? { wc: c.view.wc, ww: c.view.ww, point: c.view.point, frame: c.view.frame, spin: c.view.spin } : undefined,
  };
}

// FDI permanent dentition, in chart order (patient right on the left of the chart).
export const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

const NAMES = ['central incisor', 'lateral incisor', 'canine', 'first premolar', 'second premolar', 'first molar', 'second molar', 'third molar'];
const QUAD = ['', 'upper right', 'upper left', 'lower left', 'lower right'];

export function toothName(fdi: number): string {
  const q = Math.floor(fdi / 10), n = fdi % 10;
  return `${QUAD[q]} ${NAMES[n - 1]}`;
}

export function age(dob: string, at = new Date()): number | undefined {
  if (!dob) return undefined;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return undefined;
  let a = at.getFullYear() - d.getFullYear();
  if (at.getMonth() < d.getMonth() || (at.getMonth() === d.getMonth() && at.getDate() < d.getDate())) a--;
  return a;
}

/** DICOM DA (YYYYMMDD) to ISO date. */
export function dicomDate(da?: string): string {
  if (!da || !/^\d{8}$/.test(da)) return '';
  return `${da.slice(0, 4)}-${da.slice(4, 6)}-${da.slice(6, 8)}`;
}

export function caseTitle(c: CaseRecord): string {
  return c.patient.name.trim() || 'Unnamed patient';
}

export function sitesSummary(c: CaseRecord): string {
  if (!c.plan.sites.length) return 'No teeth selected yet';
  return c.plan.sites.map((s) => `${s.fdi} ${TREATMENTS.find((t) => t.id === s.treatment)?.label ?? s.treatment}`).join(', ');
}
