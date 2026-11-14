// Build: bundles our own code only. No runtime dependencies.
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--serve');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });

const common = { bundle: true, sourcemap: true, target: ['chrome103'], loader: { '.svg': 'text' }, logLevel: 'info', minify: !watch };
const ctxs = await Promise.all([
  esbuild.context({ ...common, entryPoints: { main: 'src/app/main.ts' }, outdir: 'dist', format: 'iife' }),
  esbuild.context({ ...common, entryPoints: { 'load.worker': 'src/workers/load.worker.ts' }, outdir: 'dist', format: 'iife' }),
]);
if (watch) {
  await Promise.all(ctxs.map((c) => c.watch()));
  const { port } = await ctxs[0].serve({ servedir: 'dist', port: 5173, host: '0.0.0.0' });
  console.log(`Serving on http://localhost:${port}`);
} else {
  await Promise.all(ctxs.map((c) => c.rebuild()));
  await Promise.all(ctxs.map((c) => c.dispose()));
}
