/* Zone 2 maths — run with:  node zone2.test.js   (no dependencies) */
'use strict';
const assert = require('assert');
require('./spec.js'); require('./engine.js'); require('./zone2.js');
const HA = globalThis.HA, E = HA.engine, Z = HA.zone2;
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 4).join('\n       ')); } }
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps == null ? 1e-6 : eps), a + ' !~ ' + b);
const dv = (...b) => new DataView(new Uint8Array(b).buffer);
const st = (o) => ({ settings: Object.assign({ age: 30, rhr: 50, mhr: 190, hrMethod: 'karvonen', zoneLo: 60, zoneHi: 70 }, o || {}), runs: [] });

console.log('Karvonen and zones');
test('Karvonen: target = (max - rest) x intensity + rest', () => {
  assert.strictEqual(Z.karvonen(190, 50, 0.6), 134);      // 140 x .6 + 50
  assert.strictEqual(Z.karvonen(190, 50, 0.7), 148);
  assert.strictEqual(Z.karvonen(185, 60, 0.65), 141);     // 125 x .65 + 60 = 141.25
  const z = E.zone2(st().settings); assert.deepStrictEqual([z.lo, z.hi], [134, 148], 'the app uses the same formula');
});
test('zoneOf: blue below, green inside (edges included), red above', () => {
  const z = { lo: 134, hi: 148 };
  assert.deepStrictEqual([120, 133, 134, 141, 148, 149, 175].map((b) => Z.zoneOf(b, z)), ['low', 'low', 'in', 'in', 'in', 'high', 'high']);
  assert.strictEqual(Z.zoneOf(0, z), null); assert.strictEqual(Z.zoneOf(140, null), null);
});

console.log('Cues');
test('a cue needs the reading to stay out of zone for the grace period, then repeats', () => {
  const w = Z.makeWatcher({ graceSec: 10, repeatSec: 30, warmupSec: 0 }), z = { lo: 134, hi: 148 }; w.begin(0);
  const out = []; for (let s = 0; s <= 100; s += 5) { const c = w.feed(160, s * 1000, z); if (c) out.push([s, c.type]); }
  assert.deepStrictEqual(out, [[10, 'high'], [40, 'high'], [70, 'high'], [100, 'high']]);
});
test('a brief spike gives no cue, and coming back after a cue gives exactly one "back"', () => {
  const w = Z.makeWatcher({ graceSec: 10, warmupSec: 0 }), z = { lo: 134, hi: 148 }; w.begin(0);
  assert.strictEqual(w.feed(150, 1000, z), null); assert.strictEqual(w.feed(140, 6000, z), null, 'spike of 5 s: silent');
  assert.strictEqual(w.feed(150, 7000, z), null); assert.strictEqual(w.feed(150, 17000, z).type, 'high');
  assert.strictEqual(w.feed(140, 18000, z).type, 'back'); assert.strictEqual(w.feed(140, 19000, z), null);
});
test('too-low is silent during warm-up but too-high is not', () => {
  const w = Z.makeWatcher({ graceSec: 10, warmupSec: 180 }), z = { lo: 134, hi: 148 }; w.begin(0);
  let lows = 0; for (let s = 0; s < 170; s += 5) if (w.feed(100, s * 1000, z)) lows++;
  assert.strictEqual(lows, 0);
  assert.strictEqual(w.feed(100, 181000, z), null, 'the clock for "too low" starts counting');
  assert.strictEqual(w.feed(100, 192000, z).type, 'low');
  const h = Z.makeWatcher({ graceSec: 10, warmupSec: 180 }); h.begin(0); h.feed(170, 1000, z); assert.strictEqual(h.feed(170, 12000, z).type, 'high');
});
test('recorder: time-weighted average and seconds per zone; gaps in the signal are capped', () => {
  const r = Z.makeRecorder(), z = { lo: 134, hi: 148 };
  [[100, 0], [140, 10], [140, 20], [160, 30], [160, 100]].forEach(([b, t]) => r.feed(b, t * 1000, z));
  const s = r.stats();
  assert.deepStrictEqual([s.inSec, s.highSec, s.lowSec], [20, 20, 0], 'the 70 s gap counts as 10 s');
  assert.strictEqual(s.maxHr, 160); assert.strictEqual(s.avgHr, 150);     // (140x10 + 140x10 + 160x10 + 160x10) / 40
});

console.log('Duration and pace');
test('parseDuration: m:ss, h:mm:ss, bare minutes, and bad input', () => {
  assert.strictEqual(Z.parseDuration('42:30'), 2550); assert.strictEqual(Z.parseDuration('1:02:15'), 3735);
  assert.strictEqual(Z.parseDuration('45'), 2700); assert.strictEqual(Z.parseDuration('45,5'), 2730);
  ['', 'abc', '12:75', '1:75:00', '0'].forEach((x) => assert.strictEqual(Z.parseDuration(x), null, x));
  assert.strictEqual(Z.fmtDuration(2550), '42:30'); assert.strictEqual(Z.fmtDuration(3735), '1:02:15');
});
test('fmtPace in min/km and min/mi', () => {
  assert.strictEqual(Z.fmtPace(360, 'km'), '6:00'); assert.strictEqual(Z.fmtPace(365.4, 'km'), '6:05');
  assert.strictEqual(Z.fmtPace(300, 'mi'), '8:03');                        // 300 x 1.609344 = 482.8 s
  assert.strictEqual(Z.paceText({ fast: 330, slow: 390 }, 'km'), '5:30–6:30 /km');
  near(Z.toKm(10, 'mi'), 16.09344); near(Z.fromKm(16.09344, 'mi'), 10);
});
test('VDOT matches the Daniels tables (5 km in 20:00 is about 49.8, 25:00 about 38.3)', () => {
  near(Z.vdot(5, 1200), 49.8, 0.2); near(Z.vdot(5, 1500), 38.3, 0.2);
});
test('race-based Zone 2 pace for a 25:00 5 km is about 6:07 to 6:48 per km at 60-70%', () => {
  const r = Z.paceRange(Object.assign(st(), { settings: st({ race: { km: 5, sec: 1500 } }).settings }), '2026-11-10');
  assert.ok(r.ok && r.src === 'race'); near(r.slow, 408, 6); near(r.fast, 367, 6);
  assert.ok(r.fast < r.slow, 'a higher heart rate means a faster pace');
});
test('run-based pace: pace scales with heart-rate reserve (median of recent steady runs)', () => {
  const S = st(); S.runs = [{ date: '2026-11-05', km: 6, sec: 2160, hr: 150 }];      // 6:00/km at 100/140 = 71.4% of reserve
  const r = Z.paceRange(S, '2026-11-10'); assert.ok(r.ok && r.src === 'runs' && r.n === 1);
  near(r.slow, 360 * (100 / 140) / 0.6, 0.01); near(r.fast, 360 * (100 / 140) / 0.7, 0.01);
  assert.strictEqual(Z.fmtPace(r.slow, 'km'), '7:09');   // 428.6 s assert.strictEqual(Z.fmtPace(r.fast, 'km'), '6:07');
  // running at the bottom of the zone gives that pace as the slow end
  S.runs = [{ date: '2026-11-05', km: 5, sec: 1800, hr: 134 }]; near(Z.paceRange(S, '2026-11-10').slow, 360, 0.01);
});
test('runs win over a race, old / short / too-hard runs are ignored, and the median resists one odd run', () => {
  const S = st({ race: { km: 5, sec: 1500 } });
  S.runs = [{ date: '2026-08-01', km: 8, sec: 3000, hr: 140 }];                          // 3 months old
  assert.strictEqual(Z.paceRange(S, '2026-11-10').src, 'race');
  S.runs = [{ date: '2026-11-08', km: 1, sec: 400, hr: 140 }, { date: '2026-11-08', km: 8, sec: 3000, hr: 185 }, { date: '2026-11-08', km: 8, sec: 3000, hr: 95 }];
  assert.strictEqual(Z.paceRange(S, '2026-11-10').src, 'race', 'short, all-out and walking-pace runs do not count');
  S.runs = [360, 365, 600].map((p, i) => ({ date: '2026-11-0' + (i + 1), km: 6, sec: p * 6, hr: 140 }));
  const r = Z.paceRange(S, '2026-11-10'); assert.strictEqual(r.n, 3);
  near(r.slow, 365 * (90 / 140) / 0.6, 0.01);                                            // the 600 s/km run does not drag the median
});
test('no pace without heart-rate settings or without a reference', () => {
  assert.deepStrictEqual(Z.paceRange({ settings: { zoneLo: 60, zoneHi: 70 }, runs: [] }, '2026-11-10'), { ok: false, why: 'hr' });
  assert.deepStrictEqual(Z.paceRange(st(), '2026-11-10'), { ok: false, why: 'ref' });
  const noRest = Z.paceRange(Object.assign(st({ rhr: null, race: { km: 5, sec: 1500 } })), '2026-11-10'); assert.ok(noRest.ok && noRest.assumedRest, 'resting HR is assumed to be 60 and flagged');
});

console.log('Bluetooth heart rate packet');
test('parseHRM: 8-bit and 16-bit values, sensor contact, RR intervals, energy field', () => {
  assert.deepStrictEqual(Z.parseHRM(dv(0x00, 72)), { bpm: 72, contact: null, rr: [] });
  assert.strictEqual(Z.parseHRM(dv(0x01, 0xb4, 0x00)).bpm, 180); assert.strictEqual(Z.parseHRM(dv(0x01, 0x2c, 0x01)).bpm, 300);
  assert.strictEqual(Z.parseHRM(dv(0x06, 70)).contact, true); assert.strictEqual(Z.parseHRM(dv(0x04, 70)).contact, false);
  assert.deepStrictEqual(Z.parseHRM(dv(0x10, 70, 0x00, 0x04, 0x00, 0x02)).rr, [1000, 500]);
  assert.deepStrictEqual(Z.parseHRM(dv(0x18, 70, 0x10, 0x00, 0x00, 0x04)), { bpm: 70, contact: null, rr: [1000] }, 'energy bytes are skipped');
  assert.strictEqual(Z.parseHRM(dv(0x00)), null); assert.strictEqual(Z.parseHRM(dv(0x01, 0x50)), null);
});

console.log('Garmin files');
const tcx = (rows) => '<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Lap><Track>' +
  rows.map(([t, d, h]) => '<Trackpoint><Time>' + t + '</Time><DistanceMeters>' + d + '</DistanceMeters><HeartRateBpm><Value>' + h + '</Value></HeartRateBpm></Trackpoint>').join('') + '</Track></Lap></Activity></Activities></TrainingCenterDatabase>';
test('TCX: distance, moving time, average heart rate and time in zone', () => {
  const rows = []; for (let i = 0; i <= 60; i++) rows.push(['2026-11-03T06:' + String(Math.floor(i / 6)).padStart(2, '0') + ':' + String(i % 6 * 10).padStart(2, '0') + 'Z', i * 28, i < 30 ? 140 : 160]);
  const s = Z.parseRunFile(tcx(rows), { lo: 134, hi: 148 });
  assert.strictEqual(s.km, 1.68); assert.strictEqual(s.sec, 600); assert.strictEqual(s.maxHr, 160);
  assert.ok(Math.abs(s.avgHr - 150) <= 1, 'avg ' + s.avgHr); assert.strictEqual(s.inSec + s.highSec, 600);
  assert.ok(s.inSec >= 290 && s.inSec <= 300, 'in-zone ' + s.inSec);
});
test('TCX: a long pause is not counted as running time', () => {
  const s = Z.parseRunFile(tcx([['2026-11-03T06:00:00Z', 0, 140], ['2026-11-03T06:00:10Z', 30, 140], ['2026-11-03T06:30:00Z', 30, 100], ['2026-11-03T06:30:10Z', 60, 140]]), null);
  assert.strictEqual(s.sec, 20); assert.strictEqual(s.km, 0.06);
});
test('GPX: distance from coordinates, heart rate from the extension, any namespace prefix', () => {
  const pt = (i, ns) => '<trkpt lat="' + (56.95 + i * 0.0009).toFixed(5) + '" lon="24.10000"><time>2026-11-03T06:00:' + String(i * 10).padStart(2, '0') + 'Z</time><extensions><' + ns + ':TrackPointExtension><' + ns + ':hr>' + (140 + i) + '</' + ns + ':hr></' + ns + ':TrackPointExtension></extensions></trkpt>';
  [['gpxtpx'], ['ns3']].forEach(([ns]) => {
    const g = '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>' + [0, 1, 2, 3, 4, 5].map((i) => pt(i, ns)).join('') + '</trkseg></trk></gpx>';
    const s = Z.parseRunFile(g, { lo: 134, hi: 148 });
    assert.ok(Math.abs(s.km - 0.5) < 0.02, ns + ' km ' + s.km); assert.strictEqual(s.sec, 50); assert.strictEqual(s.maxHr, 145); assert.strictEqual(s.inSec, 50);
  });
});
test('other files (FIT, junk) are rejected rather than guessed at', () => {
  assert.strictEqual(Z.parseRunFile('.FIT\x00binary', null), null); assert.strictEqual(Z.parseRunFile('', null), null);
  assert.strictEqual(Z.parseRunFile('<gpx></gpx>', null), null, 'no points');
});

console.log(`\n${passed} passed${failed ? ', ' + failed + ' FAILED' : ''}`);
process.exit(failed ? 1 : 0);
