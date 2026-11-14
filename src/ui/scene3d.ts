// What the 3D views show besides the volume: outlined teeth, nerve canals
// and the point marker. Meshes are built once per shape and cached.
import type { CaseRecord } from '../core/case/model';
import type { Vec3 } from '../core/volume/volume';
import { unpackMask } from '../core/segment/regionGrow';
import { surfaceNets } from '../core/segment/surfaceNets';
import { nerveTube } from '../core/anatomy/nerve';
import type { SceneSurface, SurfaceMesh } from '../render/vr/engine';
import { getEngine } from '../render/vr/engine';
import { sphereMesh, tubeMesh } from '../render/vr/shapes';
import { OVERLAY_COLORS } from './imageCanvas';

const cache = new Map<string, SurfaceMesh>();
const memo = (key: string, make: () => SurfaceMesh) => () => { let m = cache.get(key); if (!m) { m = make(); cache.set(key, m); } return m; };
const rgb = (c: number[]): [number, number, number] => [c[0] / 255, c[1] / 255, c[2] / 255];

export function sceneSurfaces(c: CaseRecord, cursor: Vec3 | null): SceneSurface[] {
  const out: SceneSurface[] = [];
  c.anatomy.teeth.forEach((t, i) => {
    const key = `tooth:${t.id}:${t.volumeMm3.toFixed(3)}:${t.mask.bits.length}`;
    out.push({ key, color: rgb(OVERLAY_COLORS[(i % 7) + 1]), mesh: memo(key, () => surfaceNets(unpackMask(t.mask))) });
  });
  for (const n of c.anatomy.nerves) {
    if (n.points.length < 2) continue;
    const key = `nerve:${n.id}:${n.points.map((q) => q.p.map((x) => x.toFixed(2)).join(',') + q.r).join(';')}`;
    out.push({ key, color: [0.9, 0.28, 0.3], mesh: memo(key, () => tubeMesh(nerveTube(n))) });
    if (n.foramen) out.push({ key: 'sphere', color: [0.98, 0.68, 0.29], mesh: memo('sphere', () => sphereMesh()), at: [...n.foramen, 1.6] as [number, number, number, number] });
  }
  if (cursor) out.push({ key: 'sphere', color: [0.98, 0.82, 0.3], mesh: memo('sphere', () => sphereMesh()), at: [...cursor, 1.2] as [number, number, number, number] });
  // Drop cached meshes nobody uses any more (keep the sphere).
  const keys = new Set(out.map((s) => s.key));
  for (const k of cache.keys()) if (!keys.has(k) && k !== 'sphere') cache.delete(k);
  getEngine().keepMeshes(keys);
  return out;
}
