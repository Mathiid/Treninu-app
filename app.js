/* app.js — DOM glue. All screens are rendered by views.js (pure strings); this file owns the document:
   event delegation, the workout overlay, sheets, the rest-timer bar, Ducky chat, file downloads and the service worker. */
(function () {
  'use strict';
  var HA = window.HA, E = HA.engine, P = HA.program, SS = HA.session, A = HA.actions, V = HA.views, AI = HA.ai, T = HA.timer, store = HA.store;
  var Z = HA.zone2, SC = HA.sched, HR = HA.hr;

  var tab = 'today', view = { week: 1, day: 1 }, ui = { pending: false, error: null, draft: '' };
  var curSheet = null, workoutOpen = false, liveOpen = false, liveSig = '', runDraft = {}, wkScroll = 0, lastTick = null, goTimer = null, toastTimer = null, REST_KEY = 'ha.rest';

  function $(id) { return document.getElementById(id); }
  function S() { return store.get(); }
  function today() { return A.isoToday(); }
  /* install + offline state, shown in Settings */
  var pwa = { sw: 'checking', err: '', deferred: null, installed: false };
  function isStandalone() {
    try { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) { return false; }
  }
  function pwaView() {
    return { sw: pwa.sw, err: pwa.err, canPrompt: !!pwa.deferred, ios: isIOS(), standalone: pwa.installed || isStandalone(), swSource: !!$('ha-sw-source') };
  }
  function ctx() { return { S: S(), today: today(), view: view, tab: tab, ui: ui, hasKey: !!store.getKey(), persistent: store.isPersistent(), pwa: pwaView(), gcal: gcalView(), origin: location.origin }; }
  function loc(el) { return { it: +el.dataset.it, ex: +(el.dataset.ex || 0), set: +el.dataset.set }; }
  function save() { store.saveSoon(); }
  // Clocks are repainted every second: only touch the DOM when the text changed.
  function setClock(el, str) {
    if (!el || el.dataset.v === str) return;
    el.dataset.v = str; el.innerHTML = V.clockHTML(str); el.setAttribute('aria-label', str);
  }

  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2800);
  }
  /* Safety net: whatever goes wrong inside a tap, a screen or a promise, the app keeps running and your data is untouched. */
  var errAt = 0;
  function softFail(e, what) {
    try { console.error('[Hybrid Athlete] ' + (what || 'error'), e); } catch (x) { /* no console */ }
    if (Date.now() - errAt > 4000) { errAt = Date.now(); toast('Something went wrong, but your data is safe. If it keeps happening, reload the page.'); }
  }
  window.addEventListener('unhandledrejection', function (ev) { try { ev.preventDefault(); } catch (x) { /* ignore */ } softFail(ev && ev.reason, 'unhandled promise'); });
  window.addEventListener('error', function (ev) {
    if (!ev || ev.target !== window || (!ev.error && /ResizeObserver|^Script error/.test(String(ev.message)))) return;
    softFail(ev.error || ev.message, 'uncaught error');
  });
  function syncLock() {
    document.documentElement.style.overflow = (curSheet || workoutOpen || liveOpen) ? 'hidden' : '';
    document.documentElement.classList.toggle('in-workout', workoutOpen);
  }

  /* ---------------------------------------------------------------- rendering */
  function render(keepScroll) {
    var y = window.scrollY, c = ctx(), box = $('duck-input');
    var typed = tab === 'ducky' && box ? box.value : '';
    var html;
    try { html = V[tab](c); } catch (e) {
      softFail(e, 'drawing the ' + tab + ' screen');
      html = '<div class="card banner"><p>This screen could not be drawn. Your data is safe.</p><button class="btn btn-primary" data-act="reload">Reload</button></div>';
    }
    $('view').innerHTML = html;
    $('nav').innerHTML = '<div class="navin">' + V.nav(tab) + '</div>';
    paintPill();
    if (keepScroll) window.scrollTo(0, y);
    var txt = ui.draft || typed;
    ui.draft = '';
    if (tab === 'ducky' && txt) { var inp = $('duck-input'); if (inp) { inp.value = txt; autoGrow(inp); } }
  }
  function paintPill() {
    $('pill-root').innerHTML = S().active && !workoutOpen ? V.resumePill(ctx()) : '';
    tickPill();
  }
  function paintSheet() {
    $('sheet-root').innerHTML = curSheet ? curSheet() : '';
    syncLock();
  }
  function openSheet(fn, focusId) {
    curSheet = fn; paintSheet();
    var el = focusId && $(focusId);
    if (el) { el.focus(); if (el.select) el.select(); }
  }
  function closeSheet() { curSheet = null; paintSheet(); }

  /* ---------------------------------------------------------- workout overlay */
  function openWorkout() {
    if (!S().active) return;
    workoutOpen = true;
    var w = $('workout');
    w.innerHTML = V.workout(ctx());
    w.classList.remove('hidden');
    T.keepAwake(true); T.requestNotify();
    var b = $('wk-body'); if (b && wkScroll) b.scrollTop = wkScroll;
    paintRest(); paintPill(); syncLock();
  }
  function closeWorkout() {
    var b = $('wk-body'); if (b) wkScroll = b.scrollTop;
    workoutOpen = false;
    $('workout').classList.add('hidden');
    paintPill(); syncLock();
  }
  // Repaint only the exercise list, so the rest bar and the scroll position survive.
  function repaintBody() {
    var body = $('wk-body'), ses = S().active;
    if (!body || !ses) return;
    var y = body.scrollTop;
    body.innerHTML = V.workoutBody(ctx());
    body.scrollTop = y;
    var pr = SS.progress(ses), pct = pr.total ? Math.round(100 * pr.done / pr.total) : 0;
    var fill = $('wk-fill'); if (fill) { fill.style.width = pct + '%'; fill.parentNode.setAttribute('aria-valuenow', pct); }
  }
  function scrollToNext() {
    var row = document.querySelector('#wk-body .srow.now');
    if (!row) return;
    var r = row.getBoundingClientRect(), bar = $('restbar');
    var limit = window.innerHeight - (bar && !bar.hidden ? bar.offsetHeight : 0) - 24;
    if (r.bottom > limit || r.top < 90) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function leaveWorkout() {
    T.cancel(); persistRest(); T.keepAwake(false);
    closeWorkout(); wkScroll = 0; closeSheet();
  }

  /* --------------------------------------------------------------- rest timer */
  function persistRest() {
    try {
      var st = T.state();
      if (st.active) localStorage.setItem(REST_KEY, JSON.stringify({ end: st.end, total: st.total, label: st.label, quick: st.quick }));
      else localStorage.removeItem(REST_KEY);
    } catch (e) { /* storage blocked */ }
  }
  function restoreRest() {
    try {
      var r = JSON.parse(localStorage.getItem(REST_KEY) || 'null');
      if (r && r.end > Date.now() + 1000 && S().active) {
        T.start(Math.ceil((r.end - Date.now()) / 1000), r.label, r.quick);
        T.state().total = r.total;
      } else localStorage.removeItem(REST_KEY);
    } catch (e) { /* ignore */ }
  }
  function paintRest() {
    var bar = $('restbar');
    if (!bar) return;
    var st = T.state();
    if (st.active) {
      clearTimeout(goTimer); goTimer = null;
      bar.hidden = false; bar.classList.remove('go');
      setClock($('rest-time'), V.fmtClock(T.remaining()));
      $('rest-fill').style.width = (T.core.fraction() * 100).toFixed(1) + '%';
      $('rest-lab').textContent = st.quick ? 'Straight to the next exercise' : 'Rest';
      $('rest-next').textContent = st.label ? 'Next: ' + st.label : '';
    } else if (!goTimer) bar.hidden = true;
  }
  function tickPill() {
    var el = $('pill-clock'), a = S().active;
    if (!el || !a) return;
    setClock(el, T.state().active ? V.fmtClock(T.remaining()) : V.fmtClock((Date.now() - a.startedAt) / 1000));
  }
  T.on('tick', function () { paintRest(); tickPill(); });
  T.on('done', function (snap) {
    persistRest(); tickPill();
    var bar = $('restbar');
    if (!bar) return;
    bar.hidden = false; bar.classList.add('go');
    var rt = $('rest-time'); rt.dataset.v = 'GO'; rt.textContent = 'GO'; rt.setAttribute('aria-label', 'Rest is over');
    $('rest-lab').textContent = 'Rest is over';
    $('rest-next').textContent = snap.label ? 'Next: ' + snap.label : '';
    clearTimeout(goTimer);
    goTimer = setTimeout(function () { goTimer = null; if (!T.state().active) { bar.classList.remove('go'); bar.hidden = true; } }, 5000);
  });
  setInterval(function () {
    var a = S().active, el = $('elapsed');
    if (el && a) setClock(el, V.fmtClock((Date.now() - a.startedAt) / 1000));
    tickPill();
    if (liveOpen) paintLive(false);
  }, 1000);

  /* ------------------------------------------------------------------- Ducky */
  // "Today's workout" for Ducky is the workout in progress, else the real day's, never the page you happen to be browsing.
  function duckView() {
    var a = S().active;
    return a ? { week: a.week, day: a.day } : A.viewFor(S(), today());
  }
  function autoGrow(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; }
  function scrollChat() { setTimeout(function () { window.scrollTo(0, document.body.scrollHeight); }, 30); }
  function showDucky() { closeSheet(); if (workoutOpen) closeWorkout(); tab = 'ducky'; render(); }

  async function sendDucky(text) {
    text = String(text || '').trim();
    if (!text || ui.pending) return;
    var st = S(), key = store.getKey();
    showDucky();
    if (!key) { ui.error = 'Add your Gemini API key in Settings first.'; ui.draft = text; render(); return; }
    ui.error = null; ui.draft = ''; ui.pending = true;
    st.chat.push({ role: 'user', text: text, at: Date.now() });
    render(); scrollChat();
    var hist = AI.toHistory(st.chat.slice(0, -1));
    var tutorial = AI.detectTutorial(text, P.allExerciseNames());
    try {
      var res = await AI.ask({ key: key, model: st.settings.geminiModel, system: AI.systemPrompt(st, duckView(), today()), history: hist, user: text });
      var r = AI.parseReply(res.text), reply = r.text;
      var msg = { role: 'duck', text: '', at: Date.now() };
      if (tutorial) {
        msg.yt = { name: tutorial, url: AI.youtubeLink(tutorial) };
        reply = reply.split('\n').filter(function (l) { return !/youtube\.com\/results/i.test(l); }).join('\n').trim();
      }
      if (!reply && r.mods.length) reply = 'Here is what I would change.';
      msg.text = reply || 'I have nothing to add to that.';
      if (r.mods.length) msg.mods = r.mods;
      st.chat.push(msg);
      ui.pending = false;
    } catch (e) {
      st.chat.pop();                          // take the question back so a retry does not double up
      ui.pending = false; ui.error = e && e.message ? e.message : 'Something went wrong. Try again.'; ui.draft = text;
    }
    store.flush(); render();
    if (tab === 'ducky') scrollChat();
  }

  function applyMods(i) {
    var st = S(), m = st.chat[i];
    if (!m || !m.mods) return;
    var dv = duckView(), r = A.applyDuckyMods(st, m.mods, dv.week, dv.day, today());
    if (r.mode === 'active') {
      m.applied = r.changed.length ? 'Applied: ' + r.changed.join('; ') : 'Nothing changed. Those sets are already done.';
      if (workoutOpen) repaintBody();
    } else if (r.mode === 'stored') {
      m.applied = 'Saved. It applies when you start this workout.';
    } else {
      m.applied = 'Nothing to change: those exercises are not in this workout.';
    }
    store.flush(); render(true); toast(m.applied);
    if (r.mode !== 'none' && r.changed && r.changed.length) { var wk = P.getWorkout(dv.week, dv.day); if (wk) queuePush([SC.mainUid(wk)]); }
  }

  /* -------------------------------------------------------------- file output */
  function download(name, mime, text) {
    var blob = new Blob([text], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  async function deliverICS(text) {
    var name = 'hybrid-athlete-16-weeks.ics';
    try {
      if (isIOS() && window.File && navigator.canShare) {
        var f = new File([text], name, { type: 'text/calendar' });
        if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Hybrid Athlete calendar' }); return; }
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    download(name, 'text/calendar;charset=utf-8', text);
  }
  function buildICS() {
    var st = S().settings, tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
    var ev = SC.allEvents(S(), true, today());                   // the program with any times you moved and notes from Ducky
    return { text: E.icsFromEvents(ev, { tz: tz, name: 'Hybrid Athlete - 16 weeks' }), count: ev.length };
  }

  /* ------------------------------------------------------ Google Calendar sync */
  function tzName() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } }
  function clientId() { return String(S().settings.gcalClientId || '').trim(); }
  function gcalOn() { var g = S().gcal; return !!(g && g.on); }
  var gcalErr = '', gcalProg = '', pushTimer = null, pushAll = false, pushUids = {}, lastAuto = 0, G;
  G = HA.gcal.create({
    S: S, save: function () { store.flush(); }, fetch: function (u, i) { return window.fetch(u, i); }, now: function () { return Date.now(); },
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); }, tz: tzName,
    events: function (withDesc) { return SC.allEvents(S(), withDesc, today()); },
    event: function (uid) { return SC.oneEvent(S(), uid, true, today()); },
    applyRemote: function (uid, R) { return SC.applyRemote(S(), uid, R, Date.now()); },
    tok: { get: store.getTok, set: store.setTok, clear: store.clearTok },
    clientId: clientId, loadGIS: function () { return HA.gcal.loadGIS(document); },
    onChange: function () { gcalProg = ''; refreshGcalUI(true); },
    progress: function (done, total) { gcalProg = done + ' of ' + total; refreshGcalUI(false); }
  });
  function gcalView() { var s = G.status(); s.prog = gcalProg; if (gcalErr) s.err = gcalErr; return s; }
  // Repaint what shows the sync state. A full redraw only happens when nothing is open and nothing is being typed.
  function refreshGcalUI(full) {
    var st = $('gcal-status'); if (st) st.innerHTML = V.gcalStatus(ctx());
    if (!full || workoutOpen || curSheet || liveOpen) return;
    var a = document.activeElement;
    if (a && a !== document.body && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    render(true);
  }
  function gcalFail(e) {
    gcalErr = e && e.message ? e.message : 'Google Calendar did not answer. Try again.';
    gcalProg = ''; refreshGcalUI(true);
  }
  // Sign in if needed (this must run inside the tap that asked for it, or the browser blocks the Google window), then sync.
  async function gcalRun(manual, opts) {
    gcalErr = '';
    try {
      if (!G.tokenOk()) { if (!manual) return; await G.connect(); }
      var r = await G.sync(opts);
      if (r && r.busy) { toast('Already syncing.'); return; }
      if (manual) toast(gcalView().msg || 'Synced.');
    } catch (e) { gcalFail(e); }
  }
  // After a change here: send it to the calendar a moment later (several quick edits go out as one batch).
  function queuePush(uids, everything) {
    if (!gcalOn()) return;
    if (uids) uids.forEach(function (u) { pushUids[u] = 1; }); else pushAll = true;
    if (everything) pushAll = 'full';
    refreshGcalUI(false);
    if (!G.tokenOk()) return;                                   // the pending count tells you; Sync now signs in again
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      var full = pushAll === 'full', list = pushAll ? null : Object.keys(pushUids);
      pushAll = false; pushUids = {};
      if (!G.tokenOk()) return;
      gcalErr = '';
      G.sync(full ? {} : list ? { pushOnly: true, uids: list } : { pushOnly: true }).catch(gcalFail);
    }, 1200);
  }
  function autoSync() {
    if (!gcalOn() || !G.tokenOk() || Date.now() - lastAuto < 120000) return;
    lastAuto = Date.now(); gcalErr = '';
    G.sync().catch(gcalFail);
  }

  /* ----------------------------------------------------------- live heart rate */
  var manual = null;                                   // a heart rate typed in by hand: { bpm, ts }, good for 3 minutes
  function liveModel() {
    var s = HR.state(), z = E.zone2(S().settings), now = Date.now(), st = HR.stats();
    var byHand = s.status !== 'live' && manual && now - manual.ts < 180000, bpm = byHand ? manual.bpm : s.bpm, fr = byHand ? true : HR.fresh(now);
    return { supported: HR.supported(), status: s.status, name: s.name, bpm: bpm, fresh: fr, source: byHand ? 'manual' : 'sensor', zone: fr && z ? Z.zoneOf(bpm, z) : null,
             running: HR.running(), elapsed: HR.elapsed(now), z: z, err: s.err, inPct: st && st.hrSec >= 5 ? Math.round(100 * st.inSec / st.hrSec) : null };
  }
  function liveManual() {
    var el = $('lr-manual'), n = el ? parseInt(String(el.value).replace(/\D/g, ''), 10) : NaN;
    if (!(n >= 30 && n <= 230)) { toast('Enter a heart rate between 30 and 230.'); return; }
    manual = { bpm: n, ts: Date.now() }; paintLive(true);
  }
  function paintLive(force) {
    var wrap = $('lr-wrap');
    if (!liveOpen || !wrap) return;
    var L = liveModel(), sig = [L.supported, L.status, L.running, L.err, !!L.z, L.name, L.source].join('|');
    if (force || sig !== liveSig) { liveSig = sig; wrap.innerHTML = V.liveBody(ctx(), L); return; }
    var zn = L.fresh && L.z ? L.zone || 'none' : 'none', main = $('lr-main'), cls = 'lr-main zone-' + zn;
    if (main && main.className !== cls) main.className = cls;
    var b = $('lr-bpm'); if (b) b.textContent = L.fresh ? L.bpm : '–';
    var st = $('lr-state'), txt = V.liveState(L); if (st && st.textContent !== txt) st.textContent = txt;
    var m = $('lr-mark'); if (m) { if (L.fresh && L.z) { m.hidden = false; m.style.left = V.gaugePos(L.bpm, L.z).toFixed(1) + '%'; } else m.hidden = true; }
    var t = $('lr-time'); if (t) t.textContent = V.fmtClock(L.elapsed);
    var iz = $('lr-inzone'); if (iz) iz.textContent = L.inPct == null ? '–' : L.inPct + '%';
  }
  function openLive() {
    liveOpen = true; liveSig = '';
    var box = $('runlive'); box.innerHTML = V.liveRun(ctx(), liveModel()); box.classList.remove('hidden');
    paintLive(true); syncLock();
    var x = box.querySelector('.icon-btn'); if (x) x.focus();
  }
  function closeLive() { liveOpen = false; $('runlive').classList.add('hidden'); syncLock(); if (HR.running()) toast('The run keeps going. Open Live heart rate to see it.'); }
  HR.on(function () { paintLive(false); });
  function liveConnect(all) { T.unlock(); HR.connect(all).catch(function () { /* the reason is in the sensor state and shown on screen */ }); }
  function liveStart() {
    var z = E.zone2(S().settings);
    if (!z) { toast('Add your age in Settings first.'); return; }
    HR.startRun(z, Date.now()); paintLive(true);
  }
  function liveStop() {
    var s = HR.stopRun(Date.now());
    liveOpen = false; $('runlive').classList.add('hidden'); syncLock();
    if (!s || s.sec < 120) { toast('That was under two minutes, so it was not saved.'); return; }
    var pct = s.hrSec ? Math.round(100 * s.inSec / s.hrSec) : null, u = S().settings.paceUnit || 'km';
    runDraft = { date: today(), time: Z.fmtDuration(s.sec), hr: s.avgHr || '', dist: '',
                 note: 'Run finished: ' + Z.fmtDuration(s.sec) + (s.avgHr ? ', average ' + s.avgHr + ' bpm' : '') + (pct != null ? ', ' + pct + '% of the time in Zone 2' : '') + '. Add the distance (' + u + ') and save it, and your target pace learns from it.' };
    openSheet(function () { return V.runSheet(ctx(), runDraft); }, 'run-dist');
  }

  /* ---------------------------------------------------------------- runs */
  function saveRun() {
    var u = S().settings.paceUnit || 'km', sec = Z.parseDuration($('run-time').value), d = A.parseNum($('run-dist').value), hr = A.parseNum($('run-hr').value);
    if (!sec) { toast('Enter the time like 42:30.'); return; }
    if (!d) { toast('Enter the distance.'); return; }
    var run = A.addRun(S(), { date: $('run-date').value, km: Z.toKm(d, u), sec: sec, hr: hr || 0 }, runDraft.src || 'manual');
    if (!run) { toast('Check the date, time, distance and heart rate.'); return; }
    runDraft = {}; closeSheet(); store.flush(); render(true); toast('Run saved.');
  }
  function importRun(input) {
    var f = input.files && input.files[0];
    if (!f) return;
    var rd = new FileReader(), note = $('run-import-note');
    rd.onload = function () {
      input.value = '';
      var r = Z.parseRunFile(String(rd.result), E.zone2(S().settings)), u = S().settings.paceUnit || 'km';
      if (!r) { if (note) note.textContent = 'That file is not a TCX or GPX activity. FIT files are not supported: export TCX or GPX instead.'; return; }
      runDraft.src = 'import';
      if ($('run-date')) $('run-date').value = r.date;
      if ($('run-time')) $('run-time').value = Z.fmtDuration(r.sec);
      if ($('run-dist')) $('run-dist').value = r.km ? E.fmtNum(Math.round(Z.fromKm(r.km, u) * 100) / 100) : '';
      if ($('run-hr')) $('run-hr').value = r.avgHr || '';
      var inz = r.avgHr && r.inSec + r.lowSec + r.highSec ? Math.round(100 * r.inSec / (r.inSec + r.lowSec + r.highSec)) + '% of the time in Zone 2. ' : '';
      if (note) note.textContent = 'Read ' + Z.fmtDuration(r.sec) + (r.km ? ', ' + E.fmtNum(Math.round(Z.fromKm(r.km, u) * 100) / 100) + ' ' + u : ', no distance in the file') + (r.avgHr ? ', average ' + r.avgHr + ' bpm' : ', no heart rate in the file') + '. ' + inz + 'Check the numbers, then save.';
    };
    rd.onerror = function () { if (note) note.textContent = 'Could not read that file.'; };
    rd.readAsText(f);
  }
  function refreshPace() { var el = $('pace-result'); if (el) el.innerHTML = V.paceResult(ctx()); }

  /* --------------------------------------------------------------- 1RM helpers */
  function calcOut() {
    var out = $('calc-out'), w = A.parseNum($('calc-w').value), r = A.parseNum($('calc-r').value), st = S().settings, u = st.units;
    if ($('calc-k').value === 'pullup') {                 // weight = what you added; the total includes bodyweight
      var bw = E.bodyKg(st);
      if (!bw) { out.textContent = 'Add your bodyweight in Settings to work out a pull-up 1RM.'; return null; }
      if (w === undefined || !r) { out.textContent = 'Enter the reps and the added weight (0 for bodyweight only).'; return null; }
      var bwd = E.toDisp(bw, u), tot = E.epley(bwd + (w || 0), r);
      out.innerHTML = 'Estimated 1RM: <b>' + E.fmtNum(Math.round(tot * 10) / 10) + '</b> ' + u + ' total (bodyweight ' + E.fmtNum(Math.round(bwd * 10) / 10) + ' + ' + E.fmtNum(Math.round((tot - bwd) * 10) / 10) + ' added)';
      return tot;
    }
    if (!w || !r) { out.textContent = 'Enter a weight and reps.'; return null; }
    var v = E.epley(w, r);
    out.innerHTML = 'Estimated 1RM: <b>' + E.fmtNum(Math.round(v * 10) / 10) + '</b> ' + u;
    return v;
  }
  function refreshZoneLine() {
    var tmp = document.createElement('div'); tmp.innerHTML = V.settings(ctx());
    var a = tmp.querySelector('#sec-hr .result'), b = document.querySelector('#sec-hr .result');
    if (a && b) b.innerHTML = a.innerHTML;
  }

  /* ------------------------------------------------------------------ finish */
  function doFinish() {
    var st = S(), r = A.finish(st, Date.now());
    if (r.empty) { openSheet(emptySheet); return; }
    leaveWorkout();
    store.flush(); render();
    openSheet(function () { return V.summarySheet(ctx(), r); });
  }
  function emptySheet() { return V.confirmSheet('Nothing to save', 'You have not completed any sets, so there is nothing to log.', 'wk-discard', 'Discard workout'); }
  function leftSets() { var p = SS.progress(S().active); return p.total - p.done; }

  /* ----------------------------------------------------------------- clicks */
  function onAct(act, el, ev) {
    try { doAct(act, el, ev); } catch (e) { softFail(e, 'action ' + act); }
  }
  function doAct(act, el, ev) {
    var st = S(), c;
    switch (act) {
      case 'reload': location.reload(); break;
      /* navigation */
      case 'tab': tab = el.dataset.tab; render(); window.scrollTo(0, 0); if (tab === 'ducky') scrollChat(); break;
      case 'goto-settings':
        closeSheet(); if (liveOpen) closeLive(); tab = 'settings'; render();
        var target = el.dataset.focus === 'bw' ? document.querySelector('[data-set="bodyKg"]') : $(el.dataset.focus === 'key' ? 'sec-key' : el.dataset.focus === 'pace' ? 'sec-pace' : 'sec-hr');
        if (target) { target.scrollIntoView({ block: 'center' }); if (el.dataset.focus === 'bw') target.focus(); }
        break;
      case 'goto-lifts': closeSheet(); tab = 'lifts'; render(); window.scrollTo(0, 0); break;
      case 'goto-today': view = A.viewFor(st, today()); tab = 'today'; render(); break;
      case 'wk-prev': view.week = Math.max(1, view.week - 1); render(); break;
      case 'wk-next': view.week = Math.min(16, view.week + 1); render(); break;
      case 'pick-day': view.day = +el.dataset.d; render(true); break;
      case 'open-day': openSheet(function () { return V.daySheet(ctx(), +el.dataset.w, +el.dataset.d); }); break;
      case 'start-today': A.startProgramToday(st, today()); view = A.viewFor(st, today()); store.flush(); render(); toast('Week 1 starts today.'); break;
      case 'restart': A.restartProgram(st, today()); view = A.viewFor(st, today()); store.flush(); render(); toast('New wave starts next Monday.'); break;
      case 'mark': A.toggleMark(st, el.dataset.key); store.flush(); render(true); if (curSheet) paintSheet(); break;

      /* sheets */
      case 'sheet-close': case 'sheet-bg': closeSheet(); break;

      /* starting, leaving and finishing a workout */
      case 'start':
        if (el.dataset.replace) { A.discard(st); T.cancel(); persistRest(); }
        A.startWorkout(st, +el.dataset.w, +el.dataset.d, today());
        wkScroll = 0; closeSheet(); store.flush(); render(); openWorkout();
        break;
      case 'wk-resume': closeSheet(); openWorkout(); break;
      case 'wk-min': closeWorkout(); break;
      case 'wk-finish':
        if (SS.progress(st.active).done === 0) openSheet(emptySheet);
        else if (leftSets() > 0) openSheet(function () { return V.finishSheet(ctx(), leftSets()); });
        else doFinish();
        break;
      case 'wk-finish-go': closeSheet(); doFinish(); break;
      case 'wk-discard': A.discard(st); leaveWorkout(); store.flush(); render(); toast('Workout discarded.'); break;

      /* sets */
      case 'chk':
        T.unlock();
        var l = loc(el), res = A.toggleSet(st, l);
        if (!res) break;
        if (res.done) {
          lastTick = l;
          if (res.plan) { T.start(res.plan.sec, res.plan.next, res.plan.quick); persistRest(); }
        } else if (lastTick && lastTick.it === l.it && lastTick.ex === l.ex && lastTick.set === l.set && T.state().active) {
          T.cancel(); persistRest();
        }
        store.saveSoon(); repaintBody(); paintRest(); scrollToNext();
        break;
      case 'add-set': A.addSet(st, loc(el)); save(); repaintBody(); break;
      case 'rm-set': if (!A.removeSet(st, loc(el))) toast('Untick a set to remove it.'); save(); repaintBody(); break;
      case 'add-round': A.addRound(st, +el.dataset.it); save(); repaintBody(); break;
      case 'rm-round': if (!A.removeRound(st, +el.dataset.it)) toast('Untick a set to remove a round.'); save(); repaintBody(); break;
      case 'skip-ex': A.skipEx(st, loc(el), true); save(); repaintBody(); break;
      case 'unskip': A.skipEx(st, loc(el), false); save(); repaintBody(); break;
      case 'ask-duck': sendDucky('How do I perform ' + el.dataset.name + '?'); break;

      /* rest timer */
      case 'rest-sub': T.add(-15); persistRest(); break;
      case 'rest-add': T.add(15); persistRest(); break;
      case 'rest-skip': T.cancel(); persistRest(); break;

      /* install and offline */
      case 'pwa-install':
        if (pwa.deferred) {
          var dp = pwa.deferred; pwa.deferred = null;
          dp.prompt(); if (dp.userChoice) dp.userChoice.then(function () { pwaChanged(); });
          pwaChanged();
        }
        break;
      case 'sw-download':
        var src = $('ha-sw-source');
        if (src) { download('sw.js', 'text/javascript;charset=utf-8', src.textContent.replace(/^\n/, '')); toast('sw.js saved. Put it next to this page, then reload.'); }
        break;

      /* lifts */
      case 'edit-1rm': openSheet(function () { return V.oneRMSheet(ctx(), el.dataset.key); }, 'rm-input'); break;
      case 'clear-1rm': A.clearBaseline(st, el.dataset.key); store.flush(); render(true); toast('Using your logged estimate.'); break;
      case 'save-1rm':
        if (!A.setBaseline(st, el.dataset.key, $('rm-input').value, today())) {
          toast(el.dataset.key === 'pullup' && !E.bodyKg(st) && /^\s*\+/.test($('rm-input').value) ? 'Add your bodyweight in Settings first.' : 'Enter a number above 0.');
          break;
        }
        closeSheet(); store.flush(); render(true); toast('1RM saved.');
        break;
      case 'calc-save':
        var v = calcOut();
        if (!v) { toast('Enter a weight and reps first.'); break; }
        A.setBaseline(st, $('calc-k').value, String(Math.round(v * 10) / 10), today());
        store.flush(); render(true); toast('1RM saved.');
        break;
      case 'del-log':
        var id = el.dataset.id;
        openSheet(function () { return V.confirmSheet('Delete this session?', 'Its sets stop counting toward your 1RM estimates.', 'del-log-go', 'Delete', ' data-id="' + V.esc(id) + '"'); });
        break;
      case 'del-log-go': A.deleteLog(st, el.dataset.id); closeSheet(); store.flush(); render(true); toast('Session deleted.'); break;

      /* Ducky */
      case 'apply-mods': applyMods(+el.dataset.i); break;
      case 'duck-modify': openSheet(function () { return V.modifySheet(ctx()); }); break;
      case 'duck-how': openSheet(function () { return V.howSheet(ctx()); }); break;
      case 'duck-ask': sendDucky(el.dataset.q); break;
      case 'duck-clear': st.chat = []; ui.error = null; store.flush(); render(); break;
      case 'duck-mod-go': closeSheet(); sendDucky('Modify today’s workout. ' + el.dataset.q); break;
      case 'duck-mod-custom':
        var mt = $('mod-text').value.trim();
        if (!mt) { toast('Describe how you feel first.'); break; }
        closeSheet(); sendDucky('Modify today’s workout. ' + mt);
        break;
      case 'duck-how-go': var nm = $('how-sel').value; closeSheet(); sendDucky('How do I perform ' + nm + '?'); break;

      /* moving a session */
      case 'move-open': openSheet(function () { return V.moveSheet(ctx(), el.dataset.uid); }); break;
      case 'move-save':
        var mu = el.dataset.uid;
        if (!A.moveSession(st, mu, $('mv-date').value, $('mv-time').value, parseInt($('mv-mins').value, 10))) { toast('Check the date, the time and the length (5 to 600 minutes).'); break; }
        closeSheet(); store.flush(); render(true); toast(gcalOn() ? 'Moved. Sending to Google Calendar…' : 'Time changed.'); queuePush([mu]);
        break;
      case 'move-reset':
        var ru = el.dataset.uid;
        A.resetMove(st, ru); closeSheet(); store.flush(); render(true); toast('Back to the program time.'); queuePush([ru]);
        break;

      /* running: live heart rate, logged runs */
      case 'live-open': openLive(); break;
      case 'live-close': closeLive(); break;
      case 'live-connect': liveConnect(false); break;
      case 'live-connect-all': liveConnect(true); break;
      case 'live-disconnect': HR.disconnect(); paintLive(true); break;
      case 'live-manual': liveManual(); break;
      case 'live-start': liveStart(); break;
      case 'live-stop': liveStop(); break;
      case 'run-log': runDraft = {}; openSheet(function () { return V.runSheet(ctx(), runDraft); }, 'run-time'); break;
      case 'run-save': saveRun(); break;
      case 'run-del': A.deleteRun(st, el.dataset.id); store.flush(); render(true); toast('Run deleted.'); break;

      /* Google Calendar */
      case 'gcal-connect': case 'gcal-sync': gcalRun(true); break;
      case 'gcal-force': gcalRun(true, { force: true }); break;
      case 'gcal-disconnect': G.disconnect(); gcalErr = ''; render(true); toast('Disconnected. The calendar stays in your Google account.'); break;

      /* settings */
      case 'cal-download':
        c = buildICS(); deliverICS(c.text); toast(c.count + ' events ready.');
        break;
      case 'key-save':
        var kv = $('key-input').value.trim();
        if (!kv) { $('key-result').textContent = 'Paste your key first.'; break; }
        store.setKey(kv); render(true); $('key-result').textContent = 'Saved on this device.';
        break;
      case 'key-test': testKey(); break;
      case 'key-clear': store.setKey(''); render(true); toast('API key removed.'); break;
      case 'data-export': download('hybrid-athlete-backup-' + today() + '.json', 'application/json', store.exportJSON()); toast('Backup downloaded.'); break;
      case 'data-reset':
        openSheet(function () { return V.confirmSheet('Erase everything?', 'Your logs, 1RMs, settings and API key are deleted from this device. This cannot be undone.', 'data-reset-go', 'Erase everything'); });
        break;
      case 'data-reset-go':
        T.cancel(); persistRest(); T.keepAwake(false); store.setKey(''); try { G.disconnect(); } catch (e) { /* ignore */ } HR.disconnect(); runDraft = {}; gcalErr = ''; store.reset();
        closeSheet(); closeWorkout(); view = A.viewFor(S(), today()); tab = 'today'; ui = { pending: false, error: null, draft: '' };
        render(); window.scrollTo(0, 0); toast('All data erased.');
        break;
      default: break;
    }
  }

  async function testKey() {
    var out = $('key-result'), typed = $('key-input').value.trim(), key = typed || store.getKey();
    if (!key) { out.textContent = 'Paste your key first.'; return; }
    out.textContent = 'Testing…';
    try {
      var r = await AI.ask({ key: key, model: S().settings.geminiModel, system: 'Reply with the single word OK.', history: [], user: 'ping' });
      out.textContent = 'Works. Answered by ' + r.model + '.';
      if (typed) { store.setKey(typed); $('key-input').value = ''; }
    } catch (e) { out.textContent = e.message; }
  }

  document.addEventListener('click', function (ev) {
    var open = document.querySelectorAll('details.more[open]');
    if (open.length) open.forEach(function (d) { if (!d.contains(ev.target)) d.removeAttribute('open'); });
    var el = ev.target.closest && ev.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    // a tap on the sheet content must not fall through to the backdrop
    if (el.classList.contains('sheet-bd') && ev.target !== el) return;
    onAct(el.dataset.act, el, ev);
  });

  /* ------------------------------------------------------------ typing / forms */
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.matches && t.matches('.srow input[data-f]')) {
      A.setField(S(), loc(t), t.dataset.f, t.value);
      save();
      if (t.dataset.f === 'w') {                          // the % of 1RM follows the weight you type
        var l = loc(t), rmEl = $('rm-' + l.it + '-' + l.ex), exo = A.exAt(S().active, l.it, l.ex);
        if (rmEl && exo) rmEl.textContent = V.rmLine(ctx(), exo, l.set);
      }
    } else if (t.id === 'calc-w' || t.id === 'calc-r') calcOut();
    else if (t.id === 'duck-input') autoGrow(t);
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target, st = S();
    if (t.dataset && t.dataset.actChange === 'data-import') { importFile(t); return; }
    if (t.dataset && t.dataset.actChange === 'run-import') { importRun(t); return; }
    if (t.id === 'calc-k') { calcOut(); return; }
    // set-row inputs also carry data-set (the set index): only settings fields have data-type
    var path = t.dataset && t.dataset.type ? t.dataset.set : null;
    if (!path) return;
    var type = t.dataset.type, val = type === 'bool' ? t.checked : t.value;
    if (!A.setSetting(st, path, val)) { toast(path === 'raceTime' ? 'Use minutes and seconds, like 25:00.' : 'That value does not work. Use a number.'); render(true); return; }
    store.flush();
    if (path === 'units' || path === 'bodyKg' || path === 'paceUnit') render(true);
    else if (/^(age|rhr|mhr|mhrFormula|hrMethod|zoneLo|zoneHi)$/.test(path)) { refreshZoneLine(); refreshPace(); }
    else if (path === 'raceDist' || path === 'raceTime') refreshPace();
    else if (path === 'gcalClientId') {                     // a different client id cannot reach the old calendar: start clean
      G.forget(); gcalErr = ''; if (clientId()) G.preload().catch(function () { /* shown when you tap Connect */ });
      var cb = document.querySelector('[data-act="gcal-connect"]'); if (cb) cb.disabled = !clientId();
      refreshGcalUI(false);                                 // no redraw here: the tap that caused this change may be on a button
    }
    else if (path === 'startDate') { view = A.viewFor(st, today()); queuePush(null); }
    else if (/^times\./.test(path)) queuePush(null);
    else if (path === 'includeRest') queuePush(null, true);
    else if (path === 'wakeLock') T.keepAwake(!!st.active && workoutOpen);
  });
  document.addEventListener('submit', function (ev) {
    if (ev.target.dataset && ev.target.dataset.form === 'ducky') {
      ev.preventDefault();
      var inp = $('duck-input'), txt = inp.value; inp.value = ''; autoGrow(inp);
      sendDucky(txt);
    }
  });
  document.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (ev.key === 'Enter' && !ev.shiftKey && t.id === 'duck-input') { ev.preventDefault(); t.form.requestSubmit(); }
    else if (ev.key === 'Enter' && t.id === 'lr-manual') { ev.preventDefault(); liveManual(); }
    else if (ev.key === 'Enter' && t.matches && t.matches('.srow input')) t.blur();
    else if (ev.key === 'Escape') { if (curSheet) closeSheet(); else if (liveOpen) closeLive(); else if (workoutOpen) closeWorkout(); }
  });
  document.addEventListener('focusin', function (ev) {
    if (ev.target.matches && ev.target.matches('.srow input')) setTimeout(function () { try { ev.target.select(); } catch (e) { /* ignore */ } }, 0);
  });

  function importFile(input) {
    var f = input.files && input.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var r = store.importJSON(String(rd.result));
      input.value = '';
      if (!r.ok) { toast(r.error); return; }
      view = A.viewFor(S(), today()); render(); toast('Imported ' + r.logs + ' logged sessions.');
    };
    rd.onerror = function () { toast('Could not read that file.'); };
    rd.readAsText(f);
  }

  /* -------------------------------------------------------------------- boot */
  window.addEventListener('pagehide', function () { store.flush(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') store.flush();
    else { tickPill(); paintRest(); autoSync(); }
  });
  window.addEventListener('online', function () { queuePush(null); });

  function boot() {
    store.load();
    view = A.viewFor(S(), today());
    render();
    restoreRest();
    if (clientId()) G.preload().catch(function () { /* shown when you tap Connect */ });
    autoSync();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* not available */ }
    registerSW();
  }

  /* A service worker must be its own file (browsers refuse one from a blob: or data: URL, or from the page
     itself). So: if sw.js sits next to this page, register it; if not, the app runs fine without it and
     Settings offers the embedded copy to save. */
  function pwaChanged() { if (tab === 'settings' && !workoutOpen && !curSheet) render(true); }
  function registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) { pwa.sw = 'unsupported'; return; }
    fetch('sw.js', { method: 'HEAD', cache: 'no-store' }).then(function (r) {
      var js = /javascript|ecmascript/i.test(r.headers.get('content-type') || '');
      if (!r.ok || !js) { pwa.sw = 'absent'; pwaChanged(); return; }
      return navigator.serviceWorker.register('sw.js').then(function () { return navigator.serviceWorker.ready; })
        .then(function () { pwa.sw = 'active'; pwaChanged(); });
    }).catch(function (e) { pwa.sw = pwa.sw === 'checking' ? 'absent' : 'error'; pwa.err = e && e.message ? String(e.message).slice(0, 120) : ''; pwaChanged(); });
  }
  window.addEventListener('beforeinstallprompt', function (ev) { ev.preventDefault(); pwa.deferred = ev; pwaChanged(); });
  window.addEventListener('appinstalled', function () { pwa.deferred = null; pwa.installed = true; pwaChanged(); toast('Installed.'); });
  boot();

  // exposed so the app can be inspected from the console
  window.HA.app = { render: render, openWorkout: openWorkout };
})();
