/* engine.js — pure logic, no DOM.
   Epley 1RM + intensity engine, units, dates, Zone 2 heart rate, rest/target parsing,
   AI-modification sanitiser, and the .ics calendar generator. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};

  var KG_PER_LB = 0.45359237;
  var DELOAD_PCT = 0.55;          // spec: deload weeks run at 50-60% of 1RM
  var TOTAL_DAYS = 112;           // 16 weeks x 7 days

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function roundTo(x, inc) { return inc > 0 ? Math.round(x / inc) * inc : x; }
  function lbToKg(x) { return x * KG_PER_LB; }
  function kgToLb(x) { return x / KG_PER_LB; }
  function num(v) { if (v === null || v === undefined || v === '') return null; var n = +v; return isFinite(n) ? n : null; }

  /* ------------------------------------------------------------------ dates */
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function addDaysISO(s, n) { var d = parseISO(s); d.setDate(d.getDate() + n); return isoDate(d); }
  function daysBetween(a, b) {
    var x = parseISO(a), y = parseISO(b);
    return Math.round((Date.UTC(y.getFullYear(), y.getMonth(), y.getDate()) -
                       Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())) / 864e5);
  }
  function nextMondayISO(todayISO) {
    var dow = parseISO(todayISO).getDay();           // 0 = Sunday
    return addDaysISO(todayISO, dow === 1 ? 0 : (8 - dow) % 7);
  }
  function position(startISO, todayISO) {
    var i = daysBetween(startISO, todayISO);
    if (i < 0) return { state: 'before', daysUntil: -i };
    if (i >= TOTAL_DAYS) return { state: 'after', daysOver: i - TOTAL_DAYS + 1 };
    return { state: 'active', index: i, week: Math.floor(i / 7) + 1, day: (i % 7) + 1 };
  }
  function dateFor(startISO, week, day) { return addDaysISO(startISO, (week - 1) * 7 + (day - 1)); }

  /* -------------------------------------------------------------------- 1RM */
  // Epley: 1RM = w * (1 + reps/30). A single rep IS the 1RM (universal convention).
  function epley(w, r) {
    w = +w; r = +r;
    if (!(w > 0) || !(r > 0)) return 0;
    if (r === 1) return w;
    return w * (1 + r / 30);
  }
  // Epley with "reps in reserve": the set was stopped `rir` reps short of failure.
  function e1rmAdj(w, r, rir) {
    w = +w; r = +r;
    if (!(w > 0) || !(r > 0)) return 0;
    var eff = r + (+rir || 0);
    return eff <= 1 ? w : w * (1 + eff / 30);
  }
  // Inverse of the above: the fraction of 1RM that is right for `reps` leaving `rir` in the tank.
  function pctFor(reps, rir) {
    var eff = (+reps || 0) + (+rir || 0);
    return eff <= 1 ? 1 : 1 / (1 + eff / 30);
  }
  // Reps left in the tank by phase (spec: hypertrophy blocks leave ~2, strength/peak blocks ~1).
  // Power cleans are speed lifts and stop further from failure (+2).
  var BASE_RIR = { b1: 2, b2: 1, b3: 1, b4: 2 };
  function rirFor(phase, liftKey) {
    var b = BASE_RIR[phase]; if (b == null) b = 2;
    return liftKey === 'clean' ? b + 2 : b;
  }

  /* ------------------------------------------ the six lifts driven by a 1RM */
  // Bench, Zercher squat, power clean and RDL load an external weight. So does the Bulgarian split squat
  // (the total weight held, reps counted per leg). The pull-up loads bodyweight PLUS whatever is added:
  // its 1RM and its percentages are about the TOTAL load, and the number typed in the logger is the
  // ADDED weight (empty = bodyweight only).
  var LIFT_KEYS = ['bench', 'zercher', 'clean', 'rdl', 'bss', 'pullup'];
  function bodyKg(s) { return s && +s.bodyKg > 0 ? +s.bodyKg : 0; }
  // total load (kg) of a set with typed weight w; 0 when it cannot be known (pull-up without a bodyweight)
  function loadKg(key, w, bw) {
    w = +w > 0 ? +w : 0;
    if (key === 'pullup') return bw > 0 ? bw + w : 0;
    return w;
  }
  // the weight to type for a set at `pct` of a 1RM; null if it cannot be worked out.
  // Pull-up: the share of the total load above bodyweight, never below 0 (0 = bodyweight only).
  function workingKg(key, rmKg, pct, s) {
    if (!(rmKg > 0) || !(pct > 0)) return null;
    var total = rmKg * pct;
    if (key === 'pullup') { var bw = bodyKg(s); return bw ? roundWeightKg(Math.max(0, total - bw), s) : null; }
    return roundWeightKg(total, s);
  }
  // what fraction of the 1RM a typed weight really is (null when unknown)
  function pctOfRM(key, w, rmKg, bw) { var l = loadKg(key, w, bw); return l > 0 && rmKg > 0 ? l / rmKg : null; }

  /* ------------------------------------------------------------------ units */
  function incOf(s) { return s.increment > 0 ? +s.increment : (s.units === 'lb' ? 5 : 2.5); }
  function toDisp(kg, units) { return units === 'lb' ? kgToLb(kg) : kg; }
  function toKg(v, units) { return units === 'lb' ? lbToKg(v) : v; }
  function roundWeightKg(kg, s) { var u = s.units || 'kg'; return toKg(roundTo(toDisp(kg, u), incOf(s)), u); }
  function fmtNum(x) { return String(Math.round(x * 10) / 10); }
  function fmtW(kg, units) { return kg == null || kg === '' ? '' : fmtNum(toDisp(+kg, units)); }

  /* ----------------------------------------------------------- text parsing */
  // "2-3 mins" -> 150, "90-120 sec full rest" -> 105, "60 sec" -> 60 (nearest 5 s)
  function parseRest(txt) {
    if (txt == null) return null;
    var m = /(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(minutes?|mins?|secs?|s)\b/i.exec(String(txt));
    if (!m) return null;
    var a = +m[1], b = m[2] ? +m[2] : a, mid = (a + b) / 2;
    var sec = m[3].charAt(0).toLowerCase() === 'm' ? mid * 60 : mid;
    return Math.round(sec / 5) * 5;
  }

  // "10 reps/leg", "20 sec/leg", "3x5 switches/leg", "30-45 sec", "4 (Banded/assisted)", "3x10m", "1x10"
  function parseTarget(raw) {
    var s = String(raw == null ? '' : raw).trim();
    var out = { raw: s, sets: null, lo: null, hi: null, unit: 'reps', suffix: '', note: '' };
    var pm = /\(([^)]*)\)\s*$/.exec(s);
    if (pm) { out.note = pm[1].trim(); s = s.slice(0, pm.index).trim(); }
    var rest = s, m;
    m = /^(\d+)\s*x\s*(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(.*)$/i.exec(s);
    if (m) {
      out.sets = +m[1]; out.lo = +m[2]; out.hi = m[3] ? +m[3] : +m[2]; rest = m[4];
    } else {
      m = /^(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(.*)$/.exec(s);
      if (m) { out.lo = +m[1]; out.hi = m[2] ? +m[2] : +m[1]; rest = m[3]; }
    }
    rest = (rest || '').trim();
    var u;
    if ((u = /^(secs?|s)\b\s*/i.exec(rest))) { out.unit = 'sec'; rest = rest.slice(u[0].length); }
    else if ((u = /^m\b\s*/i.exec(rest))) { out.unit = 'm'; rest = rest.slice(u[0].length); }
    else if ((u = /^reps?\b\s*/i.exec(rest))) { rest = rest.slice(u[0].length); }
    out.suffix = rest.trim();
    return out;
  }

  function fmtTarget(p) {
    if (p.lo == null) return p.raw || '';
    var n = p.hi != null && p.hi !== p.lo ? p.lo + '\u2013' + p.hi : String(p.lo);
    var suf = p.suffix || '';
    var tail = suf ? (suf.charAt(0) === '/' ? suf : ' ' + suf) : '';
    if (p.unit === 'sec') return n + 's' + tail;
    if (p.unit === 'm') return n + ' m' + tail;
    if (!suf) return n + ' reps';
    return n + (suf.charAt(0) === '/' ? ' reps' + suf : ' ' + suf);
  }

  /* ------------------------------------------------------- Zone 2 heart rate */
  function maxHR(s) {
    if (+s.mhr > 0) return Math.round(+s.mhr);
    if (!(+s.age > 0)) return null;
    return Math.round(s.mhrFormula === 'tanaka' ? 208 - 0.7 * s.age : 220 - s.age);
  }
  // Karvonen (heart-rate reserve) when resting HR is known and selected, otherwise % of max HR.
  function zone2(s) {
    var mhr = maxHR(s); if (!mhr) return null;
    var loP = (+s.zoneLo || 60) / 100, hiP = (+s.zoneHi || 70) / 100;
    var rhr = +s.rhr, a, b, method = 'mhr';
    if (s.hrMethod === 'karvonen' && rhr > 0 && rhr < mhr) {
      var hrr = mhr - rhr; a = rhr + loP * hrr; b = rhr + hiP * hrr; method = 'karvonen';
    } else { a = loP * mhr; b = hiP * mhr; }
    return { mhr: mhr, lo: Math.round(a), hi: Math.round(b), method: method, loPct: loP * 100, hiPct: hiP * 100 };
  }
  function zone2Text(s) {
    var z = zone2(s); if (!z) return '';
    return 'Zone 2 target ' + z.lo + '\u2013' + z.hi + ' bpm (' + (z.method === 'karvonen' ? 'Karvonen' : '% of max HR') +
           ', max ' + z.mhr + ')';
  }

  /* -------------------------------------------- history: e1RM + "Previous" */
  function normName(n) { return String(n || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

  function bestE1RMOfLog(log, key) {
    var best = 0;
    (log.entries || []).forEach(function (en) {
      if (en.liftKey !== key) return;
      (en.sets || []).forEach(function (s) {
        var r = +s.r, w = loadKg(key, s.w, +en.bodyKg);      // pull-ups: bodyweight (stored with the entry) + added weight
        // Epley gets unreliable past ~12 reps, so higher-rep sets don't move the estimate.
        if (w > 0 && r >= 1 && r <= 12) { var e = e1rmAdj(w, r, en.rir); if (e > best) best = e; }
      });
    });
    return best;
  }
  // Every non-deload session that trained this lift, oldest first.
  function e1rmPoints(state, key) {
    var pts = [];
    (state.logs || []).forEach(function (log) {
      if (log.deload) return;
      var b = bestE1RMOfLog(log, key);
      if (b > 0) pts.push({ date: log.date, e1rm: b, ts: log.finishedAt || log.startedAt || 0 });
    });
    pts.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts || 0) - (b.ts || 0); });
    return pts;
  }
  // Working 1RM: a manual baseline wins until a session logged after it exists (compared by time when both
  // have one, otherwise by date, where a same-day log counts as later); afterwards the best logged
  // estimate of the last 28 days (so one bad day doesn't crash the numbers).
  function baselineIsCurrent(base, last) {
    if (!last) return true;
    if (base.ts && last.ts) return base.ts > last.ts;
    return base.at > last.date;
  }
  function oneRMFor(state, key, refISO) {
    var base = state.baselines && state.baselines[key];
    var pts = e1rmPoints(state, key);
    var last = pts.length ? pts[pts.length - 1] : null;
    if (base && base.kg > 0 && baselineIsCurrent(base, last)) return { kg: base.kg, src: 'baseline', date: base.at };
    if (!last) return null;
    var cutoff = addDaysISO(refISO, -28), best = null;
    pts.forEach(function (p) { if (p.date >= cutoff && (!best || p.e1rm > best.e1rm)) best = p; });
    if (best) return { kg: best.e1rm, src: 'logged', date: best.date };
    return { kg: last.e1rm, src: 'older', date: last.date };
  }
  function prevSets(state, name) {
    var key = normName(name), logs = state.logs || [];
    for (var i = logs.length - 1; i >= 0; i--) {
      var ens = logs[i].entries || [];
      for (var j = 0; j < ens.length; j++) {
        if (normName(ens[j].name) === key && ens[j].sets && ens[j].sets.length) return { date: logs[i].date, sets: ens[j].sets, entry: ens[j] };
      }
    }
    return null;
  }
  // Weighted work without a 1RM (Pallof press...), or a tracked lift whose 1RM cannot be used yet
  // (pull-ups before a bodyweight is set): repeat last weight, add one increment once every set
  // reached the top of the rep target.
  function suggestFromLast(prev, ex, incKg) {
    if (!prev || !prev.sets.length) return function () { return null; };
    var sets = prev.sets, goal = ex.hi || ex.lo || 0;
    var hit = goal > 0 && sets.every(function (x) { return +x.r >= goal; });
    return function (i) {
      var x = sets[Math.min(i, sets.length - 1)], w = +x.w;
      if (!(w > 0)) return null;
      return hit ? w + incKg : w;
    };
  }
  function prevText(prevSet, ex, units) {
    if (!prevSet) return '\u2013';
    if (ex.mode === 'weightReps') {
      var w = prevSet.w > 0 ? fmtW(prevSet.w, units) : 'BW';
      return w + '\u00d7' + (prevSet.r == null ? '' : prevSet.r);
    }
    if (ex.mode === 'hold' || ex.mode === 'result') return prevSet.r == null ? '\u2013' : prevSet.r + 's';
    if (ex.mode === 'reps') return prevSet.r == null ? '\u2013' : String(prevSet.r);
    return '\u2013';
  }

  /* ------------------------------------------- Ducky "modify" instructions */
  function sanitizeMods(raw) {
    var arr = raw && Array.isArray(raw.modifications) ? raw.modifications : (Array.isArray(raw) ? raw : []);
    var out = [];
    arr.forEach(function (m) {
      if (!m || typeof m.exercise !== 'string' || !m.exercise.trim()) return;
      var o = { exercise: m.exercise.trim().slice(0, 80), note: typeof m.note === 'string' ? m.note.slice(0, 160) : '' };
      if (m.skip === true) o.skip = true;
      var sets = num(m.sets), reps = num(m.reps), wf = num(m.weightFactor);
      if (sets !== null && sets >= 1) o.sets = Math.min(8, Math.round(sets));
      if (reps !== null && reps > 0) o.reps = Math.min(100, Math.round(reps));
      if (wf !== null && wf > 0) o.weightFactor = Math.max(0.4, Math.min(1.2, wf));
      out.push(o);
    });
    return out;
  }

  /* ------------------------------------------------------ calendar (.ics) */
  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function utf8Len(ch) {
    var c = ch.codePointAt(0);
    return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  // RFC 5545: content lines are folded at 75 octets; continuation lines start with one space.
  function fold(line) {
    var out = [], cur = '', bytes = 0;
    Array.from(line).forEach(function (ch) {
      var b = utf8Len(ch);
      if (bytes + b > 75) { out.push(cur); cur = ' '; bytes = 1; }
      cur += ch; bytes += b;
    });
    out.push(cur);
    return out.join('\r\n');
  }
  function localStamp(dateISO, hhmm, addMin) {
    var p = String(hhmm || '00:00').split(':');
    var d = parseISO(dateISO);
    d.setHours(+p[0] || 0, (+p[1] || 0) + (addMin || 0), 0, 0);
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
  }
  function utcStamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
           pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }

  // The events of one program day (week w, day d) as plain objects. `slot` says which session of the day it is.
  function dayEvents(o, w, d) {
    var t = o.times, ev = [], date = dateFor(o.startISO, w, d), wk = o.getWorkout(w, d);
    var tag = 'W' + w + ' D' + d, uid = 'ha-w' + pad(w) + 'd' + d;
    var body = (o.summarize ? o.summarize(wk) : []).join('\n');
    if (wk.am) {
      ev.push({ uid: uid + '-am', slot: 'am', label: 'Morning run', title: tag + ' \u2013 AM Zone 2 Run', date: date, start: t.am, mins: t.amDur || 45,
                desc: [wk.am.text, o.zoneText || ''].filter(Boolean).join('\n') });
    }
    if (wk.kind === 'strength') {
      ev.push({ uid: uid + '-pm', slot: 'main', label: 'Lifting', title: tag + ' \u2013 PM ' + wk.shortTitle, date: date, start: t.pm, mins: t.pmDur || 90, desc: body });
    } else if (wk.kind === 'bjj') {
      ev.push({ uid: uid, slot: 'main', label: wk.shortTitle, title: tag + ' \u2013 ' + wk.shortTitle, date: date, start: t.bjjStart, mins: minutesBetween(t.bjjStart, t.bjjEnd),
                desc: [wk.effort ? 'Effort: ' + wk.effort : '', wk.focus || ''].filter(Boolean).join('\n') });
    } else if (wk.kind === 'recovery') {
      ev.push({ uid: uid, slot: 'main', label: wk.shortTitle, title: tag + ' \u2013 ' + wk.shortTitle, date: date, start: t.recovery, mins: t.recDur || 60, desc: body });
    } else if (wk.kind === 'speed') {
      ev.push({ uid: uid, slot: 'main', label: wk.shortTitle, title: tag + ' \u2013 ' + wk.shortTitle, date: date, start: t.sprint, mins: t.sprDur || 75, desc: body });
    } else if (wk.kind === 'rest' && o.includeRest) {
      ev.push({ uid: uid, slot: 'main', label: 'Rest', title: tag + ' \u2013 Rest', date: date, allDay: true, desc: 'Complete rest and system recovery.' });
    }
    return ev;
  }
  // Turn the 16-week schedule into plain event objects.
  function calendarEvents(o) {
    var ev = [];
    for (var w = 1; w <= 16; w++) for (var d = 1; d <= 7; d++) ev = ev.concat(dayEvents(o, w, d));
    return ev;
  }
  function minutesBetween(a, b) {
    var x = String(a || '19:00').split(':'), y = String(b || '21:00').split(':');
    var m = (+y[0] * 60 + +y[1]) - (+x[0] * 60 + +x[1]);
    return m > 0 ? m : 120;
  }
  function icsFromEvents(events, o) {
    o = o || {};
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hybrid Athlete Tracker//Ducky Coach//EN',
             'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + icsEscape(o.name || 'Hybrid Athlete - 16 weeks')];
    if (o.tz) L.push('X-WR-TIMEZONE:' + o.tz);
    var now = o.now || new Date(), stamp = utcStamp(now);
    // each export gets a higher revision number, so calendars treat a re-import as a newer copy of the same events
    var seq = Math.floor(now.getTime() / 60000);
    events.forEach(function (e) {
      L.push('BEGIN:VEVENT', 'UID:' + e.uid + '@hybrid-athlete.local', 'DTSTAMP:' + stamp, 'LAST-MODIFIED:' + stamp, 'SEQUENCE:' + seq);
      if (e.allDay) {
        L.push('DTSTART;VALUE=DATE:' + e.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + addDaysISO(e.date, 1).replace(/-/g, ''));
      } else {
        L.push('DTSTART:' + localStamp(e.date, e.start, 0), 'DTEND:' + localStamp(e.date, e.start, e.mins));
      }
      L.push('SUMMARY:' + icsEscape(e.title), 'DESCRIPTION:' + icsEscape(e.desc || ''),
             'TRANSP:' + (e.allDay ? 'TRANSPARENT' : 'OPAQUE'));
      if (!e.allDay) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(e.title), 'TRIGGER:-PT30M', 'END:VALARM');
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  // One-tap "add to Google Calendar" link for a single event (floating local time).
  function googleLink(e) {
    var dates = e.allDay
      ? e.date.replace(/-/g, '') + '/' + addDaysISO(e.date, 1).replace(/-/g, '')
      : localStamp(e.date, e.start, 0) + '/' + localStamp(e.date, e.start, e.mins);
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(e.title) +
           '&dates=' + dates + '&details=' + encodeURIComponent(e.desc || '');
  }

  HA.engine = {
    KG_PER_LB: KG_PER_LB, DELOAD_PCT: DELOAD_PCT, TOTAL_DAYS: TOTAL_DAYS,
    lbToKg: lbToKg, kgToLb: kgToLb, roundTo: roundTo, num: num,
    isoDate: isoDate, parseISO: parseISO, addDaysISO: addDaysISO, daysBetween: daysBetween,
    nextMondayISO: nextMondayISO, position: position, dateFor: dateFor,
    epley: epley, e1rmAdj: e1rmAdj, pctFor: pctFor, rirFor: rirFor,
    LIFT_KEYS: LIFT_KEYS, bodyKg: bodyKg, loadKg: loadKg, workingKg: workingKg, pctOfRM: pctOfRM,
    incOf: incOf, toDisp: toDisp, toKg: toKg, roundWeightKg: roundWeightKg, fmtNum: fmtNum, fmtW: fmtW,
    parseRest: parseRest, parseTarget: parseTarget, fmtTarget: fmtTarget,
    maxHR: maxHR, zone2: zone2, zone2Text: zone2Text,
    normName: normName, bestE1RMOfLog: bestE1RMOfLog, e1rmPoints: e1rmPoints, oneRMFor: oneRMFor,
    prevSets: prevSets, suggestFromLast: suggestFromLast, prevText: prevText,
    sanitizeMods: sanitizeMods,
    icsEscape: icsEscape, fold: fold, localStamp: localStamp, dayEvents: dayEvents, calendarEvents: calendarEvents,
    icsFromEvents: icsFromEvents, googleLink: googleLink
  };
})(typeof window !== 'undefined' ? window : globalThis);
