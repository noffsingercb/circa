/** Browser-level regression for the chromeless route and real iframe height beacon.
 * All historical/geocoder responses are deterministic local mocks. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4173;
const base = `http://127.0.0.1:${port}`;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  env: { ...process.env, VITE_CIRCA_API: 'https://api.ci.invalid' },
  stdio: 'pipe',
});
let log = '';
server.stdout.on('data', (chunk) => { log += chunk; });
server.stderr.on('data', (chunk) => { log += chunk; });
const event = (id, date, extra = {}) => ({
  id, title: id, displayTitle: id, blurb: null, date: date.slice(0,4), dateStartISO: date,
  dateEndISO: date, displayDateISO: date, precision: 'year', displayPrecision: 'year',
  lat: 38, lng: -104, distanceKm: 1, reachKm: 100, scope: 'national', tier: 'national',
  phase: null, significance: 0.9, category: 'event', sourceUrl: null, segmentIndex: 0, score: 0.9,
  ...extra,
});
const entries = [event('Early history', '1940-01-01'), event('Middle history', '1980-01-01'),
  event('Cold War', '1947-03-12', { date: '1991', dateEndISO: '1991-12-26', displayDateISO: '1991-12-26', phase: 'ends' })];
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
let browser;
try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(`Vite exited early:\n${log}`);
    try { const r = await fetch(base); if (r.ok) break; } catch { /* startup */ }
    if (i >= 100) throw new Error(`Vite did not start:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext();
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith(`${base}/__fixture-host`)) {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><iframe id="circa" src="/embed" style="width:900px;height:300px"></iframe><script>window.heights=[];window.addEventListener('message',e=>{if(e.data?.type==='circa:height'){window.heights.push(e.data.height);document.querySelector('iframe').style.height=e.data.height+'px'}})</script>` });
    }
    if (url.startsWith('https://photon.komoot.io/api')) {
      return route.fulfill({ json: { features: [{ geometry: { coordinates: [-104.6091, 38.2544] }, properties: { name: 'Pueblo', state: 'Colorado', country: 'United States', type: 'city' } }] }, headers: cors });
    }
    if (url.startsWith('https://api.ci.invalid/')) {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (url.endsWith('/v1/health')) return route.fulfill({ json: { ok: true }, headers: cors });
      if (url.endsWith('/v1/timeline')) return route.fulfill({ json: { datasetVersion: 'test', generatedWith: 'test', entries, meta: { segmentCount: 1, totalMatched: 3, returned: 3 } }, headers: cors });
    }
    return route.continue();
  });
  async function fillAndRun(pageOrFrame) {
    const rows = pageOrFrame.locator('form .row');
    for (const [index, year] of [[0, '1935'], [1, '2000']]) {
      const row = rows.nth(index);
      await row.getByLabel('Place').fill('Pueblo');
      await row.locator('.suggestions button').first().click();
      await row.getByLabel('Year').fill(year);
    }
    await pageOrFrame.getByRole('button', { name: 'Build the timeline' }).click();
    await pageOrFrame.locator('ol.timeline').waitFor();
  }
  const standalone = await context.newPage();
  await standalone.goto(base);
  await fillAndRun(standalone);
  const expected = (await standalone.locator('ol.timeline > li.row').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim());
  assert.equal(expected.length, 5, 'standalone must include three history and two life cards');
  assert.match(expected[0], /1935.*Born/);
  assert.match(expected[3], /1991.*Cold War/);
  const host = await context.newPage();
  await host.goto(`${base}/__fixture-host`);
  const frame = host.frameLocator('#circa');
  await host.waitForFunction(() => window.heights.length > 0);
  const before = await host.evaluate(() => window.heights.length);
  await fillAndRun(frame);
  const actual = (await frame.locator('ol.timeline > li.row').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim());
  assert.deepEqual(actual, expected, 'embed must render the same life and history rows in the same order');
  await host.waitForFunction((n) => window.heights.length > n, before);
  const height = await host.evaluate(() => window.heights.at(-1));
  assert.ok(Number.isFinite(height) && height > 300, `expected a useful height beacon, received ${height}`);
  await frame.locator('form .row').first().getByLabel('Year').fill('1940');
  assert.deepEqual((await frame.locator('ol.timeline > li.row').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim()), actual, 'editing the form must not mutate the displayed snapshot');
  console.log(`PASS: iframe and standalone parity, ${actual.length} rows, 1991 bookend, snapshot isolation, and ${height}px height beacon`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
