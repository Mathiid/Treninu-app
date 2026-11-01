/* Logic tests — run with:  node logic.test.js   (no dependencies) */
'use strict';
const assert = require('assert');
require('./spec.js');
require('./engine.js');
require('./program.js');
require('./session.js');
require('./actions.js');
const HA = globalThis.HA, E = HA.engine, P = HA.program, S = HA.session;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); process.exitCode = 1; }
}
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 1e-6), a + ' !~ ' + b);

console.log('Engine');
test('Epley matches the spec formula', () => {
  near(E.epley(100, 10), 100 * (1 + 10 / 30));
  near(E.epley(60, 5), 70);
  assert.strictEqual(E.epley(100, 1), 100, 'a single is the 1RM');
  assert.strictEqual(E.epley(0, 5), 0);
  assert.strictEqual(E.epley(100, 0), 0);
});
test('pctFor is the inverse of the RIR-adjusted Epley (closed loop)', () => {
  for (const reps of [1, 2, 3, 4, 5, 6, 8, 10]) for (const rir of [0, 1, 2, 4]) {
    const oneRM = 140, w = oneRM * E.pctFor(reps, rir);
    if (reps + rir > 1) near(E.e1rmAdj(w, reps, rir), oneRM, 1e-9);
  }
});
test('intensity table lands in the spec ranges', () => {
  // Block 2: 80-88% for 4-6 reps; Block 3: 88-92+% for 1-3 reps
  for (const [reps, lo, hi] of [[6, 0.80, 0.82], [5, 0.82, 0.85], [4, 0.85, 0.88]]) {
    const p = E.pctFor(reps, E.rirFor('b2', 'bench')); assert.ok(p >= lo && p <= hi, reps + ' -> ' + p);
  }
  for (const [reps, lo, hi] of [[3, 0.88, 0.89], [2, 0.90, 0.92], [1, 0.92, 0.95]]) {
    const p = E.pctFor(reps, E.rirFor('b3', 'bench')); assert.ok(p >= lo && p <= hi, reps + ' -> ' + p);
  }
});
test('parseRest', () => {
  assert.strictEqual(E.parseRest('2-3 mins'), 150);
  assert.strictEqual(E.parseRest('90-120 sec full rest'), 105);
  assert.strictEqual(E.parseRest('60 sec'), 60);
  assert.strictEqual(E.parseRest('2 mins'), 120);
  assert.strictEqual(E.parseRest('30-45 sec'), 40);
  assert.strictEqual(E.parseRest('Rest: 60 sec.'), 60);
  assert.strictEqual(E.parseRest(undefined), null);
});
test('parseTarget / fmtTarget', () => {
  const t = (s) => E.parseTarget(s);
  assert.deepStrictEqual([t('10 reps/leg').lo, t('10 reps/leg').unit, t('10 reps/leg').suffix], [10, 'reps', '/leg']);
  assert.deepStrictEqual([t('20 sec/leg').lo, t('20 sec/leg').unit, t('20 sec/leg').suffix], [20, 'sec', '/leg']);
  assert.strictEqual(t('15 sec/leg (Deload)').note, 'Deload');
  assert.deepStrictEqual([t('3x5 switches/leg').sets, t('3x5 switches/leg').lo, t('3x5 switches/leg').suffix], [3, 5, 'switches/leg']);
  assert.deepStrictEqual([t('3x10m').sets, t('3x10m').unit], [3, 'm']);
  assert.deepStrictEqual([t('30-45 sec').lo, t('30-45 sec').hi], [30, 45]);
  assert.strictEqual(t('4 (Banded/assisted)').note, 'Banded/assisted');
  assert.strictEqual(t('1x6 (Light)').note, 'Light');
  assert.deepStrictEqual([t('3x15s/side').sets, t('3x15s/side').unit, t('3x15s/side').suffix], [3, 'sec', '/side']);
  assert.strictEqual(E.fmtTarget(t('10 reps/leg')), '10 reps/leg');
  assert.strictEqual(E.fmtTarget(t('20 sec/leg')), '20s/leg');
  assert.strictEqual(E.fmtTarget(t('6 total')), '6 total');
  assert.strictEqual(E.fmtTarget(t('3-4')), '3–4 reps');
});
test('Zone 2: Karvonen and % of max HR', () => {
  const k = E.zone2({ age: 30, rhr: 55, hrMethod: 'karvonen', zoneLo: 60, zoneHi: 70 });
  assert.deepStrictEqual([k.mhr, k.lo, k.hi, k.method], [190, 136, 150, 'karvonen']);
  const m = E.zone2({ age: 30, hrMethod: 'karvonen', zoneLo: 60, zoneHi: 70 });   // no resting HR -> falls back
  assert.deepStrictEqual([m.lo, m.hi, m.method], [114, 133, 'mhr']);
  assert.strictEqual(E.zone2({}), null);
  assert.strictEqual(E.maxHR({ age: 30, mhrFormula: 'tanaka' }), 187);
  assert.strictEqual(E.maxHR({ age: 30, mhr: 195 }), 195);
});
test('units: lb <-> kg and plate rounding', () => {
  const s = { units: 'lb' };
  near(E.roundWeightKg(E.lbToKg(137), s), E.lbToKg(135), 1e-9);   // nearest 5 lb
  assert.strictEqual(E.fmtW(E.lbToKg(135), 'lb'), '135');
  assert.strictEqual(E.fmtW(62.5, 'kg'), '62.5');
  near(E.roundWeightKg(71.4, { units: 'kg' }), 72.5);
});
test('dates & program position', () => {
  assert.strictEqual(E.nextMondayISO('2026-10-28'), '2026-11-02');   // Wednesday -> next Monday
  assert.strictEqual(E.nextMondayISO('2026-11-02'), '2026-11-02');
  assert.strictEqual(E.nextMondayISO('2026-11-01'), '2026-11-02');   // Sunday
  assert.deepStrictEqual(E.position('2026-11-02', '2026-11-02'), { state: 'active', index: 0, week: 1, day: 1 });
  assert.deepStrictEqual(E.position('2026-11-02', '2026-11-09'), { state: 'active', index: 7, week: 2, day: 1 });
  assert.strictEqual(E.position('2026-11-02', '2026-10-30').state, 'before');
  assert.strictEqual(E.position('2026-11-02', '2027-02-21').week, 16);
  assert.strictEqual(E.position('2026-11-02', '2027-02-22').state, 'after');
  assert.strictEqual(E.dateFor('2026-11-02', 16, 7), '2027-02-21');
});

console.log('Program');
test('all 112 days resolve with sane exercises', () => {
  let strength = 0;
  for (let w = 1; w <= 16; w++) for (let d = 1; d <= 7; d++) {
    const wk = P.getWorkout(w, d);
    assert.strictEqual(wk.week, w); assert.strictEqual(wk.day, d);
    if (d === 7 || d === 2 || d === 3) assert.strictEqual(wk.items.length, 0);
    else assert.ok(wk.items.length > 3, `W${w}D${d} has items`);
    P.flatExs(wk).forEach((ex) => {
      assert.ok(ex.name && ex.name.length, 'name');
      assert.ok(Number.isInteger(ex.sets) && ex.sets >= 1 && ex.sets <= 8, `${ex.name} sets=${ex.sets} (W${w}D${d})`);
      assert.ok(['weightReps', 'reps', 'hold', 'result', 'check'].includes(ex.mode), ex.mode);
      assert.ok(Number.isFinite(ex.rest) && ex.rest >= 0, `${ex.name} rest`);
      if (ex.mode === 'reps' || ex.mode === 'hold' || ex.mode === 'weightReps') assert.ok(ex.target > 0, `${ex.name} target (W${w}D${d})`);
      if (ex.liftKey) assert.ok(ex.pct > 0.5 && ex.pct <= 1, `${ex.name} pct ${ex.pct}`);
      assert.ok(!/NaN|undefined|null/.test(ex.label + ex.name + ex.note), `${ex.name} label "${ex.label}"`);
    });
    wk.items.forEach((it) => { if (it.kind === 'group') it.exs.forEach((e) => assert.strictEqual(e.sets, it.rounds, `${it.label} rounds`)); });
    if (wk.kind === 'strength') strength++;
  }
  assert.strictEqual(strength, 32);
});
test('Block 1 matches the spec numbers', () => {
  const clean = (w) => P.flatExs(P.getWorkout(w, 1)).find((e) => e.liftKey === 'clean');
  assert.deepStrictEqual([1, 2, 3, 4].map((w) => [clean(w).sets, clean(w).target]), [[4, 5], [4, 4], [4, 3], [2, 3]]);
  const bss = P.flatExs(P.getWorkout(1, 1)).find((e) => /Bulgarian/.test(e.name));
  assert.deepStrictEqual([bss.sets, bss.target, bss.suffix], [3, 10, '/leg']);
  const hold = P.flatExs(P.getWorkout(3, 1)).find((e) => /Pause Split/.test(e.name));
  assert.deepStrictEqual([hold.sets, hold.target, hold.mode], [2, 30, 'hold']);
  const g = P.getWorkout(1, 1).items.filter((i) => i.kind === 'group');
  assert.strictEqual(g.length, 2);
  assert.deepStrictEqual(g[0].exs.map((e) => e.name), ['Plyo Push-Up (or Incline)', 'Bench Press', 'Floor Hollow Body Hold']);
  assert.deepStrictEqual(g[0].exs.map((e) => e.rest), [30, 30, 90]);
  assert.strictEqual(g[0].restAfter, 120); assert.strictEqual(g[1].restAfter, null);
  const nordic = (w) => P.flatExs(P.getWorkout(w, 5)).find((e) => /Nordic/.test(e.name));
  assert.deepStrictEqual([1, 2, 3, 4].map((w) => [nordic(w).sets, nordic(w).target]), [[2, 4], [2, 5], [3, 5], [1, 4]]);
  assert.strictEqual(P.getWorkout(4, 1).deload, true);
  assert.ok(P.getWorkout(4, 1).items.some((i) => i.kind === 'group' && i.exs.every((e) => e.sets === 3)), 'spec keeps 3 rounds in W4');
});
test('Block 2 and 3 follow the rules', () => {
  // the four barbell lifts follow the heavy-rep rules; split squats and pull-ups have their own rep tables (next test)
  const lifts = (w, d) => P.flatExs(P.getWorkout(w, d)).filter((e) => e.liftKey && e.liftKey !== 'bss' && e.liftKey !== 'pullup');
  // heavy 4-6 reps in Block 2, 1-3 in Block 3
  lifts(5, 5).forEach((e) => assert.ok(e.target >= 4 && e.target <= 6 && e.pct >= 0.80 && e.pct <= 0.88, `${e.name} ${e.target} ${e.pct}`));
  lifts(9, 5).forEach((e) => assert.ok(e.target >= 1 && e.target <= 3 && e.pct >= 0.85, `${e.name} ${e.target} ${e.pct}`));
  // deload: 50-60% 1RM and volume roughly halved
  lifts(8, 1).forEach((e) => assert.strictEqual(e.pct, 0.55));
  lifts(12, 5).forEach((e) => assert.strictEqual(e.pct, 0.55));
  // Nordics
  const nordic = (w) => P.flatExs(P.getWorkout(w, 5)).find((e) => /Nordic/.test(e.name));
  [5, 6, 7].forEach((w) => assert.ok(nordic(w).sets === 3 && nordic(w).target >= 4 && nordic(w).target <= 6));
  [9, 10, 11].forEach((w) => assert.ok(nordic(w).sets === 2 && nordic(w).target >= 3 && nordic(w).target <= 4));
  // contrast complex on Days 1 & 5: iso 20 s rest -> jump 3-4 reps -> 2 min, 3 rounds
  [1, 5].forEach((d) => {
    const c = P.getWorkout(5, d).items.find((i) => i.kind === 'group' && i.variant === 'contrast');
    assert.ok(c, 'contrast on day ' + d);
    assert.deepStrictEqual([c.rounds, c.exs[0].rest, c.exs[1].rest, c.exs[1].lo, c.exs[1].hi], [3, 20, 120, 3, 4]);
  });
  assert.strictEqual(P.getWorkout(9, 1).items.find((i) => i.variant === 'contrast').exs[1].name, 'Depth Jump');
  assert.ok(/single-leg/i.test(P.getWorkout(9, 5).items.find((i) => i.variant === 'contrast').exs[1].name));
  // BJJ effort text from the rules
  assert.ok(/60.70%/.test(P.getWorkout(5, 2).effort) && /85.95%/.test(P.getWorkout(5, 3).effort));
  // Block 3 sprints: 30m flat on odd weeks with Flying 20s, steep 20m hill on even weeks
  const flat = P.flatExs(P.getWorkout(9, 6)).map((e) => e.name), hill = P.flatExs(P.getWorkout(10, 6)).map((e) => e.name);
  assert.ok(flat.includes('Flying 20') && flat.includes('Flat sprint') && hill.includes('Hill sprint') && !hill.includes('Flying 20'));
  assert.ok(/30m/.test(P.flatExs(P.getWorkout(9, 6)).find((e) => e.name === 'Flat sprint').label));
});
test('Block 4 (assumed) is flagged and repeats Block 1', () => {
  const w = P.getWorkout(13, 1);
  assert.ok(w.assumed && !w.derived && w.belt === 'brown');
  assert.deepStrictEqual(P.flatExs(w).map((e) => e.name + e.sets + e.label), P.flatExs(P.getWorkout(1, 1)).map((e) => e.name + e.sets + e.label));
  assert.strictEqual(P.getWorkout(16, 1).deload, true);
});
test('Day 4 and Day 6 are broken into loggable items', () => {
  const d4 = P.flatExs(P.getWorkout(2, 4)).map((e) => e.name);
  ['McGill Curl-Up', 'McGill Side Plank', 'McGill Bird-Dog', 'Foam Rolling', '90/90 Hip Switches', 'Cossack Squats',
   'Couch Stretch', 'Pigeon Stretch', 'Parasympathetic Nasal Breathing'].forEach((n) => assert.ok(d4.includes(n), 'missing ' + n + ' in ' + d4));
  const side = P.flatExs(P.getWorkout(2, 4)).find((e) => e.name === 'McGill Side Plank');
  assert.deepStrictEqual([side.sets, side.target, side.mode, side.suffix], [3, 20, 'hold', '/side']);
  const d6 = P.flatExs(P.getWorkout(2, 6)).map((e) => e.name);
  assert.ok(d6.includes('Hill sprint') && d6.some((n) => /Bounding/.test(n)) && d6.some((n) => /Wall Drives/.test(n)));
  assert.strictEqual(P.flatExs(P.getWorkout(2, 6)).find((e) => e.name === 'Hill sprint').sets, 5);
  assert.strictEqual(P.flatExs(P.getWorkout(3, 6)).find((e) => e.name === 'Flat sprint').sets, 6);
});
test('summaries and exercise index', () => {
  const lines = P.summarize(P.getWorkout(1, 1), { oneRM: (k) => ({ bench: 100, zercher: 120, clean: 80, rdl: 140 })[k], settings: { units: 'kg' } });
  assert.ok(lines.some((l) => /Bench Press: 3 x 10 reps at 71\.4% of 1RM \(about 72\.5 kg\)/.test(l)), lines.join('\n'));
  assert.ok(P.allExerciseNames().includes('Zercher Squat') && P.allExerciseNames().length > 25);
});

test('Bulgarian split squats and pull-ups are tracked lifts: spec reps kept, % of 1RM from reps and reps-in-reserve', () => {
  const find = (w, d, key) => P.flatExs(P.getWorkout(w, d)).find((e) => e.liftKey === key);
  [[1, 10], [2, 8], [3, 6]].forEach(([w, reps]) => {
    const b = find(w, 1, 'bss');
    assert.deepStrictEqual([b.target, b.suffix, b.mode, b.sets], [reps, '/leg', 'weightReps', 3]);
    near(b.pct, E.pctFor(reps, 2));
  });
  [[1, 10], [2, 8], [3, 6], [4, 5]].forEach(([w, reps]) => { assert.strictEqual(find(w, 1, 'pullup').target, reps, 'pull-ups W' + w); });
  assert.strictEqual(find(4, 1, 'bss').pct, 0.55); assert.strictEqual(find(4, 1, 'pullup').pct, 0.55);          // deload
  assert.ok(find(1, 5, 'pullup'), 'pull-ups are on day 5 too');
  // derived blocks keep their own rep tables (not the barbell-lift reps)
  assert.deepStrictEqual([5, 6, 7, 8].map((w) => find(w, 1, 'bss').target), [6, 5, 4, 5]);
  assert.deepStrictEqual([9, 10, 11, 12].map((w) => find(w, 1, 'bss').target), [3, 3, 2, 3]);
  assert.deepStrictEqual([5, 6, 7, 8].map((w) => find(w, 1, 'pullup').target), [6, 6, 5, 3]);
  assert.deepStrictEqual([9, 10, 11, 12].map((w) => find(w, 5, 'pullup').target), [5, 4, 3, 3]);
  assert.strictEqual(P.LIFT_BY_NAME['Pull-Ups'], 'pullup'); assert.deepStrictEqual(E.LIFT_KEYS, ['bench', 'zercher', 'clean', 'rdl', 'bss', 'pullup']);
  // Pallof press stays an untracked accessory
  assert.strictEqual(P.flatExs(P.getWorkout(1, 5)).find((e) => /Pallof/.test(e.name)).liftKey, null);
});
test('working weight: external lifts = % x 1RM; pull-ups = % x total load minus bodyweight (never below bodyweight)', () => {
  const s = { units: 'kg', increment: null, bodyKg: 80 }, p = E.pctFor(10, 2);
  assert.strictEqual(E.workingKg('bss', 40, p, s), 27.5);            // 28.57 -> nearest 2.5
  assert.strictEqual(E.workingKg('pullup', 120, p, s), 5);           // 85.7 total - 80 bodyweight = 5.7 -> 5
  assert.strictEqual(E.workingKg('pullup', 100, p, s), 0);           // 71 kg < bodyweight: bodyweight is already enough
  assert.strictEqual(E.workingKg('pullup', 120, p, { units: 'kg' }), null, 'no bodyweight yet');
  assert.strictEqual(E.workingKg('bss', null, p, s), null);
  near(E.pctOfRM('pullup', 10, 120, 80), 90 / 120); near(E.pctOfRM('pullup', 0, 120, 80), 80 / 120); near(E.pctOfRM('bss', 30, 40), 0.75);
  assert.strictEqual(E.pctOfRM('pullup', 10, 120, 0), null);
  const lb = { units: 'lb', increment: null, bodyKg: 80 };
  assert.strictEqual(E.fmtW(E.workingKg('pullup', 120, p, lb), 'lb'), '15');       // 12.6 lb added -> 15 lb step
  assert.strictEqual(P.summarize(P.getWorkout(1, 1), { oneRM: (k) => ({ bss: 40, pullup: 120 }[k] || null), settings: s }).filter((l) => /Pull-Ups|Bulgarian/.test(l)).join('|'),
    'Bulgarian Split Squat: 3 x 10 reps/leg at 71.4% of 1RM (about 27.5 kg)|  - Pull-Ups: 3 x 10 reps at 71.4% of 1RM (about +5 kg added to bodyweight)');
});

console.log('Session');
const mkState = () => ({ settings: { units: 'kg', increment: null }, baselines: {}, logs: [], overrides: {} });
test('weights prefill from the 1RM and the recalibration is closed-loop', () => {
  const st = mkState();
  st.baselines.bench = { kg: 100, at: '2026-11-01' };
  const ses = S.build(P.getWorkout(1, 1), st, '2026-11-02');
  const bench = S.allExs(ses).find((e) => e.liftKey === 'bench');
  assert.strictEqual(bench.sets.length, 3); assert.strictEqual(bench.sets[0].w, 72.5);   // 100 x 71.4% -> 71.4 -> 72.5
  // do exactly what was prescribed, log it, and the 1RM estimate stays where it was (no drift)
  bench.sets.forEach((s) => { s.done = true; });
  const log = S.toLog(ses, Date.now() + 3600e3);
  st.logs.push(log);
  const rm = E.oneRMFor(st, 'bench', '2026-11-03');
  assert.strictEqual(rm.src, 'logged'); near(rm.kg, 72.5 * (1 + 12 / 30), 1e-9); assert.ok(Math.abs(rm.kg - 100) < 2, 'drift ' + rm.kg);
  // next week (8 reps) targets the right weight from the recalibrated 1RM
  const ses2 = S.build(P.getWorkout(2, 1), st, '2026-11-09');
  const b2 = S.allExs(ses2).find((e) => e.liftKey === 'bench');
  assert.ok(Math.abs(b2.sets[0].w - 0.75 * rm.kg) <= 1.25, `${b2.sets[0].w} vs ${0.75 * rm.kg}`);
});
test('beating the target raises next weeks weights; a new baseline overrides old logs', () => {
  const st = mkState();
  st.logs.push({ date: '2026-11-02', deload: false, entries: [{ name: 'Bench Press', liftKey: 'bench', rir: 2, sets: [{ w: 80, r: 10 }] }] });
  const before = E.oneRMFor(st, 'bench', '2026-11-03').kg;
  st.logs.push({ date: '2026-11-09', deload: false, entries: [{ name: 'Bench Press', liftKey: 'bench', rir: 2, sets: [{ w: 80, r: 12 }] }] });
  assert.ok(E.oneRMFor(st, 'bench', '2026-11-10').kg > before);
  st.baselines.bench = { kg: 90, at: '2026-11-12' };
  assert.deepStrictEqual([E.oneRMFor(st, 'bench', '2026-11-12').kg, E.oneRMFor(st, 'bench', '2026-11-12').src], [90, 'baseline']);
});
test('same-day ordering: a workout logged after you typed a 1RM takes over; a 1RM typed after the workout wins', () => {
  const st = mkState();
  const log = { date: '2026-11-02', startedAt: 2000, finishedAt: 3000, deload: false, entries: [{ name: 'Bench Press', liftKey: 'bench', rir: 2, sets: [{ w: 80, r: 10 }] }] };
  st.logs.push(log);
  st.baselines.bench = { kg: 100, at: '2026-11-02', ts: 1000 };                       // typed first, trained later
  assert.strictEqual(E.oneRMFor(st, 'bench', '2026-11-02').src, 'logged');
  near(E.oneRMFor(st, 'bench', '2026-11-02').kg, 80 * (1 + 12 / 30));
  st.baselines.bench = { kg: 100, at: '2026-11-02', ts: 4000 };                       // tested after the workout
  assert.deepStrictEqual([E.oneRMFor(st, 'bench', '2026-11-02').src, E.oneRMFor(st, 'bench', '2026-11-02').kg], ['baseline', 100]);
  st.baselines.bench = { kg: 100, at: '2026-11-02' };                                 // older saved data without a time: same day counts as earlier
  assert.strictEqual(E.oneRMFor(st, 'bench', '2026-11-02').src, 'logged');
  st.baselines.bench = { kg: 100, at: '2026-11-03' };
  assert.strictEqual(E.oneRMFor(st, 'bench', '2026-11-03').src, 'baseline');
});
test('deload sessions never lower the 1RM; reps above 12 are ignored', () => {
  const st = mkState();
  st.logs.push({ date: '2026-11-02', deload: false, entries: [{ name: 'Zercher Squat', liftKey: 'zercher', rir: 2, sets: [{ w: 100, r: 8 }, { w: 60, r: 15 }] }] });
  const base = E.oneRMFor(st, 'zercher', '2026-11-03').kg;
  st.logs.push({ date: '2026-11-23', deload: true, entries: [{ name: 'Zercher Squat', liftKey: 'zercher', rir: 2, sets: [{ w: 50, r: 5 }] }] });
  near(E.oneRMFor(st, 'zercher', '2026-11-24').kg, base);
  near(base, 100 * (1 + 10 / 30), 1e-9);
});
test('untracked weighted accessories (Pallof press) repeat last weight and step up after a clean session', () => {
  const st = mkState();
  const name = 'Pallof Press (or DB Drag Plank)';
  st.logs.push({ date: '2026-11-02', entries: [{ name, mode: 'weightReps', sets: [{ w: 10, r: 10 }, { w: 10, r: 10 }, { w: 10, r: 10 }] }] });
  const pal = (ses) => S.allExs(ses).find((e) => /Pallof/.test(e.name));
  assert.strictEqual(pal(S.build(P.getWorkout(1, 5), st, '2026-11-09')).sets[0].w, 12.5);   // hit 3x10 -> +2.5
  st.logs[0].entries[0].sets[2].r = 8;
  assert.strictEqual(pal(S.build(P.getWorkout(1, 5), st, '2026-11-09')).sets[0].w, 10);
});
test('split squat and pull-up sessions pre-fill from their 1RMs, show bodyweight work as an empty field, and close the loop', () => {
  const st = mkState(); st.settings.bodyKg = 80;
  st.baselines.bss = { kg: 40, at: '2026-11-01', ts: 1 }; st.baselines.pullup = { kg: 120, at: '2026-11-01', ts: 1 };
  const get = (ses, k) => S.allExs(ses).find((e) => e.liftKey === k);
  const ses = S.build(P.getWorkout(1, 1), st, '2026-11-02');
  assert.deepStrictEqual(get(ses, 'bss').sets.map((x) => x.w), [27.5, 27.5, 27.5]);
  assert.deepStrictEqual(get(ses, 'pullup').sets.map((x) => x.w), [5, 5, 5]);
  assert.deepStrictEqual([get(ses, 'bss').oneRM, get(ses, 'pullup').oneRM, get(ses, 'pullup').bodyKg], [40, 120, 80]);
  // do exactly what was planned: the estimates barely move (rounding only)
  S.allExs(ses).forEach((e) => e.sets.forEach((x) => { x.done = true; }));
  st.logs.push(S.toLog(ses, Date.now() + 3600e3));
  assert.strictEqual(st.logs[0].entries.find((e) => e.liftKey === 'pullup').bodyKg, 80, 'bodyweight is saved with the pull-up entry');
  near(E.oneRMFor(st, 'bss', '2026-11-03').kg, 27.5 * (1 + 12 / 30), 1e-9);
  near(E.oneRMFor(st, 'pullup', '2026-11-03').kg, 85 * (1 + 12 / 30), 1e-9);
  assert.ok(Math.abs(E.oneRMFor(st, 'pullup', '2026-11-03').kg - 120) < 2 && Math.abs(E.oneRMFor(st, 'bss', '2026-11-03').kg - 40) < 2);
  // bodyweight changes later: the logged entry keeps the bodyweight it was done at
  st.settings.bodyKg = 95;
  near(E.oneRMFor(st, 'pullup', '2026-11-03').kg, 85 * 1.4, 1e-9);
  // a pull-up plan that is below bodyweight leaves the field empty (placeholder says BW)
  const st2 = mkState(); st2.settings.bodyKg = 80; st2.baselines.pullup = { kg: 100, at: '2026-11-01', ts: 1 };
  assert.deepStrictEqual(get(S.build(P.getWorkout(1, 1), st2, '2026-11-02'), 'pullup').sets.map((x) => x.w), [null, null, null]);
  assert.strictEqual(get(S.build(P.getWorkout(1, 1), st2, '2026-11-02'), 'pullup').targetKg, 0);
});
test('pull-up estimates: bodyweight-only sets count, entries without a bodyweight are ignored, no bodyweight falls back to last time', () => {
  const st = mkState();
  st.logs.push({ date: '2026-11-02', entries: [{ name: 'Pull-Ups', liftKey: 'pullup', rir: 2, bodyKg: 80, sets: [{ w: null, r: 10 }] }] });
  near(E.oneRMFor(st, 'pullup', '2026-11-03').kg, 80 * 1.4, 1e-9);                     // 10 reps at bodyweight -> 112 total
  const st2 = mkState();
  st2.logs.push({ date: '2026-11-02', entries: [{ name: 'Pull-Ups', liftKey: 'pullup', rir: 2, sets: [{ w: 5, r: 10 }, { w: 5, r: 10 }, { w: 5, r: 10 }] }] });
  assert.strictEqual(E.oneRMFor(st2, 'pullup', '2026-11-03'), null, 'without a bodyweight the total load is unknown');
  const pu = S.allExs(S.build(P.getWorkout(1, 1), st2, '2026-11-09')).find((e) => e.liftKey === 'pullup');
  assert.deepStrictEqual(pu.sets.map((x) => x.w), [7.5, 7.5, 7.5]);                     // last time +1 step, all sets hit 10
  // a set above 12 reps does not move the estimate
  st.logs.push({ date: '2026-11-04', entries: [{ name: 'Pull-Ups', liftKey: 'pullup', rir: 2, bodyKg: 80, sets: [{ w: 30, r: 15 }] }] });
  near(E.oneRMFor(st, 'pullup', '2026-11-05').kg, 80 * 1.4, 1e-9);
});
test('bodyweight setting and "+added" 1RM entry', () => {
  const A = HA.actions, st = { settings: { units: 'kg', bodyKg: null }, baselines: {} };
  assert.strictEqual(A.setBaseline(st, 'pullup', '+30', '2026-11-01'), false, 'needs a bodyweight first');
  assert.strictEqual(A.setSetting(st, 'bodyKg', '80,5'), true); assert.strictEqual(st.settings.bodyKg, 80.5);
  assert.strictEqual(A.setSetting(st, 'bodyKg', '5'), false); assert.strictEqual(A.setSetting(st, 'bodyKg', 'abc'), false);
  assert.strictEqual(st.settings.bodyKg, 80.5, 'rejected values change nothing');
  assert.strictEqual(A.setBaseline(st, 'pullup', '+30', '2026-11-01'), true); near(st.baselines.pullup.kg, 110.5);
  assert.strictEqual(A.setBaseline(st, 'pullup', '112', '2026-11-01'), true); assert.strictEqual(st.baselines.pullup.kg, 112);
  assert.strictEqual(A.setBaseline(st, 'bss', '+30', '2026-11-01'), false, '+ is only for pull-ups');
  st.settings.units = 'lb'; assert.strictEqual(A.setSetting(st, 'bodyKg', '176'), true); near(st.settings.bodyKg, 176 * 0.45359237, 0.01);
  assert.strictEqual(A.setSetting(st, 'bodyKg', ''), true); assert.strictEqual(st.settings.bodyKg, null);
});
test('"Previous" benchmark text', () => {
  const st = mkState();
  st.logs.push({ date: '2026-11-02', entries: [{ name: 'Pull-Ups', mode: 'weightReps', sets: [{ w: null, r: 9 }] }, { name: 'Pause Split Squat Hold', mode: 'hold', sets: [{ w: null, r: 25 }] }] });
  const p = E.prevSets(st, 'pull-ups');
  assert.strictEqual(E.prevText(p.sets[0], { mode: 'weightReps' }, 'kg'), 'BW×9');
  assert.strictEqual(E.prevText(E.prevSets(st, 'Pause Split Squat Hold').sets[0], { mode: 'hold' }, 'kg'), '25s');
  assert.strictEqual(E.prevSets(st, 'Nope'), null);
});
test('superset flow: 30 s between exercises, full rest at round end, group rest after the last round', () => {
  const st = mkState();
  const ses = S.build(P.getWorkout(1, 1), st, '2026-11-02');
  const gi = ses.items.findIndex((i) => i.kind === 'group');
  const plan = (ex, set) => S.restPlan(ses, gi, ex, set);
  assert.deepStrictEqual([plan(0, 0).sec, plan(0, 0).quick, /Bench Press, round 1/.test(plan(0, 0).next)], [30, true, true]);
  assert.strictEqual(plan(1, 0).sec, 30);
  assert.deepStrictEqual([plan(2, 0).sec, /Plyo Push-Up.*round 2/.test(plan(2, 0).next)], [90, true]);
  assert.strictEqual(plan(2, 2).sec, 120);                  // restAfterSuperset
  assert.ok(/Pull-Ups/.test(plan(2, 2).next));
  // last superset of the workout: nothing after the final set
  const gl = ses.items.length - 1;
  assert.strictEqual(S.restPlan(ses, gl, 1, 2), null);
  assert.strictEqual(S.restPlan(ses, gl, 1, 0).sec, 90);
  // straight sets: between-set rest, then rest-after into the next exercise
  const pi = ses.items.findIndex((i) => i.kind === 'ex' && i.ex.liftKey === 'clean');
  assert.strictEqual(S.restPlan(ses, pi, 0, 0).sec, 150);   // 2-3 mins
  assert.ok(/Bulgarian/.test(S.restPlan(ses, pi, 0, 3).next));
});
test('add/remove sets and rounds never destroy completed sets', () => {
  const ses = S.build(P.getWorkout(1, 1), mkState(), '2026-11-02');
  const clean = S.allExs(ses).find((e) => e.liftKey === 'clean');
  S.addSet(clean); assert.strictEqual(clean.sets.length, 5);
  clean.sets[4].done = true;                                  // the added set is done, so removal must skip it
  assert.ok(S.removeSet(clean)); assert.strictEqual(clean.sets.length, 4); assert.strictEqual(clean.sets[3].done, true);
  const g = ses.items.find((i) => i.kind === 'group');
  S.addRound(g); assert.ok(g.exs.every((e) => e.sets.length === 4));
  g.exs[0].sets.forEach((s) => { s.done = true; });
  S.removeRound(g); assert.strictEqual(g.exs[0].sets.length, 4);   // first exercise is fully done, the rest lose a set
  assert.strictEqual(g.exs[1].sets.length, 3);
});
test('Ducky modifications apply to open sets only', () => {
  const st = mkState(); st.baselines.zercher = { kg: 120, at: '2026-11-01' };
  const ses = S.build(P.getWorkout(1, 5), st, '2026-11-06');
  const z = S.allExs(ses).find((e) => e.liftKey === 'zercher');
  const w0 = z.sets[0].w; z.sets[0].done = true;
  const mods = E.sanitizeMods({ modifications: [
    { exercise: 'zercher squat', sets: 2, reps: 6, weightFactor: 0.8, note: 'Back is tight' },
    { exercise: 'Nordic Hamstring Curls', skip: true },
    { exercise: 'Pull-Ups', sets: 99 }, { exercise: 'Not in the program', sets: 1 }, { nope: 1 }
  ] });
  assert.strictEqual(mods.length, 4); assert.strictEqual(mods[2].sets, 8);
  const changed = S.applyMods(ses, mods, st.settings);
  assert.deepStrictEqual(changed.sort(), ['Nordic Hamstring Curls (Eccentric Focus)', 'Pull-Ups', 'Zercher Squat'].sort());
  assert.strictEqual(z.sets.length, 2); assert.strictEqual(z.sets[0].w, w0, 'done set untouched');
  assert.ok(z.sets[1].w < w0 && z.sets[1].r === 6 && z.modified && z.note === 'Back is tight');
  assert.ok(S.allExs(ses).find((e) => /Nordic/.test(e.name)).skipped);
  assert.strictEqual(S.allExs(ses).find((e) => e.name === 'Pull-Ups').sets.length, 8);
  // stored overrides are picked up when a session is built
  st.overrides['2026-11-06:w1d5'] = E.sanitizeMods([{ exercise: 'Romanian Deadlift', sets: 1 }]);
  assert.strictEqual(S.allExs(S.build(P.getWorkout(1, 5), st, '2026-11-06')).find((e) => e.liftKey === 'rdl').sets.length, 1);
});
test('progress, next pending and the saved log', () => {
  const ses = S.build(P.getWorkout(1, 1), mkState(), '2026-11-02');
  const total = S.progress(ses).total;
  assert.deepStrictEqual(S.nextPending(ses), { it: 0, ex: 0, set: 0 });
  assert.strictEqual(S.toLog(ses), null, 'an empty session saves nothing');
  const clean = S.allExs(ses).find((e) => e.liftKey === 'clean');
  clean.sets[0].done = true; clean.sets[0].w = 60; clean.sets[0].r = 5;
  assert.strictEqual(S.progress(ses).done, 1); assert.strictEqual(S.progress(ses).total, total);
  const log = S.toLog(ses, ses.startedAt + 90 * 60e3);
  assert.strictEqual(log.entries.length, 1); assert.strictEqual(log.volumeKg, 300); assert.strictEqual(log.durationSec, 5400);
  assert.deepStrictEqual(log.entries[0].sets, [{ w: 60, r: 5 }]);
  assert.strictEqual(log.entries[0].rir, 4);               // power cleans stop 2 reps further from failure
});

test('"up next" follows the set you last ticked: jumping ahead does not send you back, finished tails wrap round', () => {
  const ses = S.build(P.getWorkout(1, 1), mkState(), '2026-11-02');
  const seq = S.order(ses), idx = (name, set) => seq.findIndex((p) => { const it = ses.items[p.it]; const ex = it.kind === 'ex' ? it.ex : it.exs[p.ex]; return ex.name === name && p.set === set; });
  const tick = (i) => { const p = seq[i]; p.st.done = true; ses.cur = { it: p.it, ex: p.ex, set: p.set }; };
  assert.deepStrictEqual(S.nextPending(ses), { it: seq[0].it, ex: 0, set: 0 }, 'fresh workout starts at the top');
  const pc0 = idx('Power Clean or High Pull', 0); tick(pc0);                      // jump ahead to the clean
  assert.deepStrictEqual(S.nextPending(ses), { it: seq[pc0 + 1].it, ex: seq[pc0 + 1].ex, set: 1 }, 'next is clean set 2, not the skipped warm-up');
  // finish everything after the cursor: wraps to the first unfinished set at the top
  for (let i = pc0 + 1; i < seq.length; i++) tick(i);
  assert.deepStrictEqual(S.nextPending(ses), { it: seq[0].it, ex: 0, set: 0 }, 'wraps round to what was skipped');
  for (let i = 0; i < seq.length; i++) tick(i);
  assert.strictEqual(S.nextPending(ses), null, 'all done');
  // supersets go round by round: A1 B1 C1 A2 ...
  const g = ses.items.find((i) => i.kind === 'group'), gi = ses.items.indexOf(g);
  const inGroup = S.order(ses).filter((p) => p.it === gi).slice(0, 4).map((p) => [p.ex, p.set]);
  assert.deepStrictEqual(inGroup, [[0, 0], [1, 0], [2, 0], [0, 1]]);
});
test('skipped exercises are left out of the order and a removed set shifts nothing else', () => {
  const ses = S.build(P.getWorkout(1, 1), mkState(), '2026-11-02');
  const before = S.order(ses).length, ex = S.allExs(ses).find((e) => /Pogo/.test(e.name));
  ex.skipped = true; assert.strictEqual(S.order(ses).length, before - 3);
  ex.skipped = false; S.removeSet(ex); assert.strictEqual(S.order(ses).length, before - 1);
});

console.log('Calendar');
test('.ics has every day, valid folding, CRLF, escaping and stable UIDs', () => {
  const settings = { age: 30, rhr: 55, hrMethod: 'karvonen' };
  const times = { am: '07:00', amDur: 45, pm: '17:30', pmDur: 90, recovery: '18:00', recDur: 60, sprint: '10:00', sprDur: 75, bjjStart: '19:00', bjjEnd: '21:00' };
  const mk = (rest) => E.calendarEvents({ startISO: '2026-11-02', times, getWorkout: P.getWorkout, summarize: P.summarize, zoneText: E.zone2Text(settings), includeRest: rest });
  const ev = mk(true);
  assert.strictEqual(ev.length, 144); assert.strictEqual(mk(false).length, 128);
  assert.strictEqual(new Set(ev.map((e) => e.uid)).size, 144, 'unique UIDs');
  const first = ev[0]; assert.deepStrictEqual([first.title, first.date, first.start], ['W1 D1 – AM Zone 2 Run', '2026-11-02', '07:00']);
  assert.ok(/Zone 2 target 136.150 bpm/.test(first.desc));
  assert.ok(ev.find((e) => e.title === 'W1 D2 – BJJ Gi' && e.mins === 120 && e.date === '2026-11-03'));
  assert.ok(ev.find((e) => e.title === 'W1 D3 – BJJ No-Gi'));
  assert.ok(ev.find((e) => e.title === 'W16 D7 – Rest' && e.allDay && e.date === '2027-02-21'));
  const ics = E.icsFromEvents(ev, { now: new Date(Date.UTC(2026, 9, 28, 20, 0, 0)), tz: 'Europe/Riga' });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'CRLF only');
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 144);
  assert.strictEqual((ics.match(/END:VEVENT/g) || []).length, 144);
  assert.ok(ics.includes('DTSTART:20261102T070000') && ics.includes('DTEND:20261102T074500') && ics.includes('DTSTART;VALUE=DATE:20270221'));
  assert.ok(ics.includes('DTSTAMP:20261028T200000Z') && ics.includes('X-WR-TIMEZONE:Europe/Riga'));
  ics.split('\r\n').forEach((l) => assert.ok(Buffer.byteLength(l) <= 75, 'line too long: ' + l.length));
  assert.strictEqual(E.icsEscape('a,b;c\nd\\e'), 'a\\,b\\;c\\nd\\\\e');
  // unfolding restores the original content
  const long = 'SUMMARY:' + 'x'.repeat(200) + 'éé€';
  assert.strictEqual(E.fold(long).replace(/\r\n /g, ''), long);
  E.fold(long).split('\r\n').forEach((l) => assert.ok(Buffer.byteLength(l) <= 75));
});
test('each .ics export carries a rising revision number so a re-import supersedes the old copy', () => {
  const events = [{ uid: 'ha-w01d1-am', title: 'x', date: '2026-11-02', start: '07:00', mins: 45, desc: '' }];
  const a = E.icsFromEvents(events, { now: new Date('2026-11-01T10:00:00Z') }), b = E.icsFromEvents(events, { now: new Date('2026-11-01T10:05:00Z') });
  const seq = (t) => +/SEQUENCE:(\d+)/.exec(t)[1];
  assert.strictEqual(seq(b) - seq(a), 5); assert.ok(/LAST-MODIFIED:20261101T100000Z/.test(a));
  assert.ok(seq(a) < 2 ** 31, 'fits a signed 32-bit integer');
});
test('google calendar one-tap link', () => {
  const link = E.googleLink({ title: 'W1 D1 – AM Zone 2 Run', date: '2026-11-02', start: '07:00', mins: 45, desc: 'Easy, steady' });
  assert.ok(link.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&text=') && link.includes('dates=20261102T070000/20261102T074500') && link.includes('Easy%2C%20steady'));
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
