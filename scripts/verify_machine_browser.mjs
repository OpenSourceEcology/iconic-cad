// Browser CI uses an original FreeCAD box, not the private source archive.
// npm install --no-save playwright; npx playwright install chromium
// node scripts/verify_machine_browser.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.env.MACHINE_BROWSER_OUTPUT || '/tmp/iconic-machine-browser');
await mkdir(output, { recursive: true });
const fixture = resolve(root, 'tests/fixtures/machines');
const entry = { id: 'test_box', title: 'Test box', family: 'Tooling fixtures', variant: '10x20x30', description: 'Original rectangular test solid.', source_url: 'https://github.com/OpenSourceEcology/iconic-cad', source_revision: 'fixture-v1', license_review: 'pending', validation: { geometry: 'passed', engineering: 'unreviewed' }, bounds_mm: [10,20,30], parts: [{ id: 'box', label: 'Test box', mesh: 'assets/gvcs/test-box/box.mesh.json', brep: 'assets/gvcs/test-box/box.brp', color: '#4f7cac' }] };
const catalog = { version: 1, units: 'mm', entries: [entry], demos: [{ id: 'box_demo', title: 'Test box demo', description: 'Original geometry fixture.', instances: [{ id: 'test-box-1', entry_id: entry.id, position_mm: [0,0,0], rotation_deg: 0 }] }] };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/data/gvcs-machines.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(catalog)); }
    const isFixture = pathname.startsWith('/assets/gvcs/test-box/');
    const base = isFixture ? fixture : resolve(root, 'web');
    const path = resolve(base, isFixture ? pathname.split('/').at(-1) : `.${pathname}`);
    if (!path.startsWith(`${base}/`)) throw new Error('Invalid test path');
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[extname(path)] || 'text/plain';
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': mime }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => { if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
  await page.goto(`${base}/machines.html`);
  await page.waitForFunction(() => document.querySelector('#catalog-status').textContent.includes('1 source entries'));
  const count = async n => page.waitForFunction(n => document.querySelectorAll('#instance-list .instance-item').length === n, n);
  const click = async id => page.locator(`#${id}`).click();
  const save = async stem => { const pending = page.waitForEvent('download'); await click('save-workspace'); const download = await pending; const path = resolve(output, `${stem}.json`); await download.saveAs(path); return { path, value: JSON.parse(await readFile(path, 'utf8')) }; };
  await page.locator('#catalog-filter').fill('no-match'); assert.equal(await page.locator('#catalog-list button').count(), 0);
  await page.locator('#catalog-filter').fill('tooling'); assert.equal(await page.locator('#catalog-list button').count(), 1);
  await page.locator('#demo-list button').click(); await count(1);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#empty-state').isVisible(), false);
  for (const [id, value] of [['position-x','125'],['position-y','-250'],['position-z','75'],['rotation-x','27'],['rotation-y','-35'],['rotation-z','73']]) await page.locator(`#${id}`).fill(value);
  await click('apply-transform');
  let saved = await save('xyz');
  assert.deepEqual(saved.value.instances[0].position_mm, [125,-250,75]);
  assert.equal(saved.value.instances[0].rotation_x_deg, 27); assert.equal(saved.value.instances[0].rotation_y_deg, -35);
  await click('undo-workspace'); assert.equal(await page.locator('#rotation-x').inputValue(), '0');
  await click('redo-workspace'); assert.equal(await page.locator('#rotation-y').inputValue(), '-35');
  await click('duplicate-instance'); await count(2);
  await click('delete-instance'); await count(1);
  await click('undo-workspace'); await count(2);
  await click('redo-workspace'); await count(1);
  await click('new-workspace'); await count(0);
  await click('undo-workspace'); await count(1);
  await page.locator('#load-file').setInputFiles(saved.path); await page.waitForFunction(() => document.querySelector('#message').textContent === 'Machine workspace loaded.');
  const before = await save('before-invalid');
  await page.locator('#load-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"units":"mm","instances":{}}') });
  await page.waitForFunction(() => document.querySelector('#message').textContent.startsWith('Could not load workspace'));
  assert.deepEqual((await save('after-invalid')).value, before.value);
  for (const view of ['front','top','side','iso']) await page.locator(`[data-view="${view}"]`).click();
  await click('fit-view');
  for (const [id, name] of [['export-bom','component-bom.csv'],['export-fcstd','assembly.FCStd']]) { const pending = page.waitForEvent('download'); await click(id); const download = await pending; await download.saveAs(resolve(output,name)); assert((await readFile(resolve(output,name))).length > 100); }
  const fills = await page.evaluate(() => { const a = document.querySelector('#viewport canvas').getBoundingClientRect(), b = document.querySelector('.viewport-panel').getBoundingClientRect(); return Math.abs(a.width-b.width)<2 && Math.abs(a.height-b.height)<2; });
  assert(fills, 'renderer fills viewport');
  await page.screenshot({ path: resolve(output,'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output,'mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no mobile overflow');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  const fallback = await browser.newPage();
  await fallback.route('**/data/gvcs-machines.json', route => route.fulfill({ status: 404, body: '' }));
  await fallback.goto(`${base}/machines.html`);
  await fallback.waitForFunction(() => document.querySelector('#demo-list').textContent.includes('Example assembly'));
  await fallback.locator('#demo-list button').click();
  await fallback.waitForFunction(() => document.querySelectorAll('#instance-list .instance-item').length === 2);
  assert.equal(await fallback.locator('#empty-state').isVisible(), false);
  await fallback.close();
  const invalidCatalog = await browser.newPage();
  await invalidCatalog.route('**/data/gvcs-machines.json', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":999}' }));
  await invalidCatalog.goto(`${base}/machines.html`);
  await invalidCatalog.waitForFunction(() => document.querySelector('#catalog-status').textContent.startsWith('Catalog unavailable'));
  assert.equal(await invalidCatalog.locator('#demo-list button').count(), 0, 'invalid source catalog must not silently fall back');
  await invalidCatalog.close();
  console.log('PASS machine browser: filtering, XYZ, history, legacy demo, save/load, invalid load, views, downloads, responsive viewport, offline assets');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
