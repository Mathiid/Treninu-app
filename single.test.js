/* Checks the single-file build (build-single.js) without a browser:
   self-contained, strict CSP hashes that match, every module copied verbatim, scripts parse and run.
   Run: node single.test.js */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm'), assert = require('assert');
const { build } = require('./build-single.js');
const root = __dirname;
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } }

const { html, scripts, csp, sw, manifest } = build();
const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const markup = html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');
const ORDER = ['guard', 'spec', 'engine', 'program', 'session', 'store', 'zone2', 'sched', 'actions', 'timer', 'hr', 'gcal', 'ai', 'thumbs', 'views', 'app'];
const GIS = 'https://accounts.google.com/gsi/client';
const REL = (n) => (n === 'gcal' ? 'gcal-off' : n) + '.js';          // the safe edition swaps the Google module for an inert stub

test('one file, no references to any other local file', () => {
  assert.ok(!/<script[^>]*\ssrc=/i.test(markup), 'external script tag');
  assert.ok(!/<link[^>]*rel="(stylesheet|preload|modulepreload)"/i.test(markup), 'external link');
  const man = markup.match(/<link rel="manifest" href="([^"]*)"/); assert.ok(man && /^data:application\/manifest\+json,/.test(man[1]), 'the manifest must be a data: URL');
  const refs = [...markup.matchAll(/(?:src|href|action)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(data:|https?:\/\/|#)/.test(u));
  assert.deepStrictEqual(refs, []);
  assert.ok(!/url\((?!["']?data:)/.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')), 'a CSS url() points at a file');
  assert.ok(Buffer.byteLength(html) < 1024 * 1024, 'file is unexpectedly large');
});

test('all 16 modules are inlined, in dependency order, each copied byte for byte', () => {
  assert.strictEqual(scriptBlocks.length, ORDER.length);
  assert.deepStrictEqual(scripts.map((s) => s.rel), ORDER.map(REL));
  scripts.forEach((s, i) => {
    const src = fs.readFileSync(path.join(root, s.rel), 'utf8').replace(/\r\n/g, '\n').replace(/\n*$/, '\n');
    assert.ok(scriptBlocks[i].endsWith(src), s.rel + ' differs from its source');
  });
});

test('guard.js comes first, is small, plain ES5, and stays silent outside a browser', () => {
  assert.strictEqual(scripts[0].rel, 'guard.js');
  const src = fs.readFileSync(path.join(root, 'guard.js'), 'utf8');
  assert.ok(src.length < 8000, 'guard.js should stay small');
  assert.ok(!/=>|\blet\b|\bconst\b|`|\?\.|\?\?/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^'\n]*'/g, "''")), 'older phones must be able to parse it');
  const ctx = { console, setTimeout }; ctx.window = ctx; vm.createContext(ctx); assert.doesNotThrow(() => vm.runInContext(scriptBlocks[0], ctx));
  assert.ok(!ctx.HA, 'guard must not publish anything');
});

test('safe edition: no Google sign-in anywhere in what runs, a CSP that cannot blank the page, and it still limits where data can go', () => {
  const m = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/); assert.ok(m, 'no CSP meta'); assert.strictEqual(m[1], csp);
  const dir = (n) => (csp.split('; ').find((d) => d.startsWith(n + ' ')) || '').split(' ').slice(1);
  assert.deepStrictEqual(dir('script-src'), ["'self'", "'unsafe-inline'"], 'scripts are not pinned by hash: a re-saved file must still start');
  assert.deepStrictEqual(dir('connect-src'), ["'self'", 'https://generativelanguage.googleapis.com'], 'only Gemini may be contacted');
  assert.ok(!/accounts\.google\.com|www\.googleapis\.com|frame-src/.test(csp), 'no Google sign-in or Calendar API in the policy');
  assert.ok(/font-src data:/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp) && /form-action 'none'/.test(csp));
  assert.ok(/manifest-src data:(;|$)/.test(csp) && /worker-src 'self'(;|$)/.test(csp));
  const sources = scriptBlocks.join('\n');
  assert.ok(!/accounts\.google\.com\/gsi|googleapis\.com\/calendar|initTokenClient/.test(sources), 'the Google module is not in the file');
  const stub = scriptBlocks[ORDER.indexOf('gcal')]; assert.ok(/gcal-off\.js/.test(stub) && !/fetch\(|createElement\('script'\)/.test(stub.replace(/\/\*[\s\S]*?\*\//g, '')), 'the stub does nothing but answer "off"');
  assert.ok(!/\r/.test(scriptBlocks.join('')), 'no CR in script text');
});
test('full edition (--full): scripts pinned by hash, Google sign-in allowed from its exact address only', () => {
  const f = build({ edition: 'full' }), fb = [...f.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  assert.strictEqual(f.edition, 'full'); assert.deepStrictEqual(f.scripts.map((x) => x.rel), ORDER.map((n) => n + '.js'));
  const dir = (n) => (f.csp.split('; ').find((d) => d.startsWith(n + ' ')) || '').split(' ').slice(1);
  const all = dir('script-src'); assert.strictEqual(all.filter((x) => !x.startsWith("'sha256-")).join(' '), GIS);
  assert.deepStrictEqual(all.filter((x) => x.startsWith("'sha256-")), fb.map((b) => "'sha256-" + crypto.createHash('sha256').update(b, 'utf8').digest('base64') + "'"));
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(all.join(' ')));
  assert.deepStrictEqual(dir('connect-src'), ["'self'", 'https://generativelanguage.googleapis.com', 'https://www.googleapis.com', 'https://accounts.google.com/gsi/']);
  assert.deepStrictEqual(dir('frame-src'), ['https://accounts.google.com/gsi/']);
  assert.ok(/initTokenClient/.test(fb.join('')), 'the real Google module is in the full edition');
});

test('every script parses, and the modules run in order and publish what the app needs', () => {
  scriptBlocks.forEach((b, i) => assert.doesNotThrow(() => new vm.Script(b, { filename: ORDER[i] + '.js' })));
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math }; ctx.window = ctx; vm.createContext(ctx);
  scriptBlocks.slice(0, -1).forEach((b, i) => vm.runInContext(b, ctx, { filename: ORDER[i] + '.js' }));     // app.js needs a real DOM: the e2e run covers it
  ['SPEC', 'THUMBS', 'engine', 'program', 'session', 'store', 'zone2', 'sched', 'actions', 'timer', 'hr', 'gcal', 'ai', 'views'].forEach((k) => assert.ok(ctx.HA[k], 'HA.' + k + ' missing'));
  assert.strictEqual(ctx.HA.gcal.off, true); assert.strictEqual(ctx.HA.gcal.create().status().off, true);
  assert.strictEqual(ctx.HA.SPEC.totalWeeks, 16);
});

test('the program data in the file is the program.json from the spec', () => {
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx); vm.runInContext(scriptBlocks[ORDER.indexOf('spec')], ctx);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.HA.SPEC)), JSON.parse(fs.readFileSync(path.join(root, 'program.json'), 'utf8')));
});

test('font and icons are embedded as real data', () => {
  const font = html.match(/url\("data:font\/woff;base64,([A-Za-z0-9+/=]+)"\)/); assert.ok(font, 'font not embedded');
  assert.strictEqual(Buffer.from(font[1], 'base64').subarray(0, 4).toString('latin1'), 'wOFF');
  assert.ok(html.includes('OFL') || html.includes('SIL OPEN FONT LICENSE'), 'font licence must travel with the font');
  ['icon', 'apple-touch-icon'].forEach((rel) => {
    const m = html.match(new RegExp('<link rel="' + rel + '"[^>]*href="data:image/png;base64,([A-Za-z0-9+/=]+)"')); assert.ok(m, rel + ' not embedded');
    assert.strictEqual(Buffer.from(m[1], 'base64').subarray(1, 4).toString('latin1'), 'PNG');
  });
});

test('manifest: a valid data-URL manifest with real icons (192, 512, maskable), standalone, no start_url that could point elsewhere', () => {
  const m = html.match(/<link rel="manifest" href="data:application\/manifest\+json,([^"]*)"/);
  const parsed = JSON.parse(decodeURIComponent(m[1])); assert.deepStrictEqual(parsed, manifest);
  assert.deepStrictEqual([parsed.name, parsed.short_name, parsed.display, parsed.orientation], ['Hybrid Athlete Tracker', 'Hybrid Athlete', 'standalone', 'portrait']);
  assert.ok(!('start_url' in parsed) && !('scope' in parsed), 'start_url and scope default to this page');
  assert.deepStrictEqual(parsed.icons.map((i) => i.sizes + (i.purpose ? ':' + i.purpose : '')), ['192x192:any', '512x512:any', '512x512:maskable']);
  parsed.icons.forEach((i) => {
    const png = Buffer.from(i.src.replace(/^data:image\/png;base64,/, ''), 'base64'), want = +i.sizes.split('x')[0];
    assert.strictEqual(png.subarray(1, 4).toString('latin1'), 'PNG'); assert.strictEqual(png.readUInt32BE(16), want); assert.strictEqual(png.readUInt32BE(20), want);
  });
  assert.ok(/^#[0-9a-f]{6}$/.test(parsed.theme_color) && /^#[0-9a-f]{6}$/.test(parsed.background_color));
  assert.ok(m[1].length < 40 * 1024, 'manifest data URL should stay small, it is ' + m[1].length);
});

test('the service worker source is embedded as inert text, parses, and is the single-file variant', () => {
  const m = html.match(/<script type="text\/plain" id="ha-sw-source">\n([\s\S]*?)<\/script>/); assert.ok(m, 'embedded sw source');
  assert.strictEqual(m[1], sw);
  assert.doesNotThrow(() => new vm.Script(sw, { filename: 'sw.js' }));
  assert.ok(sw.includes("var SHELL = ['./'];") && sw.includes('var STRICT = false;'), 'caches the page only; a missing file must not block install');
  assert.ok(!/css\/|js\/spec|icons\/icon-512|manifest\.webmanifest/.test(sw.replace(/\/\/ BUILD[^\n]*/g, '')), 'no file list from the folder version');
  ['install', 'activate', 'fetch', 'message', 'notificationclick'].forEach((ev) => assert.ok(sw.includes("addEventListener('" + ev + "'"), ev + ' handler'));
  assert.ok(/rest-schedule/.test(sw) && /showNotification/.test(sw), 'background rest notification');
  assert.ok(!/<\/script/i.test(sw));
  assert.strictEqual(scriptBlocks.length, 16, 'a text/plain script is data, not one of the hashed scripts');
});

test('the files on disk (index-single.html, sw-single.js), if present, are up to date with the source', () => {
  const f = path.join(root, 'index-single.html'), g = path.join(root, 'sw-single.js');
  if (fs.existsSync(f)) assert.strictEqual(fs.readFileSync(f, 'utf8'), html, 'index-single.html is stale: run node build-single.js');
  if (fs.existsSync(g)) assert.strictEqual(fs.readFileSync(g, 'utf8'), sw, 'sw-single.js is stale: run node build-single.js');
});

console.log(`\n${passed} passed${failed ? ', ' + failed + ' FAILED' : ''}`);
process.exit(failed ? 1 : 0);
