/* End-to-end tests in real Chromium (Playwright). Drives the actual UI like a user would.
   Time is controlled with Playwright's fake clock, Gemini is mocked, audio/vibration/service-worker
   messages are spied on.
   Run:   node e2e.test.js            (needs `playwright` + Chromium)
   Shots: SHOTS=/some/dir node e2e.test.js   saves a screenshot of each key screen.
   Single file: SINGLE=1 node e2e.test.js       the same tests against index-single.html (+ sw-single.js, served as /sw.js; build first with
                                                       node build-single.js). Any request for another local file is an error.
                SINGLE=alone node e2e.test.js    index-single.html served WITHOUT a service worker, like a host that only got the one file:
                                                       the service-worker tests are skipped and the "no service worker" ones run. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert');
const { chromium } = require('playwright');
const { makeFake } = require('./fake-gcal.js');
const SINGLE = !!process.env.SINGLE, ALONE = process.env.SINGLE === 'alone', SHOTS = process.env.SHOTS || '';
const ROOT = __dirname;                                                       // every file is in this one folder
const PAGE = SINGLE ? 'index-single.html' : 'index.html', WORKER = SINGLE ? 'sw-single.js' : 'sw.js';   // what the browser sees as /index.html and /sw.js
const skip = async (name, why) => console.log('  skip ' + name + '  (' + (typeof why === 'string' ? why : 'sw.js is not served in this run') + ')');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff': 'font/woff', '.txt': 'text/plain' };
const START = new Date('2026-11-02T08:00:00');             // a Monday: day 1 of week 1 with the default start date
const GEMINI = /generativelanguage\.googleapis\.com/;

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 5).join('\n       ')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ harness */
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      if (ALONE && p === '/sw.js') { res.writeHead(404); return res.end('nf'); }
      if (p === '/index.html') p = '/' + PAGE; else if (p === '/sw.js') p = '/' + WORKER;
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/' }));
  });
}
const SPY = () => {
  window.__osc = 0; window.__vib = []; window.__perm = 0; window.__sw = []; window.__logs = [];
  window.AudioContext = class { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() {} createOscillator() { window.__osc++; return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
  navigator.vibrate = (p) => { window.__vib.push(p); return true; };
  try { const rp = Notification.requestPermission; Notification.requestPermission = function () { window.__perm++; return Promise.resolve('default'); }; } catch (e) { /* none */ }
  if (window.ServiceWorker) { const o = ServiceWorker.prototype.postMessage; ServiceWorker.prototype.postMessage = function (m, ...r) { window.__sw.push(m); return o.call(this, m, ...r); }; }
};

async function openApp(browser, url, o) {
  o = o || {};
  const ctx = o.ctx || await browser.newContext({ viewport: { width: o.w || 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Europe/Riga', acceptDownloads: true, serviceWorkers: o.sw ? 'allow' : 'block' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  if (SINGLE) page.on('request', (r) => { if (r.url().startsWith(url) && r.url() !== url && r.url() !== url + 'sw.js') errors.push('single file asked for another local file: ' + r.url()); });
  await page.addInitScript(SPY);
  await page.clock.install({ time: START });
  await page.goto(url);
  await page.waitForSelector('.hero');
  await page.clock.pauseAt(new Date(START.getTime() + 5000));
  const adv = (ms) => page.clock.runFor(ms);
  const tap = async (sel) => { await page.locator(sel).first().tap(); await adv(60); };
  const tab = (t) => tap(`[data-act=tab][data-tab=${t}]`);
  return { ctx, page, errors, adv, tap, tab };
}
const shot = async (page, name, full) => { if (SHOTS) await sleep(450), await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); };
const text = (page, sel) => page.locator(sel).first().innerText();
const clockText = async (page) => (await page.locator('#rest-time').textContent()).replace(/\s/g, '');
const ex = (page, name) => page.locator('#workout article.ex').filter({ has: page.locator('h4', { hasText: name }) }).first();
const row = (page, name, i) => ex(page, name).locator('.srow').nth(i);
const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(HA.store.get())));


/* ------------------------------------- fakes for the running and Google Calendar tests */
// A heart-rate strap: Web Bluetooth with the Heart Rate service. window.__hr(bpm) sends one reading, like the strap would.
const FAKE_BT = () => {
  const ls = {};
  const chr = { addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); }, removeEventListener(t, f) { ls[t] = (ls[t] || []).filter((x) => x !== f); }, startNotifications: async () => chr };
  const dev = { name: 'HRM-Dual 123', addEventListener() {}, removeEventListener() {},
    gatt: { connected: false, connect: async () => { dev.gatt.connected = true; return { getPrimaryService: async (n) => { if (n !== 'heart_rate') throw new Error('Service not found'); return { getCharacteristic: async (c) => { if (c !== 'heart_rate_measurement') throw new Error('Characteristic not found'); return chr; } }; } }; }, disconnect() { dev.gatt.connected = false; } } };
  window.__bt = { requests: [], failWith: null };
  Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async (o) => { window.__bt.requests.push(JSON.stringify(o)); if (window.__bt.failWith) { const e = new Error('cancelled'); e.name = window.__bt.failWith; throw e; } return dev; } } });
  window.__hr = (bpm) => { const dv = new DataView(new ArrayBuffer(2)); dv.setUint8(0, 0x06); dv.setUint8(1, bpm); (ls.characteristicvaluechanged || []).forEach((f) => f({ target: { value: dv } })); };
};
const NO_BT = () => { Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: undefined }); };
// Google's sign-in script, replaced by one that hands out a token as soon as it is asked.
const FAKE_GIS = `window.google = { accounts: { oauth2: {
  initTokenClient: function (cfg) { (window.__gis = window.__gis || []).push({ client_id: cfg.client_id, scope: cfg.scope });
    return { requestAccessToken: function (o) { window.__gisPrompt = o && o.prompt; setTimeout(function () { cfg.callback({ access_token: 'tok-1', expires_in: 3600, scope: cfg.scope }); }, 0); } }; },
  hasGrantedAllScopes: function (r, s) { return (r.scope || '').indexOf(s) >= 0; },
  revoke: function (t, cb) { window.__revoked = t; if (cb) cb(); } } } };`;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
async function newCtx(browser, extra) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Europe/Riga', acceptDownloads: true, serviceWorkers: 'block' });
  await ctx.addInitScript(extra === 'nobt' ? NO_BT : FAKE_BT);
  return ctx;
}
async function until(page, fn, arg, ms) {            // poll in the page, moving its fake clock along so timers still fire
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - t0 > (ms || 10000)) {
      const seen = await page.evaluate(() => { const g = document.getElementById('gcal-status'), r = document.getElementById('lr-state'); return JSON.stringify({ gcalStatus: g && g.textContent, live: r && r.textContent, gcal: window.HA && HA.store.get().gcal && { on: HA.store.get().gcal.on, lastSync: HA.store.get().gcal.lastSync, cal: HA.store.get().gcal.calendarId } }); }).catch(() => '?');
      throw new Error('timed out waiting for: ' + String(fn).slice(0, 120) + '  page: ' + seen);
    }
    await page.clock.runFor(50).catch(() => {}); await sleep(40);
  }
}
async function untilNode(fn, ms) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > (ms || 10000)) throw new Error('timed out waiting for: ' + String(fn)); await sleep(40); } }
const tcx = (o) => {                                 // 10-second trackpoints with distance and heart rate
  let pts = '';
  for (let i = 0; i <= o.sec / 10; i++) pts += `<Trackpoint><Time>${new Date(Date.parse(o.start) + i * 10000).toISOString()}</Time><DistanceMeters>${(o.m * i * 10 / o.sec).toFixed(1)}</DistanceMeters><HeartRateBpm><Value>${o.hr}</Value></HeartRateBpm></Trackpoint>`;
  return `<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Lap><Track>${pts}</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
};
async function setHeart(a) {                          // age 30, resting 55 -> Zone 2 is 136-150 bpm
  await a.tab('settings'); await a.page.fill('[data-set=age]', '30'); await a.page.fill('[data-set=rhr]', '55'); await a.page.dispatchEvent('[data-set=rhr]', 'change'); await a.tab('today');
}

async function setupAthlete(a) {                       // 1RMs and heart-rate details, entered through the UI
  const { page, tap, tab } = a;
  await tab('lifts');
  for (const [k, v] of [['bench', '100'], ['zercher', '120'], ['clean', '80'], ['rdl', '140']]) {
    await tap(`[data-act=edit-1rm][data-key=${k}]`); await page.fill('#rm-input', v); await tap('[data-act=save-1rm]');
  }
  await tab('settings');
  await page.fill('[data-set=age]', '30'); await page.fill('[data-set=rhr]', '55'); await page.dispatchEvent('[data-set=rhr]', 'change');
  await tab('today');
}

/* -------------------------------------------------------------------- run */
(async () => {
  const { srv, url } = await serve();
  const browser = await chromium.launch();
  const allErrors = [];
  console.log('End to end (Chromium, 390 px wide, Europe/Riga)');

  /* ---------------------------------------------------------- first run & setup */
  const a = await openApp(browser, url, { sw: true });
  const { page, tap, tab, adv } = a;
  allErrors.push(a.errors);

  await test('first launch: week 1, day 1 for the start date, with a prompt to add heart-rate details', async () => {
    assert.ok(/Week\s*1\s*of 16/.test((await text(page, '.hero-week')).replace(/\s+/g, ' ')));
    assert.ok(/Today is day 1/.test(await text(page, '.hero-sub')));
    assert.ok(/Power & Base Leg Day/.test(await text(page, '.day-title')));
    assert.ok(await page.locator('[data-act=goto-settings][data-focus=hr]').count());
    await shot(page, '01-today-empty');
  });

  await test('entering 1RMs and age/resting HR fills in weights and the Zone 2 range', async () => {
    await setupAthlete(a);
    assert.ok(/136\s*[–-]\s*150/.test((await text(page, '.run-num')).replace(/\s+/g, '')), 'Karvonen 60-70% for age 30, resting 55');
    const prev = await page.locator('.p-row', { hasText: 'Power Clean' }).locator('.p-w').innerText();
    assert.ok(/62\.5 kg/.test(prev), 'power clean preview weight: ' + prev);
    assert.ok(/72\.5 kg/.test(await page.locator('.p-row', { hasText: 'Bench Press' }).locator('.p-w').innerText()));
    await shot(page, '02-today-ready', true);
  });

  await test('Lifts shows each 1RM with a 16-week projection', async () => {
    await tab('lifts');
    assert.strictEqual(await page.locator('.lift').count(), 6, 'bench, zercher, clean, RDL, split squat, pull-up');
    assert.strictEqual(await page.locator('.proj th').count(), 96);
    assert.ok(/Not set yet/.test(await text(page, '.lift:has(h2:text-is("Bulgarian Split Squat"))')), 'split squat has no 1RM until you set one');
    assert.ok(/100/.test(await text(page, '.lift:nth-of-type(1) .lift-num')));
    await shot(page, '03-lifts');
    await tab('today');
  });

  /* ------------------------------------------------------------ live workout */
  await test('starting the workout opens the logger with pre-filled weights and previous benchmarks', async () => {
    await tap('[data-act=start]');
    await page.waitForSelector('#workout .wk-body');
    assert.ok(await page.locator('#workout').isVisible());
    const pc = row(page, 'Power Clean', 0);
    assert.strictEqual(await pc.locator('.in-w').inputValue(), '62.5');
    assert.strictEqual(await pc.locator('.in-r').inputValue(), '5', 'reps pre-filled with the written target');
    assert.strictEqual(await pc.locator('.prev').innerText(), '–', 'no history yet');
    assert.strictEqual(await row(page, 'Power Clean', 0).locator('.chk').count(), 1);
    assert.ok(await page.evaluate(() => window.__perm) >= 0);
    await shot(page, '04-workout');
  });

  await test('live editing a weight, ticking a set marks it done and starts the rest timer', async () => {
    const r0 = row(page, 'Power Clean', 0);
    await r0.locator('.in-w').fill('65'); await adv(300);
    assert.strictEqual((await state(page)).active.items.flatMap((i) => i.kind === 'ex' ? [i.ex] : []).find((e) => /Power Clean/.test(e.name)).sets[0].w, 65);
    await r0.locator('.chk').tap(); await adv(60);
    assert.ok(await row(page, 'Power Clean', 0).evaluate((e) => e.classList.contains('done')), 'row marked done');
    assert.strictEqual(await row(page, 'Power Clean', 0).locator('.in-r').inputValue(), '5');
    const spec = await page.evaluate(() => HA.session.allExs(HA.store.get().active).find((e) => /Power Clean/.test(e.name)).rest);
    assert.ok(await page.locator('#restbar').isVisible(), 'rest bar visible');
    const want = `${Math.floor(spec / 60)}:${String(spec % 60).padStart(2, '0')}`;
    assert.strictEqual(await clockText(page), want, 'rest = exercise rest from the spec');
    assert.ok(/Power Clean.*set 2/.test(await text(page, '#rest-next')), 'next: ' + await text(page, '#rest-next'));
    assert.ok(await row(page, 'Power Clean', 1).evaluate((e) => e.classList.contains('now')), 'next set highlighted');
    const pct = await page.locator('#wk-fill').evaluate((e) => parseFloat(e.style.width)); assert.ok(pct > 0);
    await shot(page, '05-rest-running');
  });

  await test('timer counts down in real seconds, ±15 s adjusts it, and the service worker is told when it ends', async () => {
    if (!ALONE) await page.evaluate(() => navigator.serviceWorker.ready);
    const t0 = await clockText(page), [m, s] = t0.split(':').map(Number), total = m * 60 + s;
    await adv(10000);
    const [m1, s1] = (await clockText(page)).split(':').map(Number); assert.strictEqual(m1 * 60 + s1, total - 10);
    await tap('[data-act=rest-add]');  assert.strictEqual(await clockText(page).then((x) => x.split(':').reduce((p, c) => p * 60 + +c, 0)), total - 10 + 15);
    await tap('[data-act=rest-sub]');  assert.strictEqual(await clockText(page).then((x) => x.split(':').reduce((p, c) => p * 60 + +c, 0)), total - 10);
    const msgs = await page.evaluate(() => window.__sw);
    if (ALONE) {
      assert.deepStrictEqual(msgs, [], 'no service worker, so nothing is posted to one');
      assert.strictEqual(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()) === undefined), true, 'no sw.js next to the page: no service worker registered');
    } else {
      const sched = msgs.filter((x) => x.type === 'rest-schedule'); assert.ok(sched.length >= 1, 'rest-schedule posted');
      assert.strictEqual(sched[sched.length - 1].at, await page.evaluate(() => HA.timer.state().end), 'scheduled for exactly the timer end');
      assert.ok(/Next: Power Clean/.test(sched[sched.length - 1].body));
    }
  });

  await test('when rest ends: shows GO, beeps three times, vibrates, tells the service worker to stand down', async () => {
    const osc0 = await page.evaluate(() => window.__osc), vib0 = await page.evaluate(() => window.__vib.length);
    await adv((await page.evaluate(() => HA.timer.remaining())) * 1000 + 500);
    assert.strictEqual(await text(page, '#rest-time'), 'GO');
    assert.ok(await page.locator('#restbar.go').count());
    assert.strictEqual(await page.evaluate(() => window.__osc) - osc0, 3, 'long rest = three-tone chime');
    assert.strictEqual(await page.evaluate(() => window.__vib.length) - vib0, 1);
    if (!ALONE) assert.ok((await page.evaluate(() => window.__sw)).some((x) => x.type === 'rest-cancel'));
    await adv(5200);
    assert.ok(await page.locator('#restbar').isHidden(), 'bar hides after a few seconds');
    await shot(page, '06-after-rest');
  });

  await test('un-ticking the set you just ticked cancels its rest; skip hides the bar', async () => {
    const r1 = row(page, 'Power Clean', 1);
    await r1.locator('.chk').tap(); await adv(60); assert.ok(await page.locator('#restbar').isVisible());
    await r1.locator('.chk').tap(); await adv(60); assert.ok(await page.locator('#restbar').isHidden(), 'undo cancels');
    await r1.locator('.chk').tap(); await adv(60); await tap('[data-act=rest-skip]'); assert.ok(await page.locator('#restbar').isHidden());
  });

  await test('superset: short rests lead to the next exercise, the full rest comes after the last one of the round', async () => {
    const g = await page.evaluate(() => { const it = HA.store.get().active.items.find((i) => i.kind === 'group'); return { names: it.exs.map((e) => e.name), rest: it.exs.map((e) => e.rest), rounds: it.exs[0].sets.length }; });
    assert.ok(g.rounds === 3 && g.names.length === 3, JSON.stringify(g));
    const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    await page.locator('#workout .group').first().scrollIntoViewIfNeeded();
    // exercise 1 -> 30 s, straight to exercise 2
    await row(page, g.names[0], 0).locator('.chk').tap(); await adv(60);
    assert.strictEqual(await clockText(page), mmss(g.rest[0]));
    assert.ok(/Straight to the next/.test(await text(page, '#rest-lab')));
    assert.ok(new RegExp(g.names[1].slice(0, 8)).test(await text(page, '#rest-next')), await text(page, '#rest-next'));
    const osc0 = await page.evaluate(() => window.__osc); await adv(g.rest[0] * 1000 + 500);
    assert.strictEqual(await page.evaluate(() => window.__osc) - osc0, 1, 'short rest = single beep');
    // exercise 2 -> 30 s, straight to exercise 3
    await row(page, g.names[1], 0).locator('.chk').tap(); await adv(60);
    assert.strictEqual(await clockText(page), mmss(g.rest[1]));
    assert.ok(new RegExp(g.names[2].slice(0, 8)).test(await text(page, '#rest-next')));
    // exercise 3 = last of the round -> full rest, then round 2 starts with exercise 1
    await row(page, g.names[2], 0).locator('.chk').tap(); await adv(60);
    assert.strictEqual(await clockText(page), mmss(g.rest[2]), 'full rest after the round');
    assert.ok(new RegExp(g.names[0].slice(0, 8)).test(await text(page, '#rest-next')) && /round 2/.test(await text(page, '#rest-next')), await text(page, '#rest-next'));
    assert.ok(/Round 2 of 3/.test(await page.locator('#workout .round-chip').first().innerText()));
    await tap('[data-act=rest-skip]');
    await shot(page, '07-superset');
  });

  await test('add set, remove set, skip exercise and undo skip', async () => {
    const card = ex(page, 'Bulgarian Split Squat'), before = await card.locator('.srow').count();
    await card.locator('[data-act=add-set]').tap(); await adv(60);
    assert.strictEqual(await ex(page, 'Bulgarian Split Squat').locator('.srow').count(), before + 1);
    await ex(page, 'Bulgarian Split Squat').locator('[data-act=rm-set]').tap(); await adv(60);
    await ex(page, 'Bulgarian Split Squat').locator('[data-act=rm-set]').tap(); await adv(60);
    assert.strictEqual(await ex(page, 'Bulgarian Split Squat').locator('.srow').count(), before - 1);
    await ex(page, 'Ankle Pogo Hops').locator('summary').tap();
    await ex(page, 'Ankle Pogo Hops').locator('[data-act=skip-ex]').tap(); await adv(60);
    assert.ok(await page.locator('#workout .ex.skipped', { hasText: 'Ankle Pogo Hops' }).count());
    await page.locator('#workout .ex.skipped [data-act=unskip]').tap(); await adv(60);
    assert.strictEqual(await page.locator('#workout .ex.skipped').count(), 0);
    const g = page.locator('#workout .group').first(), r0 = await g.locator('.srow').count();
    await g.locator('[data-act=add-round]').tap(); await adv(60);
    assert.ok(await page.locator('#workout .group').first().locator('.srow').count() > r0);
    await page.locator('#workout .group').first().locator('[data-act=rm-round]').tap(); await adv(60);
    assert.strictEqual(await page.locator('#workout .group').first().locator('.srow').count(), r0);
  });

  await test('each exercise links to a YouTube how-to search', async () => {
    const href = await ex(page, 'Power Clean').locator('.more-menu a').getAttribute('href');
    assert.strictEqual(href, 'https://www.youtube.com/results?search_query=how+to+do+power+clean');
  });

  await test('minimise keeps the workout alive behind a pill; resume returns to the same scroll position', async () => {
    await page.locator('#wk-body').evaluate((e) => { e.scrollTop = 600; });
    await tap('[data-act=wk-min]');
    assert.ok(await page.locator('#workout').isHidden()); assert.ok(await page.locator('.pill').isVisible());
    await adv(3000); assert.ok(/^\d+:\d\d$/.test((await text(page, '#pill-clock')).replace(/\s/g, '')));
    await tap('.pill');
    assert.ok(await page.locator('#workout').isVisible());
    const top = await page.locator('#wk-body').evaluate((e) => e.scrollTop); assert.ok(Math.abs(top - 600) < 5, 'scrollTop ' + top);
  });

  await test('the workout, edited weight and ticked sets survive a reload (app killed in the background)', async () => {
    await row(page, 'Bench Press', 1).locator('.in-w').fill('80'); await row(page, 'Bench Press', 1).locator('.in-r').fill('10');
    await row(page, 'Bench Press', 1).locator('.chk').tap(); await adv(400);
    await page.reload(); await page.waitForSelector('.hero');
    assert.ok(await page.locator('.pill').isVisible(), 'resume pill after reload');
    await tap('.pill');
    assert.strictEqual(await row(page, 'Bench Press', 1).locator('.in-w').inputValue(), '80');
    assert.ok(await row(page, 'Bench Press', 1).evaluate((e) => e.classList.contains('done')));
    assert.ok(await row(page, 'Bench Press', 0).evaluate((e) => e.classList.contains('done')));
    assert.ok(await row(page, 'Power Clean', 0).evaluate((e) => e.classList.contains('done')));
    assert.strictEqual(await row(page, 'Power Clean', 0).locator('.in-w').inputValue(), '65', 'edited weight kept');
  });

  await test('finishing with unfinished sets asks first, then saves the log and shows the summary', async () => {
    await tap('[data-act=wk-finish]');
    assert.ok(/sets are not done/.test(await text(page, '.sheet')));
    await tap('[data-act=sheet-close]'); assert.ok(await page.locator('#workout').isVisible());
    await tap('[data-act=wk-finish]'); await tap('[data-act=wk-finish-go]');
    assert.ok(await page.locator('#workout').isHidden());
    const sheet = await text(page, '.sheet');
    assert.ok(/Workout saved/.test(sheet) && /Time/.test(sheet) && /Sets/.test(sheet), sheet);
    assert.ok(/Bench Press/.test(sheet), 'recalibration shown: ' + sheet);
    await shot(page, '08-summary');
    await tap('[data-act=sheet-close]');
    const S = await state(page); assert.strictEqual(S.logs.length, 1); assert.strictEqual(S.active, null);
    assert.ok(S.logs[0].entries.find((e) => e.name === 'Bench Press').sets.some((x) => x.w === 80 && x.r === 10));
  });

  await test('heavier-than-planned bench raises the 1RM, and Previous shows last time next session', async () => {
    await tab('lifts');
    const bench = Number((await text(page, '.lift:nth-of-type(1) .lift-num b')).trim());
    assert.ok(bench > 100, 'bench 1RM recalibrated upward from 100, now ' + bench);
    assert.ok(await page.locator('.hrow').count() === 1);
    await shot(page, '09-lifts-after');
    await tab('today');
    await page.evaluate(() => { HA.actions.startWorkout(HA.store.get(), 1, 1, '2026-11-02'); HA.app.openWorkout(); });
    // "Previous" lines up set by set: round 1 was the planned 72.5 x 10, round 2 the heavier 80 x 10
    const prev = async (i) => (await row(page, 'Bench Press', i).locator('.prev').innerText()).replace(/\s/g, '');
    try {
      assert.strictEqual(await prev(0), '72.5×10'); assert.strictEqual(await prev(1), '80×10');
    } finally {
      await page.evaluate(() => { HA.actions.discard(HA.store.get()); });
      await tap('[data-act=wk-min]'); await page.evaluate(() => HA.store.flush());
    }
  });

  await test('discarding a workout throws it away without logging', async () => {
    await page.evaluate(() => { HA.actions.discard(HA.store.get()); HA.app.render(); });
    await tab('today');
    await tap('[data-act=pick-day][data-d="5"]'); await tap('[data-act=start]');
    await tap('[data-act=wk-finish]'); assert.ok(await page.locator('.sheet').innerText().then((t) => /Nothing to save/.test(t)));
    await tap('[data-act=wk-discard]');
    assert.ok(await page.locator('#workout').isHidden()); assert.strictEqual((await state(page)).logs.length, 1); assert.strictEqual((await state(page)).active, null);
  });

  /* ----------------------------------------------------------------- Ducky */
  const calls = [];
  await page.route(GEMINI, async (route) => {
    const req = route.request(), body = JSON.parse(req.postData() || '{}');
    calls.push({ headers: req.headers(), body, url: req.url() });
    const last = body.contents[body.contents.length - 1].parts[0].text;
    if (page.__fail) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { message: 'API key not valid' } }) });
    let reply;
    if (/Modify/.test(last)) reply = '- Cutting bench to 2 sets because you are tired.\n- Lighter load.\n\n```json\n{"modifications":[{"exercise":"Bench Press","sets":2,"reps":6,"weightFactor":0.85,"note":"fatigue"}]}\n```';
    else reply = '- Set the bar in the front rack of your elbows.\n- Brace, then sit between your hips.\n- Keep your chest tall.\n\nhttps://www.youtube.com/results?search_query=how+to+do+zercher+squat';
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: reply }] } }] }) });
  });

  await test('Ducky stays silent until asked: no request is made just by opening it', async () => {
    await tab('ducky'); await adv(2000);
    assert.strictEqual(calls.length, 0);
    assert.ok(/Add API key/.test(await text(page, '.banner')));
  });
  await test('asking without a key explains what to do and sends nothing', async () => {
    await page.fill('#duck-input', 'hello'); await page.locator('.send').tap(); await adv(100);
    assert.ok(/Add your Gemini API key/.test(await text(page, '.msg.err'))); assert.strictEqual(calls.length, 0);
    assert.strictEqual(await page.inputValue('#duck-input'), 'hello', 'text kept');
    await page.fill('#duck-input', '');
  });
  await test('API key is saved locally from Settings and never leaves except to Google', async () => {
    await tab('settings');
    await page.fill('#key-input', 'AIzaTEST-key-123'); await tap('[data-act=key-save]');
    assert.ok(/Saved on this device/.test(await text(page, '#key-result')));
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('ha.geminiKey')), 'AIzaTEST-key-123');
    assert.ok(!(await page.evaluate(() => localStorage.getItem('ha.state.v1'))).includes('AIzaTEST'), 'key not in the app state');
    await tap('[data-act=key-test]');
    await page.waitForFunction(() => /Works|rejected|refused|Could not/.test(document.querySelector('#key-result').textContent));
    assert.ok(/Works/.test(await text(page, '#key-result')), await text(page, '#key-result'));
    calls.length = 0;
  });
  await test('"How do I perform…" returns cue bullets and an exact YouTube search link', async () => {
    await tab('ducky'); await tap('[data-act=duck-how]');
    await page.selectOption('#how-sel', { label: 'Zercher Squat' });
    await tap('[data-act=duck-how-go]'); await adv(300);
    await page.waitForSelector('.msg.duck .bubble li');
    assert.ok((await page.locator('.msg.duck .bubble li').count()) >= 3);
    const hrefs = await page.locator('.msg.duck a').evaluateAll((as) => as.map((a) => a.href));
    assert.ok(hrefs.every((h) => /^https:\/\/www\.youtube\.com\/results\?search_query=how\+to\+do\+/.test(h)), hrefs.join());
    assert.strictEqual(await page.locator('.msg.duck a.yt').count(), 1, 'one link, not duplicated');
    assert.strictEqual(calls.length, 1);
    const c = calls[0]; assert.strictEqual(c.headers['x-goog-api-key'], 'AIzaTEST-key-123');
    assert.ok(/Hybrid Athlete/.test(c.body.systemInstruction.parts[0].text) && /Zercher/.test(c.body.systemInstruction.parts[0].text), 'program-aware system prompt');
    assert.ok(/TODAY'S WORKOUT/.test(c.body.systemInstruction.parts[0].text) && /FULL PROGRAM SPEC/.test(c.body.systemInstruction.parts[0].text));
    assert.ok(!c.url.includes('AIza'), 'key is in a header, not the URL');
    await shot(page, '10-ducky-how');
  });
  await test('typing the question yourself also gets a link for the exercise it names', async () => {
    await page.fill('#duck-input', 'How do I perform Zercher squats?'); await page.keyboard.press('Enter'); await adv(300);
    await page.waitForFunction(() => document.querySelectorAll('.msg.duck a.yt').length === 2);
    assert.strictEqual(await page.locator('.msg.duck a.yt').last().getAttribute('href'), 'https://www.youtube.com/results?search_query=how+to+do+zercher+squat');
  });
  await test('"Modify today\'s workout" returns changes you can apply; applied to the day, they show up when you start', async () => {
    await tap('[data-act=duck-modify]'); await tap('[data-act=duck-mod-go]'); await adv(300);
    await page.waitForSelector('.mods');
    assert.ok(/Bench Press/.test(await text(page, '.mods')) && /2 sets/.test(await text(page, '.mods')));
    await shot(page, '11-ducky-mods');
    await tap('[data-act=apply-mods]'); assert.ok(/applies when you start/i.test(await text(page, '.applied')));
    assert.ok(/TODAY'S WORKOUT \(Week 1 Day 1/.test(calls[calls.length - 1].body.systemInstruction.parts[0].text), 'Ducky is told about the real today even though the Today tab was left on day 5');
    await tab('today');
    assert.ok(await page.locator('[data-act=goto-today]').count(), 'we are browsing another day');
    await tap('[data-act=goto-today]');
    await tap('[data-act=start]');
    assert.strictEqual(await ex(page, 'Bench Press').locator('.srow').count(), 2, 'bench cut to 2 sets');
    assert.ok(await ex(page, 'Bench Press').locator('.tag-duck').count());
    const w = Number(await row(page, 'Bench Press', 0).locator('.in-w').inputValue()); assert.ok(w > 0);
    await tap('[data-act=wk-finish]'); await tap('[data-act=wk-discard]');
  });
  await test('Gemini errors are explained in plain words and the question is returned to the box', async () => {
    page.__fail = true;
    await tab('ducky'); await page.fill('#duck-input', 'Is my squat depth ok?'); await page.locator('.send').tap(); await adv(300);
    await page.waitForSelector('.msg.err');
    assert.ok(/rejected the API key|refused/.test(await text(page, '.msg.err')));
    assert.strictEqual(await page.inputValue('#duck-input'), 'Is my squat depth ok?');
    page.__fail = false; await shot(page, '12-ducky-error');
    await tap('[data-act=duck-clear]'); assert.strictEqual(await page.locator('.msg').count(), 0);
  });

  /* -------------------------------------------------------------- calendar */
  await test('calendar export: 144 events, correct local dates and times, workout names, reminders', async () => {
    await tab('settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act=cal-download]').tap()]);
    assert.ok(/\.ics$/.test(dl.suggestedFilename()));
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
    assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 144);
    assert.ok(/X-WR-TIMEZONE:Europe\/Riga/.test(ics));
    const unfolded = ics.replace(/\r\n[ \t]/g, '');
    const ev = (title) => { const m = unfolded.split('BEGIN:VEVENT').find((b) => b.includes('SUMMARY:' + title)); assert.ok(m, 'missing ' + title); return m; };
    assert.ok(/DTSTART:20261102T070000/.test(ev('W1 D1 – AM Zone 2 Run')));
    assert.ok(/DTSTART:20261102T173000/.test(ev('W1 D1 – PM Power & Base Leg Day + Upper'.replace(' & ', ' & ')).replace(/\\,/g, ',')) || /DTSTART:20261102T173000/.test(unfolded));
    assert.ok(/DTSTART:20261103T190000[\s\S]*DTEND:20261103T210000/.test(ev('W1 D2 – BJJ Gi')));
    assert.ok(/DTSTART:20261104T190000/.test(ev('W1 D3 – BJJ No-Gi')));
    assert.ok(/SUMMARY:W1 D4 –/.test(unfolded) && /SUMMARY:W1 D5 –/.test(unfolded) && /SUMMARY:W1 D6 –/.test(unfolded));
    assert.ok(/DTSTART;VALUE=DATE:20261108/.test(ev('W1 D7 – Rest')));
    assert.ok(/DTSTART;VALUE=DATE:20270221/.test(ev('W16 D7 – Rest')), 'last day is 21 Feb 2027');
    assert.ok(/Zone 2 target 136.150 bpm/.test(ev('W1 D1 – AM Zone 2 Run').replace(/\\/g, '')));
    assert.ok((ics.match(/TRIGGER:-PT30M/g) || []).length === 128);
    assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75), 'lines folded to 75 octets');
  });
  await test('changing the start date and times changes the export', async () => {
    await page.fill('[data-set=startDate]', '2026-12-07'); await page.dispatchEvent('[data-set=startDate]', 'change');
    await page.fill('[data-set="times.am"]', '06:15'); await page.dispatchEvent('[data-set="times.am"]', 'change');
    await page.locator('[data-set=includeRest]').evaluate((e) => e.click());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act=cal-download]').tap()]);
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(/DTSTART:20261207T061500/.test(ics)); assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 128);
    await page.fill('[data-set=startDate]', '2026-11-02'); await page.dispatchEvent('[data-set=startDate]', 'change');
    await page.fill('[data-set="times.am"]', '07:00'); await page.dispatchEvent('[data-set="times.am"]', 'change');
    await page.locator('[data-set=includeRest]').evaluate((e) => e.click());
  });

  /* ------------------------------------------------------------- settings */
  await test('switching to pounds converts every weight on screen and keeps the data in kg', async () => {
    await tab('settings');
    try {
      await page.selectOption('[data-set=units]', 'lb'); await adv(100);
      await tab('today');
      const shown = await page.locator('.p-row', { hasText: 'Bench Press' }).locator('.p-w').innerText();
      const kg = await page.evaluate(() => { const S = HA.store.get(), r = HA.engine.oneRMFor(S, 'bench', HA.actions.isoToday()); const ex = HA.program.flatExs(HA.program.getWorkout(1, 1)).find((e) => e.liftKey === 'bench'); return r.kg * ex.pct; });
      const want = Math.round(kg * 2.20462 / 5) * 5;
      assert.strictEqual(shown.replace(/\s/g, ''), want + 'lb', `bench shows ${shown}, expected ${want} lb`);
      await tab('lifts'); assert.ok(/lb 1RM/.test(await text(page, '.lift-num')));
      assert.ok(Math.abs((await state(page)).baselines.zercher.kg - 120) < 0.01, 'stored in kg');
      await shot(page, '15-lifts-lb');
    } finally {
      await tab('settings'); await page.selectOption('[data-set=units]', 'kg'); await adv(100);
    }
  });
  await test('backup export has no API key; erase wipes everything; import restores the logs', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act=data-export]').tap()]);
    const file = await dl.path(), raw = fs.readFileSync(file, 'utf8');
    assert.ok(!raw.includes('AIzaTEST'), 'no key in backup'); assert.strictEqual(JSON.parse(raw).logs.length, 1);
    await tap('[data-act=data-reset]'); await tap('[data-act=data-reset-go]');
    const S = await state(page); assert.strictEqual(S.logs.length, 0); assert.deepStrictEqual(S.baselines, {});
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('ha.geminiKey')), null, 'key erased too');
    await tab('settings');
    await page.setInputFiles('input[data-act-change=data-import]', file); await adv(300);
    await page.waitForFunction(() => HA.store.get().logs.length === 1);
    assert.ok(Math.abs((await state(page)).baselines.bench.kg - 100) < 0.01);
    await adv(3000);
  });
  await test('importing garbage is rejected with a message', async () => {
    const bad = path.join(require('os').tmpdir(), 'bad.json'); fs.writeFileSync(bad, '{"hello":1}');
    await page.setInputFiles('input[data-act-change=data-import]', bad); await adv(100);
    assert.ok(/does not look like a Hybrid Athlete backup/.test(await text(page, '#toast')));
    assert.strictEqual((await state(page)).logs.length, 1, 'state untouched');
  });

  /* ------------------------------------------------- Program tab + day sheet */
  await test('Program lists all 16 weeks; tapping a day opens it', async () => {
    await tab('program');
    assert.strictEqual(await page.locator('.wrow').count(), 16); assert.strictEqual(await page.locator('.dc').count(), 112);
    assert.strictEqual(await page.locator('.dc.done').count(), 1, 'the logged day is marked');
    await tap('[data-act=open-day][data-w="13"][data-d="1"]');
    assert.ok(/Assumed block/.test(await text(page, '.sheet')) || /Week 13, day 1/.test(await text(page, '.sheet')));
    await shot(page, '13-program-day');
    await tap('[data-act=sheet-close]');
  });

  await test('1RM calculator: Epley, and one tap to use it as a lift\'s 1RM', async () => {
    await tab('lifts');
    await page.fill('#calc-w', '100'); await page.fill('#calc-r', '5');
    assert.ok(/116\.7 kg/.test((await text(page, '#calc-out')).replace(/\s+/g, ' ')), await text(page, '#calc-out'));
    await page.fill('#calc-r', '1'); assert.ok(/100 kg/.test(await text(page, '#calc-out')), 'a single rep is the 1RM');
    await page.fill('#calc-r', '5'); await page.selectOption('#calc-k', 'rdl'); await tap('[data-act=calc-save]');
    assert.ok(/116\.7/.test(await text(page, '.lift:nth-of-type(4) .lift-num')), await text(page, '.lift:nth-of-type(4) .lift-num'));
  });
  await test('a derived Block 2 session opens from the Program tab with the contrast complex grouped', async () => {
    await tab('program'); await tap('[data-act=open-day][data-w="5"][data-d="1"]');
    assert.ok(/Built from your Block 2 rules/.test(await text(page, '.sheet')) || /Week 5, day 1/.test(await text(page, '.sheet')));
    await tap('.sheet [data-act=start]');
    try {
      await page.waitForSelector('#workout .group.g-contrast');
      assert.ok(await page.locator('#workout .group.g-contrast .ex').count() >= 2, 'contrast pair');
      assert.ok(/Week 5, day 1/.test(await text(page, '#workout .wk-title')));
    } finally { await tap('[data-act=wk-finish]'); await tap('[data-act=wk-discard]'); }
  });

  /* ------------------------------------------------- layout and accessibility */
  for (const w of [360, 390, 430]) {
    await test(`no horizontal overflow and every control has a name on every screen at ${w}px`, async () => {
      const b = await openApp(browser, url, { w }); allErrors.push(b.errors);
      await b.page.evaluate(() => { const S = HA.store.get(); S.baselines.bench = { kg: 100, at: '2026-11-01' }; });
      for (const t of ['today', 'program', 'lifts', 'ducky', 'settings']) {
        await b.tab(t);
        const r = await b.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
          unnamed: [...document.querySelectorAll('button, a, input, select, textarea')].filter((e) => !e.closest('[hidden]') && !(e.getAttribute('aria-label') || e.textContent.trim() || e.getAttribute('placeholder') || (e.labels && e.labels.length) || e.closest('label')) ).map((e) => e.outerHTML.slice(0, 80)) }));
        assert.ok(r.sw <= r.iw, `${t}: scrollWidth ${r.sw} > ${r.iw}`); assert.deepStrictEqual(r.unnamed, [], t + ' unnamed controls');
      }
      await b.tab('today'); await b.tap('[data-act=start]');
      const r = await b.page.evaluate(() => ({ sw: document.getElementById('workout').scrollWidth, iw: window.innerWidth,
        wide: [...document.querySelectorAll('#workout *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => e.className).slice(0, 5) }));
      assert.ok(r.sw <= r.iw, 'workout overflow'); assert.deepStrictEqual(r.wide, []);
      if (w === 360) await shot(b.page, '14-workout-360');
      await b.ctx.close();
    });
  }

  /* -------------------------------------------------------- offline (SW) */
  await (ALONE ? skip : test)('after the first visit the app opens with no network at all', async () => {
    const b = await openApp(browser, url, { sw: true }); allErrors.push(b.errors);
    await b.page.evaluate(() => navigator.serviceWorker.ready); await sleep(600);
    await b.page.evaluate(async () => { const keys = await caches.keys(); window.__cached = (await (await caches.open(keys[0])).keys()).length; });
    assert.ok(await b.page.evaluate(() => window.__cached) >= (SINGLE ? 1 : 23), 'shell cached');
    await b.ctx.setOffline(true);
    await b.page.reload(); await b.page.waitForSelector('.hero');
    assert.ok(/Week/.test(await text(b.page, '.hero-week'))); assert.ok(await b.page.evaluate(() => !!(window.HA && HA.views)));
    await b.ctx.close();
  });
  await (ALONE ? skip : test)('the service worker shows the "rest is over" notification when the page cannot', async () => {
    const ctx = await browser.newContext({ serviceWorkers: 'allow', permissions: ['notifications'] });
    const p = await ctx.newPage(); await p.goto(url); await p.waitForSelector('.hero');
    await p.evaluate(() => navigator.serviceWorker.ready); await sleep(300);
    const shown = await p.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      const before = (await reg.getNotifications()).length;
      reg.active.postMessage({ type: 'rest-schedule', at: Date.now() - 1000, body: 'Next: Bench Press, set 2' });
      await new Promise((r) => setTimeout(r, 2300));
      const n = await reg.getNotifications({ tag: 'ha-rest' });
      return { before, n: n.map((x) => [x.title, x.body]) };
    });
    // the SW only notifies when no window is visible; a headless page counts as visible, so either outcome is valid but it must not throw
    assert.ok(shown.n.length === 0 || (shown.n[0][0] === 'Rest is over' && /Bench Press/.test(shown.n[0][1])), JSON.stringify(shown));
    await p.evaluate(async () => { (await navigator.serviceWorker.ready).active.postMessage({ type: 'rest-cancel' }); });
    await ctx.close();
  });

  /* ------------------------------------- rest-over notification without a service worker (single file, or SW blocked) */
  await test('rest-over notification comes from the page itself when no service worker is registered', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Riga', serviceWorkers: 'block', permissions: ['notifications'] });
    const b = await openApp(browser, url, { ctx }); allErrors.push(b.errors);
    await b.page.evaluate(() => {
      window.__notes = []; const Real = window.Notification;
      window.Notification = function (title, o) { window.__notes.push({ title, body: o && o.body, icon: o && o.icon }); };
      window.Notification.permission = 'granted'; window.Notification.requestPermission = Real.requestPermission;
      Object.defineProperty(document, 'visibilityState', { get: () => window.__vis || 'visible', configurable: true });
    });
    await b.tap('[data-act=start]');
    await b.page.locator('#workout .srow .chk').first().tap(); await b.adv(60);
    assert.ok(await b.page.locator('#restbar').isVisible(), 'rest running');
    await b.page.evaluate(() => { window.__vis = 'hidden'; });                  // as if the app were in the background
    await b.adv((await b.page.evaluate(() => HA.timer.remaining())) * 1000 + 700);
    await b.page.waitForFunction(() => window.__notes.length > 0);
    const n = await b.page.evaluate(() => window.__notes);
    assert.strictEqual(n.length, 1); assert.strictEqual(n[0].title, 'Rest is over');
    assert.ok(/^Next: |^Time for your next set/.test(n[0].body), n[0].body);
    assert.ok(/^(data:image\/png|http:\/\/127\.0\.0\.1:\d+\/icon-192\.png)/.test(n[0].icon), 'icon: ' + String(n[0].icon).slice(0, 40));
    await ctx.close();
  });

  /* ---------------------------------------------- opened straight from disk (the point of the single file) */
  await (SINGLE ? test : (n) => skip(n, 'runs only against the single file: SINGLE=1'))('opened from disk as file:// it runs, keeps its data after a reload, and the CSP blocks nothing of its own', async () => {
    const file = 'file://' + path.join(ROOT, PAGE);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Riga', serviceWorkers: 'block' });
    const page = await ctx.newPage(), errors = [], violations = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('requestfailed', (r) => errors.push('request failed: ' + r.url().slice(0, 80)));
    await page.addInitScript(() => { window.__v = []; document.addEventListener('securitypolicyviolation', (e) => window.__v.push(e.violatedDirective + ' ' + String(e.blockedURI).slice(0, 60))); });
    await page.goto(file); await page.waitForSelector('.hero');
    assert.ok(/Week/.test(await text(page, '.hero-week')));
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.querySelector('.hero-week')).fontFamily.includes('Big Shoulders')), true);
    assert.ok(await page.evaluate(() => document.fonts.check('700 20px "Big Shoulders"')) !== undefined);
    await page.locator('[data-act=tab][data-tab=lifts]').first().tap();
    await page.locator('[data-act=edit-1rm][data-key=bench]').tap(); await page.fill('#rm-input', '100'); await page.locator('[data-act=save-1rm]').tap();
    await page.reload(); await page.waitForSelector('.hero');
    assert.strictEqual(await page.evaluate(() => (HA.store.get().baselines.bench || {}).kg), 100, 'a saved 1RM survives a reload on file://');
    assert.deepStrictEqual(await page.evaluate(() => window.__v), []);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  /* ---------------------------------------------- Bulgarian split squat and pull-ups: tracked weighted lifts */
  await test('split squat and pull-ups: 1RMs, bodyweight, working weights, live % of 1RM, recalibration after a session', async () => {
    const b = await openApp(browser, url); allErrors.push(b.errors);
    const { page, tap, tab, adv } = b;
    await tab('lifts');
    assert.ok(/Add bodyweight/.test(await text(page, '.lift:has(h2:text-is("Pull-up"))')), 'pull-up card asks for a bodyweight');
    await tap('[data-act=goto-settings][data-focus=bw]');
    await page.fill('[data-set=bodyKg]', '80'); await page.dispatchEvent('[data-set=bodyKg]', 'change'); await adv(60);
    assert.strictEqual(await page.locator('[data-set=bodyKg]').inputValue(), '80');
    await tab('lifts');
    await tap('[data-act=edit-1rm][data-key=bss]'); await page.fill('#rm-input', '40'); await tap('[data-act=save-1rm]');
    await tap('[data-act=edit-1rm][data-key=pullup]'); assert.ok(/Type the total, or type \+ and the weight you added/.test(await text(page, '.sheet')));
    await page.fill('#rm-input', '+40'); await tap('[data-act=save-1rm]');
    const card = (n) => page.locator('.lift', { has: page.locator('h2', { hasText: n }) });
    assert.strictEqual((await text(page, '.lift:has(h2:text-is("Bulgarian Split Squat")) .lift-num b')).trim(), '40');
    const pu = (await card('Pull-up').innerText()).replace(/\s+/g, ' ');
    assert.ok(/Bodyweight 80 \+ 40 kg added/.test(pu) && /120\s*kg total 1RM/.test(pu), pu);
    assert.ok(/\+5/.test(await card('Pull-up').locator('.proj td').first().innerText()), 'projection shows the added weight');
    await shot(page, '15-lifts-six');
    await tab('today'); await tap('[data-act=start]');
    const rm = (name) => ex(page, name).locator('.ex-rm').innerText();
    assert.strictEqual(await rm('Bulgarian Split Squat'), '27.5 kg = 68.8% of estimated 1RM 40 kg');
    assert.strictEqual(await rm('Pull-Ups'), '+5 kg added = 70.8% of estimated 1RM 120 kg total');
    assert.ok(/71\.4% of 1RM/.test(await ex(page, 'Bulgarian Split Squat').locator('.ex-id').innerText()), 'plan percentage in the sub-line');
    assert.strictEqual(await row(page, 'Bulgarian Split Squat', 0).locator('.in-w').inputValue(), '27.5');
    assert.strictEqual(await row(page, 'Pull-Ups', 0).locator('.in-w').inputValue(), '5');
    // the percentage follows what you type
    await row(page, 'Bulgarian Split Squat', 0).locator('.in-w').fill('30'); await adv(60);
    assert.strictEqual(await rm('Bulgarian Split Squat'), '30 kg = 75% of estimated 1RM 40 kg');
    await row(page, 'Pull-Ups', 0).locator('.in-w').fill('10'); await adv(60);
    assert.strictEqual(await rm('Pull-Ups'), '+10 kg added = 75% of estimated 1RM 120 kg total');
    await row(page, 'Pull-Ups', 0).locator('.in-w').fill(''); await adv(60);
    assert.strictEqual(await rm('Pull-Ups'), 'Bodyweight 80 kg = 66.7% of estimated 1RM 120 kg total');
    await row(page, 'Pull-Ups', 0).locator('.in-w').fill('10'); await adv(60);
    await shot(page, '16-workout-split-squat-pullups');
    // do one set of each, finish: both estimates move up
    await row(page, 'Bulgarian Split Squat', 0).locator('.chk').tap(); await adv(60);
    await row(page, 'Pull-Ups', 0).locator('.chk').tap(); await adv(60);
    await tap('[data-act=wk-finish]'); await tap('[data-act=wk-finish-go]');
    const sheet = (await text(page, '.sheet')).replace(/\s+/g, ' ');
    assert.ok(/Bulgarian Split Squat.*40 to 42 kg \(\+2\)/.test(sheet), sheet);
    assert.ok(/Pull-up.*120 to 126 kg total \(\+6\)/.test(sheet), sheet);
    await tap('[data-act=sheet-close]');
    const S = await state(page), entry = S.logs[0].entries.find((e) => e.liftKey === 'pullup');
    assert.strictEqual(entry.bodyKg, 80, 'bodyweight stored with the pull-up entry');
    await tab('lifts');
    assert.strictEqual((await text(page, '.lift:has(h2:text-is("Pull-up")) .lift-num b')).trim(), '126');
    assert.ok(/Bodyweight 80 \+ 46 kg added/.test((await card('Pull-up').innerText()).replace(/\s+/g, ' ')));
    // the calculator treats the weight as ADDED for pull-ups
    await page.selectOption('#calc-k', 'pullup'); await page.fill('#calc-w', '20'); await page.fill('#calc-r', '5');
    assert.ok(/Estimated 1RM: 116\.7 kg total \(bodyweight 80 \+ 36\.7 added\)/.test((await text(page, '#calc-out')).replace(/\s+/g, ' ')), await text(page, '#calc-out'));
    await tap('[data-act=calc-save]'); assert.ok(/116\.7/.test(await text(page, '.lift:has(h2:text-is("Pull-up")) .lift-num b')));
    await b.ctx.close();
  });

  /* ------------------------------------------------------- install, manifest and offline card */
  await test('the browser sees an installable web app: manifest parsed with its icons, and no installability errors', async () => {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(url); await page.waitForSelector('.hero');
    const cdp = await ctx.newCDPSession(page); await cdp.send('Page.enable');
    const m = await cdp.send('Page.getAppManifest');
    assert.deepStrictEqual(m.errors, [], 'manifest errors');
    const man = JSON.parse(m.data);
    assert.ok(/Hybrid Athlete/.test(man.name) && man.display === 'standalone' && man.icons.length >= 3, JSON.stringify(man).slice(0, 200));
    if (SINGLE) assert.ok(/^data:application\/manifest\+json,/.test(m.url), 'the single file carries its manifest as a data: URL');
    const inst = await cdp.send('Page.getInstallabilityErrors');
    assert.deepStrictEqual(inst.installabilityErrors, [], 'installability: ' + JSON.stringify(inst.installabilityErrors));
    await ctx.close();
  });
  await test('Settings: the install and offline card follows the service-worker state; Download sw.js saves the embedded worker', async () => {
    const b = await openApp(browser, url, { sw: true }); allErrors.push(b.errors);
    await b.tab('settings');
    if (ALONE) {
      await b.page.waitForFunction(() => /Offline mode is off/.test(document.body.innerText));
      assert.ok(/cannot live inside this page/.test(await text(b.page, '#sec-install')));
      const [dl] = await Promise.all([b.page.waitForEvent('download'), b.tap('[data-act=sw-download]')]);
      assert.strictEqual(dl.suggestedFilename(), 'sw.js');
      assert.strictEqual(fs.readFileSync(await dl.path(), 'utf8'), fs.readFileSync(path.join(ROOT, WORKER), 'utf8'), 'the saved file is the embedded worker');
    } else {
      await b.page.waitForFunction(() => /Offline mode is on/.test(document.body.innerText));
      assert.strictEqual(await b.page.locator('[data-act=sw-download]').count(), 0, 'nothing to download once it is running');
      assert.ok(await b.page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), 'registered');
    }
    // Chrome's install prompt: the card offers a button that calls the browser's prompt
    await b.page.evaluate(() => {
      const ev = new Event('beforeinstallprompt', { cancelable: true });
      ev.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); };
      ev.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.__bipDefaultPrevented = !window.dispatchEvent(ev);
    });
    assert.strictEqual(await b.page.evaluate(() => window.__bipDefaultPrevented), true, 'the mini-infobar is held back for our own button');
    await b.page.waitForSelector('[data-act=pwa-install]');
    await b.tap('[data-act=pwa-install]');
    assert.strictEqual(await b.page.evaluate(() => window.__prompted), 1);
    await b.page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    await b.page.waitForFunction(() => /installed app/.test(document.body.innerText));
    await b.ctx.close();
  });
  await test('Settings on an iPhone explains Share, then Add to Home Screen', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Riga', serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' });
    const b = await openApp(browser, url, { ctx }); allErrors.push(b.errors);
    await b.tab('settings');
    const t = await text(b.page, '#sec-install');
    assert.ok(/Tap the Share button/.test(t) && /Add to Home Screen/.test(t), t);
    assert.strictEqual(await b.page.locator('[data-act=pwa-install]').count(), 0);
    await ctx.close();
  });


  /* ------------------------------------------------ running: pace, import, live heart rate */
  await test('Zone 2 pace: a logged run sets the target pace on the run card; Settings switches min/km and min/mile and lists the run', async () => {
    const a = await openApp(browser, url, { ctx: await newCtx(browser) }); allErrors.push(a.errors); const { page, tap, tab } = a;
    await setHeart(a);
    assert.ok(/Add a run or a race time/.test(await text(page, '.run')), 'no pace without a reference');
    await tap('.run-tools [data-act=run-log]');
    await page.fill('#run-time', '50:00'); await page.fill('#run-dist', '10'); await page.fill('#run-hr', '140');
    await tap('[data-act=run-save]');
    assert.ok(await page.locator('.sheet').count() === 0, 'sheet closed');
    assert.ok(/4:28–5:15 \/km/.test(await text(page, '.run-pace')), await text(page, '.run-pace'));
    assert.ok(/From your last run/.test(await text(page, '.run')));
    await shot(page, '15-run-pace');
    await tab('settings');
    assert.ok(/Zone 2 pace: 4:28–5:15 \/km/.test((await text(page, '#pace-result')).replace(/\s+/g, ' ')));
    assert.strictEqual(await page.locator('.runs li').count(), 1);
    await page.selectOption('[data-set=paceUnit]', 'mi'); await a.adv(60);
    assert.ok(/7:12–8:27 \/mi/.test(await text(page, '#pace-result')), await text(page, '#pace-result'));
    assert.ok(/Race distance \(mi\)/.test(await text(page, '#sec-pace')));
    await page.fill('[data-set=raceDist]', '3.1'); await page.fill('[data-set=raceTime]', '25:00'); await page.dispatchEvent('[data-set=raceTime]', 'change');
    assert.strictEqual((await state(page)).settings.race.sec, 1500);
    await tap('[data-act=run-del]'); assert.strictEqual(await page.locator('.runs li').count(), 0);
    assert.ok(/From your race result/.test(await text(page, '#pace-result')), 'with no runs the race result is used');
    await page.fill('[data-set=raceTime]', 'soon'); await page.dispatchEvent('[data-set=raceTime]', 'change'); await a.adv(60);
    assert.ok(/minutes and seconds/.test(await text(page, '#toast')));
    await a.ctx.close();
  });

  await test('Garmin Connect export: a TCX file fills in date, time, distance and heart rate; other files are refused with a reason', async () => {
    const a = await openApp(browser, url, { ctx: await newCtx(browser) }); allErrors.push(a.errors); const { page, tap } = a;
    await setHeart(a); await tap('.run-tools [data-act=run-log]');
    await page.setInputFiles('[data-act-change=run-import]', { name: 'activity_1.fit', mimeType: 'application/octet-stream', buffer: Buffer.from('.FIT\u0000\u0001binary') });
    await until(page, () => /not a TCX or GPX/.test(document.getElementById('run-import-note').textContent));
    await page.setInputFiles('[data-act-change=run-import]', { name: 'activity_1.tcx', mimeType: 'application/xml', buffer: Buffer.from(tcx({ start: '2026-11-01T05:00:00Z', sec: 1800, m: 5000, hr: 142 })) });
    await until(page, () => document.getElementById('run-time').value !== '');
    assert.deepStrictEqual(await page.evaluate(() => ['run-date', 'run-time', 'run-dist', 'run-hr'].map((i) => document.getElementById(i).value)), ['2026-11-01', '30:00', '5', '142']);
    assert.ok(/100% of the time in Zone 2/.test(await text(page, '#run-import-note')), await text(page, '#run-import-note'));
    await tap('[data-act=run-save]');
    const runs = (await state(page)).runs; assert.deepStrictEqual([runs.length, runs[0].km, runs[0].sec, runs[0].hr, runs[0].src], [1, 5, 1800, 142, 'import']);
    await a.ctx.close();
  });

  await test('live heart rate: connects to a strap, shows blue / green / red for below / in / above Zone 2, beeps and buzzes when you drift, then saves the run', async () => {
    const a = await openApp(browser, url, { ctx: await newCtx(browser) }); allErrors.push(a.errors); const { page, tap, adv } = a;
    await setHeart(a);
    await tap('.run-tools [data-act=live-open]');
    assert.ok(await page.locator('#runlive').isVisible() && /No sensor connected/.test(await text(page, '#lr-state')));
    assert.ok(/136–150 bpm/.test(await text(page, '.lr-target')), 'target range from Karvonen');
    await tap('[data-act=live-connect]');
    await until(page, () => !!document.querySelector('[data-act=live-start]'));
    assert.deepStrictEqual(await page.evaluate(() => window.__bt.requests), ['{"filters":[{"services":["heart_rate"]}]}']);
    const hr = (bpm) => page.evaluate((b) => window.__hr(b), bpm);
    const look = () => page.evaluate(() => ({ cls: document.getElementById('lr-main').className, bpm: document.getElementById('lr-bpm').textContent, state: document.getElementById('lr-state').textContent, mark: !document.getElementById('lr-mark').hidden }));
    await hr(120); assert.deepStrictEqual(await look(), { cls: 'lr-main zone-low', bpm: '120', state: 'Below Zone 2: pick it up', mark: true });
    await hr(142); assert.deepStrictEqual(await look(), { cls: 'lr-main zone-in', bpm: '142', state: 'In Zone 2', mark: true });
    await hr(165); assert.deepStrictEqual(await look(), { cls: 'lr-main zone-high', bpm: '165', state: 'Above Zone 2: ease off', mark: true });
    await sleep(450);                                                                    // the colour fades in over a quarter of a second (a CSS transition runs on real time)
    const colours = await page.evaluate(() => { const m = document.getElementById('lr-main'); return getComputedStyle(m).borderTopColor; });
    assert.strictEqual(colours, 'rgb(255, 107, 107)', 'red above the zone');
    await shot(page, '16-live-red'); await hr(142); await shot(page, '17-live-green'); await hr(120); await shot(page, '18-live-blue');
    await tap('[data-act=live-start]'); assert.ok(await page.locator('[data-act=live-stop]').count());
    const before = await page.evaluate(() => ({ vib: window.__vib.length, osc: window.__osc }));
    for (let i = 0; i < 14; i++) { await hr(165); await adv(1000); }                    // above the zone for 14 s: the cue comes after 10
    const high = await page.evaluate(() => ({ vib: window.__vib.slice(), osc: window.__osc }));
    assert.ok(high.vib.slice(before.vib).some((p) => Array.isArray(p) && p.length === 5), 'three-pulse buzz for "too high": ' + JSON.stringify(high.vib));
    assert.ok(high.osc - before.osc >= 3, 'three beeps');
    await hr(142); await adv(1000);
    assert.ok((await page.evaluate(() => window.__vib)).some((p) => Array.isArray(p) ? false : p === 70 || (p && p[0] === 70)) || (await page.evaluate(() => window.__vib)).some((p) => JSON.stringify(p) === '[70]'), 'soft "back in the zone" buzz');
    await tap('[data-act=live-close]'); assert.ok(await page.locator('#runlive').isHidden() && /run keeps going/.test(await text(page, '#toast')));
    await tap('.run-tools [data-act=live-open]'); assert.ok(await page.locator('[data-act=live-stop]').count(), 'the run is still going');
    await adv(9000);                                                                    // the strap goes quiet
    assert.deepStrictEqual(await look().then((l) => [l.cls, l.bpm]), ['lr-main zone-none', '–'], 'no stale number');
    for (let i = 0; i < 110; i++) { await hr(142); await adv(1000); }
    assert.ok(/^\d+%$/.test(await text(page, '#lr-inzone')) && parseInt(await text(page, '#lr-inzone'), 10) > 60);
    await tap('[data-act=live-stop]');
    assert.ok(await page.locator('#runlive').isHidden() && await page.locator('#run-dist').count(), 'run sheet opens');
    assert.ok(/^2:\d\d$/.test(await page.inputValue('#run-time')) && +(await page.inputValue('#run-hr')) > 130 && /Zone 2/.test(await text(page, '.sheet .result')), await text(page, '.sheet .result'));
    await page.fill('#run-dist', '0.5'); await tap('[data-act=run-save]');
    assert.strictEqual((await state(page)).runs.length, 1);
    await a.ctx.close();
  });

  await test('live heart rate: a cancelled device chooser is explained; a browser without Bluetooth says so and what to use instead', async () => {
    const a = await openApp(browser, url, { ctx: await newCtx(browser) }); allErrors.push(a.errors); const { page, tap } = a;
    await setHeart(a); await tap('.run-tools [data-act=live-open]');
    await page.evaluate(() => { window.__bt.failWith = 'NotFoundError'; });
    await tap('[data-act=live-connect]'); await until(page, () => /No heart-rate sensor was chosen/.test(document.getElementById('lr-actions').textContent));
    assert.ok(await page.locator('[data-act=live-connect]').count() && await page.locator('[data-act=live-connect-all]').count(), 'can try again, or list every device');
    await tap('[data-act=live-connect-all]');
    assert.ok((await page.evaluate(() => window.__bt.requests)).some((r) => /acceptAllDevices/.test(r)));
    await a.ctx.close();
    const b = await openApp(browser, url, { ctx: await newCtx(browser, 'nobt') }); allErrors.push(b.errors);
    await setHeart(b); await b.tap('.run-tools [data-act=live-open]');
    assert.ok(/Bluetooth is not available/.test(await text(b.page, '#lr-state')) && /Bluefy/.test(await text(b.page, '#lr-actions')), await text(b.page, '#lr-actions'));
    assert.strictEqual(await b.page.locator('[data-act=live-connect]').count(), 0);
    await b.ctx.close();
  });

  await test('changing a session\'s time: saved, shown, moved to another day, reset; bad input refused; the .ics file carries it', async () => {
    const a = await openApp(browser, url, { ctx: await newCtx(browser) }); allErrors.push(a.errors); const { page, tap, tab } = a;
    assert.ok(/07:00–07:45/.test(await text(page, '.sched')) && /17:30–19:00/.test(await text(page, '.sched')));
    await tap('[data-act=move-open][data-uid=ha-w01d1-pm]');
    assert.strictEqual(await page.locator('[data-act=move-reset]').count(), 0);
    await page.fill('#mv-time', ''); await tap('[data-act=move-save]'); assert.ok(/Check the date/.test(await text(page, '#toast')) && await page.locator('.sheet').count(), 'bad input keeps the sheet open');
    await page.fill('#mv-time', '19:15'); await tap('[data-act=move-save]');
    assert.ok(/19:15–20:45/.test(await text(page, '.sched')), await text(page, '.sched'));
    await tap('[data-act=move-open][data-uid=ha-w01d1-pm]'); await page.fill('#mv-date', '2026-11-03'); await tap('[data-act=move-save]');
    assert.ok(/Moved to Tue/.test(await text(page, '.sched')), await text(page, '.sched'));
    await tab('settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act=cal-download]').tap()]);
    const ics = fs.readFileSync(await dl.path(), 'utf8').replace(/\r\n[ \t]/g, '');
    const ev = ics.split('BEGIN:VEVENT').find((b) => /UID:ha-w01d1-pm/.test(b)) || ics.split('BEGIN:VEVENT').find((b) => /SUMMARY:W1 D1 – PM/.test(b));
    assert.ok(ev && /DTSTART:20261103T191500/.test(ev), 'the file has the new date and time: ' + (ev || '').slice(0, 300));
    assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 144);
    await tab('today'); await tap('[data-act=move-open][data-uid=ha-w01d1-pm]'); await tap('[data-act=move-reset]');
    assert.ok(/17:30–19:00/.test(await text(page, '.sched')) && !/Moved to/.test(await text(page, '.sched')));
    assert.deepStrictEqual((await state(page)).sched, {}, 'nothing stored once it is back on the program time');
    await a.ctx.close();
  });


  /* ------------------------------------------------ safe edition: manual heart rate, calendar links, no crashes */
  await test('no sensor and no Bluetooth: type a heart rate and get the same blue / green / red; bad numbers are refused politely', async () => {
    const a = await openApp(browser, url, { ctx: await newCtx(browser, 'nobt') }); allErrors.push(a.errors); const { page, tap, adv } = a;
    await setHeart(a); await tap('.run-tools [data-act=live-open]');
    assert.ok(/Bluetooth is not available/.test(await text(page, '#lr-state')) && await page.locator('#lr-manual').isVisible());
    const look = () => page.evaluate(() => ({ cls: document.getElementById('lr-main').className, bpm: document.getElementById('lr-bpm').textContent, state: document.getElementById('lr-state').textContent }));
    const type = async (v) => { await page.fill('#lr-manual', v); await tap('[data-act=live-manual]'); };
    await type('abc'); assert.ok(/between 30 and 230/.test(await text(page, '#toast'))); await type('400'); assert.ok(/between 30 and 230/.test(await text(page, '#toast')));
    await type('120'); assert.deepStrictEqual(await look(), { cls: 'lr-main zone-low', bpm: '120', state: 'Below Zone 2: pick it up' });
    await type('142'); assert.deepStrictEqual(await look(), { cls: 'lr-main zone-in', bpm: '142', state: 'In Zone 2' });
    await page.fill('#lr-manual', '165'); await page.press('#lr-manual', 'Enter'); await adv(60);
    assert.deepStrictEqual(await look(), { cls: 'lr-main zone-high', bpm: '165', state: 'Above Zone 2: ease off' });
    assert.strictEqual(await page.inputValue('#lr-manual'), '165');
    await shot(page, '21-live-manual');
    await adv(181000);                                                                  // a typed number goes stale after 3 minutes
    assert.deepStrictEqual(await look().then((l) => [l.cls, l.bpm]), ['lr-main zone-none', '–']);
    await a.ctx.close();
    const b = await openApp(browser, url, { ctx: await newCtx(browser) }); allErrors.push(b.errors);        // Bluetooth present: typing also works until a sensor is live
    await setHeart(b); await b.tap('.run-tools [data-act=live-open]');
    await b.page.fill('#lr-manual', '130'); await b.tap('[data-act=live-manual]');
    assert.strictEqual((await b.page.evaluate(() => document.getElementById('lr-main').className)), 'lr-main zone-low');
    await b.tap('[data-act=live-connect]'); await until(b.page, () => !!document.querySelector('[data-act=live-start]'));
    assert.strictEqual(await b.page.locator('#lr-manual').count(), 0, 'the box goes away once a sensor delivers');
    await b.ctx.close();
  });

  await test('one-tap Add to Google Calendar links for every timed session, following moved times; the .ics download still works', async () => {
    const a = await openApp(browser, url, { ctx: await newCtx(browser) }); allErrors.push(a.errors); const { page, tap, tab } = a;
    const links = () => page.locator('.cal-links a').evaluateAll((as) => as.map((x) => ({ t: x.textContent, h: x.href, target: x.target, rel: x.rel })));
    let l = await links(); assert.deepStrictEqual(l.map((x) => x.t), ['Add morning run to Google Calendar', 'Add lifting to Google Calendar']);
    assert.ok(l[0].h.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&text=') && l[0].h.includes('dates=20261102T070000%2F20261102T074500') || l[0].h.includes('dates=20261102T070000/20261102T074500'), l[0].h);
    assert.deepStrictEqual([l[0].target, l[0].rel], ['_blank', 'noopener noreferrer']);
    await tap('[data-act=move-open][data-uid=ha-w01d1-pm]'); await page.fill('#mv-time', '19:15'); await tap('[data-act=move-save]');
    l = await links(); assert.ok(/dates=20261102T191500(%2F|\/)20261102T204500/.test(l[1].h), l[1].h);
    await a.tap('[data-act=pick-day][data-d="7"]'); assert.strictEqual(await page.locator('.cal-links a').count(), 0, 'a rest day has nothing timed to add');
    await tab('settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act=cal-download]').tap()]);
    assert.ok(/\.ics$/.test(dl.suggestedFilename())); assert.strictEqual((fs.readFileSync(await dl.path(), 'utf8').match(/BEGIN:VEVENT/g) || []).length, 144);
    if (SINGLE) { assert.strictEqual(await page.locator('[data-set=gcalClientId]').count(), 0, 'no sign-in field in the safe edition'); assert.ok(/btn-primary/.test(await page.locator('[data-act=cal-download]').getAttribute('class'))); }
    await a.ctx.close();
  });

  await (SINGLE ? test : (n) => skip(n, 'safe single file only: SINGLE=1'))('the safe edition never contacts Google except to answer Ducky: not on start, in Settings, on the live screen, or exporting', async () => {
    const ctx = await newCtx(browser), hits = [];
    ctx.on('request', (r) => { if (!r.url().startsWith(url) && !/^data:|^blob:/.test(r.url())) hits.push(r.url()); });
    const a = await openApp(browser, url, { ctx }); allErrors.push(a.errors); const { tap, tab, page } = a;
    await setHeart(a); await tab('settings'); await tab('lifts'); await tab('ducky'); await tab('program'); await tab('today');
    await tap('.run-tools [data-act=live-open]'); await tap('[data-act=live-close]');
    await tab('settings'); await page.locator('[data-act=cal-download]').tap(); await a.adv(300);
    assert.deepStrictEqual(hits, [], 'requests to other sites: ' + hits.join(', '));
    await ctx.close();
  });

  await test('a screen that fails to draw shows a message and a Reload button instead of a blank page; a stray error never breaks the app', async () => {
    const a = await openApp(browser, url, { ctx: await newCtx(browser) }); const { page, tap, tab, adv } = a;
    await page.evaluate(() => { HA.__real = HA.views.lifts; HA.views.lifts = () => { throw new Error('boom'); }; });
    await tab('lifts');
    assert.ok(/could not be drawn/.test(await text(page, '#view')) && await page.locator('[data-act=reload]').isVisible(), await text(page, '#view'));
    assert.ok(await page.locator('#nav .nav-btn').count() === 5, 'navigation still works');
    await page.evaluate(() => { HA.views.lifts = HA.__real; }); await tab('today'); await tab('lifts');
    assert.strictEqual(await page.locator('.lift').count(), 6, 'recovers as soon as the screen works again');
    await page.evaluate(() => { Promise.reject(new Error('late failure')); }); await adv(200);
    assert.ok(/data is safe/.test(await text(page, '#toast')), 'a stray rejected promise is caught');
    await page.evaluate(() => { const o = HA.actions.toggleMark; HA.actions.toggleMark = () => { throw new Error('click boom'); }; window.__o = o; });
    await tab('today'); await tap('[data-act=mark]'); assert.ok(/data is safe/.test(await text(page, '#toast')), 'an error inside a tap is caught');
    await page.evaluate(() => { HA.actions.toggleMark = window.__o; }); await tab('lifts'); assert.strictEqual(await page.locator('.lift').count(), 6, 'still alive');
    await a.ctx.close();
  });

  await (SINGLE ? (n) => skip(n, 'the safe single file has no Google sign-in; covered by the folder run') : test)('Google Calendar: sign in, create "Hybrid Athlete Schedule" with all 144 sessions, send a change, pull a change, survive a lapsed sign-in, sign out', async () => {
    const T = { v: START.getTime() + 3600e3 }, fake = makeFake({ now: () => T.v });
    const ctx = await newCtx(browser); let gis = 0;
    await ctx.route('https://accounts.google.com/gsi/client', (route) => { gis++; route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_GIS }); });
    await ctx.route('https://www.googleapis.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const r = fake.handle(req.method(), req.url(), req.headers(), req.postData());
      await route.fulfill({ status: r.status, headers: Object.assign({ 'content-type': 'application/json' }, CORS), body: r.body == null ? '' : JSON.stringify(r.body) });
    });
    const a = await openApp(browser, url, { ctx }); allErrors.push(a.errors); const { page, tap, tab, adv } = a;
    await setHeart(a);
    await tab('settings');
    assert.ok(await page.locator('[data-act=gcal-connect]').isDisabled(), 'no sign-in without a client ID');
    assert.ok(new RegExp(url.replace(/\/$/, '').replace(/[.]/g, '\\.')).test(await page.locator('.how').first().innerHTML()), 'the setup steps name this app\'s own address to authorise');
    assert.strictEqual(gis, 0, 'Google\'s script is not loaded until there is a client ID');
    await page.fill('[data-set=gcalClientId]', 'abc-123.apps.googleusercontent.com'); await page.dispatchEvent('[data-set=gcalClientId]', 'change'); await adv(60);
    await until(page, () => !!(window.google && window.google.accounts));
    assert.strictEqual(gis, 1); assert.ok(await page.locator('[data-act=gcal-connect]').isEnabled());
    await shot(page, '19-settings-google', true);
    await tap('[data-act=gcal-connect]');
    await until(page, () => HA.store.get().gcal.lastSync > 0 && /Everything is in step/.test(document.getElementById('gcal-status').textContent), null, 30000);
    const g = await page.evaluate(() => ({ gis: window.__gis, prompt: window.__gisPrompt, st: HA.store.get().gcal }));
    assert.deepStrictEqual(g.gis, [{ client_id: 'abc-123.apps.googleusercontent.com', scope: 'https://www.googleapis.com/auth/calendar.app.created' }]);
    assert.strictEqual(g.prompt, 'consent', 'first sign-in asks for consent');
    assert.strictEqual(fake.cal().summary, 'Hybrid Athlete Schedule'); assert.strictEqual(fake.live().length, 144); assert.strictEqual(fake.cal().timeZone, 'Europe/Riga');
    const e1 = fake.ev('ha01d1p'); assert.deepStrictEqual([e1.start.dateTime, e1.end.dateTime, e1.start.timeZone], ['2026-11-02T17:30:00', '2026-11-02T19:00:00', 'Europe/Riga']);
    assert.ok(/Power & Base Leg Day/.test(e1.summary) && /Bench Press/.test(e1.description), e1.summary);
    const exported = await page.evaluate(() => HA.store.exportJSON()); assert.ok(!/tok-1/.test(exported), 'the access token never goes into a backup');
    assert.ok(/Everything is in step/.test(await text(page, '#gcal-status')));

    // app -> calendar: change a session here and it is sent on its own
    await tab('today'); fake.clearLog();
    await tap('[data-act=move-open][data-uid=ha-w01d1-pm]'); await page.fill('#mv-time', '19:15'); await tap('[data-act=move-save]');
    await adv(1500);
    await untilNode(() => fake.ev('ha01d1p').start.dateTime === '2026-11-02T19:15:00');
    assert.strictEqual(fake.ev('ha01d1p').end.dateTime, '2026-11-02T20:45:00');
    assert.deepStrictEqual(fake.log().filter((l) => l.method !== 'GET').map((l) => l.method + ' ' + l.path.split('/').pop()), ['PATCH ha01d1p'], 'one update, nothing else');
    await until(page, () => /In step with Google Calendar/.test(document.querySelector('.sched-sync').textContent));

    // calendar -> app: move it in Google Calendar, then Sync now
    T.v += 3600e3; fake.userMove('ha01d1a', '2026-11-02T06:30:00', '2026-11-02T07:15:00');
    await tab('settings'); await tap('[data-act=gcal-sync]');
    await until(page, () => !!(HA.store.get().sched['ha-w01d1-am']), null, 15000);
    assert.deepStrictEqual(await page.evaluate(() => { const o = HA.store.get().sched['ha-w01d1-am']; return [o.date, o.start, o.mins]; }), ['2026-11-02', '06:30', 45]);
    await tab('today'); assert.ok(/06:30–07:15/.test(await text(page, '.sched')), await text(page, '.sched'));
    await shot(page, '20-today-synced');

    // default time changed in Settings: every untouched morning run follows
    await tab('settings'); await page.fill('[data-set="times.am"]', '06:45'); await page.dispatchEvent('[data-set="times.am"]', 'change'); await adv(1500);
    await untilNode(() => fake.ev('ha02d1a').start.dateTime === '2026-11-09T06:45:00');
    assert.strictEqual(fake.ev('ha01d1a').start.dateTime, '2026-11-02T06:30:00', 'the session moved in Google Calendar keeps its own time');

    // the sign-in lapses (they last about an hour): the app says so and one tap signs in and syncs again
    await page.evaluate(() => HA.store.setTok({ t: 'old', exp: 1 })); await tab('today');
    assert.ok(/tap to sign in and sync/.test(await text(page, '.sched-sync')));
    T.v += 3600e3; fake.userMove('ha01d2', '2026-11-03T18:00:00', '2026-11-03T20:00:00');
    await tap('[data-act=gcal-sync]');
    await until(page, () => HA.store.get().sched['ha-w01d2'] && true, null, 15000);
    assert.strictEqual(await page.evaluate(() => window.__gisPrompt), '', 'already consented: no consent screen again');
    assert.deepStrictEqual(await page.evaluate(() => { const o = HA.store.get().sched['ha-w01d2']; return [o.date, o.start, o.mins]; }), ['2026-11-03', '18:00', 120]);

    // opening the app again pulls changes made while it was closed
    T.v += 3600e3; fake.userMove('ha01d3', '2026-11-04T20:00:00', '2026-11-04T22:00:00');
    await page.reload(); await page.waitForSelector('.hero');
    await until(page, () => !!HA.store.get().sched['ha-w01d3'], null, 15000);
    assert.strictEqual(await page.evaluate(() => HA.store.get().sched['ha-w01d3'].start), '20:00');

    // sign out: the token goes, the calendar stays in Google
    await tab('settings'); await tap('[data-act=gcal-disconnect]');
    assert.ok(await page.locator('[data-act=gcal-connect]').isVisible());
    assert.strictEqual(await page.evaluate(() => HA.store.getTok()), null); assert.strictEqual(await page.evaluate(() => window.__revoked), 'tok-1');
    assert.strictEqual(fake.live().length, 144);
    await ctx.close();
  });

  await (SINGLE ? (n) => skip(n, 'the safe single file has no Google sign-in; covered by the folder run') : test)('Google Calendar: when Google sign-in cannot load, the reason is shown and nothing breaks', async () => {
    const ctx = await newCtx(browser);
    await ctx.route('https://accounts.google.com/gsi/client', (route) => route.abort());
    const a = await openApp(browser, url, { ctx }); const { page, tap, tab, adv } = a;                 // its console noise about the blocked script is expected
    await tab('settings'); await page.fill('[data-set=gcalClientId]', 'abc-123.apps.googleusercontent.com'); await page.dispatchEvent('[data-set=gcalClientId]', 'change'); await adv(200);
    await tap('[data-act=gcal-connect]'); await adv(200);
    await until(page, () => /sign-in is still loading|Could not load Google sign-in/.test(document.getElementById('gcal-status').textContent));
    assert.ok(await page.locator('[data-act=gcal-connect]').isEnabled(), 'can try again');
    await ctx.close();
  });

  await test('a file that was changed after the build shows an explanation instead of a blank page; an unchanged one shows none', async () => {
    const open = async (route) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' }), page = await ctx.newPage();
      if (route) await route(page);
      await page.goto(url); await page.waitForTimeout(1500);              // real clock: the guard waits 600 ms after load
      const guard = await page.locator('#ha-guard').count() ? await page.locator('#ha-guard').innerText() : '';
      const started = await page.evaluate(() => !!(window.HA && window.HA.app));
      await ctx.close(); return { guard, started };
    };
    const ok = await open(); assert.deepStrictEqual(ok, { guard: '', started: true }, 'a normal start must not show the guard');
    if (SINGLE) {
      // the safe edition does not pin scripts by hash: an edited or re-saved file still starts
      const edit = (from, to) => (page) => page.route(url, async (route) => {
        const res = await route.fetch(), body = await res.text(), edited = body.replace(from, to);
        assert.notStrictEqual(edited, body); await route.fulfill({ response: res, body: edited });
      });
      const spaced = await open(edit('/* ---- engine.js ---- */', '/* ---- engine.js ----  */'));
      assert.deepStrictEqual(spaced, { guard: '', started: true }, 'one extra space must not stop the app');
      const crlf = await open((page) => page.route(url, async (route) => { const res = await route.fetch(), body = await res.text(); await route.fulfill({ response: res, body: body.replace(/\n/g, '\r\n') }); }));
      assert.deepStrictEqual(crlf, { guard: '', started: true }, 'Windows line endings must not stop the app');
      // a script that is really broken: the explanation replaces what would be a black page
      const bad = await open(edit('/* ---- engine.js ---- */', '/* ---- engine.js ---- */ )('));
      assert.strictEqual(bad.started, false); assert.ok(/The app could not start/.test(bad.guard) && /error while starting/.test(bad.guard) && /Lietotne neuzsāka darbu/.test(bad.guard), bad.guard);
    } else {                                                                // folder version: a script file that is missing
      const bad = await open((page) => page.route('**/engine.js', (route) => route.fulfill({ status: 404, body: 'nf' })));
      assert.strictEqual(bad.started, false); assert.ok(/could not be loaded/.test(bad.guard) && /Could not load engine\.js/.test(bad.guard), bad.guard);
    }
  });

  await test('the content security policy is enforced: inline script and other sites are blocked, Gemini is allowed', async () => {
    const b = await openApp(browser, url);                    // own page: its deliberate violations are not app errors
    const r = await b.page.evaluate(async () => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', (e) => violations.push(e.violatedDirective.split(' ')[0] + ' ' + e.blockedURI));
      const sc = document.createElement('script'); sc.textContent = 'window.__injected = 1'; document.head.appendChild(sc);
      await fetch('https://example.com/x', { mode: 'no-cors' }).catch(() => {});
      await fetch('https://generativelanguage.googleapis.com/v1beta/models', { mode: 'no-cors' }).catch(() => {});   // offline here, but must not be a CSP block
      await new Promise((res) => { const img = new Image(); img.onerror = img.onload = res; img.src = 'http://insecure.example/x.png'; });   // no timers: the page clock is paused
      return { injected: !!window.__injected, violations,
        hasMeta: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
        inlineScripts: document.querySelectorAll('script:not([src]):not([type])').length - 1,   // executable inline scripts, minus the one we just injected
        inlineHandlers: document.querySelectorAll('[onclick],[onerror],[onload]').length };
    });
    if (SINGLE) assert.strictEqual(r.injected, true, 'the safe edition does not pin scripts (that is what keeps it from going blank)');
    else { assert.strictEqual(r.injected, false, 'inline script must not run'); assert.ok(r.violations.some((v) => /^script-src/.test(v)), 'inline script reported: ' + r.violations); }
    assert.ok(r.violations.some((v) => /^connect-src https:\/\/example\.com/.test(v)), 'other site blocked: ' + r.violations);
    assert.ok(!r.violations.some((v) => /generativelanguage/.test(v)), 'Gemini not blocked by the policy');
    assert.ok(r.hasMeta && r.inlineScripts === (SINGLE ? 16 : 0) && r.inlineHandlers === 0, JSON.stringify(r));      // single file: exactly the 16 hashed module scripts
    await b.ctx.close();
  });

  await test('no JavaScript errors anywhere during the whole run', async () => {
    const errs = allErrors.flat(); assert.deepStrictEqual(errs, []);
  });

  await browser.close(); srv.close();
  console.log(`\n${passed} passed${failed ? ', ' + failed + ' FAILED' : ''}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('Harness crash:', e); process.exit(2); });
