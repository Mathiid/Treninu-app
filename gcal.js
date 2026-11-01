/* gcal.js — two-way sync with Google Calendar (API v3), talking to one calendar the app creates itself.
   Sign-in is Google Identity Services' token model (a pop-up; access tokens last about an hour; no refresh token and no server).
   The scope is calendar.app.created: the app can only see and change calendars it created, never your other calendars.

     App to calendar   sessions get a fixed event id (sched.idFor), so a push is an update, never a duplicate.
     Calendar to app   an incremental sync (syncToken) returns only events changed since last time. A session moved in
                       Google Calendar becomes a move in the app; when both sides moved it, the later change wins.

   Everything the module needs from the page (state, fetch, clock, token storage) comes in through `deps`, so the same code
   runs against a fake Calendar in Node and against Google in the browser. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  var SC = HA.sched;

  var SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
  var API = 'https://www.googleapis.com/calendar/v3';
  var GIS_URL = 'https://accounts.google.com/gsi/client';
  var CAL_NAME = 'Hybrid Athlete Schedule';

  function fail(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function enc(s) { return encodeURIComponent(s); }
  function qs(o) { return Object.keys(o).map(function (k) { return enc(k) + '=' + enc(o[k]); }).join('&'); }

  // Loads Google's sign-in script when it is first needed (never at start-up, and only if a client id is set).
  function loadGIS(doc) {
    return new Promise(function (resolve, reject) {
      if (root.google && root.google.accounts && root.google.accounts.oauth2) return resolve();
      var s = doc.createElement('script');
      s.src = GIS_URL; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(fail('script', 'Could not load Google sign-in. Check your connection.')); };
      doc.head.appendChild(s);
    });
  }

  function create(deps) {
    var d = deps, busy = false, gisReady = null, info = { msg: '', err: '' };

    function S() { return d.S(); }
    function G() { var s = S(); if (!s.gcal) s.gcal = { on: false, granted: false, calendarId: null, syncToken: null, snap: {}, lastSync: 0 }; return s.gcal; }
    function tokenOk() { var t = d.tok.get(); return !!(t && t.t && t.exp > d.now() + 30000); }

    /* ------------------------------------------------------------ requests */
    function rateLimited(status, json) {
      if (status === 429 || status >= 500) return true;
      var why = json && json.error && json.error.errors && json.error.errors[0] && json.error.errors[0].reason;
      return status === 403 && /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(why || '');
    }
    async function api(method, path, o) {
      o = o || {};
      var url = API + path + (o.q ? '?' + qs(o.q) : ''), tries = 0;
      for (;;) {
        var tk = d.tok.get();
        if (!tk || !tk.t || tk.exp <= d.now()) throw fail('auth', 'Sign in again to sync.');
        var init = { method: method, headers: { Authorization: 'Bearer ' + tk.t } };
        if (o.body) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(o.body); }
        var res = await d.fetch(url, init), text = '', json = null;
        try { text = await res.text(); json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        if (res.status === 401) { d.tok.clear(); throw fail('auth', 'Google needs you to sign in again.'); }
        if (rateLimited(res.status, json) && tries < 4) { tries++; await d.sleep(400 * Math.pow(2, tries) + Math.floor(Math.random() * 200)); continue; }
        return { status: res.status, json: json };
      }
    }
    function bad(r, what) {
      var m = r.json && r.json.error && r.json.error.message;
      return fail('api', what + ' (' + r.status + (m ? ': ' + m : '') + ')');
    }
    async function pool(items, n, fn) {
      var i = 0, out = [];
      async function worker() { while (i < items.length) { var k = i++; out[k] = await fn(items[k]); } }
      var ws = []; for (var w = 0; w < Math.min(n, items.length); w++) ws.push(worker());
      await Promise.all(ws);
      return out;
    }

    /* ------------------------------------------------------------ calendar */
    async function ensureCalendar() {
      var g = G();
      if (g.calendarId) return g.calendarId;
      try {                                          // an earlier install may have made it: reuse it if this scope can list it
        var l = await api('GET', '/users/me/calendarList', { q: { minAccessRole: 'owner', maxResults: 250 } });
        var hit = l.status === 200 && (l.json.items || []).filter(function (i) { return i.summary === CAL_NAME; })[0];
        if (hit) { g.calendarId = hit.id; g.syncToken = null; g.snap = {}; return hit.id; }
      } catch (e) { if (e.code === 'auth') throw e; }
      var c = await api('POST', '/calendars', { body: { summary: CAL_NAME, description: 'Your 16-week hybrid athlete program. Managed by the Hybrid Athlete Tracker app.', timeZone: d.tz() } });
      if (c.status !== 200 || !c.json || !c.json.id) throw bad(c, 'Could not create the calendar');
      g.calendarId = c.json.id; g.syncToken = null; g.snap = {};
      return g.calendarId;
    }
    function resetCalendar() { var g = G(); g.calendarId = null; g.syncToken = null; g.snap = {}; }

    // Events changed since the last sync (all of them the first time). Returns { remote: {uid: event}, next, reset }.
    async function pull() {
      var g = G();
      for (var attempt = 0; attempt < 2; attempt++) {
        var remote = {}, page = null, next = null, again = false;
        do {
          var q = { maxResults: 250, showDeleted: 'true', timeZone: d.tz() };
          if (g.syncToken) q.syncToken = g.syncToken;
          if (page) q.pageToken = page;
          var r = await api('GET', '/calendars/' + enc(g.calendarId) + '/events', { q: q });
          if (r.status === 410) { g.syncToken = null; again = true; break; }          // the token expired: list everything again
          if (r.status === 404) return { remote: {}, next: null, reset: true };       // the calendar was deleted in Google Calendar
          if (r.status !== 200) throw bad(r, 'Could not read the calendar');
          (r.json.items || []).forEach(function (res) { var R = SC.fromResource(res); if (R) remote[R.uid] = R; });
          page = r.json.nextPageToken || null;
          if (!page) next = r.json.nextSyncToken || null;
        } while (page);
        if (!again) return { remote: remote, next: next, reset: false };
      }
      throw fail('api', 'Could not read the calendar (sync token kept expiring)');
    }

    function record(ev, res) {
      G().snap[ev.uid] = { date: ev.date, start: ev.start, mins: ev.allDay ? 0 : ev.mins, key: SC.coreKey(ev), note: ev.note || '', at: d.now(), upd: res && res.updated ? Date.parse(res.updated) : 0 };
    }
    // Create or update one event. An update sends only title and time (and the description when the note changed).
    async function pushEvent(ev, force) {
      var g = G(), M = g.snap[ev.uid], body = SC.toResource(ev, d.tz()), id = body.id, base = '/calendars/' + enc(g.calendarId) + '/events', r;
      async function insertOrRevive() {
        var ins = await api('POST', base, { body: body });
        if (ins.status === 409) ins = await api('PATCH', base + '/' + id, { body: body });     // it exists (or was deleted): overwrite it
        return ins;
      }
      if (M && !M.deleted) {
        var patch = { summary: body.summary, start: body.start, end: body.end, status: 'confirmed' };
        if (force || (M.note || '') !== (ev.note || '')) patch.description = body.description;
        r = await api('PATCH', base + '/' + id, { body: patch });
        if (r.status === 404 || r.status === 410) r = await insertOrRevive();
      } else r = await insertOrRevive();
      if (r.status !== 200) throw bad(r, 'Could not save "' + ev.title + '"');
      record(ev, r.json);
    }
    async function deleteEvent(uid) {
      var g = G(), r = await api('DELETE', '/calendars/' + enc(g.calendarId) + '/events/' + SC.idFor(uid));
      if (r.status !== 204 && r.status !== 200 && r.status !== 404 && r.status !== 410) throw bad(r, 'Could not remove an event');
      delete g.snap[uid];
    }

    /* --------------------------------------------------------------- sync */
    function localView(ev) {
      return { date: ev.date, start: ev.start, mins: ev.mins, allDay: !!ev.allDay, key: SC.coreKey(ev), at: ev.moved ? ev.at : (S().settings.timesAt || 0) };
    }
    function pending() {
      var g = G(), n = 0;
      d.events(false).forEach(function (ev) { if (SC.reconcile(localView(ev), g.snap[ev.uid], undefined) === 'push') n++; });
      return n;
    }

    /* opts.pushOnly: send local changes without reading the calendar (used right after you move a session).
       opts.uids:     only these sessions.   opts.force: rebuild every event, descriptions included. */
    async function sync(opts) {
      opts = opts || {};
      if (busy) return { busy: true };
      busy = true; info.err = '';
      var out = { pulled: 0, pushed: 0, conflicts: 0, removed: 0, errors: 0 };
      try {
        if (!tokenOk()) throw fail('auth', 'Sign in again to sync.');
        var g = G();
        await ensureCalendar();
        var got = { remote: {}, next: null, reset: false };
        if (!opts.pushOnly) {
          got = await pull();
          if (got.reset) { resetCalendar(); await ensureCalendar(); got = await pull(); }
        }
        // 1. decide for every session
        var events = d.events(false), pulls = [], pushes = [], remoteGone = {};
        events.forEach(function (ev) {
          if (opts.uids && opts.uids.indexOf(ev.uid) < 0) return;
          var L = localView(ev), M = g.snap[ev.uid], R = got.remote[ev.uid];
          var act = opts.force ? 'push' : SC.reconcile(L, M, R);
          if (M && !M.deleted && R && !R.cancelled && !SC.same(R, M) && !SC.same(L, M) && !SC.same(R, L)) out.conflicts++;       // both sides moved it
          if (act === 'pull') pulls.push([ev, R]);
          else if (act === 'push') pushes.push(ev);
          else if (act === 'sync') { record(ev, { updated: new Date(R.updatedMs).toISOString() }); }
          else if (act === 'deleted') { g.snap[ev.uid] = { deleted: true, at: R.updatedMs || d.now() }; remoteGone[ev.uid] = 1; out.removed++; }
        });
        // 2. apply what changed in the calendar
        pulls.forEach(function (p) { d.applyRemote(p[0].uid, p[1]); record(d.event(p[0].uid) || p[0], { updated: new Date(p[1].updatedMs).toISOString() }); out.pulled++; });
        // 3. send what changed here (each event is rebuilt with its description; an update only resends it when the note changed)
        var done = 0;
        await pool(pushes, 3, async function (ev) {
          try { await pushEvent(d.event(ev.uid) || ev, !!opts.force); out.pushed++; }
          catch (e) { if (e.code === 'auth') throw e; out.errors++; info.err = e.message; }
          done++; if (d.progress) d.progress(done, pushes.length);
        });
        // 4. events the program no longer has (for example rest days switched off)
        if (!opts.pushOnly && !opts.uids) {
          var have = {}; events.forEach(function (ev) { have[ev.uid] = 1; });
          var orphans = Object.keys(g.snap).filter(function (uid) { return !have[uid] && !g.snap[uid].deleted; });
          await pool(orphans, 3, function (uid) { return deleteEvent(uid).catch(function (e) { if (e.code === 'auth') throw e; out.errors++; }); });
        }
        if (!opts.pushOnly && got.next && !out.errors) g.syncToken = got.next;
        g.lastSync = d.now();
        info.msg = summary(out);
        d.save();
        return out;
      } catch (e) {
        info.err = e.message; d.save();
        throw e;
      } finally {
        busy = false;                                    // before onChange, so the screen reads "done", not "syncing"
        if (d.onChange) { try { d.onChange(); } catch (e2) { /* a screen repaint must not turn a good sync into an error */ } }
      }
    }
    function summary(o) {
      var p = [];
      if (o.pulled) p.push(o.pulled + ' moved in Google Calendar');
      if (o.pushed) p.push(o.pushed + ' sent');
      if (o.removed) p.push(o.removed + ' removed there');
      if (o.errors) p.push(o.errors + ' failed');
      return p.length ? p.join(', ') : 'Everything is up to date';
    }

    /* ------------------------------------------------------------ sign-in */
    function gis() { return root.google && root.google.accounts && root.google.accounts.oauth2; }
    function preload() {                              // call early, so the click that opens the Google pop-up can call it straight away
      if (gis()) return Promise.resolve();
      if (!gisReady) gisReady = (d.loadGIS ? d.loadGIS() : Promise.reject(fail('script', 'No sign-in script'))).catch(function (e) { gisReady = null; throw e; });
      return gisReady;
    }
    function connect() {
      var cid = d.clientId(), g = G();
      if (!cid) return Promise.reject(fail('config', 'Paste your Google client ID first.'));
      if (!gis()) { preload().catch(function () {}); return Promise.reject(fail('script', 'Google sign-in is still loading. Tap again in a moment.')); }
      return new Promise(function (resolve, reject) {
        var client = gis().initTokenClient({
          client_id: cid, scope: SCOPE,
          callback: function (r) {
            if (!r || r.error) return reject(fail('auth', (r && (r.error_description || r.error)) || 'Google did not sign you in.'));
            if (gis().hasGrantedAllScopes && !gis().hasGrantedAllScopes(r, SCOPE)) return reject(fail('scope', 'Calendar access was not granted.'));
            d.tok.set({ t: r.access_token, exp: d.now() + (+r.expires_in || 3600) * 1000 });
            g.on = true; g.granted = true; d.save(); resolve();
          },
          error_callback: function (e) {
            var t = e && e.type;
            reject(fail('popup', t === 'popup_closed' ? 'The Google window was closed before you finished.' :
              t === 'popup_failed_to_open' ? 'The browser blocked the Google window. Allow pop-ups for this site and try again.' : 'Google sign-in failed.'));
          }
        });
        client.requestAccessToken({ prompt: g.granted ? '' : 'consent' });
      });
    }
    function disconnect() {
      var t = d.tok.get(), g = G();
      try { if (t && t.t && gis() && gis().revoke) gis().revoke(t.t, function () {}); } catch (e) { /* ignore */ }
      d.tok.clear(); g.on = false; g.granted = false; d.save();
    }
    // The calendar was made by one client id: with another, it is out of reach, so start clean.
    function forget() { disconnect(); resetCalendar(); G().lastSync = 0; d.save(); }

    function status() {
      var g = G();
      return { configured: !!d.clientId(), on: !!g.on, tokenOk: tokenOk(), calendarId: g.calendarId, lastSync: g.lastSync || 0,
               pending: g.on ? pending() : 0, busy: busy, msg: info.msg, err: info.err, gis: !!gis() };
    }

    return { sync: sync, connect: connect, disconnect: disconnect, forget: forget, preload: preload, status: status, tokenOk: tokenOk, pending: pending };
  }

  HA.gcal = { SCOPE: SCOPE, API: API, GIS_URL: GIS_URL, CAL_NAME: CAL_NAME, create: create, loadGIS: loadGIS };
})(typeof window !== 'undefined' ? window : globalThis);
