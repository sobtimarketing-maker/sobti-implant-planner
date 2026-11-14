/// <reference lib="webworker" />
import { loadCbct } from './loader';
import type { Tier } from '../core/volume/budget';

interface LoadRequest { type: 'load'; files: File[]; tier: Tier; ramGb: number; max3d?: number }

self.onmessage = async (ev: MessageEvent<LoadRequest>) => {
  const req = ev.data;
  if (req.type !== 'load') return;
  try {
    const res = await loadCbct(req.files, {
      tier: req.tier, ramGb: req.ramGb, max3d: req.max3d,
      onProgress: (p) => (self as unknown as Worker).postMessage({ type: 'progress', progress: p }),
    });
    (self as unknown as Worker).postMessage({ type: 'done', result: res }, [res.volume.data.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
