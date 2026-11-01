/* Schedule layer and Google Calendar sync — run with:  node sync.test.js   (no dependencies, no network)
   Google is replaced by fake-gcal.js, which follows the API's documented behaviour. */
'use strict';
const assert = require('assert');
require('./spec.js'); require('./engine.js'); require('./program.js'); require('./session.js'); require('./store.js'); require('./sched.js'); require('./gcal.js');
const { makeFake } = require('./fake-gcal.js');
const HA = globalThis.HA, E = HA.engine, SC = HA.sched, store = HA.store;
let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
const T0 = Date.parse('2026-11-01T12:00:00Z'), TODAY = '2026-11-02';

/* ------------------------------------------------------------------ the pure schedule layer */
const mkState = () => { const S = store.load(); S.settings.startDate = TODAY; S.sched = {}; return S; };
const base = (S, uid) => SC.baseEvent(S, uid, false);

test('ids: stable, unique, and legal for Google (a-v, 0-9, 5+ characters); uid round-trips', () => {
  const S = mkState(), ev = SC.allEvents(S, false, TODAY), ids = ev.map((e) => SC.idFor(e.uid));
  assert.strictEqual(ev.length, 144); assert.strictEqual(new Set(ids).size, 144);
  ids.forEach((id, i) => { assert.ok(/^[a-v0-9]{5,}$/.test(id), id); assert.strictEqual(SC.uidFor(id), ev[i].uid); });
  assert.deepStrictEqual([SC.idFor('ha-w01d1-am'), SC.idFor('ha-w01d1-pm'), SC.idFor('ha-w16d7')], ['ha01d1a', 'ha01d1p', 'ha16d7']);
  assert.strictEqual(SC.idFor('nonsense'), null); assert.strictEqual(SC.uidFor('ha01d1x'), null);
});
test('moves: stored as an override, moving back to the program time removes it, bad input is refused', () => {
  const S = mkState(), b = base(S, 'ha-w01d1-pm');
  assert.deepStrictEqual([b.date, b.start, b.mins], ['2026-11-02', '17:30', 90]);
  assert.ok(SC.setMove(S, b, '2026-11-03', '18:15', 75, 5000));
  assert.deepStrictEqual(S.sched['ha-w01d1-pm'], { date: '2026-11-03', start: '18:15', mins: 75, at: 5000 });
  const e = SC.effective(b, S); assert.deepStrictEqual([e.date, e.start, e.mins, e.moved, e.at], ['2026-11-03', '18:15', 75, true, 5000]);
  assert.strictEqual(b.date, '2026-11-02', 'the base event is not changed');
  assert.ok(SC.setMove(S, b, b.date, b.start, b.mins, 6000)); assert.deepStrictEqual(S.sched, {});
  [['2026-13-40x', '18:00', 60], ['2026-11-03', '25:00', 60], ['2026-11-03', '18:00', 2], ['2026-11-03', '18:00', 9999]].forEach((a) => assert.strictEqual(SC.setMove(S, b, a[0], a[1], a[2], 1), false, a.join()));
  assert.strictEqual(SC.setMove(S, base(S, 'ha-w01d7'), '2026-11-08', '10:00', 60, 1), false, 'all-day rest entries cannot be moved');
  assert.deepStrictEqual(S.sched, {});
});
test('notes (what Ducky changed) live beside moves and are removed when empty', () => {
  const S = mkState(); SC.setNote(S, 'ha-w01d1-pm', 'Ducky: Bench Press -10%');
  assert.strictEqual(SC.effective(base(S, 'ha-w01d1-pm'), S).note, 'Ducky: Bench Press -10%');
  SC.setMove(S, base(S, 'ha-w01d1-pm'), '2026-11-03', '18:00', 90, 1); SC.setNote(S, 'ha-w01d1-pm', '');
  assert.ok(S.sched['ha-w01d1-pm'].date && !S.sched['ha-w01d1-pm'].note);
  SC.clearMove(S, 'ha-w01d1-pm'); assert.deepStrictEqual(S.sched, {});
  assert.strictEqual(SC.mainUid({ week: 1, day: 1, kind: 'strength' }), 'ha-w01d1-pm'); assert.strictEqual(SC.mainUid({ week: 3, day: 6, kind: 'speed' }), 'ha-w03d6');
});
test('event bodies: wall-clock times with a zone, a 30-minute reminder, our id and uid; all-day entries use dates', () => {
  const S = mkState(), r = SC.toResource(Object.assign({}, base(S, 'ha-w01d1-pm'), { desc: 'Bench 60 kg', note: 'Ducky: lighter' }), 'Europe/Riga');
  assert.deepStrictEqual([r.id, r.start, r.end], ['ha01d1p', { dateTime: '2026-11-02T17:30:00', timeZone: 'Europe/Riga' }, { dateTime: '2026-11-02T19:00:00', timeZone: 'Europe/Riga' }]);
  assert.deepStrictEqual(r.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] });
  assert.strictEqual(r.extendedProperties['private'].haUid, 'ha-w01d1-pm'); assert.strictEqual(r.description, 'Bench 60 kg\n\nDucky: lighter'); assert.strictEqual(r.transparency, 'opaque');
  const late = SC.toResource(Object.assign({}, base(S, 'ha-w01d1-pm'), { start: '23:30', mins: 90 }), 'UTC'); assert.strictEqual(late.end.dateTime, '2026-11-03T01:00:00', 'crosses midnight');
  const rest = SC.toResource(base(S, 'ha-w01d7'), 'UTC'); assert.deepStrictEqual([rest.start, rest.end, rest.transparency], [{ date: '2026-11-08' }, { date: '2026-11-09' }, 'transparent']);
});
test('reading a Google event: wall-clock time, minutes, cancelled events by id, foreign events ignored', () => {
  const R = SC.fromResource({ id: 'ha01d1p', status: 'confirmed', updated: '2026-11-01T10:00:00.000Z', start: { dateTime: '2026-11-03T18:15:00+02:00' }, end: { dateTime: '2026-11-03T19:30:00+02:00' }, extendedProperties: { 'private': { haUid: 'ha-w01d1-pm' } } });
  assert.deepStrictEqual(R, { uid: 'ha-w01d1-pm', cancelled: false, updatedMs: Date.parse('2026-11-01T10:00:00Z'), date: '2026-11-03', start: '18:15', mins: 75 });
  assert.deepStrictEqual(SC.fromResource({ id: 'ha01d1p', status: 'cancelled' }), { uid: 'ha-w01d1-pm', cancelled: true, updatedMs: 0 });
  assert.strictEqual(SC.fromResource({ id: 'abcde12345', summary: 'Dentist', start: { dateTime: '2026-11-03T09:00:00Z' } }), null);
  assert.deepStrictEqual(SC.fromResource({ id: 'ha01d7', status: 'confirmed', start: { date: '2026-11-08' } }).allDay, true);
});
test('who wins: the decision table', () => {
  const L = (o) => Object.assign({ date: '2026-11-02', start: '17:30', mins: 90, key: 'k', at: 0, allDay: false }, o);
  const M = (o) => Object.assign({ date: '2026-11-02', start: '17:30', mins: 90, key: 'k' }, o);
  const R = (o) => Object.assign({ uid: 'x', date: '2026-11-02', start: '17:30', mins: 90, updatedMs: 1000, cancelled: false }, o);
  const rec = (l, m, r) => SC.reconcile(l, m, r);
  assert.strictEqual(rec(L(), M(), undefined), 'none', 'nothing changed');
  assert.strictEqual(rec(L(), undefined, undefined), 'push', 'new session');
  assert.strictEqual(rec(L({ start: '18:00', at: 5 }), M(), undefined), 'push', 'moved in the app');
  assert.strictEqual(rec(L(), M({ key: 'old' }), undefined), 'push', 'title or note changed in the app');
  assert.strictEqual(rec(L(), M(), R({ start: '19:00' })), 'pull', 'moved in Google Calendar');
  assert.strictEqual(rec(L(), M(), R()), 'none', 'our own echo');
  assert.strictEqual(rec(L({ start: '18:00', at: 5000 }), M(), R({ start: '19:00', updatedMs: 4000 })), 'push', 'both moved: the app was later');
  assert.strictEqual(rec(L({ start: '18:00', at: 3000 }), M(), R({ start: '19:00', updatedMs: 4000 })), 'pull', 'both moved: Google was later');
  assert.strictEqual(rec(L({ start: '19:00', at: 3000 }), M(), R({ start: '19:00', updatedMs: 4000 })), 'sync', 'both moved to the same time');
  assert.strictEqual(rec(L(), undefined, R({ start: '19:00' })), 'pull', 'first sync adopts the calendar time over an untouched default');
  assert.strictEqual(rec(L({ start: '20:00', at: 9000 }), undefined, R({ start: '19:00', updatedMs: 4000 })), 'push', 'first sync keeps a time you moved here');
  assert.strictEqual(rec(L(), M(), R({ cancelled: true })), 'deleted');
  assert.strictEqual(rec(L(), M({ deleted: true, at: 100 }), undefined), 'none', 'deleted there: do not bring it back by itself');
  assert.strictEqual(rec(L({ start: '18:00', at: 500 }), M({ deleted: true, at: 100 }), undefined), 'push', 'but a later change here recreates it');
  assert.strictEqual(rec(L(), M({ deleted: true, at: 100 }), R({ start: '19:00' })), 'pull', 'restored in Google Calendar');
  assert.strictEqual(rec(L({ allDay: true, mins: 0 }), M({ key: 'k' }), R({ allDay: true })), 'none', 'rest days are never pulled');
  assert.strictEqual(rec(L({ allDay: true, mins: 0 }), undefined, R({ allDay: true })), 'sync', 'an all-day entry that is already there is not sent again');
  assert.strictEqual(rec(L({ allDay: true, mins: 0 }), undefined, R({ allDay: true, date: '2026-11-09' })), 'push');
});

/* ------------------------------------------------------------------ sync against the fake */
function rig(o) {
  o = o || {};
  let t = T0; const sleeps = [], S = mkState(), fake = makeFake({ now: () => t, listAllowed: o.listAllowed });
  S.gcal.on = true; let token = { t: 'tok-1', exp: T0 + 3600e3 };
  const deps = {
    S: () => S, save() {}, fetch: fake.fetch, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, tz: () => 'Europe/Riga',
    events: (withDesc) => SC.allEvents(S, withDesc, TODAY), event: (uid) => SC.oneEvent(S, uid, true, TODAY),
    applyRemote: (uid, R) => SC.applyRemote(S, uid, R, t),
    tok: { get: () => token, set: (x) => { token = x; }, clear: () => { token = null; } }, clientId: () => 'client-id', onChange() {}
  };
  const g = HA.gcal.create(deps);
  return { S, fake, g, sleeps, tick: (ms) => { t += ms; }, now: () => t, tok: () => token, setTok: (x) => { token = x; }, deps };
}
const hm = (iso) => iso.slice(11, 16);

test('the screen is told about a finished sync only after the sync stops being busy (a repaint must not read "syncing")', async () => {
  const r = rig(), seen = []; r.deps.onChange = () => seen.push(r.g.status().busy);
  const g2 = HA.gcal.create(r.deps); await g2.sync(); assert.deepStrictEqual(seen, [false]);
  r.fake.st.tokens.clear(); seen.length = 0; r.setTok({ t: 'bad', exp: T0 + 3600e3 });
  await assert.rejects(g2.sync(), /sign in/i); assert.deepStrictEqual(seen, [false], 'also after a failure');
});
test('first sync: makes the calendar "Hybrid Athlete Schedule", sends all 144 sessions under fixed ids, and a second sync sends nothing', async () => {
  const r = rig(), a = await r.g.sync();
  assert.deepStrictEqual([a.pushed, a.pulled, a.errors], [144, 0, 0]);
  assert.strictEqual(Object.keys(r.fake.st.cals).length, 1); assert.strictEqual(r.fake.cal().summary, 'Hybrid Athlete Schedule'); assert.strictEqual(r.fake.cal().timeZone, 'Europe/Riga');
  assert.strictEqual(r.fake.live().length, 144); assert.ok(r.fake.ev('ha01d1p') && r.fake.ev('ha16d7'));
  const e = r.fake.ev('ha01d1a'); assert.strictEqual(e.summary, 'W1 D1 – AM Zone 2 Run'); assert.strictEqual(e.start.dateTime, '2026-11-02T07:00:00'); assert.strictEqual(e.end.dateTime, '2026-11-02T07:45:00');
  assert.ok(/Zone 2/.test(r.fake.ev('ha01d1a').description) && /\w/.test(r.fake.ev('ha01d1p').description), 'descriptions are sent');
  assert.ok(r.S.gcal.syncToken && r.S.gcal.calendarId);
  r.tick(60000); r.fake.clearLog(); const b = await r.g.sync();
  assert.deepStrictEqual([b.pushed, b.pulled], [0, 0]); assert.strictEqual(r.fake.count('POST', /events/), 0); assert.strictEqual(r.fake.count('PATCH', /events/), 0);
  assert.strictEqual(r.g.status().pending, 0); assert.strictEqual(r.g.status().msg, 'Everything is up to date');
});
test('app to calendar: moving a session updates that one event (pushOnly), and the next full sync does not bounce it back', async () => {
  const r = rig(); await r.g.sync(); r.tick(60000);
  SC.setMove(r.S, base(r.S, 'ha-w01d1-pm'), '2026-11-03', '18:15', 75, r.now());
  assert.strictEqual(r.g.status().pending, 1);
  r.fake.clearLog(); const a = await r.g.sync({ pushOnly: true, uids: ['ha-w01d1-pm'] });
  assert.strictEqual(a.pushed, 1); assert.strictEqual(r.fake.count('GET', /events/), 0, 'no reading when pushing');
  const e = r.fake.ev('ha01d1p'); assert.deepStrictEqual([e.start.dateTime, e.end.dateTime], ['2026-11-03T18:15:00', '2026-11-03T19:30:00']);
  assert.ok(!('description' in r.fake.log().find((l) => l.method === 'PATCH').body), 'an update does not resend the description') ;
  r.tick(60000); const b = await r.g.sync(); assert.deepStrictEqual([b.pushed, b.pulled, b.conflicts], [0, 0, 0]);
  assert.deepStrictEqual(r.S.sched['ha-w01d1-pm'], { date: '2026-11-03', start: '18:15', mins: 75, at: r.S.sched['ha-w01d1-pm'].at });
});
test('calendar to app: a session dragged in Google Calendar moves in the app, with no push back', async () => {
  const r = rig(); await r.g.sync(); r.tick(60000);
  r.fake.userMove('ha01d5p', '2026-11-07T06:30:00', '2026-11-07T08:00:00');
  assert.strictEqual(r.g.status().pending, 0, 'nothing waiting to send');
  r.fake.clearLog(); const a = await r.g.sync();
  assert.deepStrictEqual([a.pulled, a.pushed], [1, 0]); assert.strictEqual(r.fake.count('PATCH', /events/), 0);
  const e = SC.oneEvent(r.S, 'ha-w01d5-pm', false, TODAY); assert.deepStrictEqual([e.date, e.start, e.mins, e.moved], ['2026-11-07', '06:30', 90, true]);
  r.tick(60000); const b = await r.g.sync(); assert.deepStrictEqual([b.pulled, b.pushed], [0, 0]);
  r.tick(60000); r.fake.userMove('ha01d5p', '2026-11-06T17:30:00', '2026-11-06T19:00:00');          // back to the program time
  const c = await r.g.sync(); assert.strictEqual(c.pulled, 1); assert.ok(!r.S.sched['ha-w01d5-pm'], 'back at the program time: the override disappears');
});
test('both sides moved the same session: the later change wins, in either direction, and it is counted', async () => {
  for (const appLater of [true, false]) {
    const r = rig(); await r.g.sync(); r.tick(60000);
    if (appLater) { r.fake.userMove('ha01d4', '2026-11-05T09:00:00', '2026-11-05T10:00:00'); r.tick(60000); SC.setMove(r.S, base(r.S, 'ha-w01d4'), '2026-11-05', '20:30', 60, r.now()); }
    else { SC.setMove(r.S, base(r.S, 'ha-w01d4'), '2026-11-05', '20:30', 60, r.now()); r.tick(60000); r.fake.userMove('ha01d4', '2026-11-05T09:00:00', '2026-11-05T10:00:00'); }
    const a = await r.g.sync(); assert.strictEqual(a.conflicts, 1);
    const g = r.fake.ev('ha01d4'), mine = SC.oneEvent(r.S, 'ha-w01d4', false, TODAY);
    assert.strictEqual(hm(g.start.dateTime), mine.start, 'both ended up the same');
    assert.strictEqual(mine.start, appLater ? '20:30' : '09:00');
  }
});
test('changing the default time of a kind of session moves all of them; start date change moves everything', async () => {
  const r = rig(); await r.g.sync(); r.tick(60000);
  r.S.settings.times.am = '06:30'; r.S.settings.timesAt = r.now();
  const n = SC.allEvents(r.S, false, TODAY).filter((e) => e.slot === 'am').length; assert.strictEqual(r.g.status().pending, n);
  r.fake.clearLog(); const a = await r.g.sync(); assert.strictEqual(a.pushed, n);
  assert.ok(r.fake.live().filter((e) => /AM Zone 2/.test(e.summary)).every((e) => hm(e.start.dateTime) === '06:30'));
  r.tick(60000); r.S.settings.startDate = '2026-11-09'; r.S.settings.timesAt = r.now(); const b = await r.g.sync(); assert.strictEqual(b.pushed, 144);
  assert.strictEqual(r.fake.ev('ha01d1p').start.dateTime.slice(0, 10), '2026-11-09'); assert.strictEqual(r.fake.live().length, 144, 'still one event per session');
});
test('structure changes: a Ducky note is added to the event description; the title and time are untouched', async () => {
  const r = rig(); await r.g.sync(); r.tick(60000);
  SC.setNote(r.S, 'ha-w01d1-pm', 'Ducky: Bench Press -10%; dropped Superset B');
  assert.strictEqual(r.g.status().pending, 1); r.fake.clearLog(); const a = await r.g.sync({ pushOnly: true, uids: ['ha-w01d1-pm'] });
  assert.strictEqual(a.pushed, 1); const e = r.fake.ev('ha01d1p');
  assert.ok(/Ducky: Bench Press -10%; dropped Superset B$/.test(e.description) && /\n\n/.test(e.description)); assert.strictEqual(e.start.dateTime, '2026-11-02T17:30:00');
  SC.setNote(r.S, 'ha-w01d1-pm', ''); await r.g.sync({ pushOnly: true, uids: ['ha-w01d1-pm'] }); assert.ok(!/Ducky/.test(r.fake.ev('ha01d1p').description), 'removing the note removes it there too');
});
test('deleted in Google Calendar: left alone, and recreated only after a later change in the app', async () => {
  const r = rig(); await r.g.sync(); r.tick(60000);
  r.fake.userDelete('ha01d2'); r.fake.clearLog(); const a = await r.g.sync(); assert.deepStrictEqual([a.removed, a.pushed], [1, 0]);
  assert.strictEqual(r.fake.ev('ha01d2').status, 'cancelled'); assert.strictEqual(r.g.status().pending, 0);
  r.tick(60000); const b = await r.g.sync(); assert.deepStrictEqual([b.removed, b.pushed], [0, 0], 'it does not come back by itself');
  r.tick(60000); SC.setMove(r.S, base(r.S, 'ha-w01d2'), '2026-11-04', '19:30', 120, r.now());
  const c = await r.g.sync(); assert.strictEqual(c.pushed, 1); assert.strictEqual(r.fake.ev('ha01d2').status, 'confirmed'); assert.strictEqual(r.fake.ev('ha01d2').start.dateTime, '2026-11-04T19:30:00');
});
test('a calendar that was deleted, and an expired sync token, both recover', async () => {
  const r = rig(); await r.g.sync(); r.tick(60000);
  r.fake.st.expireTokens = true; r.fake.clearLog(); const a = await r.g.sync(); assert.deepStrictEqual([a.pushed, a.errors], [0, 0]);
  assert.strictEqual(r.fake.count('GET', /events/), 2, 'listed again after the 410'); assert.ok(r.S.gcal.syncToken);
  r.fake.deleteCalendar(); r.tick(60000); const b = await r.g.sync();
  assert.strictEqual(b.pushed, 144); assert.strictEqual(Object.keys(r.fake.st.cals).length, 1); assert.strictEqual(r.fake.live().length, 144);
});
test('an existing "Hybrid Athlete Schedule" is reused after a reinstall; without list permission a new one is made', async () => {
  const r = rig(); await r.g.sync();
  const r2 = rig(); r2.fake.st.cals = r.fake.st.cals; r2.fake.st.calN = 1;          // new install, same Google account: empty app state
  const a = await r2.g.sync(); assert.strictEqual(Object.keys(r2.fake.st.cals).length, 1, 'no second calendar');
  assert.deepStrictEqual([a.pushed, a.pulled], [0, 0], 'the calendar already agrees with the untouched defaults');
  const r3 = rig({ listAllowed: false }); r3.fake.st.cals = r.fake.st.cals; r3.fake.st.calN = 1; await r3.g.sync(); assert.strictEqual(Object.keys(r3.fake.st.cals).length, 2);
});
test('a reinstall adopts a time that was moved in Google Calendar instead of overwriting it', async () => {
  const r = rig(); await r.g.sync(); r.fake.userMove('ha01d1p', '2026-11-03T21:00:00', '2026-11-03T22:30:00'); r.tick(60000);
  const r2 = rig(); r2.fake.st.cals = r.fake.st.cals; r2.fake.st.calN = 1; r2.fake.st.seq = r.fake.st.seq;
  const a = await r2.g.sync(); assert.strictEqual(a.pulled, 1); assert.strictEqual(SC.oneEvent(r2.S, 'ha-w01d1-pm', false, TODAY).start, '21:00');
});
test('rest days switched off: their events are removed from the calendar', async () => {
  const r = rig(); await r.g.sync(); r.tick(60000); r.S.settings.includeRest = false;
  const a = await r.g.sync(); assert.strictEqual(a.errors, 0); assert.strictEqual(r.fake.live().length, 128); assert.strictEqual(r.fake.ev('ha01d7').status, 'cancelled');
});
test('events that are not ours are ignored', async () => {
  const r = rig(); await r.g.sync(); r.tick(60000); r.fake.userAdd('abcde12345', 'Dentist'); r.fake.userAdd('ha99d9', 'Odd');
  const a = await r.g.sync(); assert.deepStrictEqual([a.pulled, a.pushed, a.errors], [0, 0, 0]);
});
test('rate limits are retried with backoff, then it carries on', async () => {
  const r = rig(); r.fake.st.failures.push({ status: 403, reason: 'rateLimitExceeded' }, { status: 429, reason: 'x' }, { status: 503, reason: 'x' });
  const a = await r.g.sync(); assert.strictEqual(a.pushed, 144); assert.strictEqual(r.sleeps.length, 3); assert.ok(r.sleeps[1] > r.sleeps[0] && r.sleeps[2] > r.sleeps[1], r.sleeps.join());
});
test('a real error on one event is counted and the rest are still sent; the sync token is kept for a retry', async () => {
  const r = rig(); await r.g.sync(); r.tick(60000); r.fake.userMove('ha01d3', '2026-11-04T08:00:00', '2026-11-04T09:30:00'); r.tick(60000);
  SC.setMove(r.S, base(r.S, 'ha-w01d4'), '2026-11-05', '07:00', 60, r.now()); SC.setMove(r.S, base(r.S, 'ha-w01d5-pm'), '2026-11-06', '07:00', 60, r.now());
  const was = r.S.gcal.syncToken; const orig = r.fake.handle;
  r.fake.fetch = null; const f = r.fake; let n = 0;
  r.deps.fetch = async (url, init) => { if (init.method === 'PATCH' && /ha01d4/.test(url)) { n++; return { status: 400, text: async () => JSON.stringify({ error: { message: 'bad' } }) }; } return f.handle ? (async () => { const x = orig(init.method || 'GET', url, init.headers, init.body); return { status: x.status, text: async () => (x.body == null ? '' : JSON.stringify(x.body)) }; })() : null; };
  const g2 = HA.gcal.create(r.deps), a = await g2.sync();
  assert.deepStrictEqual([a.pulled, a.pushed, a.errors], [1, 1, 1]); assert.strictEqual(r.S.gcal.syncToken, was, 'token not advanced past a failure'); assert.ok(/bad/.test(g2.status().err));
  assert.strictEqual(g2.status().pending, 1, 'the failed move is still waiting');
});
test('an expired or rejected token: nothing is lost, the error says to sign in, and pending changes are still counted', async () => {
  const r = rig(); await r.g.sync(); r.tick(60000); SC.setMove(r.S, base(r.S, 'ha-w01d1-pm'), '2026-11-03', '18:15', 75, r.now());
  r.setTok({ t: 'tok-1', exp: r.now() - 1 }); await assert.rejects(() => r.g.sync(), (e) => e.code === 'auth');
  assert.strictEqual(r.g.status().tokenOk, false); assert.strictEqual(r.g.status().pending, 1);
  r.setTok({ t: 'revoked', exp: r.now() + 3600e3 }); await assert.rejects(() => r.g.sync(), (e) => e.code === 'auth'); assert.strictEqual(r.tok(), null, 'a rejected token is dropped');
  r.setTok({ t: 'tok-1', exp: r.now() + 3600e3 }); const a = await r.g.sync(); assert.strictEqual(a.pushed, 1, 'the move goes out once you sign in again');
});
test('sign-in: token model through Google Identity Services, with each error mapped to something a person can act on', async () => {
  const r = rig(); r.setTok(null); let cfg, asked;
  const mk = (behave) => ({ accounts: { oauth2: { initTokenClient: (c) => { cfg = c; return { requestAccessToken: (o) => { asked = o; behave(c, o); } }; }, hasGrantedAllScopes: (res) => !res.denied, revoke: (t, cb) => { r.revoked = t; cb && cb(); } } } });
  globalThis.google = mk((c) => c.callback({ access_token: 'tok-1', expires_in: 3599, scope: HA.gcal.SCOPE }));
  await r.g.connect(); assert.strictEqual(cfg.scope, 'https://www.googleapis.com/auth/calendar.app.created'); assert.strictEqual(cfg.client_id, 'client-id'); assert.strictEqual(asked.prompt, 'consent');
  assert.deepStrictEqual([r.tok().t, r.tok().exp], ['tok-1', r.now() + 3599e3]); assert.ok(r.S.gcal.on && r.S.gcal.granted); assert.ok(r.g.tokenOk());
  await r.g.connect(); assert.strictEqual(asked.prompt, '', 'after the first consent there is no consent screen again');
  globalThis.google = mk((c) => c.error_callback({ type: 'popup_closed' })); await assert.rejects(() => r.g.connect(), /closed/);
  globalThis.google = mk((c) => c.error_callback({ type: 'popup_failed_to_open' })); await assert.rejects(() => r.g.connect(), /pop-ups/);
  globalThis.google = mk((c) => c.callback({ error: 'access_denied' })); await assert.rejects(() => r.g.connect(), /access_denied/);
  globalThis.google = mk((c) => c.callback({ access_token: 'x', expires_in: 3600, denied: true })); await assert.rejects(() => r.g.connect(), /not granted/);
  globalThis.google = mk((c) => c.callback({ access_token: 'tok-9', expires_in: 3600 })); r.deps.clientId = () => ''; await assert.rejects(() => HA.gcal.create(r.deps).connect(), /client ID/);
  r.deps.clientId = () => 'client-id'; await r.g.connect(); r.g.disconnect(); assert.strictEqual(r.revoked, 'tok-9'); assert.strictEqual(r.tok(), null); assert.strictEqual(r.S.gcal.on, false);
  delete globalThis.google; await assert.rejects(() => r.g.connect(), /still loading|No sign-in/);
});
test('Google is only contacted with a bearer token and only the Calendar endpoints; the scope is the narrowest that fits', async () => {
  const r = rig(); await r.g.sync(); assert.ok(r.fake.st.log.every((l) => /^\/(calendars|users\/me\/calendarList)/.test(l.path)));
  assert.ok(!/calendar$|calendar\.readonly|calendar\.events/.test(HA.gcal.SCOPE) && /calendar\.app\.created$/.test(HA.gcal.SCOPE));
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 5).join('\n       ')); }
  }
  console.log(`\n${passed} passed${failed ? ', ' + failed + ' FAILED' : ''}`);
  process.exit(failed ? 1 : 0);
})();
