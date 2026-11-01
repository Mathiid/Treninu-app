/* sched.js — the schedule layer between the program and a calendar. Pure functions, no network and no DOM.
   The program says what happens on which day (engine.dayEvents). On top of that, each session can be moved
   (S.sched[uid] = { date, start, mins, at }) and can carry a note ({ note }), for example the changes Ducky made.
   Google Calendar event ids, the event bodies, and the rule that decides which side wins when both changed are here too,
   so they can be tested without a browser. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  var E = HA.engine;

  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  /* ---------------------------------------------------------------- ids */
  // Google lets us choose an event id: lowercase a-v and digits, 5 to 1024 characters. 'ha-w01d1-am' becomes 'ha01d1a'.
  // The same session always gets the same id, so pushing twice updates the event instead of duplicating it.
  function idFor(uid) {
    var m = /^ha-w(\d{2})d(\d)(?:-(am|pm))?$/.exec(uid || '');
    return m ? 'ha' + m[1] + 'd' + m[2] + (m[3] === 'am' ? 'a' : m[3] === 'pm' ? 'p' : '') : null;
  }
  function uidFor(id) {
    var m = /^ha(\d{2})d(\d)([ap]?)$/.exec(id || '');
    return m ? 'ha-w' + m[1] + 'd' + m[2] + (m[3] === 'a' ? '-am' : m[3] === 'p' ? '-pm' : '') : null;
  }
  function parseUid(uid) {
    var m = /^ha-w(\d{2})d(\d)/.exec(uid || '');
    return m ? { week: +m[1], day: +m[2] } : null;
  }
  // The session Ducky's changes belong to: the lifting session on a strength day, otherwise the day's only session.
  function mainUid(wk) {
    var uid = 'ha-w' + (wk.week < 10 ? '0' : '') + wk.week + 'd' + wk.day;
    return wk.kind === 'strength' ? uid + '-pm' : uid;
  }

  /* ---------------------------------------------------------- overrides */
  function effective(ev, S) {
    var o = S && S.sched && S.sched[ev.uid];
    if (!o) return ev;
    var r = {}, k;
    for (k in ev) r[k] = ev[k];
    if (o.date && !ev.allDay) { r.date = o.date; r.start = o.start; r.mins = o.mins; r.moved = true; r.at = o.at || 0; }
    if (o.note) r.note = o.note;
    return r;
  }
  function applyAll(events, S) { return events.map(function (e) { return effective(e, S); }); }

  function valid(date, start, mins) { return DATE_RE.test(date || '') && TIME_RE.test(start || '') && mins >= 5 && mins <= 600; }
  function prune(S, uid) { var e = S.sched[uid]; if (e && !e.date && !e.note) delete S.sched[uid]; }
  // Move a session. Moving it back to where the program has it removes the override.
  function setMove(S, base, date, start, mins, now) {
    if (!valid(date, start, mins) || base.allDay) return false;
    var e = S.sched[base.uid] || (S.sched[base.uid] = {});
    if (date === base.date && start === base.start && mins === base.mins) { delete e.date; delete e.start; delete e.mins; delete e.at; }
    else { e.date = date; e.start = start; e.mins = Math.round(mins); e.at = now || Date.now(); }
    prune(S, base.uid);
    return true;
  }
  function clearMove(S, uid) { var e = S.sched[uid]; if (e) { delete e.date; delete e.start; delete e.mins; delete e.at; prune(S, uid); } }
  function setNote(S, uid, text) {
    var e = S.sched[uid] || (S.sched[uid] = {});
    if (text) e.note = String(text).slice(0, 400); else delete e.note;
    prune(S, uid);
  }

  /* ------------------------------------------------ calendar event bodies */
  function wall(ev, addMin) {                      // 'YYYY-MM-DDTHH:MM:00' in local wall-clock time
    var s = E.localStamp(ev.date, ev.start, addMin || 0);
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) + 'T' + s.slice(9, 11) + ':' + s.slice(11, 13) + ':00';
  }
  // What a change to the session looks like to the calendar: title, time and note. (The description is sent when it is created or the note changes.)
  function coreKey(ev) { return [ev.title, ev.date, ev.allDay ? 'all' : ev.start, ev.allDay ? 0 : ev.mins, ev.note || ''].join('|'); }

  function toResource(ev, tz) {
    var r = {
      id: idFor(ev.uid), summary: ev.title, status: 'confirmed',
      description: (ev.desc || '') + (ev.note ? '\n\n' + ev.note : ''),
      transparency: ev.allDay ? 'transparent' : 'opaque',
      extendedProperties: { 'private': { haUid: ev.uid } }
    };
    if (ev.allDay) { r.start = { date: ev.date }; r.end = { date: E.addDaysISO(ev.date, 1) }; }
    else {
      r.start = { dateTime: wall(ev, 0), timeZone: tz }; r.end = { dateTime: wall(ev, ev.mins), timeZone: tz };
      r.reminders = { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] };
    }
    return r;
  }
  // A Google event, reduced to what we sync. dateTime strings carry the wall-clock time in the zone we asked for.
  function fromResource(res) {
    if (!res) return null;
    var p = res.extendedProperties && res.extendedProperties['private'], uid = (p && p.haUid) || uidFor(res.id);
    if (!uid || !parseUid(uid)) return null;
    var out = { uid: uid, cancelled: res.status === 'cancelled', updatedMs: Date.parse(res.updated) || 0 };
    if (res.start && res.start.dateTime) {
      var s = res.start.dateTime, e = res.end && res.end.dateTime;
      out.date = s.slice(0, 10); out.start = s.slice(11, 16);
      out.mins = e ? Math.round((Date.parse(e) - Date.parse(s)) / 60000) : null;
    } else if (res.start && res.start.date) { out.allDay = true; out.date = res.start.date; }
    return out;
  }

  /* ------------------------------------------------------ who wins */
  function same(a, b) { return !!(a && b && a.date === b.date && a.start === b.start && (a.mins | 0) === (b.mins | 0)); }
  /* L: local event now { date, start, mins, key, at, allDay }.  M: what the calendar had when we last synced
     { date, start, mins, key, deleted, at } or undefined.  R: the calendar's event if it changed since then, else undefined.
     Returns 'none' | 'push' | 'pull' | 'sync' (both already agree: just record it) | 'deleted'.
     When both sides moved the session, the later change wins. */
  function reconcile(L, M, R) {
    if (R && R.cancelled) return 'deleted';
    if (M && M.deleted) {
      if (!R) return (L.at || 0) > (M.at || 0) ? 'push' : 'none';       // removed in the calendar: leave it, unless it was changed here afterwards
      M = null;                                                         // it exists again
    }
    if (L.allDay) {
      if (!M && R && R.allDay && R.date === L.date) return 'sync';           // already there from an earlier install
      return !M || M.key !== L.key ? 'push' : 'none';
    }
    var timeLocal = !same(L, M), contentLocal = !!(M && M.key !== L.key), remoteChg = !!R && !R.allDay && !same(R, M);
    if (remoteChg && same(R, L)) return 'sync';
    if (remoteChg && timeLocal) return (L.at || 0) >= (R.updatedMs || 0) ? 'push' : 'pull';
    if (remoteChg) return 'pull';
    if (!M && !R) return 'push';
    return timeLocal || contentLocal ? 'push' : 'none';
  }

  /* ------------------------------------- the program as calendar events */
  function evOpts(S, withDesc, today) {
    var P = HA.program, st = S.settings;
    var o = { oneRM: function (k) { var r = k ? E.oneRMFor(S, k, today) : null; return r ? r.kg : null; }, settings: st };
    return { startISO: st.startDate, times: st.times, includeRest: st.includeRest, getWorkout: P.getWorkout,
             summarize: withDesc ? function (wk) { return P.summarize(wk, o); } : null, zoneText: withDesc ? E.zone2Text(st) : '' };
  }
  // Every session with moves and notes applied. withDesc builds the workout text too (slower: used for files and pushes).
  function allEvents(S, withDesc, today) { return applyAll(E.calendarEvents(evOpts(S, withDesc, today)), S); }
  function baseEvent(S, uid, withDesc, today) {
    var p = parseUid(uid);
    if (!p) return null;
    return E.dayEvents(evOpts(S, withDesc, today), p.week, p.day).filter(function (e) { return e.uid === uid; })[0] || null;
  }
  function dayList(S, w, d) { return E.dayEvents(evOpts(S, false), w, d).map(function (e) { return effective(e, S); }); }
  function endTime(ev) { var s = E.localStamp(ev.date, ev.start, ev.mins); return s.slice(9, 11) + ':' + s.slice(11, 13); }
  function oneEvent(S, uid, withDesc, today) { var b = baseEvent(S, uid, withDesc, today); return b ? effective(b, S) : null; }
  // A move that came from the calendar: the program's own time is the base, anything else is stored as a move.
  function applyRemote(S, uid, R, now) {
    var b = baseEvent(S, uid, false);
    return b ? setMove(S, b, R.date, R.start, R.mins, R.updatedMs || now) : false;
  }

  HA.sched = {
    allEvents: allEvents, dayList: dayList, endTime: endTime, oneEvent: oneEvent, baseEvent: baseEvent, applyRemote: applyRemote,
    idFor: idFor, uidFor: uidFor, parseUid: parseUid, mainUid: mainUid,
    effective: effective, applyAll: applyAll, valid: valid, setMove: setMove, clearMove: clearMove, setNote: setNote,
    coreKey: coreKey, toResource: toResource, fromResource: fromResource, same: same, reconcile: reconcile
  };
})(typeof window !== 'undefined' ? window : globalThis);
