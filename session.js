/* session.js — a live workout: building it from a resolved day, editing it, the rest/superset flow,
   applying Ducky's modifications, and turning it into a saved log. Pure logic, no DOM. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  var E = HA.engine;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function sid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function allExs(session) {
    var out = [];
    session.items.forEach(function (it) {
      if (it.kind === 'ex') out.push(it.ex);
      else if (it.kind === 'group') it.exs.forEach(function (e) { out.push(e); });
    });
    return out;
  }

  // Pre-fill one exercise: % of the current 1RM for the six tracked lifts (pull-ups: the weight to ADD to
  // bodyweight), "last time (+1 step)" for other weighted work, and the written rep/second target for the rest.
  function mkSessionEx(ex, state, todayISO) {
    var s = state.settings, incKg = E.toKg(E.incOf(s), s.units);
    var e = clone(ex);
    e.skipped = false; e.sets = []; e.modified = false;
    var rm = e.liftKey ? E.oneRMFor(state, e.liftKey, todayISO) : null;
    var base = rm && e.pct ? E.workingKg(e.liftKey, rm.kg, e.pct, s) : null;
    var suggest = (e.mode === 'weightReps' && base == null) ? E.suggestFromLast(E.prevSets(state, e.name), e, incKg) : null;
    e.oneRM = rm ? rm.kg : null;
    e.targetKg = base;
    if (e.liftKey === 'pullup') e.bodyKg = E.bodyKg(s) || null;       // saved with the log, so the 1RM estimate can use it later
    var hasR = e.mode === 'reps' || e.mode === 'weightReps' || e.mode === 'hold';
    for (var i = 0; i < ex.sets; i++) {
      var w = null;
      if (e.mode === 'weightReps') w = base != null ? (base > 0 ? base : null) : (suggest ? suggest(i) : null);   // pull-up at bodyweight: empty field
      e.sets.push({ w: w, r: hasR ? e.target : null, done: false });
    }
    return e;
  }

  function build(workout, state, todayISO) {
    var items = workout.items.map(function (it) {
      if (it.kind === 'section') return { kind: 'section', title: it.title };
      if (it.kind === 'ex') return { kind: 'ex', ex: mkSessionEx(it.ex, state, todayISO) };
      return { kind: 'group', label: it.label, sub: it.sub, variant: it.variant, restAfter: it.restAfter,
               exs: it.exs.map(function (e) { return mkSessionEx(e, state, todayISO); }) };
    });
    var ses = {
      id: sid(), startedAt: Date.now(), date: todayISO, week: workout.week, day: workout.day, wid: workout.wid,
      title: workout.shortTitle, fullTitle: workout.title, deload: workout.deload, phase: workout.phase,
      block: workout.block, belt: workout.belt, kind: workout.kind, items: items
    };
    var ov = state.overrides && state.overrides[todayISO + ':' + workout.wid];
    if (ov && ov.length) applyMods(ses, ov, state.settings);
    return ses;
  }

  /* ------------------------------------------------------------- editing sets */
  function addSet(ex) {
    var last = ex.sets[ex.sets.length - 1] || { w: null, r: ex.target };
    ex.sets.push({ w: last.w, r: last.r, done: false });
  }
  function removeSet(ex) {
    for (var i = ex.sets.length - 1; i >= 0; i--) {
      if (!ex.sets[i].done) { ex.sets.splice(i, 1); return true; }
    }
    return false;
  }
  function adjustSets(ex, n) {
    var done = ex.sets.filter(function (s) { return s.done; }).length;
    n = Math.max(n, done);
    while (ex.sets.length > n && removeSet(ex)) { /* drop undone sets from the end */ }
    while (ex.sets.length < n) addSet(ex);
  }
  function addRound(group) { group.exs.forEach(function (e) { if (!e.skipped) addSet(e); }); }
  function removeRound(group) {
    var any = false;
    group.exs.forEach(function (e) { if (!e.skipped && removeSet(e)) any = true; });
    return any;
  }

  /* ----------------------------------------------------- Ducky modifications */
  function findEx(session, name) {
    var q = E.normName(name), exact = null, loose = null;
    session.items.forEach(function (it) {
      var list = it.kind === 'ex' ? [it.ex] : it.kind === 'group' ? it.exs : [];
      list.forEach(function (ex) {
        var n = E.normName(ex.name);
        var hit = { ex: ex, group: it.kind === 'group' ? it : null };
        if (n === q) exact = exact || hit;
        else if (q && (n.indexOf(q) >= 0 || q.indexOf(n) >= 0)) loose = loose || hit;
      });
    });
    return exact || loose;
  }
  // Only touches sets that are not done yet. Returns the list of exercise names that changed.
  function applyMods(session, mods, settings) {
    var changed = [];
    mods.forEach(function (m) {
      var hit = findEx(session, m.exercise);
      if (!hit) return;
      var ex = hit.ex;
      if (m.skip) ex.skipped = true;
      if (m.sets) (hit.group ? hit.group.exs : [ex]).forEach(function (t) { adjustSets(t, m.sets); });
      if (m.reps) {
        ex.target = ex.lo = ex.hi = m.reps;
        ex.label = E.fmtTarget({ lo: m.reps, hi: m.reps, unit: ex.unit, suffix: ex.suffix });
        ex.sets.forEach(function (st) { if (!st.done && (ex.mode === 'reps' || ex.mode === 'weightReps' || ex.mode === 'hold')) st.r = m.reps; });
      }
      if (m.weightFactor) {
        ex.sets.forEach(function (st) { if (!st.done && st.w > 0) st.w = E.roundWeightKg(st.w * m.weightFactor, settings || {}); });
        if (ex.targetKg) ex.targetKg = E.roundWeightKg(ex.targetKg * m.weightFactor, settings || {});
      }
      ex.modified = true;
      if (m.note) ex.note = m.note;
      changed.push(ex.name);
    });
    return changed;
  }

  /* --------------------------------------------------- flow: what's next, rest */
  function hasUndone(ex) { return !ex.skipped && ex.sets.some(function (s) { return !s.done; }); }
  function liveExs(group) { return group.exs.filter(function (e) { return !e.skipped; }); }

  // Every set in the order you would normally do it (supersets go round by round).
  function order(session) {
    var out = [];
    session.items.forEach(function (it, i) {
      if (it.kind === 'ex' && !it.ex.skipped) {
        it.ex.sets.forEach(function (st, s) { out.push({ it: i, ex: 0, set: s, st: st }); });
      } else if (it.kind === 'group') {
        var maxR = 0;
        it.exs.forEach(function (e) { if (!e.skipped && e.sets.length > maxR) maxR = e.sets.length; });
        for (var r = 0; r < maxR; r++) {
          for (var k = 0; k < it.exs.length; k++) {
            var e = it.exs[k];
            if (!e.skipped && e.sets[r]) out.push({ it: i, ex: k, set: r, st: e.sets[r] });
          }
        }
      }
    });
    return out;
  }
  // The set to do next: the first unfinished one after the set you last ticked, wrapping round to the
  // start. Without a last-ticked set (a fresh workout) it is simply the first unfinished set. Following
  // your position matters when you jump ahead because a rack is taken: the screen must not jump back.
  function nextPending(session) {
    var seq = order(session), from = 0, c = session.cur;
    if (c) {
      for (var i = 0; i < seq.length; i++) if (seq[i].it === c.it && seq[i].ex === c.ex && seq[i].set === c.set) { from = i + 1; break; }
    }
    for (var j = 0; j < seq.length; j++) {
      var p = seq[(from + j) % seq.length];
      if (!p.st.done) return { it: p.it, ex: p.ex, set: p.set };
    }
    return null;
  }
  function nextName(session, itIdx) {
    for (var j = itIdx + 1; j < session.items.length; j++) {
      var it = session.items[j];
      if (it.kind === 'ex' && hasUndone(it.ex)) return it.ex.name;
      if (it.kind === 'group') { var e = it.exs.filter(hasUndone)[0]; if (e) return e.name; }
    }
    return null;
  }
  // Rest after ticking a set. Inside a superset the rest is the exercise's own short rest (30 s) until
  // the last exercise of the round, whose rest is the full rest; after the final round the group's
  // "rest after superset" applies. Nothing starts after the very last set of the workout.
  function restPlan(session, itIdx, exIdx, setIdx) {
    var it = session.items[itIdx], plan = null;
    if (!it) return null;
    if (it.kind === 'ex') {
      var ex = it.ex, n = ex.sets.length;
      if (setIdx < n - 1) plan = { sec: ex.rest, next: ex.name + ', set ' + (setIdx + 2), quick: false };
      else {
        var nx = nextName(session, itIdx);
        if (nx) plan = { sec: ex.restAfter != null ? ex.restAfter : ex.rest, next: nx, quick: false };
      }
    } else if (it.kind === 'group') {
      var live = liveExs(it), cur = it.exs[exIdx], pos = live.indexOf(cur);
      if (pos < 0) return null;
      var rounds = cur.sets.length;
      if (pos < live.length - 1) plan = { sec: cur.rest, next: live[pos + 1].name + ', round ' + (setIdx + 1), quick: true };
      else if (setIdx < rounds - 1) plan = { sec: cur.rest, next: live[0].name + ', round ' + (setIdx + 2), quick: false };
      else {
        var nx2 = nextName(session, itIdx);
        if (nx2) plan = { sec: it.restAfter != null ? it.restAfter : cur.rest, next: nx2, quick: false };
      }
    }
    return plan && plan.sec > 0 ? plan : null;
  }
  function progress(session) {
    var done = 0, total = 0;
    allExs(session).forEach(function (e) {
      if (e.skipped) return;
      e.sets.forEach(function (s) { total++; if (s.done) done++; });
    });
    return { done: done, total: total };
  }

  /* ----------------------------------------------------------------- finishing */
  function toLog(session, now) {
    now = now || Date.now();
    var entries = [], vol = 0;
    allExs(session).forEach(function (e) {
      if (e.skipped) return;
      var done = e.sets.filter(function (s) { return s.done; });
      if (!done.length) return;
      entries.push({
        name: e.name, cat: e.cat, mode: e.mode, liftKey: e.liftKey, rir: e.rir, pct: e.pct, bodyKg: e.bodyKg || undefined,
        sets: done.map(function (s) { return { w: s.w, r: s.r }; })
      });
      if (e.mode === 'weightReps') done.forEach(function (s) { if (s.w > 0 && s.r > 0) vol += s.w * s.r; });
    });
    if (!entries.length) return null;
    return {
      id: session.id, date: session.date, week: session.week, day: session.day, wid: session.wid, title: session.title,
      deload: !!session.deload, phase: session.phase, startedAt: session.startedAt, finishedAt: now,
      durationSec: Math.max(0, Math.round((now - session.startedAt) / 1000)), entries: entries, volumeKg: Math.round(vol)
    };
  }

  HA.session = {
    build: build, allExs: allExs, addSet: addSet, removeSet: removeSet, adjustSets: adjustSets,
    addRound: addRound, removeRound: removeRound, findEx: findEx, applyMods: applyMods,
    nextPending: nextPending, order: order, restPlan: restPlan, progress: progress, toLog: toLog
  };
})(typeof window !== 'undefined' ? window : globalThis);
