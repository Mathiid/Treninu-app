/* Renders every screen for every day of the program, in several states, and checks the HTML:
   no undefined / NaN / [object Object] text, balanced tags, unique ids, every CSS class used exists in
   styles.css, and every data-act the views emit has a handler in app.js.
   Run: node views.test.js */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = __dirname;
['spec', 'engine', 'program', 'session', 'store', 'zone2', 'sched', 'actions', 'timer', 'hr', 'gcal', 'ai', 'thumbs', 'views'].forEach((m) => require(path.join(root, m + '.js')));
const HA = globalThis.HA, V = HA.views, A = HA.actions, P = HA.program, E = HA.engine, SS = HA.session;

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).split('\n').slice(0, 4).join('\n       ')); } }

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'path0']);
const SELF_SVG = /<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*\/?>/g;
function check(html, label) {
  // text nodes only: drop tags, then look for leaks
  const text = html.replace(/<[^>]*>/g, ' ');
  for (const bad of ['undefined', 'NaN', '[object', 'Infinity']) assert.ok(text.indexOf(bad) < 0, `${label}: text contains "${bad}": ...${text.slice(Math.max(0, text.indexOf(bad) - 40), text.indexOf(bad) + 40)}`);
  assert.ok(!/(^|\s)null(\s|$)/.test(text.replace(/\s+/g, ' ')), `${label}: text contains "null"`);
  const attrs = html.match(/\s[a-z-]+="[^"]*(undefined|NaN|\[object)[^"]*"/g);
  assert.ok(!attrs, `${label}: attribute leak ${attrs}`);
  // balanced tags (svg shapes are self-closing in our markup; strip them first)
  const h = html.replace(SELF_SVG, '');
  const stack = [], re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = re.exec(h))) {
    const tag = m[1].toLowerCase(), closing = m[0][1] === '/';
    if (VOID.has(tag) || m[2] === '/') continue;
    if (!closing) stack.push(tag);
    else { const top = stack.pop(); assert.strictEqual(top, tag, `${label}: </${tag}> closes <${top}>`); }
  }
  assert.deepStrictEqual(stack, [], `${label}: unclosed ${stack}`);
  const ids = (html.match(/\sid="([^"]+)"/g) || []).map((x) => x.slice(5, -1));
  assert.strictEqual(new Set(ids).size, ids.length, `${label}: duplicate ids ${ids}`);
}

const usedClasses = new Set();
function collect(html) {
  (html.match(/class="([^"]*)"/g) || []).forEach((c) => c.slice(7, -1).split(/\s+/).filter(Boolean).forEach((k) => usedClasses.add(k)));
}
function mkState(over) {
  const S = HA.store.defaults();
  S.settings.startDate = '2026-11-02';
  Object.assign(S.settings, over || {});
  return S;
}
function ctx(S, o) { o = o || {}; return Object.assign({ S, today: '2026-11-04', view: { week: 1, day: 3 }, tab: 'today', ui: {}, hasKey: false, persistent: true, origin: 'https://me.github.io' }, o); }
function fullState() {
  const S = mkState({ age: 30, rhr: 55 });
  S.baselines = { bench: { kg: 100, at: '2026-11-01' }, zercher: { kg: 120, at: '2026-11-01' }, clean: { kg: 80, at: '2026-11-01' }, rdl: { kg: 140, at: '2026-11-01' } };
  A.startWorkout(S, 1, 1, '2026-11-02');
  S.active.items.forEach((it) => { const exs = it.kind === 'ex' ? [it.ex] : it.kind === 'group' ? it.exs : []; exs.forEach((e) => e.sets.forEach((s, i) => { if (i === 0) s.done = true; })); });
  const r = A.finish(S, Date.now() + 3600e3);
  assert.ok(!r.empty);
  return { S, r };
}

console.log('Views');

test('Today renders for all 112 days, before / during / after the program', () => {
  const S = mkState({ age: 30, rhr: 55 });
  for (const todayISO of ['2026-10-28', '2026-11-04', '2027-03-01']) {
    for (let w = 1; w <= 16; w++) for (let d = 1; d <= 7; d++) {
      const html = V.today(ctx(S, { today: todayISO, view: { week: w, day: d } }));
      check(html, `today ${todayISO} w${w}d${d}`); collect(html);
    }
  }
});
test('Today with a workout in progress shows resume buttons and the pill', () => {
  const S = mkState(); A.startWorkout(S, 1, 1, '2026-11-02');
  const same = V.today(ctx(S, { view: { week: 1, day: 1 } })), other = V.today(ctx(S, { view: { week: 1, day: 5 } }));
  assert.ok(/Resume workout/.test(same)); assert.ok(/Resume current workout/.test(other) && /data-replace="1"/.test(other));
  const pill = V.resumePill(ctx(S)); check(pill, 'pill'); collect(pill); assert.ok(/pill-clock/.test(pill));
});
test('Program, Lifts, Ducky and Settings render empty and populated', () => {
  const { S } = fullState();
  S.chat = [{ role: 'user', text: 'How do I perform Zercher squats?' },
    { role: 'duck', text: '- Keep elbows tight\n- Brace\n\nhttps://www.youtube.com/results?search_query=how+to+do+zercher+squat', yt: { name: 'Zercher Squat', url: 'https://www.youtube.com/results?search_query=how+to+do+zercher+squat' } },
    { role: 'duck', text: 'Dropping volume.', mods: [{ exercise: 'Bench Press', sets: 2, reps: 6, weightFactor: 0.85, skip: false }] },
    { role: 'duck', text: 'Done.', mods: [{ exercise: 'Bench Press', skip: true }], applied: 'Saved.' }];
  for (const s of [mkState(), S]) for (const tab of ['program', 'lifts', 'ducky', 'settings']) {
    for (const extra of [{}, { hasKey: true, ui: { pending: true } }, { ui: { error: 'Gemini rejected the API key.' } }, { persistent: false }]) {
      const html = V[tab](ctx(s, Object.assign({ tab }, extra))); check(html, tab); collect(html);
    }
  }
  const lb = mkState({ units: 'lb' }); lb.baselines.bench = { kg: 100, at: '2026-11-01' };
  for (const tab of ['lifts', 'settings']) { const h = V[tab](ctx(lb, { tab })); check(h, 'lb ' + tab); collect(h); }
});
test('Sheets render', () => {
  const { S, r } = fullState(), c = ctx(S);
  const sheets = { day: V.daySheet(c, 3, 2), day2: V.daySheet(c, 16, 7), rm: V.oneRMSheet(c, 'bench'), confirm: V.confirmSheet('Delete?', 'Sure?', 'del-log-go', 'Delete', ' data-id="x"'),
    finish: V.finishSheet(c, 3), finish1: V.finishSheet(c, 1), summary: V.summarySheet(c, r), modify: V.modifySheet(c), how: V.howSheet(c) };
  for (const k in sheets) { check(sheets[k], 'sheet ' + k); collect(sheets[k]); }
  assert.ok(/1 set is/.test(sheets.finish1));
});
test('Live workout renders for every one of the 112 days, in kg and lb', () => {
  for (const units of ['kg', 'lb']) {
    const S = mkState({ units, age: 30, rhr: 55 });
    S.baselines = { bench: { kg: 100, at: '2026-11-01' }, zercher: { kg: 120, at: '2026-11-01' }, clean: { kg: 80, at: '2026-11-01' }, rdl: { kg: 140, at: '2026-11-01' } };
    for (let w = 1; w <= 16; w++) for (let d = 1; d <= 7; d++) {
      A.startWorkout(S, w, d, '2026-11-04');
      const html = V.workout(ctx(S, { view: { week: w, day: d } })); check(html, `workout ${units} w${w}d${d}`); collect(html);
      if (S.active.items.length) {
        A.toggleSet(S, { it: S.active.items.findIndex((i) => i.kind !== 'section'), ex: 0, set: 0 });
        const h2 = V.workoutBody(ctx(S)); check(h2, `body ${units} w${w}d${d}`);
      }
    }
  }
});
test('Live workout: sub-line shows a set count, never an object', () => {
  const S = mkState(); A.startWorkout(S, 1, 1, '2026-11-02');
  const html = V.workout(ctx(S));
  assert.ok(/Pause Split Squat Hold<\/h4><p>2 × /.test(html), 'set count in sub-line');
  assert.ok(!/\[object/.test(html));
});
test('split squat and pull-up cards show their weight as a percentage of the estimated 1RM, and follow what you type', () => {
  const S = mkState({ bodyKg: 80 }); S.baselines.bss = { kg: 40, at: '2026-11-01', ts: 1 }; S.baselines.pullup = { kg: 120, at: '2026-11-01', ts: 1 };
  A.startWorkout(S, 1, 1, '2026-11-02');
  const html = V.workout(ctx(S)), text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(/Bulgarian Split Squat 3 × 10 reps\/leg, 71\.4% of 1RM 27\.5 kg = 68\.8% of estimated 1RM 40 kg/.test(text), text.match(/Bulgarian.{0,160}/)[0]);
  assert.ok(/Pull-Ups 10 reps, 71\.4% of 1RM \+5 kg added = 70\.8% of estimated 1RM 120 kg total/.test(text), text.match(/Pull-Ups.{0,160}/)[0]);
  assert.ok(/id="rm-\d+-\d+" /.test(html) || /id="rm-\d+-\d+">/.test(html), 'live line has an id the app can update');
  // typing a heavier weight into set 2 changes the line for that set
  const ex = SS.allExs(S.active).find((e) => e.liftKey === 'bss'); ex.sets[1].w = 32.5;
  assert.strictEqual(V.rmLine(ctx(S), ex, 1), '32.5 kg = 81.3% of estimated 1RM 40 kg');
  const pu = SS.allExs(S.active).find((e) => e.liftKey === 'pullup'); pu.sets[0].w = null;
  assert.strictEqual(V.rmLine(ctx(S), pu, 0), 'Bodyweight 80 kg = 66.7% of estimated 1RM 120 kg total');
  // no 1RM / no bodyweight: say what to do, never NaN
  const S2 = mkState(); A.startWorkout(S2, 1, 1, '2026-11-02');
  const t2 = V.workout(ctx(S2)).replace(/<[^>]*>/g, ' ');
  assert.ok(/Add your bodyweight in Settings to see pull-up percentages/.test(t2) && /Set your Bulgarian Split Squat 1RM on the Lifts tab/.test(t2));
  // pounds
  const S3 = mkState({ bodyKg: 80, units: 'lb' }); S3.baselines.pullup = { kg: 120, at: '2026-11-01', ts: 1 }; A.startWorkout(S3, 1, 1, '2026-11-02');
  assert.ok(/\+15 lb added = 72\.3% of estimated 1RM 264\.6 lb total/.test(V.workout(ctx(S3)).replace(/<[^>]*>/g, ' ')), V.workout(ctx(S3)).replace(/<[^>]*>/g, ' ').match(/Pull-Ups.{0,200}/)[0]);
});
test('Lifts tab: six lifts, pull-up needs a bodyweight, Settings has the bodyweight field and the calculator offers every lift', () => {
  const S = mkState(); const h = V.lifts(ctx(S, { tab: 'lifts' }));
  ['Bench Press', 'Zercher Squat', 'Power Clean', 'Romanian Deadlift', 'Bulgarian Split Squat', 'Pull-up'].forEach((n) => assert.ok(h.indexOf('<h2>' + n + '</h2>') > 0, n));
  assert.ok(/data-act="goto-settings" data-focus="bw"/.test(h), 'pull-up card asks for a bodyweight');
  assert.ok(/<option value="pullup">Pull-up<\/option>/.test(h) && /<option value="bss">/.test(h));
  const S2 = mkState({ bodyKg: 80 }); S2.baselines.pullup = { kg: 120, at: '2026-11-01', ts: 1 };
  const h2 = V.lifts(ctx(S2, { tab: 'lifts' })), t2 = h2.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(!/data-focus="bw"/.test(h2));
  assert.ok(/Bodyweight 80 \+ 40 kg added/.test(t2) && /120 kg total 1RM/.test(t2), t2.match(/Pull-up.{0,200}/)[0]);
  assert.ok(/\+5 4×10 71\.4%/.test(t2) || /\+5 3×10 71\.4%/.test(t2), 'projection shows added weight, sets x reps and the percentage: ' + (t2.match(/W1 .{0,80}/) || [''])[0]);
  const st = V.settings(ctx(S2, { tab: 'settings' }));
  assert.ok(/data-set="bodyKg" data-type="num" value="80"/.test(st), 'bodyweight field');
  assert.ok(/Type the total, or type \+ and the weight you added/.test(V.oneRMSheet(ctx(S2), 'pullup')));
  assert.ok(/Add your bodyweight in Settings first/.test(V.oneRMSheet(ctx(S), 'pullup')));
});
test('Checklist rows have no empty column header', () => {
  const S = mkState(); A.startWorkout(S, 1, 1, '2026-11-02');
  const html = V.workout(ctx(S));
  assert.ok(/Tick when done|prev tgt/.test(html)); assert.ok(!/<span>Target<\/span>/.test(html));
});
test('superset header: rounds, then the current round, then Done', () => {
  const S = mkState(); A.startWorkout(S, 1, 1, '2026-11-02');
  const chips = (h) => (h.match(/<span class="round-chip">([^<]*)<\/span>/g) || []).map((x) => x.replace(/<[^>]+>/g, ''));
  assert.deepStrictEqual(chips(V.workout(ctx(S))), ['3 rounds', '3 rounds'], 'nothing started');
  const gi = S.active.items.findIndex((i) => i.kind === 'group');
  A.toggleSet(S, { it: gi, ex: 0, set: 0 });
  assert.deepStrictEqual(chips(V.workout(ctx(S))), ['Round 1 of 3', '3 rounds']);
  S.active.items[gi].exs.forEach((e) => e.sets.forEach((s) => { s.done = true; }));
  assert.strictEqual(chips(V.workout(ctx(S)))[0], 'Done');
});
test('exercise photos: mapped names render an image, everything else keeps the category icon', () => {
  HA.THUMBS['power clean'] = 'thumbs/power-clean.webp'; HA.THUMBS['zercher squat'] = 'thumbs/a"b.webp';
  try {
    const S = mkState(); A.startWorkout(S, 1, 1, '2026-11-02');
    const h = V.workout(ctx(S));
    assert.ok(/<img src="thumbs\/power-clean\.webp"/.test(h), 'mapped by name, "or High Pull" ignored');
    assert.ok(/class="thumb t-main"><svg/.test(h) || /class="thumb t-/.test(h), 'others keep icons');
    A.startWorkout(S, 1, 5, '2026-11-06'); const h2 = V.workout(ctx(S)); check(h2, 'thumb escaping'); assert.ok(!/a"b/.test(h2), 'quote escaped');
  } finally { delete HA.THUMBS['power clean']; delete HA.THUMBS['zercher squat']; }
});
test('Clock digits sit in fixed-width cells', () => {
  assert.strictEqual(V.clockHTML('12:05'), '<span class="dg">1</span><span class="dg">2</span><span class="cl">:</span><span class="dg">0</span><span class="dg">5</span>');
});
test('Escapes user-controlled text', () => {
  const S = mkState(); S.chat = [{ role: 'user', text: '<img src=x onerror=alert(1)>' }, { role: 'duck', text: '<script>alert(1)</script> **bold** [x](javascript:alert(1))' }];
  S.logs.push({ id: 'a"><b>', date: '2026-11-02', week: 1, day: 1, wid: 'w1d1', title: '<i>t</i>', entries: [{ name: 'x', sets: [{ w: 1, r: 1 }] }], volumeKg: 1, startedAt: 1 });
  const html = V.ducky(ctx(S, { tab: 'ducky' })) + V.lifts(ctx(S, { tab: 'lifts' }));
  assert.ok(!/<img src=x/.test(html) && !/<script>alert/.test(html) && !/<i>t<\/i>/.test(html) && !/href="javascript/.test(html));
});

const gstat = (o) => Object.assign({ configured: true, on: true, tokenOk: true, calendarId: 'cal1', lastSync: Date.parse('2026-11-04T10:00:00Z'), pending: 0, busy: false, msg: 'Everything is up to date', err: '', gis: true }, o || {});
test('running: pace line, run tools, sessions with a Change button, in every Google state', () => {
  const S = mkState({ age: 30, rhr: 55 });
  const none = V.today(ctx(S, { view: { week: 1, day: 1 } }));
  assert.ok(/data-act="live-open"/.test(none) && /data-act="run-log"/.test(none), 'run tools on the run card');
  assert.ok(/data-focus="pace"/.test(none), 'no runs and no race: asks for one');
  HA.actions.addRun(S, { date: '2026-11-01', km: 8, sec: 3000, hr: 140 }, 'manual');
  const withRun = V.today(ctx(S, { view: { week: 1, day: 1 } })), text = withRun.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(/\/km target pace/.test(text) && /From your last run/.test(text), text.match(/.{60}target pace.{60}/));
  assert.ok(/data-act="move-open" data-uid="ha-w01d1-am"/.test(withRun) && /data-act="move-open" data-uid="ha-w01d1-pm"/.test(withRun), 'two sessions on day 1');
  for (const g of [undefined, gstat({ on: false }), gstat(), gstat({ pending: 3 }), gstat({ pending: 1 }), gstat({ tokenOk: false })]) {
    const h = V.today(ctx(S, { view: { week: 1, day: 1 }, gcal: g })); check(h, 'today gcal ' + JSON.stringify(g)); collect(h);
  }
  assert.ok(/3 changes are not in Google Calendar yet/.test(V.today(ctx(S, { view: { week: 1, day: 1 }, gcal: gstat({ pending: 3 }) }))));
  assert.ok(/tap to sign in and sync/.test(V.today(ctx(S, { view: { week: 1, day: 1 }, gcal: gstat({ tokenOk: false }) }))));
  const moved = mkState({ age: 30, rhr: 55 }); HA.actions.moveSession(moved, 'ha-w01d1-pm', '2026-11-03', '19:15', 60);
  const mt = V.today(ctx(moved, { view: { week: 1, day: 1 } })).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(/Moved to/.test(mt) && /19:15–20:15/.test(mt), mt.match(/Session times.{0,200}/));
});
test('sheets for moving a session and logging a run; the live screen in every state', () => {
  const S = mkState({ age: 30, rhr: 55 }), c = ctx(S, { gcal: gstat() });
  const mv = V.moveSheet(c, 'ha-w01d1-pm'); check(mv, 'move sheet'); collect(mv);
  assert.ok(/id="mv-date"[^>]*value="2026-11-02"/.test(mv) && /id="mv-time"[^>]*value="17:30"/.test(mv) && /id="mv-mins"[^>]*value="90"/.test(mv));
  assert.ok(!/move-reset/.test(mv), 'nothing to reset yet');
  HA.actions.moveSession(S, 'ha-w01d1-pm', '2026-11-03', '19:00', 60);
  const mv2 = V.moveSheet(ctx(S, { gcal: gstat() }), 'ha-w01d1-pm'); check(mv2, 'moved sheet'); assert.ok(/data-act="move-reset"/.test(mv2) && /Program time: /.test(mv2));
  assert.strictEqual(V.moveSheet(c, 'nonsense'), '');
  for (const p of [undefined, { date: '2026-11-04', time: '42:30', hr: 141, dist: '', note: 'Run finished: 42:30.' }]) { const h = V.runSheet(c, p); check(h, 'run sheet'); collect(h); assert.ok(/data-act-change="run-import"/.test(h) && /id="run-dist"/.test(h)); }
  const z = HA.engine.zone2(S.settings), base = { supported: true, status: 'idle', name: '', bpm: 0, fresh: false, zone: null, running: false, elapsed: 0, z, err: '', inPct: null };
  const states = [base, Object.assign({}, base, { supported: false }), Object.assign({}, base, { status: 'connecting' }), Object.assign({}, base, { status: 'lost' }),
    Object.assign({}, base, { status: 'live', name: 'HRM-Dual', bpm: 131, fresh: true, zone: 'in' }), Object.assign({}, base, { status: 'live', bpm: 110, fresh: true, zone: 'low', running: true, elapsed: 700, inPct: 40 }),
    Object.assign({}, base, { status: 'live', bpm: 171, fresh: true, zone: 'high', running: true, elapsed: 1200, inPct: 82 }), Object.assign({}, base, { status: 'live', fresh: false }), Object.assign({}, base, { z: null, status: 'live', bpm: 120, fresh: true }),
    Object.assign({}, base, { err: 'No heart-rate sensor was chosen.' })];
  const words = ['Bluetooth is not available', 'Connecting', 'Signal lost', 'In Zone 2', 'Below Zone 2', 'Above Zone 2', 'Waiting for a heart-rate reading', 'Add your age', 'No sensor connected'];
  const seen = new Set();
  states.forEach((L, i) => { const h = V.liveRun(c, L); check(h, 'live ' + i); collect(h); words.forEach((w) => { if (h.indexOf(w) >= 0) seen.add(w); }); });
  assert.deepStrictEqual(words.filter((w) => !seen.has(w)), [], 'every state has its own words');
  const cls = (L) => (V.liveBody(c, L).match(/class="lr-main (zone-\w+)"/) || [])[1];
  assert.deepStrictEqual([cls(states[4]), cls(states[5]), cls(states[6]), cls(states[7]), cls(states[8])], ['zone-in', 'zone-low', 'zone-high', 'zone-none', 'zone-none'], 'green in zone, blue below, red above');
  assert.ok(/data-act="live-stop"/.test(V.liveBody(c, states[5])) && /data-act="live-start"/.test(V.liveBody(c, states[4])) && /data-act="live-connect"/.test(V.liveBody(c, states[0])));
  assert.ok(V.gaugePos(60, z) < V.gaugePos(z.lo, z) && V.gaugePos(z.lo, z) < V.gaugePos(z.hi, z) && V.gaugePos(250, z) === 100 && V.gaugePos(0, z) === 0);
});
test('safe edition: no sync block, the .ics button leads, every session has a one-tap Add to Google Calendar link', () => {
  const S = mkState({ age: 30, rhr: 55 }), off = { off: true, configured: false, on: false, tokenOk: false, pending: 0, busy: false, msg: '', err: '' };
  const st = V.settings(ctx(S, { tab: 'settings', gcal: off })); check(st, 'safe settings'); collect(st);
  assert.ok(!/gcalClientId|gcal-connect|Two-way sync|console\.cloud\.google\.com/.test(st), 'no sign-in or sync controls');
  assert.ok(/<h2>Calendar<\/h2>/.test(st) && /btn btn-primary btn-block" data-act="cal-download"/.test(st) && /Add to Google Calendar link/.test(st));
  const day = V.today(ctx(S, { view: { week: 1, day: 1 }, gcal: off })); check(day, 'safe today'); collect(day);
  const links = [...day.matchAll(/<a class="link" href="([^"]+)" target="_blank" rel="noopener noreferrer">Add ([^<]+) to Google Calendar<\/a>/g)].map((m) => [m[1].replace(/&amp;/g, '&'), m[2]]);
  assert.deepStrictEqual(links.map((l) => l[1]), ['morning run', 'lifting']);
  assert.ok(links[0][0].startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&text=') && links[0][0].includes('dates=20261102T070000/20261102T074500'), links[0][0]);
  assert.ok(links[1][0].includes('dates=20261102T173000/20261102T190000') && links.every((l) => l[0].length < 2000), 'short enough for any browser: ' + links.map((l) => l[0].length));
  HA.actions.moveSession(S, 'ha-w01d1-pm', '2026-11-03', '19:15', 60);
  assert.ok(V.today(ctx(S, { view: { week: 1, day: 1 }, gcal: off })).replace(/&amp;/g, '&').includes('dates=20261103T191500/20261103T201500'), 'a moved session links to its new time');
  const none = V.today(ctx(S, { view: { week: 1, day: 7 }, gcal: off })); check(none, 'rest day'); assert.ok(!/to Google Calendar/.test(none), 'rest days have no timed session to add');
});
test('live screen: type a heart rate by hand when there is no sensor or no Bluetooth', () => {
  const S = mkState({ age: 30, rhr: 55 }), c = ctx(S, { gcal: gstat() }), z = HA.engine.zone2(S.settings);
  const base = { supported: true, status: 'idle', name: '', bpm: 0, fresh: false, zone: null, source: 'sensor', running: false, elapsed: 0, z, err: '', inPct: null };
  const hand = (zone, bpm, extra) => Object.assign({}, base, { source: 'manual', fresh: true, zone, bpm }, extra || {});
  const cases = { none: base, noBt: Object.assign({}, base, { supported: false }), low: hand('low', 120), inz: hand('in', 142), high: hand('high', 165), noBtHigh: hand('high', 165, { supported: false }), noAge: hand(null, 150, { z: null }), live: Object.assign({}, base, { status: 'live', bpm: 140, fresh: true, zone: 'in' }) };
  for (const k in cases) { const h = V.liveRun(c, cases[k]); check(h, 'manual ' + k); collect(h); }
  assert.ok(/id="lr-manual"/.test(V.liveBody(c, cases.none)) && /data-act="live-manual"/.test(V.liveBody(c, cases.none)), 'offered with no sensor');
  assert.ok(/id="lr-manual"/.test(V.liveBody(c, cases.noBt)) && /Bluefy/.test(V.liveBody(c, cases.noBt)) && !/data-act="live-connect"/.test(V.liveBody(c, cases.noBt)), 'offered where Bluetooth does not exist');
  assert.ok(!/id="lr-manual"/.test(V.liveBody(c, cases.live)), 'hidden while a sensor is delivering');
  const cls = (L) => (V.liveBody(c, L).match(/class="lr-main (zone-\w+)"/) || [])[1];
  assert.deepStrictEqual([cls(cases.low), cls(cases.inz), cls(cases.high), cls(cases.noBtHigh)], ['zone-low', 'zone-in', 'zone-high', 'zone-high']);
  assert.ok(/Above Zone 2: ease off/.test(V.liveBody(c, cases.noBtHigh)) && /value="165"/.test(V.liveBody(c, cases.high)), 'the number you typed stays in the box');
  assert.ok(/Add your age in Settings/.test(V.liveBody(c, cases.noAge)));
});
test('Settings: pace section, Google Calendar block in every state, setup steps carry this app\'s address', () => {
  const S = mkState({ age: 30, rhr: 55, race: { km: 5, sec: 1500 } });
  const states = [undefined, gstat({ configured: false, on: false }), gstat({ on: false }), gstat(), gstat({ busy: true, prog: '40 of 144' }), gstat({ tokenOk: false }), gstat({ pending: 2, err: 'Google needs you to sign in again.' })];
  states.forEach((g, i) => { const h = V.settings(ctx(S, { tab: 'settings', gcal: g })); check(h, 'settings ' + i); collect(h); });
  const h = V.settings(ctx(S, { tab: 'settings', gcal: gstat({ on: false }) })), t = h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(/id="sec-pace"/.test(h) && /id="pace-result"/.test(h) && /Zone 2 pace: /.test(t) && /From your race result/.test(t), t.match(/Running pace.{0,300}/));
  assert.ok(/data-set="gcalClientId"/.test(h) && /data-act="gcal-connect"/.test(h) && /https:\/\/me\.github\.io/.test(h), 'the origin to authorise is spelled out');
  assert.ok(/data-act="gcal-sync"/.test(V.settings(ctx(S, { tab: 'settings', gcal: gstat() }))) && /data-act="gcal-disconnect"/.test(V.settings(ctx(S, { tab: 'settings', gcal: gstat() }))));
  assert.ok(/data-act="gcal-connect" disabled/.test(V.settings(ctx(S, { tab: 'settings', gcal: gstat({ configured: false, on: false }) }))), 'cannot connect without a client id');
  assert.ok(/Syncing: 40 of 144/.test(V.gcalStatus(ctx(S, { gcal: gstat({ busy: true, prog: '40 of 144' }) }))));
  const lb = mkState({ age: 30, rhr: 55, paceUnit: 'mi', race: { km: 8.047, sec: 2400 } }); HA.actions.addRun(lb, { date: '2026-11-01', km: 10, sec: 3700, hr: 138 }, 'manual');
  const hl = V.settings(ctx(lb, { tab: 'settings', gcal: gstat() })); check(hl, 'miles'); assert.ok(/\/mi/.test(hl) && /Race distance \(mi\)/.test(hl) && /data-act="run-del"/.test(hl));
});

console.log('Wiring');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const viewsSrc = fs.readFileSync(path.join(root, 'views.js'), 'utf8');

test('every CSS class used by the views exists in styles.css', () => {
  const missing = [...usedClasses].filter((k) => !new RegExp('\\.' + k.replace(/[-]/g, '\\-') + '(?![\\w-])').test(css));
  // classes that are only hooks for JS, not styled on their own
  const hooks = new Set(['ico-check', 'ico-duck', 'in-w', 'in-r', 'cat-main', 'cat-tendon', 'cat-plyo', 'cat-contrast', 'cat-push', 'cat-pull', 'cat-core', 'cat-sprint', 'cat-drill', 'cat-mobility', 'cat-warmup', 'cat-check', 'cat-strength', 'k-', 'g-superset', 'day', 'bjj', 'wcard', 'run', 'restday', 'bk-white', 'bk-blue', 'bk-purple', 'bk-brown']);
  const real = missing.filter((k) => !hooks.has(k) && !/^cat-/.test(k));
  assert.deepStrictEqual(real, [], 'classes without CSS: ' + real.join(', '));
});
test('every data-act the views emit has a handler in app.js', () => {
  const acts = new Set((viewsSrc.match(/data-act="([a-z0-9-]+)"/g) || []).map((x) => x.slice(10, -1)));
  (appSrc.match(/confirmSheet\([^)]*?'([a-z0-9-]+-go|wk-discard)'/g) || []).forEach((x) => acts.add(x.match(/'([a-z0-9-]+)'$/)[1]));
  (viewsSrc.match(/confirmSheet\('[^']*', '[^']*', '([a-z0-9-]+)'/g) || []).forEach((x) => acts.add(x.match(/'([a-z0-9-]+)'$/)[1]));
  const handled = new Set((appSrc.match(/case '([a-z0-9-]+)'/g) || []).map((x) => x.slice(6, -1)));
  const missing = [...acts].filter((a) => !handled.has(a));
  assert.deepStrictEqual(missing, [], 'unhandled data-act: ' + missing.join(', '));
  assert.ok(acts.size > 40, 'found ' + acts.size + ' acts');
});
test('element ids that app.js reads exist in the views', () => {
  const read = [...new Set((appSrc.match(/\$\('([a-z0-9-]+)'\)/g) || []).map((x) => x.slice(3, -2)))];
  const fromIndex = new Set(['view', 'nav', 'pill-root', 'workout', 'runlive', 'sheet-root', 'toast', 'ha-sw-source']);   // ha-sw-source: only in the single-file build (the app copes without it)
  const dynamic = new Set(['wk-body']);
  const missing = read.filter((id) => !fromIndex.has(id) && !new RegExp('id="' + id + '"').test(viewsSrc));
  assert.deepStrictEqual(missing, [], 'ids not in views: ' + missing.join(', ') + ' ' + [...dynamic]);
});
test('every script and asset referenced by index.html, the manifest and the service worker exists', () => {
  const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const refs = [...idx.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u));
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const shell = [...sw.slice(sw.indexOf('var SHELL'), sw.indexOf('];')).matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((x) => x !== './');
  const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  const all = [...new Set(refs.concat(shell, man.icons.map((i) => i.src)))];
  const missing = all.filter((f) => !fs.existsSync(path.join(root, f)));
  assert.deepStrictEqual(missing, [], 'missing files: ' + missing.join(', '));
  // scripts load in dependency order
  const order = [...idx.matchAll(/<script src="([a-z0-9]+)\.js"/g)].map((m) => m[1]);
  assert.deepStrictEqual(order, ['guard', 'spec', 'engine', 'program', 'session', 'store', 'zone2', 'sched', 'actions', 'timer', 'hr', 'gcal', 'ai', 'thumbs', 'views', 'app']);
  // every script the page loads is cached for offline use, and nothing in the list points into a subfolder
  order.forEach((n) => assert.ok(shell.includes(n + '.js'), n + '.js missing from the service worker cache list'));
  assert.deepStrictEqual([...idx.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]).concat(shell, man.icons.map((i) => i.src)).filter((u) => !/^https?:/.test(u) && u.includes('/')), [], 'a link points into a subfolder');
});

console.log(`\n${passed} passed${failed ? ', ' + failed + ' FAILED' : ''}`);
process.exit(failed ? 1 : 0);
