// Own surface extraction from a binary mask (naive surface nets): one vertex
// per boundary cell at the mean of its edge crossings, one quad per crossing
// edge. Lighter than marching cubes, watertight for closed masks, no tables.
// Output in world LPS mm.
import type { Mask } from './regionGrow';

export interface Mesh { positions: Float32Array; indices: Uint32Array }

export function surfaceNets(m: Mask): Mesh {
  // Pad by one voxel so the surface closes at the box edge.
  const [mx, my, mz] = m.dims;
  const nx = mx + 2, ny = my + 2, nz = mz + 2;
  const at = (i: number, j: number, k: number) => {
    i -= 1; j -= 1; k -= 1;
    if (i < 0 || j < 0 || k < 0 || i >= mx || j >= my || k >= mz) return 0;
    return m.data[i + mx * (j + my * k)];
  };
  // Cells are between voxel centres: cell (i,j,k) has corners (i..i+1, j..j+1, k..k+1).
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const vid = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  const corner = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const toWorld = (a: number, b: number, c: number) => {
    // padded voxel coords -> mask voxel coords -> world
    const i = (a - 1) * m.spacing[0], j = (b - 1) * m.spacing[1], k = (c - 1) * m.spacing[2];
    return [
      m.origin[0] + i * m.rowDir[0] + j * m.colDir[0] + k * m.normal[0],
      m.origin[1] + i * m.rowDir[1] + j * m.colDir[1] + k * m.normal[1],
      m.origin[2] + i * m.rowDir[2] + j * m.colDir[2] + k * m.normal[2],
    ];
  };
  const v = new Uint8Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { v[c] = at(i + corner[c][0], j + corner[c][1], k + corner[c][2]); mask |= v[c] << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if (v[a] === v[b]) continue;
      sx += (corner[a][0] + corner[b][0]) / 2; sy += (corner[a][1] + corner[b][1]) / 2; sz += (corner[a][2] + corner[b][2]) / 2; n++;
    }
    vid[i + cx * (j + cy * k)] = pos.length / 3;
    pos.push(...toWorld(i + sx / n, j + sy / n, k + sz / n));
  }
  const idx: number[] = [];
  const cell = (i: number, j: number, k: number) => vid[i + cx * (j + cy * k)];
  // For each voxel edge along +x/+y/+z that crosses the surface, join the 4 cells around it.
  for (let k = 1; k < cz; k++) for (let j = 1; j < cy; j++) for (let i = 1; i < cx; i++) {
    const a = at(i, j, k);
    if (a !== at(i + 1, j, k)) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), a === 1);
    if (a !== at(i, j + 1, k)) quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), a === 1);
    if (a !== at(i, j, k + 1)) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), a === 1);
  }
  function quad(a: number, b: number, c: number, d: number, flip: boolean) {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
