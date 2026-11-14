// Working volume in DICOM LPS millimetres.
// Voxel (i, j, k) -> world = origin + i*spacing[0]*rowDir + j*spacing[1]*colDir + k*spacing[2]*normal
// i runs along a row (columns), j down the image (rows), k along the slice normal (sorted ascending).

export type Vec3 = [number, number, number];

export interface VolumeInfo {
  dims: Vec3;          // [nx, ny, nz]
  spacing: Vec3;       // mm per voxel
  origin: Vec3;        // LPS mm of voxel (0,0,0) centre
  rowDir: Vec3;        // unit, direction of increasing i
  colDir: Vec3;        // unit, direction of increasing j
  normal: Vec3;        // unit, direction of increasing k
  factor: number;      // downsample factor from source
  sourceDims: Vec3;
  sourceSpacing: Vec3;
}

export interface Volume extends VolumeInfo {
  data: Int16Array;    // HU, length nx*ny*nz, index = i + nx*(j + ny*k)
}

export function voxelToWorld(v: VolumeInfo, i: number, j: number, k: number): Vec3 {
  const a = i * v.spacing[0], b = j * v.spacing[1], c = k * v.spacing[2];
  return [
    v.origin[0] + a * v.rowDir[0] + b * v.colDir[0] + c * v.normal[0],
    v.origin[1] + a * v.rowDir[1] + b * v.colDir[1] + c * v.normal[1],
    v.origin[2] + a * v.rowDir[2] + b * v.colDir[2] + c * v.normal[2],
  ];
}

export function worldToVoxel(v: VolumeInfo, p: Vec3): Vec3 {
  const d: Vec3 = [p[0] - v.origin[0], p[1] - v.origin[1], p[2] - v.origin[2]];
  return [dot(d, v.rowDir) / v.spacing[0], dot(d, v.colDir) / v.spacing[1], dot(d, v.normal) / v.spacing[2]];
}

export function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function sampleNearest(v: Volume, i: number, j: number, k: number): number {
  const [nx, ny, nz] = v.dims;
  i = Math.round(i); j = Math.round(j); k = Math.round(k);
  if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1000;
  return v.data[i + nx * (j + ny * k)];
}
