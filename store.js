/* store.js — the app state, persisted in localStorage (falls back to memory if storage is blocked).
   The Gemini API key and the Google access token live under their own keys so exports/backups never contain them. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  var E = HA.engine;
  var KEY = 'ha.state.v1', KEYAPI = 'ha.geminiKey', KEYTOK = 'ha.gcal.token';
  var mem = {}, S = null, saveTimer = null, persistent = true;

  function ls() { try { return root.localStorage || null; } catch (e) { return null; } }
  function rd(k) {
    var l = ls();
    try { if (l) return l.getItem(k); } catch (e) { /* blocked */ }
    return mem[k] != null ? mem[k] : null;
  }
  function wr(k, v) {
    var l = ls();
    try { if (l) { l.setItem(k, v); return true; } } catch (e) { /* quota / blocked */ }
    mem[k] = v; return false;
  }
  function del(k) { var l = ls(); try { if (l) l.removeItem(k); } catch (e) { /* ignore */ } delete mem[k]; }

  function defaults() {
    var today = E.isoDate(new Date());
    return {
      v: 1, created: Date.now(),
      settings: {
        units: 'kg', increment: null, startDate: E.nextMondayISO(today),
        age: null, rhr: null, mhr: null, mhrFormula: 'classic', hrMethod: 'karvonen', zoneLo: 60, zoneHi: 70,
        autoRest: true, sound: true, vibrate: true, notify: true, wakeLock: true, includeRest: true,
        geminiModel: 'gemini-2.5-flash', paceUnit: 'km', race: null, hrCue: true, gcalClientId: '', timesAt: 0,
        times: { am: '07:00', amDur: 45, pm: '17:30', pmDur: 90, recovery: '18:00', recDur: 60, sprint: '10:00', sprDur: 75, bjjStart: '19:00', bjjEnd: '21:00' }
      },
      baselines: {}, logs: [], marks: {}, overrides: {}, active: null, chat: [],
      runs: [], sched: {}, gcal: { on: false, granted: false, calendarId: null, syncToken: null, snap: {}, lastSync: 0 }
    };
  }
  function isObj(x) { return x && typeof x === 'object' && !Array.isArray(x); }
  function merge(base, over) {
    var out = {}, k;
    for (k in base) out[k] = base[k];
    if (!isObj(over)) return out;
    for (k in over) out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
    return out;
  }
  function normalize(s) {
    if (!Array.isArray(s.logs)) s.logs = [];
    if (!Array.isArray(s.chat)) s.chat = [];
    if (!isObj(s.baselines)) s.baselines = {};
    if (!isObj(s.marks)) s.marks = {};
    if (!isObj(s.overrides)) s.overrides = {};
    if (!Array.isArray(s.runs)) s.runs = [];
    if (!isObj(s.sched)) s.sched = {};
    if (!isObj(s.gcal)) s.gcal = defaults().gcal;
    if (!isObj(s.gcal.snap)) s.gcal.snap = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.settings.startDate || '')) s.settings.startDate = E.nextMondayISO(E.isoDate(new Date()));
    return s;
  }

  function load() {
    var raw = rd(KEY), parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
    S = normalize(merge(defaults(), parsed));
    return S;
  }
  function get() { return S || load(); }
  function save() {
    if (!S) return true;
    if (S.chat.length > 80) S.chat = S.chat.slice(-80);
    persistent = wr(KEY, JSON.stringify(S));
    return persistent;
  }
  function saveSoon() {
    if (saveTimer || typeof setTimeout === 'undefined') { if (!saveTimer) save(); return; }
    saveTimer = setTimeout(function () { saveTimer = null; save(); }, 250);
  }
  function flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } save(); }
  function reset() { S = normalize(defaults()); save(); del(KEYTOK); return S; }

  function exportJSON() {
    var copy = JSON.parse(JSON.stringify(get()));
    copy.exportedAt = new Date().toISOString();
    return JSON.stringify(copy, null, 2);
  }
  function importJSON(text) {
    var p;
    try { p = JSON.parse(text); } catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
    if (!isObj(p) || !Array.isArray(p.logs) || !isObj(p.settings)) return { ok: false, error: 'This does not look like a Hybrid Athlete backup.' };
    S = normalize(merge(defaults(), p));
    S.active = null;
    save();
    return { ok: true, logs: S.logs.length };
  }

  function getKey() { return rd(KEYAPI) || ''; }
  function setKey(k) { k = String(k || '').trim(); if (k) wr(KEYAPI, k); else del(KEYAPI); }
  // The Google access token ({ t, exp }) is short-lived and stays out of backups, like the Gemini key.
  function getTok() { try { var t = JSON.parse(rd(KEYTOK) || 'null'); return t && t.t ? t : null; } catch (e) { return null; } }
  function setTok(t) { wr(KEYTOK, JSON.stringify(t)); }
  function clearTok() { del(KEYTOK); }

  HA.store = {
    defaults: defaults, load: load, get: get, save: save, saveSoon: saveSoon, flush: flush, reset: reset,
    exportJSON: exportJSON, importJSON: importJSON, getKey: getKey, setKey: setKey, getTok: getTok, setTok: setTok, clearTok: clearTok,
    isPersistent: function () { return persistent; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
