// Anatomic crown shapes: our own parametric tooth library.
//
// Each tooth (by FDI number) has its own form: cusp tips with triangular
// ridges, marginal ridges, central fossa and fissures for back teeth; incisal
// edge, lingual fossa, marginal ridges and cingulum for front teeth; buccal
// lobes on the side walls. A "library" changes the style (cusp height and
// sharpness, wear, groove depth, outline) the way commercial libraries do
// (young / natural / worn / implant-friendly flat cusps).
//
// Frame (same as crown.ts): x mesial → distal, y with +y towards the cheek
// when buccal = 1, z from the gum (0) to the cusp tips (height). Normalised
// occlusal coordinates: u ∈ [-1, 1] mesial → distal, v ∈ [-1, 1] tongue →
// cheek.
import type { TriMesh } from '../mesh/mesh';

export type LibraryId = 'natural' | 'youthful' | 'mature' | 'implant';
export interface CrownLibrary {
  id: LibraryId; label: string; help: string;
  /** Cusp height, as a share of the textbook cusp height. */
  cusp: number;
  /** Cusp tip pointedness: 1 = textbook, higher = sharper. */
  sharp: number;
  /** Fissure depth (share of the cusp height). */
  groove: number;
  /** Flattened cusp tips (0 none, 1 strong wear facets). */
  wear: number;
  /** Narrower chewing table (share taken off the cheek-tongue width at the top). */
  narrow: number;
  /** Outline squareness: added to the superellipse exponent. */
  square: number;
  /** Incisal mamelons and labial lobes on front teeth. */
  mamelons: boolean;
}
export const LIBRARIES: CrownLibrary[] = [
  { id: 'natural', label: 'Natural', help: 'Textbook anatomy with medium cusps. Good for most cases.', cusp: 1, sharp: 1, groove: 1, wear: 0.15, narrow: 0, square: 0, mamelons: false },
  { id: 'youthful', label: 'Youthful', help: 'Tall, pointed cusps, deep grooves, rounder outline and incisal mamelons, like young teeth.', cusp: 1.15, sharp: 1.2, groove: 1.25, wear: 0, narrow: 0, square: -0.25, mamelons: true },
  { id: 'mature', label: 'Mature', help: 'Worn, flatter cusps with wear facets and a squarer outline, to match older teeth.', cusp: 0.7, sharp: 0.8, groove: 0.7, wear: 0.65, narrow: 0, square: 0.5, mamelons: false },
  { id: 'implant', label: 'Implant (flat cusps)', help: 'Low cusps and a narrower chewing table, so the bite loads the implant along its axis.', cusp: 0.6, sharp: 0.85, groove: 0.8, wear: 0.3, narrow: 0.12, square: 0.15, mamelons: false },
];
export const libraryOf = (id: string | undefined): CrownLibrary => LIBRARIES.find((l) => l.id === id) ?? LIBRARIES[0];

/** VITA classical shades, approximate sRGB body colour (0..1). */
export type ShadeId = 'B1' | 'A1' | 'A2' | 'A3' | 'A3.5';
export const SHADES: Record<ShadeId, [number, number, number]> = {
  B1: [0.95, 0.93, 0.87], A1: [0.94, 0.9, 0.82], A2: [0.92, 0.86, 0.75], A3: [0.89, 0.81, 0.68], 'A3.5': [0.86, 0.77, 0.62],
};
export const SHADE_IDS = Object.keys(SHADES) as ShadeId[];

// ---------- tooth forms
interface Cusp { u: number; v: number; h: number; r: number; /** Stretch along mesial-distal (cusp ridges), default 1. */ ru?: number }
interface Form {
  front: boolean;
  /** Superellipse exponent of the outline (2 = ellipse). */
  n: number;
  /** Outline scale at the gum and at the top, mesial-distal and cheek-tongue. */
  cervMD: number; topMD: number; cervBL: number; topBL: number;
  /** Height of the widest point (share of the wall): cheek and tongue side, and mesial-distal (contact areas). */
  peakB: number; peakL: number; peakMD: number;
  /** Cusp height as a share of the crown height. */
  cusp: number;
  cusps: Cusp[];
  /** Fissure polylines in (u, v). */
  grooves: [number, number][][];
  /** Extra ridges joining two cusps (e.g. the oblique ridge), by cusp index. */
  ridges: [number, number][];
  /** Front teeth: canine (pointed) or incisor; how rounded the distal corner is. */
  canine?: boolean; tip?: number; corner?: number; lower?: boolean;
}

function formOf(fdi: number): Form {
  const q = Math.floor(fdi / 10), upper = q === 1 || q === 2 || q === 5 || q === 6;
  const t = Math.min(8, Math.max(1, fdi % 10));
  if (t <= 2) {
    const lateral = t === 2;
    return { front: true, n: lateral ? 2.2 : 2.5, cervMD: upper ? 0.68 : 0.78, topMD: 1, cervBL: 0.9, topBL: 0.26, peakB: 0.2, peakL: 0.25, peakMD: 0.8, cusp: 0.04, cusps: [], grooves: [], ridges: [], corner: upper ? (lateral ? 0.75 : 0.35) : (lateral ? 0.3 : 0.15) };
  }
  if (t === 3) {
    return { front: true, canine: true, lower: !upper, n: 2.1, cervMD: 0.7, topMD: 0.9, cervBL: 0.85, topBL: 0.34, peakB: 0.3, peakL: 0.3, peakMD: 0.7, cusp: 0.04, cusps: [], grooves: [], ridges: [], tip: upper ? -0.12 : -0.18 };
  }
  if (t <= 5) {
    const base = { front: false, n: 2.25, cervMD: 0.72, topMD: 0.9, cervBL: 0.82, topBL: 0.78, peakB: 0.25, peakL: 0.5, peakMD: 0.68, ridges: [] as [number, number][] };
    if (upper) return { ...base, cusp: 0.3, cusps: [{ u: -0.06, v: 0.5, h: 1, r: 0.55, ru: 1.7 }, { u: 0.06, v: -0.48, h: t === 4 ? 0.82 : 0.95, r: 0.52, ru: 1.5 }], grooves: [[[-0.62, 0.02], [0.62, 0.02]]] };
    if (t === 4) return { ...base, topBL: 0.7, cusp: 0.3, cusps: [{ u: 0, v: 0.3, h: 1, r: 0.6, ru: 1.6 }, { u: 0, v: -0.62, h: 0.42, r: 0.4, ru: 1.2 }], grooves: [[[-0.5, -0.28], [-0.2, -0.2]], [[0.2, -0.2], [0.5, -0.28]]], ridges: [[0, 1]] };
    return { ...base, cusp: 0.28, cusps: [{ u: 0, v: 0.45, h: 1, r: 0.55, ru: 1.7 }, { u: -0.38, v: -0.5, h: 0.72, r: 0.42 }, { u: 0.4, v: -0.52, h: 0.58, r: 0.4 }], grooves: [[[-0.6, 0.0], [0, -0.05], [0.6, 0.0]], [[0, -0.05], [0.02, -0.7]]] };
  }
  const base = { front: false, n: 2.8, cervMD: 0.78, topMD: 0.92, cervBL: 0.8, topBL: 0.8, peakB: 0.22, peakL: 0.5, peakMD: 0.65, cusp: 0.27 };
  const third = t === 8;
  if (upper) {
    // Rhomboid: MB, DB, ML (largest), DL (small); oblique ridge ML → DB.
    const dl = t === 6 ? 0.68 : third ? 0.35 : 0.5;
    return { ...base, cusps: [{ u: -0.48, v: 0.52, h: 0.95, r: 0.5, ru: 1.2 }, { u: 0.42, v: 0.55, h: 0.88, r: 0.46, ru: 1.2 }, { u: -0.38, v: -0.42, h: 1, r: 0.6 }, { u: 0.55, v: -0.55, h: dl, r: 0.38 }],
      grooves: [[[-0.82, 0.05], [-0.15, 0.08], [0.1, 0.55], [0.12, 0.95]], [[-0.15, 0.08], [0.3, -0.15], [0.7, -0.2]], [[0.3, -0.15], [0.15, -0.95]]], ridges: [[2, 1]] };
  }
  if (t === 6) {
    // Lower first molar: MB, DB, D on the cheek side; ML, DL; Y-shaped grooves.
    return { ...base, n: 3, cusps: [{ u: -0.55, v: 0.5, h: 0.85, r: 0.44, ru: 1.2 }, { u: 0.08, v: 0.55, h: 0.8, r: 0.42 }, { u: 0.66, v: 0.42, h: 0.6, r: 0.32 }, { u: -0.45, v: -0.5, h: 1, r: 0.48, ru: 1.2 }, { u: 0.42, v: -0.5, h: 0.95, r: 0.46, ru: 1.2 }],
      grooves: [[[-0.85, 0.0], [-0.1, 0.02], [0.45, -0.02], [0.85, 0.05]], [[-0.25, 0.02], [-0.22, 0.95]], [[0.45, -0.02], [0.4, 0.95]], [[-0.02, 0.0], [0.0, -0.95]]], ridges: [] };
  }
  // Lower second/third molar: four cusps, cross-shaped grooves.
  return { ...base, cusps: [{ u: -0.48, v: 0.5, h: 0.85, r: 0.46, ru: 1.2 }, { u: 0.48, v: 0.5, h: 0.8, r: 0.44, ru: 1.2 }, { u: -0.45, v: -0.5, h: 1, r: 0.48, ru: 1.2 }, { u: 0.45, v: -0.5, h: third ? 0.8 : 0.95, r: 0.46, ru: 1.2 }],
    grooves: [[[-0.85, 0], [0.85, 0]], [[0, 0.95], [0, -0.95]]], ridges: [] };
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Smooth maximum: the valleys between cusps become V-shaped grooves. */
const smax = (a: number, b: number, k: number) => { const m = Math.max(a, b); return m + Math.log(Math.exp((a - m) * k) + Math.exp((b - m) * k)) / k; };
function segDist(u: number, v: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = clamp(((u - a[0]) * dx + (v - a[1]) * dy) / l2, 0, 1);
  return Math.hypot(u - a[0] - t * dx, v - a[1] - t * dy);
}

/**
 * Occlusal height above the marginal ridge, as a share of the cusp height (cusp tips ≈ 1).
 * Also returns how deep the point sits in a fissure (0..1), for staining.
 */
function occlusal(F: Form, L: CrownLibrary, u: number, v: number): { z: number; fissure: number } {
  if (F.front) {
    // Rounded incisal edge; mamelons on young teeth.
    let z = 1 - 0.5 * v * v;
    if (L.mamelons && !F.canine) z += 0.5 * (Math.exp(-((u + 0.5) ** 2) / 0.015) + Math.exp(-(u ** 2) / 0.015) + Math.exp(-((u - 0.5) ** 2) / 0.015));
    return { z, fissure: 0 };
  }
  const k = 9;
  let z = -0.42; // fossa floor
  F.cusps.forEach((c) => {
    const h = c.h;
    const du = (u - c.u) / (c.r * (c.ru ?? 1)), dv = (v - c.v) / c.r;
    const d = Math.hypot(du, dv);
    // Rounded cone; sharper libraries pull the slopes in.
    const tipR = 0.32 / L.sharp;
    const cb = 1 - (Math.sqrt(d * d + tipR * tipR) - tipR) / (1 + 0.5 * tipR);
    const cone = cb > 0 ? h * cb ** (1.15 * L.sharp) : 0.6 * h * cb;
    // Triangular ridge from the tip down towards the central fossa.
    const tx = -c.u, ty = -c.v * 0.9, tl = Math.hypot(tx, ty) || 1;
    const al = ((u - c.u) * tx + (v - c.v) * ty) / tl, pe = Math.abs(((u - c.u) * ty - (v - c.v) * tx) / tl);
    const ridge = al > 0 ? h * 0.92 * Math.max(0, 1 - al / (tl * 0.95)) * Math.exp(-(pe * pe) / 0.018) : -1;
    z = smax(z, Math.max(cone, ridge), k);
  });
  for (const [a, b] of F.ridges) {
    const A = F.cusps[a], B = F.cusps[b];
    const ds = segDist(u, v, [A.u, A.v], [B.u, B.v]);
    z = smax(z, 0.62 * Math.min(A.h, B.h) * Math.exp(-(ds * ds) / 0.02), k);
  }
  // Marginal ridges near the mesial and distal edges.
  const mr = 0.18 * Math.exp(-((Math.abs(u) - 0.86) ** 2) / 0.006) * (1 - smooth(0.55, 0.95, Math.abs(v)));
  z = smax(z, mr - 0.05, k);
  // Fissures.
  let fis = 0;
  for (const g of F.grooves) for (let i = 0; i + 1 < g.length; i++) fis = Math.max(fis, Math.max(0, 1 - segDist(u, v, g[i], g[i + 1]) / 0.13) ** 2);
  // Grooves fade out before the crown's edge (they end in the buccal / lingual pits).
  fis *= 1 - smooth(0.62, 0.92, Math.max(Math.abs(u), Math.abs(v)));
  // Pits where grooves meet the fossa.
  fis = Math.max(fis, Math.max(0, 1 - Math.hypot(u, v) / 0.14) ** 1.4);
  z -= 0.24 * L.groove * fis;
  // Wear facets flatten the cusp tips.
  if (L.wear > 0) { const cap = 1 - 0.32 * L.wear; if (z > cap) z = cap + (z - cap) * 0.25; }
  return { z, fissure: fis };
}

/** Side-wall shape: how far a wall point sits in (−) or out (+), in mm, beyond the plain outline. */
function wallRelief(F: Form, L: CrownLibrary, x: number, y: number, md: number, bl: number, t: number, cheek: boolean): number {
  const u = x / (md / 2);
  if (F.front) {
    if (!cheek) {
      // Lingual fossa between the marginal ridges, cingulum near the gum.
      const fossa = -0.55 * (1 - smooth(0.45, 0.85, Math.abs(u))) * smooth(0.3, 0.55, t) * (1 - smooth(0.85, 1, t)) * (F.canine ? 0.7 : 1);
      const lingualRidge = F.canine ? 0.35 * Math.exp(-((u - (F.tip ?? 0)) ** 2) / 0.03) * smooth(0.3, 0.6, t) : 0;
      const cingulum = 0.35 * Math.exp(-(u * u) / 0.12) * Math.exp(-((t - 0.2) ** 2) / 0.012);
      return (fossa + lingualRidge) * Math.min(1, bl / 7) + cingulum;
    }
    // Labial developmental depressions between the three lobes.
    const lobes = L.mamelons || !F.canine ? -0.06 * (Math.exp(-((u - 0.33) ** 2) / 0.01) + Math.exp(-((u + 0.33) ** 2) / 0.01)) * smooth(0.4, 0.9, t) : 0;
    return lobes * (L.mamelons ? 1.6 : 1);
  }
  // Back teeth: lobes on the side walls under each cusp, grooves between them.
  const side = F.cusps.filter((c) => (cheek ? c.v > 0 : c.v < 0));
  if (side.length < 2) return 0;
  let lobe = 0;
  for (const c of side) lobe = Math.max(lobe, Math.exp(-((u - c.u) ** 2) / 0.07));
  return -0.22 * L.groove * (1 - lobe) * smooth(0.45, 0.95, t) * Math.min(1, md / 9);
}

/** Front teeth: how far (mm) the incisal edge / canine cusp slopes sit below the top, along u. */
function edgeDrop(F: Form, L: CrownLibrary, u: number, height: number): number {
  if (!F.front) return 0;
  if (F.canine) {
    const tip = F.tip ?? 0, span = u < tip ? 1 + tip : 1 - tip;
    const h = height * (F.lower ? 0.24 : 0.3) * (1 - 0.45 * L.wear) * (0.85 + 0.15 * L.sharp);
    const a = Math.sqrt((u - tip) ** 2 + 0.012) - Math.sqrt(0.012);
    return h * Math.min(1, a / span) ** (1.05 + 0.25 * (L.sharp - 1));
  }
  const c = F.corner ?? 0.3;
  const dist = Math.max(0, (u - 0.45) / 0.55), mes = Math.max(0, (-u - 0.7) / 0.3);
  return height * (0.012 * u * u) + (0.6 + 2.2 * c) * dist ** 2.2 + 0.5 * mes ** 2.5;
}

function profile(t: number, cerv: number, top: number, peak: number): number {
  if (t <= peak) return cerv + (1 - cerv) * Math.sin((t / peak) * Math.PI / 2);
  const s = (t - peak) / (1 - peak);
  return 1 - (1 - top) * s * s;
}

const NS = 112, NR = 22, NC = 30;
/** Share of the cusp height carried up the side walls (no lid-like edge at the marginal ridge). */
const RIM = 0.4;

export interface AnatomicCrown extends TriMesh { colors: Uint8Array }

/**
 * Crown mesh in its own frame for tooth `fdi`, filling md × bl × height (mm),
 * in the style of library `lib`, with tooth-like vertex colours for `shade`.
 */
export function anatomicCrown(fdi: number, md: number, bl: number, height: number, buccal: 1 | -1, lib: string = 'natural', shade: ShadeId = 'A2'): AnatomicCrown {
  const F = formOf(fdi), L = libraryOf(lib);
  const cuspH = height * F.cusp * (F.front ? 1 : L.cusp);
  const wallH = height - cuspH;
  const n = Math.max(1.8, F.n + L.square);
  const topBL = F.topBL * (1 - L.narrow);
  const pos: number[] = [], tone: number[] = [], fis: number[] = [];
  const outline = (th: number): [number, number] => {
    const c = Math.cos(th), s = Math.sin(th);
    return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)];
  };
  // Side wall rings, gum to marginal ridge.
  for (let k = 0; k <= NR; k++) {
    const t = k / NR;
    for (let i = 0; i < NS; i++) {
      const th = (i / NS) * Math.PI * 2, [ox, oy] = outline(th);
      const cheek = oy * buccal > 0;
      const fMD = profile(t, F.cervMD, F.topMD, F.peakMD);
      const fBL = profile(t, F.cervBL, topBL, cheek ? F.peakB : F.peakL);
      let x = (md / 2) * fMD * ox, y = (bl / 2) * fBL * oy;
      const r = Math.hypot(x, y) || 1;
      const dr = wallRelief(F, L, x, y, md, bl, t, cheek);
      x += (x / r) * dr; y += (y / r) * dr;
      // Cervical line curves up between the teeth; front teeth slope to the incisal corners / canine tip.
      const scallop = (F.front ? 0.9 : 0.4) * Math.abs(ox) ** 4 * (1 - t) ** 2;
      // Back teeth: the cheek and tongue walls run on smoothly into the cusp ridges.
      const lift = F.front ? 0 : cuspH * RIM * Math.max(0, occlusal(F, L, ox, oy * buccal).z) * Math.max(0, (t - 0.45) / 0.55) ** 2;
      pos.push(x, y, t * wallH + scallop + lift - edgeDrop(F, L, ox, height) * smooth(0.45, 1, t));
      tone.push(t * 0.75); fis.push(0);
    }
  }
  const top = NR * NS;
  // Occlusal cap: rings shrinking to the centre, raised by the occlusal form.
  for (let k = 1; k < NC; k++) {
    const rr = 1 - k / NC, edge = Math.min(1, (1 - rr) / 0.45), e = 1 - (1 - edge) ** 2.2;
    for (let i = 0; i < NS; i++) {
      const x = pos[(top + i) * 3] * rr, y = pos[(top + i) * 3 + 1] * rr;
      const u = x / ((md / 2) * F.topMD), v = (y / ((bl / 2) * topBL)) * buccal;
      const o = occlusal(F, L, u, v);
      const rim = F.front ? 0 : RIM * Math.max(0, occlusal(F, L, u / rr, v / rr).z);
      pos.push(x, y, wallH - edgeDrop(F, L, u, height) + cuspH * (rim * (1 - e) + e * o.z));
      tone.push(0.75 + 0.25 * clamp(o.z, 0, 1)); fis.push(o.fissure * e);
    }
  }
  // Round off the bend where the side wall meets the chewing surface: relax each
  // column (fixed angle) along the rings around the junction.
  for (let it = 0; it < 6; it++) for (let k = NR - 5; k <= NR + 6; k++) for (let i = 0; i < NS; i++) {
    const a = ((k - 1) * NS + i) * 3, b = (k * NS + i) * 3, c = ((k + 1) * NS + i) * 3;
    for (let d = 0; d < 3; d++) pos[b + d] = pos[b + d] * 0.5 + (pos[a + d] + pos[c + d]) * 0.25;
  }
  const capC = pos.length / 3;
  const oc = occlusal(F, L, 0, 0);
  pos.push(0, 0, wallH - edgeDrop(F, L, 0, height) + cuspH * oc.z); tone.push(0.8); fis.push(oc.fissure);
  const botC = pos.length / 3;
  pos.push(0, 0, 0); tone.push(0); fis.push(0);
  const idx: number[] = [];
  for (let k = 0; k < NR + NC - 1; k++) for (let i = 0; i < NS; i++) {
    const j = (i + 1) % NS, r0 = k * NS, r1 = (k + 1) * NS;
    idx.push(r0 + i, r0 + j, r1 + j, r0 + i, r1 + j, r1 + i);
  }
  const last = (NR + NC - 1) * NS;
  for (let i = 0; i < NS; i++) { const j = (i + 1) % NS; idx.push(last + i, last + j, capC); idx.push(botC, j, i); }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), colors: toothColors(pos, tone, fis, height, F.front, shade) };
}

/**
 * Tooth-like colour: more chroma at the gum, body shade in the middle,
 * greyer and lighter (translucent enamel) at the incisal edge or cusp tips,
 * light brown stain in the fissures.
 */
function toothColors(pos: number[], tone: number[], fis: number[], height: number, front: boolean, shade: ShadeId): Uint8Array {
  const body = SHADES[shade] ?? SHADES.A2;
  const cerv: [number, number, number] = [body[0] * 0.97, body[1] * 0.9, body[2] * 0.78];
  const edge: [number, number, number] = front ? [0.86, 0.88, 0.89] : [Math.min(1, body[0] * 1.03), Math.min(1, body[1] * 1.04), Math.min(1, body[2] * 1.08)];
  const stain: [number, number, number] = [0.68, 0.55, 0.38];
  const n = tone.length, out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = tone[i];
    const a = 1 - smooth(0, 0.35, t), b = smooth(front ? 0.6 : 0.85, 1, t) * (front ? 0.55 : 1);
    const c = [0, 1, 2].map((j) => body[j] * (1 - a - b * 0.8) + cerv[j] * a + edge[j] * b * 0.8);
    const f = Math.min(0.55, fis[i] * 0.6);
    for (let j = 0; j < 3; j++) out[i * 3 + j] = Math.round(255 * clamp(c[j] * (1 - f) + stain[j] * f, 0, 1));
  }
  void pos; void height;
  return out;
}
