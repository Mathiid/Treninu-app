/* actions.js — every state change the UI can make. Pure functions over the state object (no DOM),
   so the whole flow (start, tick sets, rest, finish, recalibrate) is testable in Node. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  var E = HA.engine, P = HA.program, SS = HA.session;

  function isoToday() { return E.isoDate(new Date()); }

  // Which week/day the Today screen opens on.
  function viewFor(S, todayISO) {
    var pos = E.position(S.settings.startDate, todayISO);
    if (pos.state === 'active') return { week: pos.week, day: pos.day };
    if (pos.state === 'before') return { week: 1, day: 1 };
    return { week: 16, day: 7 };
  }

  /* ----------------------------------------------------------------- workout */
  function exAt(ses, it, ex) {
    var item = ses && ses.items[it];
    if (!item) return null;
    if (item.kind === 'ex') return item.ex;
    if (item.kind === 'group') return item.exs[ex] || null;
    return null;
  }
  function startWorkout(S, week, day, todayISO) {
    S.active = SS.build(P.getWorkout(week, day), S, todayISO || isoToday());
    return S.active;
  }
  function discard(S) { S.active = null; }

  function parseNum(raw) {
    var t = String(raw == null ? '' : raw).replace(',', '.').trim();
    if (t === '') return null;
    var n = parseFloat(t);
    return isFinite(n) && n >= 0 && n < 100000 ? n : undefined;     // undefined = reject
  }
  // field: 'w' (entered in the display unit, stored in kg) or 'r' (reps / seconds)
  function setField(S, loc, field, raw) {
    var ex = exAt(S.active, loc.it, loc.ex), st = ex && ex.sets[loc.set];
    var n = parseNum(raw);
    if (!st || n === undefined) return false;
    if (field === 'w') st.w = n === null ? null : E.toKg(n, S.settings.units);
    else if (field === 'r') st.r = n;
    else return false;
    return true;
  }
  // Ticking a set fills in the written target if you left reps empty, then plans the rest period.
  function toggleSet(S, loc) {
    var ses = S.active, ex = exAt(ses, loc.it, loc.ex), st = ex && ex.sets[loc.set];
    if (!st) return null;
    if (st.done) { st.done = false; return { done: false, plan: null }; }
    if ((ex.mode === 'reps' || ex.mode === 'weightReps' || ex.mode === 'hold') && st.r == null && ex.target != null) st.r = ex.target;
    st.done = true;
    ses.cur = { it: loc.it, ex: loc.ex, set: loc.set };       // where you are now: "up next" follows this
    return { done: true, plan: S.settings.autoRest ? SS.restPlan(ses, loc.it, loc.ex, loc.set) : null };
  }
  function addSet(S, loc) { var ex = exAt(S.active, loc.it, 0 + loc.ex); if (ex) SS.addSet(ex); }
  function removeSet(S, loc) { var ex = exAt(S.active, loc.it, loc.ex); return ex ? SS.removeSet(ex) : false; }
  function addRound(S, it) { var g = S.active.items[it]; if (g && g.kind === 'group') SS.addRound(g); }
  function removeRound(S, it) { var g = S.active.items[it]; return g && g.kind === 'group' ? SS.removeRound(g) : false; }
  function skipEx(S, loc, skip) { var ex = exAt(S.active, loc.it, loc.ex); if (ex) ex.skipped = !!skip; }

  // Save the session as a log and report how each lift's 1RM estimate moved.
  function finish(S, now) {
    var ses = S.active;
    if (!ses) return { empty: true };
    var log = SS.toLog(ses, now);
    if (!log) return { empty: true };
    var keys = {}, before = {};
    log.entries.forEach(function (e) { if (e.liftKey) keys[e.liftKey] = 1; });
    Object.keys(keys).forEach(function (k) { before[k] = E.oneRMFor(S, k, log.date); });
    S.logs.push(log);
    S.logs.sort(function (a, b) { return a.startedAt - b.startedAt; });
    S.active = null;
    var deltas = Object.keys(keys).map(function (k) {
      var after = E.oneRMFor(S, k, log.date);
      return { key: k, before: before[k] ? before[k].kg : null, after: after ? after.kg : null };
    });
    var sets = 0; log.entries.forEach(function (e) { sets += e.sets.length; });
    return { log: log, deltas: deltas, sets: sets, volumeKg: log.volumeKg, durationSec: log.durationSec };
  }
  function deleteLog(S, id) {
    var n = S.logs.length;
    S.logs = S.logs.filter(function (l) { return l.id !== id; });
    return S.logs.length < n;
  }

  /* ----------------------------------------------------------- Ducky changes */
  // Applies to the open workout if there is one, otherwise stored for the day and applied when it starts.
  function applyDuckyMods(S, mods, week, day, todayISO) {
    var wk = P.getWorkout(week, day);
    if (S.active) {
      var changed = SS.applyMods(S.active, mods, S.settings);
      noteChanges(S, wk, changed);
      return { mode: 'active', changed: changed };
    }
    var probe = SS.build(wk, { settings: S.settings, baselines: S.baselines, logs: S.logs, overrides: {} }, todayISO);
    var hit = SS.applyMods(probe, mods, S.settings);
    if (!hit.length) return { mode: 'none', changed: [] };
    S.overrides[todayISO + ':' + wk.wid] = mods;
    noteChanges(S, wk, hit);
    return { mode: 'stored', changed: hit };
  }
  // A change to the structure of a session is written on its calendar event too ("Ducky: ...").
  function noteChanges(S, wk, changed) {
    if (!changed || !changed.length || !HA.sched) return;
    var uid = HA.sched.mainUid(wk), cur = S.sched && S.sched[uid] && S.sched[uid].note || '', items = cur ? cur.replace(/^Ducky: /, '').split('; ') : [];
    changed.forEach(function (c) { if (items.indexOf(c) < 0) items.push(c); });
    HA.sched.setNote(S, uid, 'Ducky: ' + items.join('; '));
    return uid;
  }
  function clearOverride(S, todayISO, wid) { delete S.overrides[todayISO + ':' + wid]; }

  /* ------------------------------------------------------------ lifts & marks */
  function setBaseline(S, key, displayValue, todayISO) {
    var n, kg;
    if (key === 'pullup' && /^\s*\+/.test(String(displayValue))) {       // "+30" = 30 added to bodyweight for one rep
      var add = parseNum(String(displayValue).replace('+', '')), bw = E.bodyKg(S.settings);
      if (!add || !bw) return false;
      kg = bw + E.toKg(add, S.settings.units);
    } else {
      if (/^\s*\+/.test(String(displayValue))) return false;           // "+added" only makes sense for pull-ups
      n = parseNum(displayValue);
      if (!n) return false;
      kg = E.toKg(n, S.settings.units);
    }
    S.baselines[key] = { kg: kg, at: todayISO || isoToday(), ts: Date.now() };
    return true;
  }
  function clearBaseline(S, key) { delete S.baselines[key]; }
  function toggleMark(S, key) { if (S.marks[key]) { delete S.marks[key]; return false; } S.marks[key] = Date.now(); return true; }

  /* ---------------------------------------------------------------- settings */
  var NUMERIC = { age: 1, rhr: 1, mhr: 1, zoneLo: 1, zoneHi: 1, increment: 1, 'times.amDur': 1, 'times.pmDur': 1, 'times.recDur': 1, 'times.sprDur': 1 };
  function setSetting(S, path, value) {
    var parts = path.split('.'), o = S.settings, i;
    if (NUMERIC[path]) {
      var n = parseNum(value);
      if (n === undefined) return false;
      value = n === 0 ? null : n;
    }
    if (path === 'bodyKg') {                          // typed in the current units, kept in kg
      var bn = parseNum(value);
      if (bn === undefined) return false;
      if (bn === null || bn === 0) value = null;
      else { var bk = E.toKg(bn, S.settings.units); if (bk < 25 || bk > 400) return false; value = Math.round(bk * 100) / 100; }
    }
    if (path === 'startDate' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    if (path === 'raceDist' || path === 'raceTime') {          // a recent race or time trial, used for the pace estimate when there are no runs yet
      var race = S.settings.race || {}, Z = HA.zone2;
      if (path === 'raceDist') { var rd = parseNum(value); if (rd === undefined) return false; race.km = rd ? Math.round(Z.toKm(rd, S.settings.paceUnit) * 1000) / 1000 : null; }
      else { var rs = String(value).trim() ? Z.parseDuration(value) : null; if (String(value).trim() && !rs) return false; race.sec = rs; }
      S.settings.race = race.km || race.sec ? race : null;
      return true;
    }
    if (path === 'startDate' || /^times\./.test(path)) S.settings.timesAt = Date.now();     // the calendar compares this with its own edit time
    for (i = 0; i < parts.length - 1; i++) { if (!o[parts[i]] || typeof o[parts[i]] !== 'object') return false; o = o[parts[i]]; }
    o[parts[parts.length - 1]] = value;
    return true;
  }
  /* ------------------------------------------------------------------ runs */
  // r: { date, km, sec, hr } with the distance already in km. Returns the saved run, or null when something is out of range.
  function addRun(S, r, src) {
    var km = +r.km, sec = Math.round(+r.sec), hr = r.hr ? Math.round(+r.hr) : 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || !(km >= 0.3 && km <= 200) || !(sec >= 120 && sec <= 86400) || (hr && (hr < 40 || hr > 230))) return null;
    var run = { id: 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), date: r.date, km: Math.round(km * 100) / 100, sec: sec, hr: hr || 0, src: src || 'manual' };
    S.runs.push(run);
    if (S.runs.length > 200) S.runs = S.runs.slice(-200);
    return run;
  }
  function deleteRun(S, id) { var n = S.runs.length; S.runs = S.runs.filter(function (r) { return r.id !== id; }); return S.runs.length < n; }

  /* ---------------------------------------------------- moving a session */
  function moveSession(S, uid, date, start, mins) {
    var b = HA.sched.baseEvent(S, uid, false);
    return !!b && HA.sched.setMove(S, b, date, start, +mins, Date.now());
  }
  function resetMove(S, uid) { HA.sched.clearMove(S, uid); }

  function restartProgram(S, todayISO) { S.settings.startDate = E.nextMondayISO(todayISO || isoToday()); }
  function startProgramToday(S, todayISO) { S.settings.startDate = todayISO || isoToday(); }

  HA.actions = {
    isoToday: isoToday, viewFor: viewFor, exAt: exAt, startWorkout: startWorkout, discard: discard, parseNum: parseNum,
    setField: setField, toggleSet: toggleSet, addSet: addSet, removeSet: removeSet, addRound: addRound, removeRound: removeRound,
    skipEx: skipEx, finish: finish, deleteLog: deleteLog, applyDuckyMods: applyDuckyMods, clearOverride: clearOverride,
    setBaseline: setBaseline, clearBaseline: clearBaseline, toggleMark: toggleMark, setSetting: setSetting,
    restartProgram: restartProgram, startProgramToday: startProgramToday,
    addRun: addRun, deleteRun: deleteRun, moveSession: moveSession, resetMove: resetMove, noteChanges: noteChanges
  };
})(typeof window !== 'undefined' ? window : globalThis);
