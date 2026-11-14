/// <reference lib="webworker" />
// Loader worker. Stays alive after loading so it can read full-resolution
// regions from the same files on request.
import { CbctSource, loadCbct, loadRoi } from './loader';
import type { Tier } from '../core/volume/budget';
import type { Vec3 } from '../core/volume/volume';

type Req =
  | { type: 'load'; files: File[]; tier: Tier; ramGb: number; max3d?: number }
  | { type: 'roi'; id: number; center: Vec3; sizeMm: Vec3 };

let opened: CbctSource | null = null;
const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t);

self.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data;
  try {
    if (req.type === 'load') {
      opened = null;
      const res = await loadCbct(req.files, {
        tier: req.tier, ramGb: req.ramGb, max3d: req.max3d,
        onProgress: (p) => post({ type: 'progress', progress: p }),
        keep: (s) => { opened = s; },
      });
      post({ type: 'done', result: res }, [res.volume.data.buffer]);
    } else if (req.type === 'roi') {
      if (!opened) throw new Error('Open the scan file again to read full detail.');
      const roi = await loadRoi(opened, req.center, req.sizeMm, (p) => post({ type: 'roi-progress', id: req.id, progress: p }));
      post({ type: 'roi', id: req.id, volume: roi }, [roi.data.buffer]);
    }
  } catch (err) {
    post({ type: 'error', id: (req as { id?: number }).id, message: err instanceof Error ? err.message : String(err) });
  }
};
