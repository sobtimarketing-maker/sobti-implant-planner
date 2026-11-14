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
    await page.getByRole('button', { name: 'Bone', exact: true }).first().click();
    await page.waitForTimeout(300);
    await shot(page, '2-axial.png');
    // Tap a point and switch hero to coronal.
    const box = await page.locator('.hero canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.6);
    await page.getByRole('button', { name: 'Show Coronal view' }).click();
    await page.waitForTimeout(300);
    await shot(page, '3-coronal.png');
    // Full-resolution detail around the cursor.
    const t1 = Date.now();
    await page.getByRole('button', { name: 'Load full detail here' }).click();
    await page.getByText(/mm detail here/).waitFor({ timeout: 60000 });
    console.log(`Full detail box: ${((Date.now() - t1) / 1000).toFixed(1)} s`);
    // Measure a line.
    await page.getByRole('button', { name: 'Measure', exact: true }).click();
    const hb = await page.locator('.hero canvas').boundingBox();
    await page.mouse.move(hb.x + hb.width * 0.35, hb.y + hb.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width * 0.5, hb.y + hb.height * 0.55, { steps: 8 });
    await page.mouse.up();
    await page.getByRole('button', { name: /Show measurement 1/ }).waitFor();
    // Tilt.
    await page.getByRole('button', { name: 'Tilt', exact: true }).click();
    await page.mouse.move(hb.x + hb.width * 0.8, hb.y + hb.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width * 0.8, hb.y + hb.height * 0.3, { steps: 8 });
    await page.mouse.up();
    await page.getByText(/°$/).waitFor();
    // Zoom in to see the detail.
    await page.mouse.move(hb.x + hb.width * 0.45, hb.y + hb.height * 0.5);
    await page.keyboard.down('Control');
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    await page.waitForTimeout(400);
    await shot(page, '3b-detail-measure-tilt.png');
    await page.getByRole('button', { name: 'Expert grid' }).click();
    await page.waitForTimeout(400);
    await shot(page, '4-expert.png');
    // Step 3: arch, panoramic, nerve, teeth.
    await page.getByRole('button', { name: 'Arch and nerve' }).click();
    await page.getByRole('button', { name: 'Suggest arch at this level' }).click();
    await page.getByRole('button', { name: 'Trace the nerve' }).waitFor();
    await page.waitForTimeout(300);
    await shot(page, '6-arch.png');
    await page.getByRole('button', { name: 'Trace the nerve' }).click();
    const pano = await page.locator('.split-a canvas').boundingBox();
    const cs = await page.locator('.split-b canvas').boundingBox();
    for (const fx of [0.15, 0.22, 0.3]) {
      await page.mouse.click(pano.x + pano.width * fx, pano.y + pano.height * 0.62);
      await page.waitForTimeout(150);
      await page.mouse.click(cs.x + cs.width * 0.5, cs.y + cs.height * 0.62);
      await page.waitForTimeout(150);
    }
    await page.getByRole('button', { name: /^Right \(3\)/ }).waitFor();
    await page.getByRole('button', { name: 'Mark foramen here' }).click();
    await shot(page, '7-nerve.png');
    await page.getByRole('group', { name: 'Task' }).getByRole('button', { name: 'Teeth' }).click();
    await page.mouse.click(pano.x + pano.width * 0.72, pano.y + pano.height * 0.47);
    await page.waitForTimeout(200);
    await page.mouse.click(cs.x + cs.width * 0.5, cs.y + cs.height * 0.5);
    await page.waitForTimeout(500);
    await shot(page, '8-teeth.png');
    console.log('Teeth message:', await page.locator('.side-card .ok-line, .side-card .warn-line').first().textContent().catch(() => 'none'));
    // Reopen from the case list: volume should come back from the cache.
    await page.getByRole('button', { name: 'Back to cases' }).click();
    await page.getByRole('button', { name: /Open case Test Patient/ }).click();
    await page.locator('.split-a canvas').waitFor({ timeout: 20000 });
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
