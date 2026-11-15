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

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
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
    // 3D view: open it big, try the looks, turn it, tap to place the point.
    const t3 = Date.now();
    await page.getByRole('button', { name: 'Show 3D view' }).click();
    await page.locator('.hero.is3d canvas').waitFor();
    await page.waitForTimeout(800);
    console.log(`3D first picture: ${((Date.now() - t3) / 1000).toFixed(1)} s`);
    await shot(page, '3c-3d-bone.png');
    const b3 = await page.locator('.hero.is3d canvas').boundingBox();
    await page.mouse.move(b3.x + b3.width * 0.5, b3.y + b3.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(b3.x + b3.width * 0.62, b3.y + b3.height * 0.35, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    await shot(page, '3d-3d-turned.png');
    await page.getByRole('group', { name: '3D look' }).getByRole('button', { name: 'Teeth' }).click();
    await page.getByRole('group', { name: '3D look' }).getByRole('button', { name: 'Hide above point' }).click();
    await page.getByRole('group', { name: '3D direction' }).getByRole('button', { name: 'Top' }).click();
    await page.waitForTimeout(600);
    await shot(page, '3e-3d-teeth-top.png');
    await page.getByRole('group', { name: '3D look' }).getByRole('button', { name: 'Skin' }).click();
    await page.getByRole('group', { name: '3D look' }).getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('group', { name: '3D direction' }).getByRole('button', { name: 'Front' }).click();
    await page.waitForTimeout(600);
    await shot(page, '3f-3d-skin.png');
    await page.getByRole('group', { name: '3D look' }).getByRole('button', { name: 'Bone' }).click();
    const before = await page.locator('.readout').textContent();
    await page.mouse.click(b3.x + b3.width * 0.5, b3.y + b3.height * 0.55);
    await page.waitForTimeout(500);
    if ((await page.locator('.readout').textContent()) === before) throw new Error('tap in 3D did not move the point');
    await page.getByRole('button', { name: 'Show Coronal view' }).click();
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
    // Double tap a view to make it fill the grid, again to go back.
    const sag = await page.locator('.grid4 .cell').nth(2).boundingBox();
    await page.mouse.dblclick(sag.x + sag.width / 2, sag.y + sag.height / 2);
    await page.locator('.grid4.focus .cell.focused').waitFor();
    await page.waitForTimeout(300);
    await shot(page, '4b-expert-focus.png');
    const big = await page.locator('.grid4 .cell.focused').boundingBox();
    await page.mouse.dblclick(big.x + big.width / 2, big.y + big.height / 2);
    await page.locator('.grid4:not(.focus)').waitFor();
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
      await page.waitForTimeout(400);
      await page.mouse.click(cs.x + cs.width * 0.5, cs.y + cs.height * 0.62);
      await page.waitForTimeout(450);
    }
    await page.getByRole('button', { name: /^Right \(3\)/ }).waitFor();
    await page.getByRole('button', { name: 'Mark foramen here' }).click();
    await shot(page, '7-nerve.png');
    await page.getByRole('group', { name: 'Task' }).getByRole('button', { name: 'Teeth' }).click();
    await page.mouse.click(pano.x + pano.width * 0.72, pano.y + pano.height * 0.47);
    await page.waitForTimeout(200);
    await page.waitForTimeout(400);
    await page.mouse.click(cs.x + cs.width * 0.5, cs.y + cs.height * 0.5);
    await page.waitForTimeout(900);
    await shot(page, '8-teeth.png');
    const teethBefore = await page.locator('.measure-go').count();
    await page.mouse.dblclick(cs.x + cs.width * 0.5, cs.y + cs.height * 0.5);
    await page.locator('.split.only-b').waitFor();
    await page.waitForTimeout(500);
    if (await page.locator('.measure-go').count() !== teethBefore) throw new Error('double tap also outlined a tooth');
    await shot(page, '8b-cross-big.png');
    const csBig = await page.locator('.split-b canvas').boundingBox();
    await page.mouse.dblclick(csBig.x + csBig.width / 2, csBig.y + csBig.height / 2);
    await page.locator('.split:not(.only-a):not(.only-b)').waitFor();
    // 3D with the outlined tooth and the nerve; tap in 3D moves the cross-section.
    await page.getByRole('button', { name: 'Show 3D view' }).click();
    await page.locator('.hero.is3d canvas').waitFor();
    await page.getByRole('group', { name: '3D look' }).getByRole('button', { name: 'Teeth' }).click();
    await page.waitForTimeout(800);
    await shot(page, '9-3d-tooth-nerve.png');
    await page.getByRole('group', { name: '3D look' }).getByRole('button', { name: 'Outlines only' }).click();
    await page.getByRole('group', { name: '3D direction' }).getByRole('button', { name: 'Top' }).click();
    await page.waitForTimeout(600);
    await shot(page, '9b-3d-outlines.png');
    await page.getByRole('group', { name: '3D look' }).getByRole('button', { name: 'Bone' }).click();
    await page.getByRole('button', { name: 'Back to panoramic and cross-section' }).click();
    await page.locator('.split-a canvas').waitFor();
    console.log('Teeth message:', await page.locator('.side-card .ok-line, .side-card .warn-line').first().textContent().catch(() => 'none'));
    // Step 4: mouth scans, line up by points, fine-tune, check.
    if (process.env.IOS_DIR) {
      await page.getByRole('button', { name: 'Add scans' }).click();
      const t5 = Date.now();
      await page.getByLabel('Lower scan file').setInputFiles(join(process.env.IOS_DIR, 'restoration_lower.obj'));
      await page.getByText(/Lower scan added/).waitFor({ timeout: 60000 });
      console.log(`Lower scan read and saved: ${((Date.now() - t5) / 1000).toFixed(1)} s`);
      await page.getByLabel('Upper scan file').setInputFiles(join(process.env.IOS_DIR, 'restoration_upper.obj'));
      await page.getByText(/Upper scan added/).waitFor({ timeout: 60000 });
      await page.locator('.split-a canvas').waitFor();
      await page.waitForTimeout(800);
      const sv = await page.locator('.split-a canvas').boundingBox();
      const cv = await page.locator('.split-b canvas').boundingBox();
      // Roughly matching spots on the test case: lower incisors, left molar, right premolar.
      const spots = [[[0.53, 0.71], [0.455, 0.79]], [[0.85, 0.35], [0.78, 0.41]], [[0.27, 0.59], [0.21, 0.68]]];
      for (const [[sx, sy], [cx, cy]] of spots) {
        await page.mouse.click(sv.x + sv.width * sx, sv.y + sv.height * sy);
        await page.waitForTimeout(450);
        await page.mouse.click(cv.x + cv.width * cx, cv.y + cv.height * cy);
        await page.waitForTimeout(450);
      }
      await shot(page, '10-scan-points.png');
      await page.getByRole('button', { name: 'Line up (3 pairs)' }).click();
      await page.locator('.thumbs.four canvas').first().waitFor();
      await page.waitForTimeout(800);
      await shot(page, '11-scan-lined-up.png');
      const t6 = Date.now();
      await page.getByRole('button', { name: 'Fine-tune on the teeth' }).click();
      await page.locator('.side-card').getByText(/Fine-tuned|did not settle|Not enough/).waitFor({ timeout: 60000 });
      console.log(`Fine-tune: ${((Date.now() - t6) / 1000).toFixed(1)} s:`, await page.locator('.side-card .ok-line, .side-card .warn-line').last().textContent());
      await page.getByRole('button', { name: 'Show fit colours' }).click();
      await page.waitForTimeout(1200);
      await shot(page, '12-scan-colours.png');
      await page.getByRole('button', { name: 'Check on the coronal slice' }).click();
      await page.waitForTimeout(800);
      await shot(page, '13-scan-coronal.png');
      // Step 5: crown design from contact points.
      await page.getByRole('button', { name: 'Design crowns' }).click();
      await page.locator('.hero canvas').first().waitFor();
      await page.waitForTimeout(1500);
      await shot(page, '14-crowns-pick.png');
      const cb = await page.locator('.hero canvas').first().boundingBox();
      const CONTACTS = JSON.parse(process.env.CONTACTS || '[[0.3,0.5],[0.2,0.5]]');
      const tc = Date.now();
      for (const [x, y] of CONTACTS) { await page.mouse.click(cb.x + cb.width * x, cb.y + cb.height * y); await page.waitForTimeout(600); }
      await page.locator('.side-card').getByText(/placed|too close/).waitFor({ timeout: 30000 });
      console.log('Crown placed in', ((Date.now() - tc) / 1000).toFixed(1), 's:', await page.locator('.side-card .ok-line, .side-card .warn-line').last().textContent());
      await page.waitForTimeout(1200);
      await shot(page, '15-crown-cheek.png');
      await page.getByRole('group', { name: 'Look from' }).getByRole('button', { name: 'Bite' }).click();
      await page.waitForTimeout(1200);
      await shot(page, '16-crown-bite.png');
      await page.getByRole('button', { name: 'Height +' }).click();
      await page.getByRole('button', { name: 'Bite colours' }).click();
      await page.getByRole('group', { name: 'Look from' }).getByRole('button', { name: 'Tongue' }).click();
      await page.waitForTimeout(1200);
      await shot(page, '17-crown-tongue.png');
      // Scan editor: take a tooth out, smooth, build up, cut through, close holes, undo, save.
      await page.getByRole('button', { name: /Edit the scan/ }).click();
      await page.waitForTimeout(1500);
      const eb = await page.locator('.hero canvas').first().boundingBox();
      const at = (fx, fy) => [eb.x + eb.width * fx, eb.y + eb.height * fy];
      const stroke = async (pts) => { const [x0, y0] = at(...pts[0]); await page.mouse.move(x0, y0); await page.mouse.down(); for (const q of pts.slice(1)) { const [x, y] = at(...q); await page.mouse.move(x, y, { steps: 8 }); } await page.mouse.up(); await page.waitForTimeout(400); };
      const tool = (n) => page.getByRole('group', { name: 'Scan tool' }).getByRole('button', { name: n }).click();
      await tool('Take a tooth out');
      await page.mouse.click(...at(0.343, 0.626));
      await page.getByRole('button', { name: 'Take this tooth out' }).waitFor({ timeout: 20000 });
      await page.waitForTimeout(600);
      await shot(page, '18-extract-preview.png');
      let t7 = Date.now();
      await page.getByRole('button', { name: 'Take this tooth out' }).click();
      await page.locator('.side-card').getByText(/Tooth taken out/).waitFor({ timeout: 60000 });
      console.log(`Take a tooth out: ${((Date.now() - t7) / 1000).toFixed(1)} s`);
      await page.waitForTimeout(800);
      await shot(page, '19-extracted.png');
      await tool('Smooth');
      t7 = Date.now();
      await stroke([[0.30, 0.60], [0.36, 0.64], [0.40, 0.60], [0.33, 0.57]]);
      console.log(`Smooth stroke: ${((Date.now() - t7) / 1000).toFixed(1)} s`);
      await tool('Build up');
      await page.getByRole('group', { name: 'Brush size' }).getByRole('button', { name: 'Brush size L' }).click();
      t7 = Date.now();
      for (let k = 0; k < 3; k++) await stroke([[0.25, 0.42], [0.27, 0.50], [0.25, 0.42]]);
      console.log(`Build-up strokes: ${((Date.now() - t7) / 1000).toFixed(1)} s`);
      await page.getByRole('button', { name: 'Show changes' }).click();
      await page.waitForTimeout(1200);
      await shot(page, '20-edit-changes.png');
      await page.getByRole('button', { name: 'Show changes' }).click();
      await tool('Cut out');
      await page.getByRole('group', { name: 'Brush size' }).getByRole('button', { name: 'Brush size M' }).click();
      await stroke([[0.265, 0.46], [0.27, 0.48]]);
      await shot(page, '20b-edit-cut-red.png');
      await page.getByRole('button', { name: 'Cut through' }).click();
      await page.waitForTimeout(800);
      await tool('Close holes');
      console.log('Holes:', await page.locator('.side-card .stat').first().textContent());
      await shot(page, '21-edit-hole.png');
      await page.getByRole('button', { name: 'Close all small holes' }).click();
      await page.locator('.side-card').getByText(/closed/).waitFor({ timeout: 20000 });
      await page.waitForTimeout(800);
      await shot(page, '21b-edit-closed-now.png');
      await page.getByRole('button', { name: 'Undo' }).click();
      await page.getByRole('button', { name: 'Redo' }).click();
      await page.waitForTimeout(800);
      await shot(page, '22-edit-closed.png');
      await page.getByRole('button', { name: 'Save scan' }).click();
      await page.locator('.side-card').getByText(/Scan saved|could not be saved/).waitFor({ timeout: 60000 });
      console.log('Editor:', await page.locator('.side-card .ok-line, .side-card .warn-line').last().textContent());
    }
    // Reopen from the case list: volume should come back from the cache.
    await page.getByRole('button', { name: 'Back to cases' }).click();
    await page.getByRole('button', { name: /Open case Test Patient/ }).click();
    await page.locator('.hero canvas').first().waitFor({ timeout: 20000 });
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
