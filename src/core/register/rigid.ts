// Rigid transforms as 4×4 column-major arrays (plain numbers, stored in the
// case as JSON) and the closed-form best fit between point pairs (Horn's
// quaternion method, own Jacobi eigen solver).
import type { Vec3 } from '../volume/volume';

export type M4 = number[]; // 16, column-major, maps scan mm -> world LPS mm

export const I4: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function apply(m: M4, p: Vec3): Vec3 {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

export function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}

export function inverseRigid(m: M4): M4 {
  // R^T, -R^T t
  const o = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  const t = [m[12], m[13], m[14]];
  o[12] = -(o[0] * t[0] + o[4] * t[1] + o[8] * t[2]);
  o[13] = -(o[1] * t[0] + o[5] * t[1] + o[9] * t[2]);
  o[14] = -(o[2] * t[0] + o[6] * t[1] + o[10] * t[2]);
  return o;
}

export function fromRotT(R: number[][], t: Vec3): M4 {
  return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, t[0], t[1], t[2], 1];
}

/** Rotation about an axis through a point (deg), as a transform. */
export function rotateAbout(axis: Vec3, deg: number, about: Vec3): M4 {
  const a = (deg * Math.PI) / 180, l = Math.hypot(...axis) || 1;
  const [x, y, z] = axis.map((v) => v / l), c = Math.cos(a), s = Math.sin(a), C = 1 - c;
  const R = [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
  const Rp = [0, 1, 2].map((i) => R[i][0] * about[0] + R[i][1] * about[1] + R[i][2] * about[2]);
  return fromRotT(R, [about[0] - Rp[0], about[1] - Rp[1], about[2] - Rp[2]]);
}

export function translate(d: Vec3): M4 { const m = I4.slice(); m[12] = d[0]; m[13] = d[1]; m[14] = d[2]; return m; }

/** Best rigid fit taking src onto dst (least squares, optional weights). */
export function fitRigid(src: Vec3[], dst: Vec3[], w?: number[]): M4 {
  const n = src.length;
  let W = 0; const cs = [0, 0, 0], cd = [0, 0, 0];
  for (let i = 0; i < n; i++) { const wi = w ? w[i] : 1; W += wi; for (let a = 0; a < 3; a++) { cs[a] += src[i][a] * wi; cd[a] += dst[i][a] * wi; } }
  for (let a = 0; a < 3; a++) { cs[a] /= W; cd[a] /= W; }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    const wi = w ? w[i] : 1;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) S[a][b] += wi * (src[i][a] - cs[a]) * (dst[i][b] - cd[b]);
  }
  const [[Sxx, Sxy, Sxz], [Syx, Syy, Syz], [Szx, Szy, Szz]] = S;
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const q = topEigenvector(N);
  const [q0, qx, qy, qz] = q;
  const R = [
    [q0 * q0 + qx * qx - qy * qy - qz * qz, 2 * (qx * qy - q0 * qz), 2 * (qx * qz + q0 * qy)],
    [2 * (qy * qx + q0 * qz), q0 * q0 - qx * qx + qy * qy - qz * qz, 2 * (qy * qz - q0 * qx)],
    [2 * (qz * qx - q0 * qy), 2 * (qz * qy + q0 * qx), q0 * q0 - qx * qx - qy * qy + qz * qz],
  ];
  const Rc = [0, 1, 2].map((i) => R[i][0] * cs[0] + R[i][1] * cs[1] + R[i][2] * cs[2]);
  return fromRotT(R, [cd[0] - Rc[0], cd[1] - Rc[1], cd[2] - Rc[2]]);
}

/** Eigenvector of the largest eigenvalue of a symmetric 4×4 (Jacobi). */
export function topEigenvector(A0: number[][]): number[] {
  const A = A0.map((r) => r.slice());
  const V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += A[p][q] * A[p][q];
    if (off < 1e-20) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(A[p][q]) < 1e-30) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 4; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 4; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (A[i][i] > A[best][best]) best = i;
  const v = [V[0][best], V[1][best], V[2][best], V[3][best]];
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
}

export function residuals(m: M4, src: Vec3[], dst: Vec3[]): number[] {
  return src.map((p, i) => { const q = apply(m, p); return Math.hypot(q[0] - dst[i][0], q[1] - dst[i][1], q[2] - dst[i][2]); });
}
