// Oblique MPR: sample any plane through one or more volumes (finest first),
// so a full-resolution region shows inside the working volume.
// All geometry in DICOM LPS millimetres.
import { dot, Vec3, Volume, worldToVoxel } from '../core/volume/volume';
import type { ViewKind } from './mpr';

export interface Frame { ex: Vec3; ey: Vec3; ez: Vec3 } // orthonormal; identity = LPS axes

export const IDENTITY: Frame = { ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1] };

export interface Plane { u: Vec3; v: Vec3; n: Vec3 } // u = screen right, v = screen down, n = u × v

/**
 * Screen axes per view. Axial is seen from the feet (patient right on the
 * left, anterior up); coronal from the front; sagittal from the patient's right.
 */
export function planeFor(kind: ViewKind, f: Frame): Plane {
  if (kind === 'axial') return { u: f.ex, v: f.ey, n: f.ez };
  if (kind === 'coronal') return { u: f.ex, v: neg(f.ez), n: f.ey };
  return { u: f.ey, v: neg(f.ez), n: f.ex };
}

export function rotate(p: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  const k = norm(axis);
  const kxp = cross(k, p);
  const kdp = dot(k, p);
  return [
    p[0] * c + kxp[0] * s + k[0] * kdp * (1 - c),
    p[1] * c + kxp[1] * s + k[1] * kdp * (1 - c),
    p[2] * c + kxp[2] * s + k[2] * kdp * (1 - c),
  ];
}

export function rotateFrame(f: Frame, axis: Vec3, angle: number): Frame {
  // Re-orthonormalise to stop drift after many small rotations.
  const ex = norm(rotate(f.ex, axis, angle));
  let ey = rotate(f.ey, axis, angle);
  ey = norm(sub(ey, scale(ex, dot(ey, ex))));
  return { ex, ey, ez: cross(ex, ey) };
}

/** Tilt of a frame axis from its original LPS axis, in degrees. */
export function tiltDeg(f: Frame): number {
  const a = Math.acos(Math.min(1, Math.abs(f.ez[2])));
  const b = Math.acos(Math.min(1, Math.abs(f.ex[0])));
  return (Math.max(a, b) * 180) / Math.PI;
}

/**
 * Sample a w×h grid. Pixel (x, y) centre is at origin + x·px·u + y·px·v.
 * Volumes are tried in order; the first that contains the point wins.
 */
export function samplePlane(vols: Volume[], origin: Vec3, u: Vec3, v: Vec3, px: number, w: number, h: number, out: Int16Array, linear: boolean): void {
  const prep = vols.map((vol) => {
    const o = worldToVoxel(vol, origin);
    const du = voxStep(vol, u, px);
    const dv = voxStep(vol, v, px);
    return { vol, o, du, dv, nx: vol.dims[0], ny: vol.dims[1], nz: vol.dims[2], d: vol.data };
  });
  const nv = prep.length;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let val = -1000;
      for (let q = 0; q < nv; q++) {
        const p = prep[q];
        const i = p.o[0] + x * p.du[0] + y * p.dv[0];
        const j = p.o[1] + x * p.du[1] + y * p.dv[1];
        const k = p.o[2] + x * p.du[2] + y * p.dv[2];
        if (i < 0 || j < 0 || k < 0 || i > p.nx - 1 || j > p.ny - 1 || k > p.nz - 1) continue;
        val = linear ? trilinear(p.d, p.nx, p.ny, p.nz, i, j, k) : p.d[Math.round(i) + p.nx * (Math.round(j) + p.ny * Math.round(k))];
        break;
      }
      out[row + x] = val;
    }
  }
}

/** HU at a world point from the finest volume that contains it. */
export function sampleWorld(vols: Volume[], p: Vec3): number {
  for (const vol of vols) {
    const [i, j, k] = worldToVoxel(vol, p);
    const [nx, ny, nz] = vol.dims;
    if (i < 0 || j < 0 || k < 0 || i > nx - 1 || j > ny - 1 || k > nz - 1) continue;
    return Math.round(trilinear(vol.data, nx, ny, nz, i, j, k));
  }
  return -1000;
}

export function contains(vol: Volume, p: Vec3, marginVox = 0): boolean {
  const [i, j, k] = worldToVoxel(vol, p);
  const [nx, ny, nz] = vol.dims;
  return i >= marginVox && j >= marginVox && k >= marginVox && i <= nx - 1 - marginVox && j <= ny - 1 - marginVox && k <= nz - 1 - marginVox;
}

export function volumeCenter(vol: Volume): Vec3 {
  const c = (n: number, s: number) => ((n - 1) * s) / 2;
  const a = c(vol.dims[0], vol.spacing[0]), b = c(vol.dims[1], vol.spacing[1]), d = c(vol.dims[2], vol.spacing[2]);
  return [
    vol.origin[0] + a * vol.rowDir[0] + b * vol.colDir[0] + d * vol.normal[0],
    vol.origin[1] + a * vol.rowDir[1] + b * vol.colDir[1] + d * vol.normal[1],
    vol.origin[2] + a * vol.rowDir[2] + b * vol.colDir[2] + d * vol.normal[2],
  ];
}

function voxStep(vol: Volume, dir: Vec3, px: number): Vec3 {
  return [dot(dir, vol.rowDir) * px / vol.spacing[0], dot(dir, vol.colDir) * px / vol.spacing[1], dot(dir, vol.normal) * px / vol.spacing[2]];
}

function trilinear(d: Int16Array, nx: number, ny: number, nz: number, i: number, j: number, k: number): number {
  const i0 = Math.min(nx - 2, Math.floor(i)), j0 = Math.min(ny - 2, Math.floor(j)), k0 = Math.min(nz - 2, Math.floor(k));
  const fi = i - i0, fj = j - j0, fk = k - k0;
  const sxy = nx * ny;
  const b = i0 + nx * j0 + sxy * k0;
  const c00 = d[b] + (d[b + 1] - d[b]) * fi;
  const c10 = d[b + nx] + (d[b + nx + 1] - d[b + nx]) * fi;
  const c01 = d[b + sxy] + (d[b + sxy + 1] - d[b + sxy]) * fi;
  const c11 = d[b + sxy + nx] + (d[b + sxy + nx + 1] - d[b + sxy + nx]) * fi;
  const c0 = c00 + (c10 - c00) * fj;
  const c1 = c01 + (c11 - c01) * fj;
  return c0 + (c1 - c0) * fk;
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
