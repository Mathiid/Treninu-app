/* timer.js — the rest timer.
   core: a tiny clock-based state machine (always correct after the screen was off, because it stores
         the end timestamp rather than counting ticks).
   fx:   sound (Web Audio), vibration, notifications (page + service worker) and screen wake lock.
   Short beeps only: we never loop audio, so YouTube Music keeps playing underneath. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};

  function makeCore(nowFn) {
    var now = nowFn || function () { return Date.now(); };
    var st = { active: false, end: 0, total: 0, label: '', quick: false };
    return {
      start: function (sec, label, quick) {
        st = { active: true, end: now() + sec * 1000, total: Math.max(1, sec), label: label || '', quick: !!quick };
        return st;
      },
      add: function (sec) { if (st.active) { st.end += sec * 1000; st.total = Math.max(1, st.total + sec); } },
      cancel: function () { st.active = false; },
      remaining: function () { return st.active ? Math.max(0, Math.ceil((st.end - now()) / 1000)) : 0; },
      fraction: function () { return st.active ? Math.min(1, Math.max(0, 1 - (st.end - now()) / (st.total * 1000))) : 0; },
      due: function () { return st.active && now() >= st.end; },
      state: function () { return st; }
    };
  }

  var core = makeCore(), iv = null, actx = null, wake = null, wantWake = false;
  var listeners = { tick: [], done: [] };

  function cfg() { try { return HA.store.get().settings; } catch (e) { return {}; } }
  function emit(name, arg) { listeners[name].forEach(function (f) { try { f(arg); } catch (e) { /* listener errors never stop the timer */ } }); }
  function hidden() { return typeof document !== 'undefined' && document.visibilityState === 'hidden'; }

  // Browsers only allow audio after a user gesture: call this from a tap handler.
  function unlock() {
    // Safari: "ambient" lets our beeps mix with music instead of interrupting it
    try { if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'ambient'; } catch (e) { /* unsupported */ }
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { /* no audio available */ }
  }
  function tone(freq, t0, dur, vol) {
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function beep(quick) {
    if (cfg().sound === false || !actx) return;
    try {
      var t = actx.currentTime + 0.02;
      if (quick) tone(880, t, 0.14, 0.28);
      else { tone(784, t, 0.16, 0.32); tone(784, t + 0.24, 0.16, 0.32); tone(1175, t + 0.48, 0.4, 0.36); }
    } catch (e) { /* ignore */ }
  }
  /* Cues for the live heart-rate zone: 'high' three quick high beeps, 'low' two falling beeps, 'back' a soft rising pair. */
  function cue(kind) {
    try {
      if (cfg().sound !== false && actx) {
        var t = actx.currentTime + 0.02;
        if (kind === 'high') { tone(1000, t, 0.12, 0.3); tone(1000, t + 0.2, 0.12, 0.3); tone(1000, t + 0.4, 0.12, 0.3); }
        else if (kind === 'low') { tone(440, t, 0.25, 0.3); tone(330, t + 0.32, 0.3, 0.3); }
        else { tone(660, t, 0.12, 0.2); tone(880, t + 0.16, 0.16, 0.2); }
      }
      if (cfg().vibrate !== false && root.navigator && root.navigator.vibrate) root.navigator.vibrate(kind === 'high' ? [100, 60, 100, 60, 100] : kind === 'low' ? [350] : [70]);
    } catch (e) { /* no audio or vibration here */ }
  }
  function vibrate(quick) {
    try { if (cfg().vibrate !== false && root.navigator && root.navigator.vibrate) root.navigator.vibrate(quick ? [120] : [220, 90, 220, 90, 500]); } catch (e) { /* unsupported */ }
  }
  /* The service worker is optional (the single-file build has none). `ready` never resolves when nothing
     is registered, so ask for the registration first and only wait on `ready` if there is one. */
  function withSW(fn, none) {
    try {
      var sw = root.navigator && root.navigator.serviceWorker;
      if (!sw || !sw.getRegistration) { if (none) none(); return; }
      sw.getRegistration().then(function (reg) {
        if (!reg) { if (none) none(); return; }
        return sw.ready.then(fn);
      }).catch(function () { if (none) none(); });
    } catch (e) { if (none) none(); }
  }
  function postSW(msg) {
    withSW(function (reg) { if (reg.active) reg.active.postMessage(msg); });
  }
  function appIcon() {
    try { var l = root.document && root.document.querySelector('link[rel="icon"]'); return l ? l.href : undefined; } catch (e) { return undefined; }
  }
  function notify(label) {
    try {
      if (cfg().notify === false || !root.Notification || root.Notification.permission !== 'granted') return;
      var opts = { body: label ? 'Next: ' + label : 'Time for your next set.', tag: 'ha-rest', renotify: true, vibrate: [220, 90, 220, 90, 500], icon: appIcon() };
      var direct = function () { try { new root.Notification('Rest is over', opts); } catch (e) { /* not allowed here */ } };
      withSW(function (reg) { return reg.showNotification('Rest is over', opts); }, direct);
    } catch (e) { /* ignore */ }
  }

  function stopLoop() { if (iv) { clearInterval(iv); iv = null; } }
  function finish() {
    var st = core.state(), snap = { label: st.label, quick: st.quick };
    core.cancel(); stopLoop();
    beep(snap.quick); vibrate(snap.quick);
    if (hidden()) notify(snap.label);
    postSW({ type: 'rest-cancel' });
    emit('done', snap);
  }
  function tick() {
    if (!core.state().active) return;
    if (core.due()) finish(); else emit('tick');
  }
  function startLoop() { stopLoop(); if (typeof setInterval !== 'undefined') iv = setInterval(tick, 250); }
  function schedule() {
    var st = core.state();
    postSW({ type: 'rest-schedule', at: st.end, body: st.label ? 'Next: ' + st.label : 'Time for your next set.', icon: appIcon() });
  }

  function start(sec, label, quick) {
    unlock();
    core.start(sec, label, quick);
    startLoop(); schedule(); emit('tick');
  }
  function add(sec) {
    core.add(sec);
    if (core.due()) tick(); else { schedule(); emit('tick'); }
  }
  function cancel() { core.cancel(); stopLoop(); postSW({ type: 'rest-cancel' }); emit('tick'); }

  function requestNotify() {
    try { if (root.Notification && root.Notification.permission === 'default' && cfg().notify !== false) root.Notification.requestPermission(); } catch (e) { /* ignore */ }
  }
  // Screen wake lock: the most reliable way to keep the timer running between sets.
  function acquire() {
    try {
      if (!wantWake || wake || !root.navigator || !root.navigator.wakeLock) return;
      root.navigator.wakeLock.request('screen').then(function (l) {
        wake = l;
        l.addEventListener('release', function () { wake = null; });
      }).catch(function () {});
    } catch (e) { /* unsupported */ }
  }
  function keepAwake(on) {
    wantWake = !!on && cfg().wakeLock !== false;
    if (wantWake) acquire();
    else if (wake) { try { wake.release(); } catch (e) { /* ignore */ } wake = null; }
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { acquire(); tick(); }
    });
  }

  HA.timer = {
    makeCore: makeCore, core: core, start: start, add: add, cancel: cancel, tick: tick, unlock: unlock, cue: cue,
    requestNotify: requestNotify, keepAwake: keepAwake,
    on: function (name, fn) { listeners[name].push(fn); },
    remaining: function () { return core.remaining(); }, state: function () { return core.state(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
