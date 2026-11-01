/* A small stand-in for the parts of Google Calendar API v3 the app uses: calendarList, calendars.insert and
   events (list with paging and incremental sync tokens, insert with a client-chosen id, patch, delete).
   It follows the documented behaviour that matters here: ids must be a-v and 0-9, five characters or more; inserting an
   id that exists (even a deleted one) is a 409; a deleted event shows up as { id, status: 'cancelled' } and nothing more;
   sync tokens expire (410); times come back with a UTC offset. Used by sync.test.js and the browser tests. */
'use strict';
function makeFake(o) {
  o = o || {};
  const st = { cals: {}, seq: 0, calN: 0, tokens: new Set(o.tokens || ['tok-1']), listAllowed: o.listAllowed !== false, failures: [], log: [],
               now: o.now || (() => Date.now()), offset: o.offset || '+02:00', expireTokens: false };
  const iso = () => new Date(st.now()).toISOString();
  const off = (dt) => (/(Z|[+-]\d\d:\d\d)$/.test(dt) ? dt : dt + st.offset);
  const copy = (x) => JSON.parse(JSON.stringify(x));
  function touch(ev) { ev.updated = iso(); ev._seq = ++st.seq; ev.etag = '"' + st.seq + '"'; }
  function shape(ev) {                                           // what the API returns
    if (ev.status === 'cancelled') return { kind: 'calendar#event', id: ev.id, status: 'cancelled', updated: ev.updated };
    const out = copy(ev); delete out._seq;
    if (out.start && out.start.dateTime) out.start.dateTime = off(out.start.dateTime);
    if (out.end && out.end.dateTime) out.end.dateTime = off(out.end.dateTime);
    out.kind = 'calendar#event'; return out;
  }
  const reply = (status, body) => ({ status, body: body === undefined ? null : body });
  const err = (status, reason, message) => reply(status, { error: { code: status, message: message || reason, errors: [{ reason }] } });

  function handle(method, url, headers, bodyText) {
    const u = new URL(url), p = u.pathname.replace(/^\/calendar\/v3/, ''), q = u.searchParams;
    const body = bodyText ? JSON.parse(bodyText) : null;
    st.log.push({ method, path: p, q: Object.fromEntries(q), body });
    const m = /^Bearer (.+)$/.exec((headers && (headers.Authorization || headers.authorization)) || '');
    if (!m || !st.tokens.has(m[1])) return err(401, 'authError', 'Invalid Credentials');
    if (st.failures.length) { const f = st.failures.shift(); return err(f.status, f.reason); }

    if (method === 'GET' && p === '/users/me/calendarList') {
      if (!st.listAllowed) return err(403, 'insufficientPermissions');
      return reply(200, { items: Object.values(st.cals).map((c) => ({ id: c.id, summary: c.summary, accessRole: 'owner' })) });
    }
    if (method === 'POST' && p === '/calendars') {
      const id = 'cal' + (++st.calN) + '@group.calendar.google.com';
      st.cals[id] = { id, summary: body.summary, timeZone: body.timeZone, events: {} };
      return reply(200, { id, summary: body.summary, timeZone: body.timeZone, kind: 'calendar#calendar' });
    }
    const em = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(p);
    if (!em) return err(404, 'notFound');
    const cal = st.cals[decodeURIComponent(em[1])], id = em[2];
    if (!cal) return err(404, 'notFound', 'Not Found');

    if (!id && method === 'GET') {
      let items = Object.values(cal.events).sort((a, b) => (a.id < b.id ? -1 : 1));
      const sync = q.get('syncToken');
      if (sync) {
        if (st.expireTokens || !/^S\d+$/.test(sync)) { st.expireTokens = false; return err(410, 'fullSyncRequired', 'Sync token is no longer valid, a full sync is required.'); }
        const n = +sync.slice(1); items = items.filter((e) => e._seq > n);
      } else if (q.get('showDeleted') !== 'true') items = items.filter((e) => e.status !== 'cancelled');
      const max = +q.get('maxResults') || 250, start = q.get('pageToken') ? +q.get('pageToken').slice(1) : 0, page = items.slice(start, start + max);
      const out = { kind: 'calendar#events', items: page.map(shape) };
      if (start + max < items.length) out.nextPageToken = 'P' + (start + max); else out.nextSyncToken = 'S' + st.seq;
      return reply(200, out);
    }
    if (!id && method === 'POST') {
      if (!/^[a-v0-9]{5,1024}$/.test(body.id || '')) return err(400, 'invalid', 'Invalid resource id value.');
      if (cal.events[body.id]) return err(409, 'duplicate', 'The requested identifier already exists.');
      const ev = Object.assign({ status: 'confirmed' }, copy(body)); touch(ev); cal.events[ev.id] = ev; return reply(200, shape(ev));
    }
    if (id && method === 'PATCH') {
      const ev = cal.events[id];
      if (!ev || (ev.status === 'cancelled' && body.status !== 'confirmed')) return err(404, 'notFound', 'Not Found');
      Object.assign(ev, copy(body)); touch(ev); return reply(200, shape(ev));
    }
    if (id && method === 'DELETE') {
      const ev = cal.events[id];
      if (!ev) return err(404, 'notFound');
      if (ev.status === 'cancelled') return err(410, 'deleted', 'Resource has been deleted');
      ev.status = 'cancelled'; touch(ev); return reply(204);
    }
    return err(405, 'methodNotAllowed');
  }
  const api = {
    st, handle,
    fetch: async (url, init) => { const r = handle((init && init.method) || 'GET', url, (init && init.headers) || {}, init && init.body); return { status: r.status, text: async () => (r.body == null ? '' : JSON.stringify(r.body)) }; },
    cal: () => Object.values(st.cals)[0],
    live: (c) => Object.values((c || api.cal()).events).filter((e) => e.status !== 'cancelled'),
    ev: (id, c) => (c || api.cal()).events[id],
    // what a person does in the Google Calendar app
    userMove(id, startLocal, endLocal, c) { const ev = (c || api.cal()).events[id]; ev.start = { dateTime: startLocal, timeZone: ev.start.timeZone }; ev.end = { dateTime: endLocal, timeZone: ev.end.timeZone }; touch(ev); },
    userDelete(id, c) { const ev = (c || api.cal()).events[id]; ev.status = 'cancelled'; touch(ev); },
    userAdd(id, summary, c) { const ev = { id, summary, status: 'confirmed', start: { dateTime: '2026-11-05T09:00:00' }, end: { dateTime: '2026-11-05T10:00:00' } }; touch(ev); (c || api.cal()).events[id] = ev; },
    log: () => st.log,
    count: (method, pathRe) => st.log.filter((l) => l.method === method && pathRe.test(l.path)).length,
    clearLog() { st.log.length = 0; },
    deleteCalendar() { st.cals = {}; }
  };
  return api;
}
module.exports = { makeFake };
