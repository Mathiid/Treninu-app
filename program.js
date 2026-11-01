/* program.js — turns the embedded 16-week spec into a concrete workout for every (week, day).
   Block 1 comes straight from the spec data. Blocks 2 and 3 only ship as rules in the spec, so they
   are generated from Block 1's exercises + those rules. Weeks 13-16 are not in the spec; they are an
   explicit, flagged assumption: Block 1's wave repeats at the (recalibrated, higher) baselines. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  var E = HA.engine, SPEC = HA.SPEC;
  var B1 = SPEC.blocks[0].schedule;

  var LIFT_BY_NAME = {
    'Power Clean or High Pull': 'clean', 'Zercher Squat': 'zercher',
    'Romanian Deadlift (RDL)': 'rdl', 'Bench Press': 'bench',
    'Bulgarian Split Squat': 'bss', 'Pull-Ups': 'pullup'          // weighted: tracked against an estimated 1RM
  };
  var LIFT_LABEL = { bench: 'Bench Press', zercher: 'Zercher Squat', clean: 'Power Clean', rdl: 'Romanian Deadlift',
                     bss: 'Bulgarian Split Squat', pullup: 'Pull-up' };
  var WEIGHTED = {
    'Power Clean or High Pull': 1, 'Zercher Squat': 1, 'Romanian Deadlift (RDL)': 1, 'Bench Press': 1,
    'Bulgarian Split Squat': 1, 'Pull-Ups': 1, 'Pallof Press (or DB Drag Plank)': 1
  };
  var DAY_META = {
    1: { kind: 'strength', short: 'Power & Base Leg Day + Upper' },
    2: { kind: 'bjj', short: 'BJJ Gi' },
    3: { kind: 'bjj', short: 'BJJ No-Gi' },
    4: { kind: 'recovery', short: 'Recovery, Mobility & Core' },
    5: { kind: 'strength', short: 'Strength-Endurance & Posterior Chain + Upper' },
    6: { kind: 'speed', short: 'Acceleration & Hill Sprints' },
    7: { kind: 'rest', short: 'Rest & System Recovery' }
  };

  /* ----------------------------------------------------------------- blocks */
  // Each block wears a BJJ belt colour: white, blue, purple, brown.
  var BLOCKS = [
    { n: 1, phase: 'b1', from: 1, name: SPEC.blocks[0].name, belt: 'white', derived: false, assumed: false, blurb: SPEC.blocks[0].description },
    { n: 2, phase: 'b2', from: 5, name: SPEC.blocks[1].name, belt: 'blue', derived: true, assumed: false, blurb: '3 weeks loading + 1 week deload. Built from the Block 2 rules.' },
    { n: 3, phase: 'b3', from: 9, name: SPEC.blocks[2].name, belt: 'purple', derived: true, assumed: false, blurb: '3 weeks peaking + 1 week deload. Built from the Block 3 rules.' },
    { n: 4, phase: 'b4', from: 13, name: 'Reset Wave at Higher Baselines', belt: 'brown', derived: false, assumed: true,
      blurb: 'Not in your spec. Assumed: Block 1 repeats, with weights recalibrated from your Block 3 peak.' }
  ];
  function blockOf(week) {
    var b = BLOCKS[Math.min(3, Math.floor((week - 1) / 4))];
    var wb = week - b.from + 1;
    return { n: b.n, phase: b.phase, name: b.name, belt: b.belt, derived: b.derived, assumed: b.assumed, blurb: b.blurb, wb: wb, deload: wb === 4 };
  }

  /* ---------------------------------------------------------------- helpers */
  function pick(prog, wb) {
    if (!prog) return null;
    if (prog['W' + wb] !== undefined) return prog['W' + wb];
    var k, m;
    for (k in prog) {
      m = /^W(\d+)-W(\d+)$/.exec(k);
      if (m && wb >= +m[1] && wb <= +m[2]) return prog[k];
    }
    return null;
  }
  function catOf(name) {
    if (/hollow|hanging|pallof|plank/i.test(name)) return 'core';
    if (/push-up|bench/i.test(name)) return 'push';
    if (/pull|row/i.test(name)) return 'pull';
    return 'main';
  }
  function mkEx(o) {
    var p = o.parsed || E.parseTarget(o.reps);
    var mode = o.mode;
    if (!mode) mode = WEIGHTED[o.name] ? 'weightReps' : p.unit === 'sec' ? 'hold' : p.unit === 'm' ? 'check' : 'reps';
    var ex = {
      id: o.id, name: o.name, cat: o.cat || 'main', mode: mode,
      unit: p.unit, suffix: p.suffix, lo: p.lo, hi: p.hi, target: p.lo,
      label: o.label != null ? o.label : E.fmtTarget(p),
      note: (o.note != null ? o.note : p.note) || '',
      sets: o.sets || p.sets || 1,
      liftKey: LIFT_BY_NAME[o.name] || null, pct: null, rir: null,
      rest: o.rest != null ? o.rest : 60,
      restAfter: o.restAfter != null ? o.restAfter : (o.rest != null ? o.rest : 60),
      info: o.info || ''
    };
    if (mode === 'check' || mode === 'result') ex.target = null;
    return ex;
  }
  function splitTop(str) {
    var out = [], depth = 0, cur = '';
    Array.from(str).forEach(function (ch) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    });
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // "Foam Rolling (...). 90/90 Hip Switches (3x8/side), Cossack Squats (3x6/side)." -> tokens
  function splitDetails(details) {
    var out = [];
    String(details || '').split(/\.\s+/).forEach(function (sentence) {
      splitTop(sentence.replace(/\.\s*$/, '')).forEach(function (t) {
        if (t && !/^\d+\s*mins?$/i.test(t)) out.push(t);
      });
    });
    return out;
  }
  function tokenToEx(token, id, cat) {
    var m = /^(.*?)\s*\((.*)\)\s*$/.exec(token);
    var name = m ? m[1].trim() : token, inner = m ? m[2] : '';
    if (m && /^\d+\s*x/i.test(inner)) {
      var p = E.parseTarget(inner);
      return mkEx({ id: id, name: name, cat: cat, reps: inner, rest: p.unit === 'sec' ? 15 : 20 });
    }
    return mkEx({ id: id, name: name, cat: cat, mode: 'check', reps: '1', label: inner, rest: 0 });
  }

  /* ----------------------------------------------- Block 1 (spec) day builders */
  function buildGroup(st, wb, id) {
    var m = /^(Superset\s+[A-Z])\s*\(([^)]*)\)\s*-\s*(\d+)\s*Rounds/i.exec(st.name) || [];
    var rounds = +m[3] || 3;
    var exs = st.exercises.map(function (x, i) {
      var reps = x.progression ? pick(x.progression, wb) : x.reps;
      return mkEx({ id: id + '-' + i, name: x.name, cat: catOf(x.name), reps: reps, sets: rounds, rest: E.parseRest(x.rest) });
    });
    return { kind: 'group', label: m[1] || 'Superset', sub: m[2] || '', variant: 'superset', rounds: rounds,
             restAfter: E.parseRest(st.restAfterSuperset), exs: exs };
  }
  function stepToItem(st, wb, ctx, idx) {
    var id = ctx.wid + '-' + idx;
    if (st.type === 'warmup') {
      var rm = /Rest:\s*([^.]+)/i.exec(st.details || '');
      var rest = rm ? E.parseRest(rm[1]) : null;
      return { kind: 'ex', ex: mkEx({ id: id, name: st.name, cat: 'warmup', mode: 'check', reps: '1', label: '', info: st.details, rest: rest == null ? 60 : rest }) };
    }
    if (st.type === 'superset') return buildGroup(st, wb, id);
    var pr = pick(st.progression, wb) || {};
    return { kind: 'ex', ex: mkEx({ id: id, name: st.name, cat: st.type, reps: pr.reps, sets: pr.sets, note: pr.note,
                                    rest: E.parseRest(st.restBetweenSets), restAfter: E.parseRest(st.restAfter) }) };
  }
  function buildSpecItems(dayKey, wb, ctx) {
    return B1[dayKey].steps.map(function (st, i) { return stepToItem(st, wb, ctx, i); });
  }
  function mcgill(x, raw, id) {
    var rest = E.parseRest(x.rest);
    var p = E.parseTarget(raw);
    if (p.sets && p.lo != null) return mkEx({ id: id, name: x.name, cat: 'core', reps: raw, rest: rest });
    var n = /^(\d+)/.exec(raw);
    var par = /^(.*?)\s*\((.*)\)\s*$/.exec(raw);
    return mkEx({ id: id, name: x.name, cat: 'core', mode: 'check', reps: '1', sets: n ? +n[1] : 1,
                  label: par ? par[1] : raw, note: par ? par[2].replace(/->/g, '→') : '', rest: rest });
  }
  function buildDay4(wb, ctx) {
    var items = [], idx = 0;
    B1.day4.sections.forEach(function (sec) {
      items.push({ kind: 'section', title: sec.name });
      if (sec.exercises) {
        sec.exercises.forEach(function (x) {
          items.push({ kind: 'ex', ex: mcgill(x, pick(x.progression, wb) || '', ctx.wid + '-' + (idx++)) });
        });
      } else {
        splitDetails(sec.details).forEach(function (tk) {
          items.push({ kind: 'ex', ex: tokenToEx(tk, ctx.wid + '-' + (idx++), 'mobility') });
        });
      }
    });
    return items;
  }

  /* -------------------------------------------------------------- Day 6 speed */
  var SPRINT = {
    b2: {
      flat: { n: [5, 6, 6, 3], eff: ['92%', '95%', '95%', '80%'], dist: ['20-30m', '20-30m', '20-30m', '20m, light'], rest: '90-120 sec' },
      hill: { n: [5, 6, 6, 3], dist: ['15m hill drive', '15m hill drive', '15m hill drive', '15m hill drive, light'], rest: '90-120 sec' }
    },
    b3: {
      flat: { n: [4, 5, 4, 2], eff: ['100%', '100%', '100%', '80%'], dist: ['30m', '30m', '30m', '20m, light'], rest: '2-3 mins', fly: [3, 3, 2, 2] },
      hill: { n: [4, 5, 4, 2], dist: ['20m steep hill', '20m steep hill', '20m steep hill', '20m steep hill, light'], rest: '2-3 mins' }
    }
  };
  function sprintItems(week, b, ctx, nextId) {
    var flat = week % 2 === 1, items = [], label, n, rest, name = flat ? 'Flat sprint' : 'Hill sprint';
    if (b.derived) {
      var t = SPRINT[b.phase][flat ? 'flat' : 'hill'], i = b.wb - 1;
      n = t.n[i]; rest = E.parseRest(t.rest);
      label = flat ? t.eff[i] + ' effort, ' + t.dist[i] : t.dist[i] + ', max effort';
      items.push({ kind: 'section', title: flat ? 'Max-velocity sprints (flat)' : 'Hill sprints' });
      items.push({ kind: 'ex', ex: mkEx({ id: nextId(), name: name, cat: 'sprint', mode: 'result', reps: '1', sets: n, label: label, rest: rest }) });
      if (flat && t.fly) {
        items.push({ kind: 'ex', ex: mkEx({ id: nextId(), name: 'Flying 20', cat: 'sprint', mode: 'result', reps: '1', sets: t.fly[i],
                                            label: '20m fly after a 20-30m build-up', rest: rest }) });
      }
    } else {
      var src = flat ? B1.day6.steps[3].flatSprints : B1.day6.steps[3].hillSprints;
      var pr = pick(src.progression, b.wb);
      n = pr.sprints; rest = E.parseRest(src.rest);
      label = flat ? pr.effort + ' effort, ' + pr.dist : pr.dist + ', max effort';
      items.push({ kind: 'section', title: flat ? 'Max-velocity sprints (flat)' : 'Hill sprints' });
      items.push({ kind: 'ex', ex: mkEx({ id: nextId(), name: name, cat: 'sprint', mode: 'result', reps: '1', sets: n, label: label, rest: rest }) });
    }
    return items;
  }
  function buildDay6(week, b, ctx) {
    var d = B1.day6, items = [], idx = 0, wbBase = b.derived ? (b.deload ? 4 : 3) : b.wb;
    function nextId() { return ctx.wid + '-' + (idx++); }
    var s0 = d.steps[0], lm = /^(\d+\s*mins?)/i.exec(s0.details || '');
    items.push({ kind: 'ex', ex: mkEx({ id: nextId(), name: s0.name, cat: 'warmup', mode: 'check', reps: '1', label: lm ? lm[1] : '', info: s0.details, rest: 60 }) });
    items.push({ kind: 'section', title: d.steps[1].name });
    splitDetails(d.steps[1].details).forEach(function (tk) { items.push({ kind: 'ex', ex: tokenToEx(tk, nextId(), 'drill') }); });
    items.push({ kind: 'section', title: d.steps[2].name });
    d.steps[2].exercises.forEach(function (x) {
      items.push({ kind: 'ex', ex: mkEx({ id: nextId(), name: x.name, cat: 'drill', reps: pick(x.progression, wbBase), rest: E.parseRest(x.rest) }) });
    });
    return items.concat(sprintItems(week, b, ctx, nextId));
  }

  /* --------------------------------------- Blocks 2 and 3 (derived from rules) */
  // reps by week-in-block [W1, W2, W3, deload]
  var TUNE = {
    b2: { lift: [6, 5, 4, 5], clean: [5, 4, 4, 3], bss: [6, 5, 4, 5], nordic: [[3, 4], [3, 5], [3, 6], [2, 3]], pull: [6, 6, 5, 3] },
    b3: { lift: [3, 2, 1, 3], clean: [3, 2, 2, 3], bss: [3, 3, 2, 3], nordic: [[2, 3], [2, 4], [2, 4], [1, 3]], pull: [5, 4, 3, 3],
          liftSets: [4, 4, 5], cleanSets: [4, 4, 4] }
  };
  var CONTRAST = {
    day1: { iso: 'Overcoming iso squat vs pins', b2: { name: 'Seated Box Vertical Jump', suffix: '' }, b3: { name: 'Depth Jump', suffix: '' } },
    day5: { iso: 'Overcoming iso RDL pull vs pins', b2: { name: 'Broad Jump (stick landing)', suffix: '' }, b3: { name: 'Max-distance single-leg bound', suffix: '/leg' } }
  };
  function setTarget(ex, reps, sets, note) {
    ex.lo = ex.hi = ex.target = reps; ex.sets = sets;
    ex.label = E.fmtTarget({ lo: reps, hi: reps, unit: ex.unit, suffix: ex.suffix });
    ex.note = note || '';
  }
  function tuneMain(ex, phase, wb) {
    var T = TUNE[phase], i = wb - 1, dl = wb === 4;
    if (/nordic/i.test(ex.name)) setTarget(ex, T.nordic[i][1], T.nordic[i][0], dl ? 'Deload' : 'Strict eccentric');
    else if (ex.liftKey === 'clean') setTarget(ex, T.clean[i], dl ? ex.sets : (T.cleanSets ? T.cleanSets[i] : ex.sets), dl ? 'Deload' : '');
    else if (ex.liftKey && ex.liftKey !== 'bss') setTarget(ex, T.lift[i], dl ? ex.sets : (T.liftSets ? T.liftSets[i] : ex.sets), dl ? 'Deload' : '');
    else setTarget(ex, T.bss[i], ex.sets, dl ? 'Deload' : '');
  }
  function tuneGroup(g, phase, wb) {
    var T = TUNE[phase], i = wb - 1, rounds = wb === 4 ? 2 : 3;
    g.rounds = rounds;
    g.exs.forEach(function (ex) {
      if (ex.liftKey === 'pullup') setTarget(ex, T.pull[i], rounds, wb === 4 ? 'Deload' : '');
      else if (ex.liftKey) setTarget(ex, T.lift[i], rounds, wb === 4 ? 'Deload' : '');
      else ex.sets = rounds;
    });
  }
  function contrastGroup(dayKey, phase, wb, id) {
    var c = CONTRAST[dayKey], j = c[phase], rounds = wb === 4 ? 2 : 3;
    var iso = mkEx({ id: id + '-0', name: c.iso, cat: 'contrast', mode: 'hold', reps: '3-4 sec', label: '3–4s max drive', sets: rounds, rest: 20 });
    var jump = mkEx({ id: id + '-1', name: j.name, cat: 'plyo', mode: 'reps', reps: '3-4 reps' + j.suffix, sets: rounds, rest: 120, restAfter: 120 });
    return { kind: 'group', label: 'Contrast complex', sub: 'Overcoming iso, 20 sec, then explosive jump', variant: 'contrast',
             rounds: rounds, restAfter: 120, exs: [iso, jump] };
  }
  function deriveStrength(dayKey, b, ctx) {
    var base = buildSpecItems(dayKey, b.deload ? 4 : 3, ctx), out = [], placed = false;
    base.forEach(function (it) {
      if (it.kind === 'ex' && it.ex.cat === 'plyo') {
        if (!placed) { out.push(contrastGroup(dayKey, b.phase, b.wb, ctx.wid + '-c')); placed = true; }
        return;
      }
      if (it.kind === 'ex' && it.ex.cat === 'main') tuneMain(it.ex, b.phase, b.wb);
      if (it.kind === 'group') tuneGroup(it, b.phase, b.wb);
      out.push(it);
    });
    return out;
  }

  /* ------------------------------------------------------------- the resolver */
  var cache = {};
  function flatExs(w) {
    var out = [];
    w.items.forEach(function (it) {
      if (it.kind === 'ex') out.push(it.ex);
      else if (it.kind === 'group') it.exs.forEach(function (e) { out.push(e); });
    });
    return out;
  }
  function getWorkout(week, day) {
    var key = week * 10 + day;
    if (cache[key]) return cache[key];
    var b = blockOf(week), dk = 'day' + day, meta = DAY_META[day], spec = B1[dk];
    var ctx = { week: week, day: day, wid: 'w' + week + 'd' + day };
    var w = {
      week: week, day: day, wid: ctx.wid, block: b.n, blockName: b.name, belt: b.belt, phase: b.phase, wb: b.wb,
      deload: b.deload, derived: b.derived, assumed: b.assumed, kind: meta.kind, title: spec.title,
      shortTitle: meta.short, am: null, effort: '', focus: '', items: []
    };
    if (day === 1 || day === 5) {
      w.am = { text: spec.am, minLo: 30, minHi: 45 };
      w.items = b.derived ? deriveStrength(dk, b, ctx) : buildSpecItems(dk, b.wb, ctx);
    } else if (day === 2 || day === 3) {
      var rules = b.derived ? SPEC.blocks[b.n - 1].rules : null;
      w.effort = rules ? (day === 2 ? rules.bjjGi : rules.bjjNoGi) : spec.effort;
      w.focus = spec.focus;
    } else if (day === 4) {
      w.items = buildDay4(b.derived ? (b.deload ? 4 : 3) : b.wb, ctx);
    } else if (day === 6) {
      w.items = buildDay6(week, b, ctx);
    }
    flatExs(w).forEach(function (ex) {
      if (ex.liftKey) {
        ex.rir = E.rirFor(w.phase, ex.liftKey);
        ex.pct = w.deload ? E.DELOAD_PCT : E.pctFor(ex.lo, ex.rir);
      }
    });
    cache[key] = w;
    return w;
  }

  /* --------------------------------------------------------------- summaries */
  function pctText(p) { return Math.round(p * 1000) / 10 + '%'; }
  // opts: { oneRM(key) -> kg|null, settings }  — adds working weights when 1RMs are known
  function exLine(ex, opts) {
    if (ex.mode === 'check') return ex.name + (ex.label ? ' (' + ex.label + ')' : '');
    var s = ex.name + ': ' + ex.sets + ' x ' + ex.label;
    if (ex.pct) {
      s += ' at ' + pctText(ex.pct) + ' of 1RM';
      var rm = opts && opts.oneRM ? opts.oneRM(ex.liftKey) : null;
      var kg = rm && opts.settings ? E.workingKg(ex.liftKey, rm, ex.pct, opts.settings) : null, u = opts && opts.settings ? opts.settings.units || 'kg' : 'kg';
      if (kg != null) s += ex.liftKey === 'pullup' ? (kg > 0 ? ' (about +' + E.fmtW(kg, u) + ' ' + u + ' added to bodyweight)' : ' (bodyweight is enough)') : ' (about ' + E.fmtW(kg, u) + ' ' + u + ')';
    }
    if (ex.note) s += ' [' + ex.note + ']';
    return s;
  }
  function summarize(w, opts) {
    var lines = [];
    if (w.am) lines.push('AM: ' + w.am.text);
    if (w.effort) lines.push('Effort: ' + w.effort);
    if (w.focus) lines.push('Focus: ' + w.focus);
    w.items.forEach(function (it) {
      if (it.kind === 'section') lines.push(it.title + ':');
      else if (it.kind === 'ex') lines.push(exLine(it.ex, opts));
      else {
        lines.push(it.label + (it.sub ? ' (' + it.sub + ')' : '') + ', ' + it.rounds + ' rounds:');
        it.exs.forEach(function (e) { lines.push('  - ' + exLine(e, opts)); });
      }
    });
    return lines;
  }
  function allExerciseNames() {
    var seen = {}, out = [];
    for (var wk = 1; wk <= 16; wk++) for (var d = 1; d <= 7; d++) {
      flatExs(getWorkout(wk, d)).forEach(function (e) {
        if (e.mode === 'check' && e.cat !== 'core' && e.cat !== 'mobility' && e.cat !== 'drill') return;
        if (!seen[e.name]) { seen[e.name] = 1; out.push(e.name); }
      });
    }
    return out;
  }

  HA.program = {
    BLOCKS: BLOCKS, LIFT_KEYS: E.LIFT_KEYS, DAY_META: DAY_META, LIFT_LABEL: LIFT_LABEL, LIFT_BY_NAME: LIFT_BY_NAME,
    blockOf: blockOf, getWorkout: getWorkout, flatExs: flatExs, summarize: summarize, allExerciseNames: allExerciseNames
  };
})(typeof window !== 'undefined' ? window : globalThis);
