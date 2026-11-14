// Crown-down design: parametric crowns placed from the contact points on the
// neighbouring teeth, sat on the gum and fitted to the opposing teeth.
//
// Each crown is built in its own frame: x mesial → distal, y towards the
// tongue or cheek (see buccal), z from the gum (0) to the cusp tips (height).
// The frame is right-handed (x × y = z) and maps to world LPS mm by
// world = origin + x·m + y·b + z·o, after the unit's own turn and shifts.
import type { Vec3 } from '../volume/volume';
import type { TriMesh } from '../mesh/mesh';
import { rayMesh } from '../mesh/raycast';

export type ToothKind = 'molar' | 'premolar' | 'canine' | 'incisor';
export const KIND_LABEL: Record<ToothKind, string> = { molar: 'Molar', premolar: 'Premolar', canine: 'Canine', incisor: 'Incisor' };

export function kindOf(fdi: number): ToothKind {
  const p = fdi % 10;
  return p >= 6 ? 'molar' : p >= 4 ? 'premolar' : p === 3 ? 'canine' : 'incisor';
}
export const isUpper = (fdi: number) => { const q = Math.floor(fdi / 10); return q === 1 || q === 2; };

// Typical crown size (mm): mesiodistal width, buccolingual size, crown height.
// Textbook averages; the contact points set the real width.
const SIZES: Record<'upper' | 'lower', Record<number, [number, number, number]>> = {
  upper: { 1: [8.5, 7, 10.5], 2: [6.5, 6, 9], 3: [7.5, 8, 10], 4: [7, 9, 8.5], 5: [6.5, 9, 7.5], 6: [10, 11, 7.5], 7: [9, 11, 7], 8: [8.5, 10, 6.5] },
  lower: { 1: [5, 6, 9], 2: [5.5, 6, 9.5], 3: [7, 7.5, 11], 4: [7, 7.5, 8.5], 5: [7, 8, 8], 6: [11, 10.5, 7.5], 7: [10.5, 10, 7], 8: [10, 9.5, 7] },
};
export function typicalSize(fdi: number): [number, number, number] {
  return SIZES[isUpper(fdi) ? 'upper' : 'lower'][Math.min(8, Math.max(1, fdi % 10))];
}

/** One crown of a span. Sizes in mm, turn in degrees about the crown's long axis. */
export interface CrownUnit {
  fdi: number;
  md: number; bl: number; height: number;
  turn: number; shiftM: number; shiftB: number;
  /** Centre of the crown base on the gum (world mm), set when the span is fitted. */
  origin: Vec3;
}
/** A single crown or a bridge between two contact points. */
export interface CrownSpan {
  id: string;
  mesial: Vec3; distal: Vec3;
  /** Frame: m mesial → distal, o towards the opposing teeth, b = o × m. */
  m: Vec3; o: Vec3; b: Vec3;
  /** +1 if b points to the cheek, -1 if to the tongue. */
  buccal: 1 | -1;
  /** Wanted gap to the opposing teeth (mm): 0 = light touch, negative = firmer. */
  bite: number;
  /** Grind the crown down where it would push into the opposing teeth. */
  adapt: boolean;
  units: CrownUnit[];
}

// ---------- shape template
interface Shape { n: number; cervMD: number; topMD: number; peakMD: number; cervBL: number; topBL: number; peakBL: number; cusp: number }
const SHAPES: Record<ToothKind, Shape> = {
  molar: { n: 2.8, cervMD: 0.74, topMD: 0.9, peakMD: 0.72, cervBL: 0.8, topBL: 0.8, peakBL: 0.35, cusp: 0.28 },
  premolar: { n: 2.3, cervMD: 0.7, topMD: 0.84, peakMD: 0.72, cervBL: 0.8, topBL: 0.76, peakBL: 0.35, cusp: 0.26 },
  canine: { n: 2.0, cervMD: 0.7, topMD: 0.55, peakMD: 0.7, cervBL: 0.8, topBL: 0.55, peakBL: 0.3, cusp: 0.3 },
  incisor: { n: 2.4, cervMD: 0.72, topMD: 1.0, peakMD: 0.8, cervBL: 0.85, topBL: 0.3, peakBL: 0.25, cusp: 0.04 },
};
const NS = 72, NR = 14, NC = 16;

function profile(t: number, cerv: number, top: number, peak: number): number {
  if (t <= peak) return cerv + (1 - cerv) * Math.sin((t / peak) * Math.PI / 2);
  const s = (t - peak) / (1 - peak);
  return 1 - (1 - top) * s * s;
}
const g2 = (du: number, dv: number, su: number, sv: number) => Math.exp(-(du * du) / (2 * su * su) - (dv * dv) / (2 * sv * sv));
/** Occlusal relief above the marginal ridge, as a share of the cusp height. u: mesial-distal, v: + towards the cheek. */
function relief(kind: ToothKind, u: number, v: number): number {
  switch (kind) {
    case 'molar':
      // Four main cusps, a small distal one, central groove and fossa, marginal ridges.
      return g2(u + 0.5, v - 0.48, 0.28, 0.3) + 0.95 * g2(u - 0.5, v - 0.48, 0.28, 0.3) + 0.9 * g2(u + 0.5, v + 0.48, 0.28, 0.3) + 0.85 * g2(u - 0.5, v + 0.48, 0.28, 0.3)
        + 0.55 * g2(u - 0.85, v - 0.1, 0.16, 0.25)
        + 0.35 * g2(u + 0.88, v, 0.1, 0.5) + 0.3 * g2(u - 0.95, v, 0.08, 0.5)
        - 0.55 * g2(u, v, 0.9, 0.11) - 0.4 * g2(u, v, 0.22, 0.22) - 0.3 * g2(u, v - 0.6, 0.08, 0.35) - 0.25;
    case 'premolar':
      return g2(u, v - 0.48, 0.4, 0.3) + 0.72 * g2(u, v + 0.5, 0.4, 0.3)
        + 0.3 * g2(u + 0.85, v, 0.1, 0.5) + 0.3 * g2(u - 0.85, v, 0.1, 0.5)
        - 0.5 * g2(u, v, 0.75, 0.12) - 0.2;
    case 'canine':
      return g2(u, v - 0.1, 0.38, 0.55) - 0.1;
    default:
      return 1 - 0.3 * u * u;
  }
}

/** Crown mesh in its own frame (see top of file). */
export function crownTemplate(kind: ToothKind, md: number, bl: number, height: number, buccal: 1 | -1): TriMesh {
  const S = SHAPES[kind];
  const cuspH = height * S.cusp, wallH = height - cuspH;
  const pos: number[] = [], idx: number[] = [];
  const ring = (fMD: number, fBL: number, z: number) => {
    for (let i = 0; i < NS; i++) {
      const th = (i / NS) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      pos.push((md / 2) * fMD * Math.sign(c) * Math.abs(c) ** (2 / S.n), (bl / 2) * fBL * Math.sign(s) * Math.abs(s) ** (2 / S.n), z);
    }
  };
  // Side wall rings, gum to marginal ridge.
  for (let k = 0; k <= NR; k++) {
    const t = k / NR;
    ring(profile(t, S.cervMD, S.topMD, S.peakMD), profile(t, S.cervBL, S.topBL, S.peakBL), t * wallH);
  }
  const top = NR * NS;
  // Occlusal cap: rings shrinking to the centre, raised by the relief.
  for (let k = 1; k < NC; k++) {
    const rr = 1 - k / NC, edge = Math.min(1, (1 - rr) / 0.3), e = edge * edge * (3 - 2 * edge);
    for (let i = 0; i < NS; i++) {
      const x = pos[(top + i) * 3] * rr, y = pos[(top + i) * 3 + 1] * rr;
      const u = x / ((md / 2) * S.topMD), v = (y / ((bl / 2) * S.topBL)) * buccal;
      pos.push(x, y, wallH + cuspH * e * relief(kind, u, v));
    }
  }
  const capC = pos.length / 3;
  pos.push(0, 0, wallH + cuspH * relief(kind, 0, 0));
  const botC = pos.length / 3;
  pos.push(0, 0, 0);
  const quad = (a: number, b: number, c: number, d: number) => idx.push(a, b, c, a, c, d);
  for (let k = 0; k < NR + NC - 1; k++) for (let i = 0; i < NS; i++) {
    const j = (i + 1) % NS, r0 = k * NS, r1 = (k + 1) * NS;
    if (k < NR) quad(r0 + i, r0 + j, r1 + j, r1 + i);
    else quad(r0 + i, r0 + j, r1 + j, r1 + i); // cap rings: same winding keeps the top facing out
  }
  const last = (NR + NC - 1) * NS;
  for (let i = 0; i < NS; i++) { const j = (i + 1) % NS; idx.push(last + i, last + j, capC); idx.push(botC, j, i); }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

// ---------- placement
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mulS = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Local crown point → world, with the unit's turn and shifts. */
export function toWorld(span: CrownSpan, u: CrownUnit, p: Vec3): Vec3 {
  const a = (u.turn * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const x = p[0] * c - p[1] * s + u.shiftM, y = p[0] * s + p[1] * c + u.shiftB * span.buccal, z = p[2];
  return add(u.origin, add(mulS(span.m, x), add(mulS(span.b, y), mulS(span.o, z))));
}

/** Where each unit's centre sits on the line between the contact points. */
export function unitCentres(span: CrownSpan): Vec3[] {
  const total = span.units.reduce((a, u) => a + u.md, 0) || 1;
  const L = dot(sub(span.distal, span.mesial), span.m);
  let acc = 0;
  return span.units.map((u) => { const t = (acc + u.md / 2) / total; acc += u.md; return add(span.mesial, mulS(span.m, t * L)); });
}

/** Occlusal direction from a jaw scan (world points): the axis the arch is thinnest along, pointing towards `towards`. */
export function occlusalAxis(pts: Float32Array, towards: Vec3 | null, fallback: Vec3): Vec3 {
  const n = pts.length / 3, stride = Math.max(1, Math.floor(n / 4000));
  let k = 0; const c: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i += stride) { c[0] += pts[i * 3]; c[1] += pts[i * 3 + 1]; c[2] += pts[i * 3 + 2]; k++; }
  c[0] /= k; c[1] /= k; c[2] /= k;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i += stride) {
    const d = [pts[i * 3] - c[0], pts[i * 3 + 1] - c[1], pts[i * 3 + 2] - c[2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b] / k;
  }
  // Smallest eigenvector by inverse-free power iteration on (t·I − C).
  const t = C[0][0] + C[1][1] + C[2][2];
  let v: Vec3 = fallback;
  for (let it = 0; it < 60; it++) {
    v = norm([t * v[0] - (C[0][0] * v[0] + C[0][1] * v[1] + C[0][2] * v[2]), t * v[1] - (C[1][0] * v[0] + C[1][1] * v[1] + C[1][2] * v[2]), t * v[2] - (C[2][0] * v[0] + C[2][1] * v[1] + C[2][2] * v[2])]);
  }
  const want = towards ? sub(towards, c) : fallback;
  if (dot(v, want) < 0) v = mulS(v, -1);
  // A tilted scan or a short arch can mislead: stay within 35° of the fallback.
  if (dot(v, norm(fallback)) < Math.cos((35 * Math.PI) / 180)) return norm(fallback);
  return v;
}

/** New span from the two contact points: frame, units sized to the gap. */
export function newSpan(id: string, mesial: Vec3, distal: Vec3, fdis: number[], o: Vec3, archCentre: Vec3): CrownSpan {
  const d = sub(distal, mesial);
  const m = norm(sub(d, mulS(o, dot(d, o))));
  const b = cross(o, m);
  const mid = mulS(add(mesial, distal), 0.5);
  const outward = sub(mid, archCentre);
  const buccal: 1 | -1 = dot(sub(outward, mulS(o, dot(outward, o))), b) >= 0 ? 1 : -1;
  const L = dot(d, m);
  const typ = fdis.map(typicalSize), sum = typ.reduce((a, t) => a + t[0], 0);
  const units: CrownUnit[] = fdis.map((fdi, i) => {
    const md = (typ[i][0] * L) / sum;
    return { fdi, md, bl: typ[i][1] * (0.6 + 0.4 * md / typ[i][0]), height: typ[i][2], turn: 0, shiftM: 0, shiftB: 0, origin: mid };
  });
  return { id, mesial, distal, m, o, b, buccal, bite: 0, adapt: true, units };
}

/** Sizes again after the tooth list or the contact points changed. */
export function resizeUnits(span: CrownSpan, fdis: number[]): void {
  const L = dot(sub(span.distal, span.mesial), span.m);
  const typ = fdis.map(typicalSize), sum = typ.reduce((a, t) => a + t[0], 0);
  span.units = fdis.map((fdi, i) => {
    const old = span.units.find((u) => u.fdi === fdi);
    const md = (typ[i][0] * L) / sum;
    return { fdi, md, bl: typ[i][1] * (0.6 + 0.4 * md / typ[i][0]), height: old?.height ?? typ[i][2], turn: old?.turn ?? 0, shiftM: 0, shiftB: old?.shiftB ?? 0, origin: old?.origin ?? span.mesial };
  });
}

/** Ray hit along a direction (mm) against an optional mesh; Infinity when none. */
type Hit = (ro: Vec3, rd: Vec3) => number;
export const meshHit = (m: TriMesh | null): Hit => (ro, rd) => (m ? rayMesh(m, ro, rd) : Infinity);

/** Triangles of a mesh within `radius` of `centre`, moved to world by `model` (column-major rigid). */
export function nearbyMesh(m: TriMesh, model: ArrayLike<number> | null, centre: Vec3, radius: number): TriMesh {
  const P = m.positions, I = m.indices, r2 = radius * radius;
  const W = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (model) { W[i] = model[0] * x + model[4] * y + model[8] * z + model[12]; W[i + 1] = model[1] * x + model[5] * y + model[9] * z + model[13]; W[i + 2] = model[2] * x + model[6] * y + model[10] * z + model[14]; }
    else { W[i] = x; W[i + 1] = y; W[i + 2] = z; }
  }
  const near = (v: number) => { const dx = W[v * 3] - centre[0], dy = W[v * 3 + 1] - centre[1], dz = W[v * 3 + 2] - centre[2]; return dx * dx + dy * dy + dz * dz < r2; };
  const map = new Map<number, number>(), pos: number[] = [], idx: number[] = [];
  const keep = (v: number) => { let k = map.get(v); if (k === undefined) { k = pos.length / 3; map.set(v, k); pos.push(W[v * 3], W[v * 3 + 1], W[v * 3 + 2]); } return k; };
  for (let t = 0; t < I.length; t += 3) if (near(I[t]) || near(I[t + 1]) || near(I[t + 2])) idx.push(keep(I[t]), keep(I[t + 1]), keep(I[t + 2]));
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Sit each unit on the gum under its place on the contact line. */
export function seatOnGum(span: CrownSpan, gum: Hit): void {
  const centres = unitCentres(span);
  span.units.forEach((u, i) => {
    const c = centres[i], start = add(c, mulS(span.o, 6));
    const t = gum(start, mulS(span.o, -1));
    const typH = typicalSize(u.fdi)[2];
    // A miss (no scan under the gap) falls back to a typical crown below the contacts.
    u.origin = Number.isFinite(t) && t < 20 ? add(start, mulS(span.o, -t - 0.3)) : sub(c, mulS(span.o, typH * 0.6));
  });
}

export interface BuiltCrown { mesh: TriMesh; /** Gap to the opposing teeth per vertex (mm), Infinity if none in reach. */ gap: Float32Array; contact: number; /** Most taken off any point to fit the bite (mm). */ ground: number }

/** Crown in world mm, ground to the opposing teeth if the span says so. */
export function buildUnit(span: CrownSpan, u: CrownUnit, opposing: Hit | null): BuiltCrown {
  const t = crownTemplate(kindOf(u.fdi), u.md, u.bl, u.height, span.buccal);
  const P = t.positions, n = P.length / 3, gap = new Float32Array(n).fill(Infinity);
  const W = new Float32Array(P.length);
  for (let i = 0; i < n; i++) { const w = toWorld(span, u, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]); W[i * 3] = w[0]; W[i * 3 + 1] = w[1]; W[i * 3 + 2] = w[2]; }
  let contact = Infinity, ground = 0;
  if (opposing) {
    for (let i = 0; i < n; i++) {
      if (P[i * 3 + 2] < u.height * 0.45) continue;
      const w: Vec3 = [W[i * 3], W[i * 3 + 1], W[i * 3 + 2]];
      const back = 4, h = opposing(sub(w, mulS(span.o, back)), span.o);
      if (!Number.isFinite(h) || h > back + 3) continue;
      let g = h - back;
      if (span.adapt && g < span.bite) {
        const push = span.bite - g;
        if (push > ground) ground = push;
        W[i * 3] -= span.o[0] * push; W[i * 3 + 1] -= span.o[1] * push; W[i * 3 + 2] -= span.o[2] * push;
        g = span.bite;
      }
      gap[i] = g;
      if (g < contact) contact = g;
    }
  }
  return { mesh: { positions: W, indices: t.indices }, gap, contact, ground };
}

/**
 * Set each crown's height so its highest cusp just meets the opposing teeth
 * (at the span's bite gap). Without opposing teeth in reach, the crown is
 * made about 2 mm taller than the contact points.
 */
export function fitHeights(span: CrownSpan, opposing: Hit | null): { touched: number } {
  let touched = 0;
  span.units.forEach((u, i) => {
    const typH = typicalSize(u.fdi)[2];
    const contactH = dot(sub(unitCentres(span)[i], u.origin), span.o);
    u.height = Math.max(typH * 0.6, Math.min(typH * 1.5, contactH + 2));
    if (!opposing) return;
    const adapt = span.adapt;
    span.adapt = false;
    let hit = false;
    for (let it = 0; it < 4; it++) {
      const b = buildUnit(span, u, opposing);
      if (!Number.isFinite(b.contact)) break;
      hit = true;
      u.height = Math.max(typH * 0.5, Math.min(typH * 1.6, u.height + (b.contact - span.bite)));
    }
    span.adapt = adapt;
    if (hit) touched++;
  });
  return { touched };
}

/** Vertex colours for the bite: red = touching, yellow to green = close, ivory = clear. */
export function biteColors(gap: Float32Array, bite: number): Uint8Array {
  const out = new Uint8Array(gap.length * 3);
  for (let i = 0; i < gap.length; i++) {
    const g = gap[i] - bite;
    let c: [number, number, number];
    if (!(g < 1)) c = [236, 230, 214];
    else if (g <= 0.05) c = [226, 60, 70];
    else if (g < 0.3) { const t = (g - 0.05) / 0.25; c = [Math.round(240 - 40 * t), Math.round(200 + 20 * t), 70]; }
    else { const t = Math.min(1, (g - 0.3) / 0.7); c = [Math.round(110 + 126 * t), Math.round(200 + 30 * t), Math.round(120 + 94 * t)]; }
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  return out;
}
