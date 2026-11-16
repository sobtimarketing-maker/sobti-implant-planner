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
import { anatomicCrown, AnatomicCrown, LibraryId, ShadeId } from './anatomy';

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
  /** Crown library (shape style) and VITA shade; defaults natural / A2. */
  library?: LibraryId;
  shade?: ShadeId;
  units: CrownUnit[];
}

// ---------- shape template (anatomic library in anatomy.ts)
const KIND_FDI: Record<ToothKind, number> = { molar: 46, premolar: 45, canine: 43, incisor: 41 };
/** Crown mesh in its own frame (see top of file), for a tooth number or kind. */
export function crownTemplate(tooth: ToothKind | number, md: number, bl: number, height: number, buccal: 1 | -1, library?: string, shade?: ShadeId): AnatomicCrown {
  return anatomicCrown(typeof tooth === 'number' ? tooth : KIND_FDI[tooth], md, bl, height, buccal, library, shade);
}

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

/**
 * Fast "how far up to the opposing teeth" for many points: the opposing
 * surface is drawn once into a height map across the occlusal axis `o`
 * (lowest surface per 0.15 mm cell). The returned hit only answers rays
 * along +o, which is all the bite check asks.
 */
export function heightHit(m: TriMesh, o: Vec3, centre: Vec3, radius: number, cell = 0.15): Hit {
  const a = norm(Math.abs(o[0]) < 0.9 ? cross(o, [1, 0, 0]) : cross(o, [0, 1, 0])), b = cross(o, a);
  const n = Math.ceil((radius * 2) / cell), H = new Float32Array(n * n).fill(Infinity);
  const P = m.positions, I = m.indices;
  const U = new Float32Array(P.length / 3), V = new Float32Array(P.length / 3), Z = new Float32Array(P.length / 3);
  for (let i = 0; i < U.length; i++) {
    const d: Vec3 = [P[i * 3] - centre[0], P[i * 3 + 1] - centre[1], P[i * 3 + 2] - centre[2]];
    U[i] = (dot(d, a) + radius) / cell; V[i] = (dot(d, b) + radius) / cell; Z[i] = dot(d, o);
  }
  for (let t = 0; t < I.length; t += 3) {
    const i0 = I[t], i1 = I[t + 1], i2 = I[t + 2];
    const x0 = U[i0], y0 = V[i0], x1 = U[i1], y1 = V[i1], x2 = U[i2], y2 = V[i2];
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(det) < 1e-9) continue;
    const gx0 = Math.max(0, Math.floor(Math.min(x0, x1, x2))), gx1 = Math.min(n - 1, Math.ceil(Math.max(x0, x1, x2)));
    const gy0 = Math.max(0, Math.floor(Math.min(y0, y1, y2))), gy1 = Math.min(n - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const px = gx + 0.5, py = gy + 0.5;
      const l1 = ((px - x0) * (y2 - y0) - (x2 - x0) * (py - y0)) / det, l2 = ((x1 - x0) * (py - y0) - (px - x0) * (y1 - y0)) / det, l0 = 1 - l1 - l2;
      if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
      const z = l0 * Z[i0] + l1 * Z[i1] + l2 * Z[i2], k = gy * n + gx;
      if (z < H[k]) H[k] = z;
    }
  }
  return (ro) => {
    const d: Vec3 = [ro[0] - centre[0], ro[1] - centre[1], ro[2] - centre[2]];
    const gx = Math.floor((dot(d, a) + radius) / cell), gy = Math.floor((dot(d, b) + radius) / cell);
    if (gx < 0 || gy < 0 || gx >= n || gy >= n) return Infinity;
    const z = H[gy * n + gx], t = z - dot(d, o);
    return t > 0 ? t : Infinity;
  };
}

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

export interface BuiltCrown { mesh: TriMesh & { colors: Uint8Array }; /** Gap to the opposing teeth per vertex (mm), Infinity if none in reach. */ gap: Float32Array; contact: number; /** Most taken off any point to fit the bite (mm). */ ground: number }

/** Crown in world mm, ground to the opposing teeth if the span says so. */
export function buildUnit(span: CrownSpan, u: CrownUnit, opposing: Hit | null): BuiltCrown {
  const t = crownTemplate(u.fdi, u.md, u.bl, u.height, span.buccal, span.library, span.shade);
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
  return { mesh: { positions: W, indices: t.indices, colors: t.colors }, gap, contact, ground };
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
