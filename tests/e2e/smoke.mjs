// End-to-end smoke test in headless Chromium.
// Usage: CASE_ZIP=/path/to/cbct.zip SHOTS=/tmp/shots node tests/e2e/smoke.mjs
// Without CASE_ZIP it only checks that the app starts and a case can be created.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // dev tool only
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.map': 'application/json' };
const server = createServer(async (req, res) => {
  const p = join('dist', decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html')));
  try { res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }); res.end(await readFile(p)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;
const shots = process.env.SHOTS;
if (shots) await mkdir(shots, { recursive: true });
const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(shots, name) }); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
try {
  await page.goto(url);
  await page.getByRole('button', { name: 'New case' }).click();
  await page.getByLabel('Full name').fill('Test Patient');
  for (const t of [46, 47]) await page.getByRole('button', { name: new RegExp(`^Tooth ${t},`) }).click();
  await page.getByLabel('Implant system (any brand)').fill('Any system');
  await shot(page, '1-intake.png');
  if (process.env.CASE_ZIP) {
    const t0 = Date.now();
    await page.locator('input[type=file]').setInputFiles(process.env.CASE_ZIP);
    await page.getByText('Check the scan').waitFor({ timeout: 180000 });
    console.log(`CBCT open to first image: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Bone', exact: true }).click();
    await page.waitForTimeout(300);
    await shot(page, '2-axial.png');
    // Tap a point and switch hero to coronal.
    const box = await page.locator('.hero canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.6);
    await page.getByRole('button', { name: 'Show Coronal view' }).click();
    await page.waitForTimeout(300);
    await shot(page, '3-coronal.png');
    await page.getByRole('button', { name: 'Expert grid' }).click();
    await page.waitForTimeout(400);
    await shot(page, '4-expert.png');
    // Reopen from the case list: volume should come back from the cache.
    await page.getByRole('button', { name: 'Back to cases' }).click();
    await page.getByRole('button', { name: /Open case Test Patient/ }).click();
    await page.getByText('Check the scan').waitFor({ timeout: 20000 });
    console.log('Reopen from cache OK');
  }
  await page.getByRole('button', { name: 'Back to cases' }).click();
  await page.getByRole('button', { name: /Open case Test Patient/ }).waitFor();
  await shot(page, '5-home.png');
  if (errors.length) throw new Error('Page errors:\n' + errors.join('\n'));
  console.log('E2E smoke: PASS');
} catch (e) {
  await shot(page, 'failure.png');
  console.error('E2E smoke: FAIL', e.message, errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
