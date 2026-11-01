/* guard.js — loads before every other script.
   If the app cannot start (a script was blocked or broken, a file is missing, the file was edited after it was
   built), it says so on screen, in plain words, instead of leaving a blank page. It does nothing while the app
   starts normally. Kept tiny and independent of the other modules, so it still runs when they do not. */
(function (root) {
  'use strict';
  var doc = root.document;
  if (!doc || !doc.addEventListener) return;                       // not a browser (the Node tests load modules without a page)

  var problems = [], blocked = false, missing = false, shown = false;
  function note(s) {
    s = String(s || '').replace(/\s+/g, ' ').slice(0, 200);
    if (s && problems.indexOf(s) < 0 && problems.length < 8) problems.push(s);
  }
  function started() { return !!(root.HA && root.HA.app); }       // app.js sets HA.app as its very last step

  root.addEventListener('error', function (e) {                   // capture phase: also sees <script src> files that failed to load
    var t = e && e.target;
    if (t && t !== root && t.tagName === 'SCRIPT') { missing = true; note('Could not load ' + (t.getAttribute('src') || 'a script')); }
    else if (e && e.message) note(e.message);
  }, true);
  doc.addEventListener('securitypolicyviolation', function (e) {
    var d = String(e.effectiveDirective || e.violatedDirective || '');
    if (/^script-src/.test(d)) blocked = true;
    note('Blocked by the security policy: ' + d + ' ' + (e.blockedURI || ''));
  });

  var TEXT = {
    blocked: {
      en: 'A script in this file no longer matches the fingerprint the browser expects, so the browser blocked it. This happens when index.html was edited, re-saved, copied through another app, or changed by a host. Upload the original index.html again, unchanged.',
      lv: 'Kāds skripts failā vairs neatbilst kontrolkodam, ko gaida pārlūks, tāpēc tas to bloķēja. Tā notiek, ja index.html ir rediģēts, atkārtoti saglabāts, kopēts caur citu lietotni vai mainīts hostingā. Augšupielādē oriģinālo index.html vēlreiz, neko nemainot.'
    },
    missing: {
      en: 'A file the app needs could not be loaded. Upload every file of the app in the same folders, or use the single-file index.html.',
      lv: 'Nevarēja ielādēt kādu no lietotnes failiem. Augšupielādē visus lietotnes failus tajās pašās mapēs vai izmanto vienu failu index.html.'
    },
    error: {
      en: 'The app hit an error while starting. The details below say where.',
      lv: 'Startējot lietotni, radās kļūda. Detaļas ir zemāk.'
    },
    silent: {
      en: 'The app scripts did not run. The page may be open as plain text or a preview, or JavaScript is off. Open the app from its web address (for example the github.io address), not from the code view or a downloaded file.',
      lv: 'Lietotnes skripti nedarbojās. Lapa var būt atvērta kā teksts vai priekšskatījums, vai JavaScript ir izslēgts. Atver lietotni no tās tīmekļa adreses (piemēram, github.io), nevis no koda skata vai lejupielādēta faila.'
    }
  };
  function el(tag, css, text) {
    var n = doc.createElement(tag);
    if (css) n.style.cssText = css;
    if (text) n.textContent = text;
    return n;
  }
  function show() {
    if (shown || !doc.body) return;
    shown = true;
    var msg = blocked ? TEXT.blocked : missing ? TEXT.missing : problems.length ? TEXT.error : TEXT.silent;
    var wrap = el('div', 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:99999;overflow:auto;background:#0d0f12;color:#ece7dc;' +
      'padding:28px 20px 40px;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif');
    wrap.id = 'ha-guard'; wrap.setAttribute('role', 'alert');
    wrap.appendChild(el('h1', 'margin:0 0 4px;font-size:22px', 'The app could not start'));
    wrap.appendChild(el('p', 'margin:0 0 16px;color:#a9a396', 'Lietotne neuzsāka darbu.'));
    wrap.appendChild(el('p', 'margin:0 0 12px', msg.en));
    wrap.appendChild(el('p', 'margin:0 0 20px;color:#a9a396', msg.lv));
    var info = problems.concat(['Address: ' + (root.location && root.location.href), 'Browser: ' + (root.navigator && root.navigator.userAgent)]).join('\n');
    wrap.appendChild(el('pre', 'margin:0 0 20px;padding:12px;border-radius:8px;background:#171a20;color:#cfc9bb;font:12px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word', info));
    var btn = el('button', 'padding:12px 20px;border:0;border-radius:8px;background:#ece7dc;color:#0d0f12;font:600 16px system-ui,sans-serif', 'Reload / Pārlādēt');
    btn.addEventListener('click', function () { root.location.reload(); });
    wrap.appendChild(btn);
    doc.body.appendChild(wrap);
  }
  function check() { if (!started()) show(); }
  function arm() { root.setTimeout(check, 600); }
  if (doc.readyState === 'complete') arm(); else root.addEventListener('load', arm);
})(typeof window !== 'undefined' ? window : globalThis);
