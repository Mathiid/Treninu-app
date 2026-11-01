#!/usr/bin/env node
/* Builds ONE self-contained index.html from the multi-file source.
     node build-single.js [output]            the SAFE edition (default): index-single.html, plus sw-single.js beside it
     node build-single.js [output] --full     the FULL edition with Google sign-in and two-way Calendar sync (default: index-single-full.html)

   Safe edition: no Google sign-in, no sync, nothing loaded from anywhere but the file itself (gcal-off.js stands in for gcal.js).
   Calendar export is the .ics file and one-tap Add to Google Calendar links. Its Content-Security-Policy does not pin scripts by hash, so
   a file that was re-saved, re-encoded or touched by a host still starts instead of showing a blank page.

   What goes inside the file
     - fonts.css + styles.css           -> <style> blocks (the font is a base64 data: URI)
     - the 16 script files, in order   -> one <script> each, copied byte for byte
     - spec.js                          -> the 16-week program data (checked against program.json)
     - icons                            -> data: URIs for the tab icon and the iPhone home-screen icon
     - the web app manifest              -> a data: URL in <link rel="manifest">, with the icons inside it
     - the service worker                -> its source is embedded as inert text (Settings can save it as sw.js)
   A service worker can NOT be registered from inside an HTML file (browsers refuse blob:, data: and the page
   itself), so the build also writes sw-single.js, byte for byte the embedded text. Rename it to sw.js and put it next to the page, and
   the page registers it; without it the app still runs and installs from the browser menu.

   The Content-Security-Policy stays strict: instead of allowing every inline script, it lists the
   SHA-256 hash of each one, so a script injected into the page still would not run. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), vm = require('vm'), assert = require('assert');

const ROOT = __dirname;                                          // every file sits in this one folder
const ARGS = process.argv.slice(2), FULL_CLI = ARGS.includes('--full'), ARG_OUT = ARGS.filter((a) => !a.startsWith('--'))[0];
const OUT = path.resolve(ARG_OUT || path.join(ROOT, FULL_CLI ? 'index-single-full.html' : 'index-single.html'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');      // the HTML parser turns CRLF into LF, so hash the LF text
const b64 = (rel) => fs.readFileSync(path.join(ROOT, rel)).toString('base64');
const sha = (s) => "'sha256-" + crypto.createHash('sha256').update(s, 'utf8').digest('base64') + "'";

function build(opts) {
  const SAFE = !(opts && opts.edition === 'full');
  let html = read('index.html');
  const swap = (re, fn, what) => {
    let n = 0; html = html.replace(re, (...m) => { n++; return fn(...m); });
    assert.ok(n >= 1, 'build: pattern not found in index.html: ' + what);
    return n;
  };

  /* 1. the program data in spec.js must be the same as program.json */
  const sandbox = {}; sandbox.window = sandbox; vm.createContext(sandbox);
  vm.runInContext(read('spec.js'), sandbox);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.HA.SPEC)), JSON.parse(read('program.json')), 'spec.js differs from program.json');

  /* 2. scripts, in the order index.html lists them */
  const scripts = [];
  swap(/<script src="([a-z0-9]+\.js)"><\/script>/g, (_, rel0) => {
    const rel = SAFE && rel0 === 'gcal.js' ? 'gcal-off.js' : rel0;
    const code = read(rel);
    assert.ok(!/<\/script/i.test(code) && !code.includes('<!--'), rel + ' contains a sequence that would end an inline <script>');
    const body = '\n/* ---- ' + rel + ' ---- */\n' + code.replace(/\n*$/, '\n');
    scripts.push({ rel, body });
    return '<script>' + body + '</script>';
  }, 'script tags');

  /* 3. styles */
  const fontLicence = read('OFL-BigShoulders.txt');
  assert.ok(!fontLicence.includes('*/'), 'font licence would end a CSS comment');
  const fontsCss = read('fonts.css').replace(
    /url\("BigShoulders-Bold\.woff"\)/, 'url("data:font/woff;base64,' + b64('BigShoulders-Bold.woff') + '")');
  assert.ok(fontsCss.includes('data:font/woff;base64,'), 'font url not replaced');
  const stylesCss = read('styles.css');
  assert.ok(!/<\/style/i.test(stylesCss), 'styles.css contains </style');
  swap(/<link rel="stylesheet" href="fonts\.css">\n/, () =>
    '<style>\n/* Big Shoulders font, embedded below. Licence:\n\n' + fontLicence.trim() + '\n*/\n' + fontsCss + '</style>\n', 'fonts.css link');
  swap(/<link rel="stylesheet" href="styles\.css">\n/, () => '<style>\n' + stylesCss.replace(/\n*$/, '\n') + '</style>\n', 'styles.css link');

  /* 4. icons as data: URIs, and the manifest as a data: URL (no start_url or scope: both then default to this page) */
  const icon = (rel, sizes, purpose) => Object.assign({ src: 'data:image/png;base64,' + b64(rel), sizes: sizes, type: 'image/png' }, purpose ? { purpose: purpose } : {});
  const manifest = {
    name: 'Hybrid Athlete Tracker', short_name: 'Hybrid Athlete', lang: 'en',
    description: (/<meta name="description" content="([^"]*)"/.exec(html) || [])[1] || '',
    display: 'standalone', orientation: 'portrait', background_color: '#0d0f12', theme_color: '#0d0f12',
    categories: ['health', 'fitness', 'sports'],
    icons: [icon('icon-192.png', '192x192', 'any'), icon('icon-512.png', '512x512', 'any'), icon('icon-maskable-512.png', '512x512', 'maskable')]
  };
  const manifestUrl = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(manifest));
  swap(/<link rel="icon" type="image\/png" href="icon-192\.png">/, () => '<link rel="icon" type="image/png" href="data:image/png;base64,' + b64('icon-192.png') + '">', 'icon link');
  swap(/<link rel="apple-touch-icon" href="apple-touch-icon.png">/, () => '<link rel="apple-touch-icon" href="data:image/png;base64,' + b64('apple-touch-icon.png') + '">', 'apple-touch-icon link');
  swap(/<link rel="manifest" href="manifest\.webmanifest">/, () => '<link rel="manifest" href="' + manifestUrl + '">', 'manifest link');

  /* 4b. the service worker: the single-file variant caches only the page and installs even if that fetch fails */
  let sw = read('sw.js');
  const sw0 = sw;
  sw = sw.replace(/var SHELL = \[   \/\/ BUILD:SHELL[\s\S]*?\];\n/, () => "var SHELL = ['./'];   // BUILD:SHELL\n");
  sw = sw.replace('var STRICT = true;   // BUILD:STRICT', 'var STRICT = false;   // BUILD:STRICT');
  assert.ok(sw !== sw0 && sw.includes("var SHELL = ['./'];") && sw.includes('var STRICT = false;'), 'sw.js BUILD markers not found');
  sw = '// Generated for the single-file page by build-single.js. Save it as sw.js next to that page.\n' + sw;
  assert.ok(!/<\/script/i.test(sw), 'sw.js contains </script');
  html = html.replace('</body>', () => '<script type="text/plain" id="ha-sw-source">\n' + sw + '</script>\n</body>');

  /* 5. content security policy: hashes instead of 'self' for scripts, data: for the font, no manifest/worker */
  const csp = SAFE
    ? ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", 'font-src data:',
       "connect-src 'self' https://generativelanguage.googleapis.com", "manifest-src data:", "worker-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ')
    : ["default-src 'self'", 'script-src ' + scripts.map((s) => sha(s.body)).join(' ') + ' https://accounts.google.com/gsi/client',
       "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style", "img-src 'self' data: blob: https:", 'font-src data:',
       // Google sign-in (Identity Services) is the one outside script: loaded only when you enter a client ID, from Google's own address.
       "connect-src 'self' https://generativelanguage.googleapis.com https://www.googleapis.com https://accounts.google.com/gsi/",
       'frame-src https://accounts.google.com/gsi/',
       "manifest-src data:", "worker-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"].join('; ');
  swap(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, () => '<meta http-equiv="Content-Security-Policy" content="' + csp + '">', 'CSP meta');

  /* 6. a header comment so the file explains itself */
  const note = '<!-- Hybrid Athlete Tracker & Ducky Coach: single-file build.\n' +
    '     Generated by build-single.js from the loose source files. Edit the source files and rebuild;\n' +
    '     changes made here are lost on the next build. Inside: two style blocks (fonts, then styles), then one\n' +
    '     script block per module in load order: guard (explains a failed start), spec (the 16-week program data),\n' +
    '     engine, program, session, store, zone2 (Zone 2 and pace maths), sched (session times), actions, timer, hr (Bluetooth\n' +
    '     heart rate), gcal (' + (SAFE ? 'switched off in this edition: no Google sign-in, no sync' : 'Google Calendar sync') + '), ai, thumbs, views, app.\n' +
    '     Search for "---- " plus a file name to jump between modules.\n' +
    (SAFE ? '     This is the safe edition: it contacts only Google Gemini (when you ask Ducky), and only with your own key.\n'
          : '     Google sign-in loads from accounts.google.com only after you enter a client ID in Settings.\n') +
    '     The web app manifest is a data: URL in the head. At the end of the body, a text block holds the source of\n' +
    '     the service worker (a browser only accepts one as a separate file: Settings can save it as sw.js). -->\n';
  html = html.replace('<!doctype html>\n', '<!doctype html>\n' + note);

  /* 7. nothing may still point at a local file */
  const markup = html.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '').replace(/<style>[\s\S]*?<\/style>/g, '');      // attributes only, not code
  const leftovers = [...markup.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(data:|https?:|#)/.test(u));
  assert.deepStrictEqual(leftovers, [], 'local references left in the output: ' + leftovers.join(', '));
  return { html, scripts, csp, sw, manifest, edition: SAFE ? 'safe' : 'full' };
}

if (require.main === module) {
  const { html, scripts, sw, edition } = build({ edition: FULL_CLI ? 'full' : 'safe' });
  // In this folder index.html and sw.js are the loose-file page and its worker: never overwrite them. Elsewhere the worker is saved as sw.js.
  if (path.dirname(OUT) === ROOT && ['index.html', 'sw.js'].includes(path.basename(OUT))) { console.error('Refusing to overwrite ' + path.basename(OUT) + ', the loose-file version. Pick another output name.'); process.exit(1); }
  const SW_OUT = path.dirname(OUT) === ROOT ? 'sw-single.js' : 'sw.js';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  fs.writeFileSync(path.join(path.dirname(OUT), SW_OUT), sw);
  console.log(edition + ' edition: wrote ' + path.relative(process.cwd(), OUT) + ' (' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB, ' + scripts.length + ' scripts inlined) and ' + SW_OUT + ' beside it');
}
module.exports = { build };
