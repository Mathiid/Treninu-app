/* Service worker: makes the app work offline and delivers the "rest is over" notification when the page
   itself has been frozen by the browser (screen off, app in the background).
   Bump CACHE whenever a shipped file changes.
   The two BUILD lines are rewritten by tools/build-single.js for the single-file index.html, which has
   nothing to cache but the page itself; there a missing file must not stop the worker installing. */
'use strict';
var CACHE = 'ha-v4';
var SHELL = [   // BUILD:SHELL
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css', 'css/fonts.css', 'fonts/BigShoulders-Bold.woff',
  'js/guard.js', 'js/spec.js', 'js/engine.js', 'js/program.js', 'js/session.js', 'js/store.js', 'js/zone2.js', 'js/sched.js', 'js/actions.js',
  'js/timer.js', 'js/hr.js', 'js/gcal.js', 'js/ai.js', 'js/thumbs.js', 'js/views.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'
];
var STRICT = true;   // BUILD:STRICT

function precache(c) {
  if (STRICT) return c.addAll(SHELL);
  return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () { /* optional */ }); }));
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(precache).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

// Same-origin GETs: answer from the cache at once, refresh it in the background. Gemini calls are never touched.
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () {
          if (hit) return hit;
          if (req.mode !== 'navigate') return Response.error();
          return cache.match('index.html').then(function (p) { return p || cache.match('./'); }).then(function (p) { return p || Response.error(); });
        });
        return hit || net;
      });
    })
  );
});

/* ---- rest timer fallback ------------------------------------------------------------------
   The page asks us to wake at the end of the rest. We aim 1.5 s after the page's own timer so that,
   when the page is still alive, it cancels us first and the user gets one alert, not two. */
var restTimer = null, restDone = null;

function cancelRest() {
  if (restTimer) { clearTimeout(restTimer); restTimer = null; }
  if (restDone) { restDone(); restDone = null; }
}
function appVisible() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    return list.some(function (c) { return c.visibilityState === 'visible'; });
  });
}
self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'rest-cancel') { cancelRest(); return; }
  if (d.type !== 'rest-schedule') return;
  cancelRest();
  var wait = Math.max(0, (d.at || 0) - Date.now()) + 1500;
  // waitUntil keeps the worker alive for the length of the rest (browsers allow a few minutes)
  e.waitUntil(new Promise(function (resolve) {
    restDone = resolve;
    restTimer = setTimeout(function () {
      restTimer = null; restDone = null;
      appVisible().then(function (visible) {
        if (visible) return;
        return self.registration.showNotification('Rest is over', {
          body: d.body || 'Time for your next set.', tag: 'ha-rest', renotify: true,
          vibrate: [220, 90, 220, 90, 500], icon: d.icon || 'icons/icon-192.png', badge: d.icon || 'icons/icon-192.png'
        });
      }).catch(function () { /* no notification permission */ }).then(resolve);
    }, wait);
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) if ('focus' in list[i]) return list[i].focus();
    return self.clients.openWindow('./');
  }));
});
