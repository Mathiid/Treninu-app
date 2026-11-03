/* program.js — turns the embedded Master Program (spec.js) into a concrete workout for every (week, day), and reads its
   nutrition and sleep protocols.
   Block 1 is read straight from the program text: every set, rep target and load comes from the strings in spec.js, so
   changing a number there changes the app. Blocks 2 and 3 only ship as rules in the program, so they are generated from
   Block 1's exercises plus those rules (percent of your estimated 1RM). Block 4 repeats Block 1's wave at your recalibrated
   baselines (percent of 1RM) and adds the Pre-VAD items. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  var E = HA.engine, SPEC = HA.SPEC;
  var B1 = SPEC.blocks[0].details, SCHED = SPEC.weeklySchedule, NUT = SPEC.nutritionProtocols || {};

  var LIFT_LABEL = { bench: 'DB Bench Press (each dumbbell)', zercher: 'Zercher Squat', clean: 'Power Clean', rdl: 'Romanian Deadlift',
                     bss: 'Bulgarian Split Squat', pullup: 'Pull-up' };
  // The six lifts tracked against an estimated 1RM. The match is on the start of the name, so "Yielding Iso RDL Hold" is not the RDL.
  function liftKeyOf(name) {
    var n = String(name);
    if (/^power clean/i.test(n)) return 'clean';
    if (/^zercher squat/i.test(n)) return 'zercher';
    if (/^(romanian deadlift|rdl)\b/i.test(n)) return 'rdl';
    if (/^(db )?bench press/i.test(n)) return 'bench';
    if (/bulgarian split squat/i.test(n)) return 'bss';          // weighted: the total weight held, reps per leg
    if (/^pull-?ups?\b/i.test(n)) return 'pullup';               // weighted: bodyweight plus the weight added
    return null;
  }
  // Exercises whose weight is logged (the six lifts, and accessories that repeat last time's weight and add a plate step).
  var WEIGHTED_RE = /^(power clean|zercher squat|romanian deadlift|rdl\b|(db )?bench press|(atg )?bulgarian split squat|pull-?ups?\b|db hammer curls|tricep rope pushdowns|db lateral raises|pallof press)/i;
  var DAY_META = {
    1: { kind: 'strength', short: 'Power & ATG Leg + Upper' },
    2: { kind: 'bjj', short: 'BJJ Gi' },
    3: { kind: 'bjj', short: 'BJJ No-Gi' },
    4: { kind: 'recovery', short: 'Mobility, Neck Armor & McGill Reset' },
    5: { kind: 'strength', short: 'Strength-Endurance & Posterior Chain + Upper' },
    6: { kind: 'speed', short: 'Max Velocity Sprints & Hill Accelerations' },
    7: { kind: 'rest', short: 'Rest & System Recovery' }
  };

  /* ----------------------------------------------------------------- blocks */
  // Each block wears a BJJ belt colour: white, blue, purple, brown.
  function blockName(i) { return String(SPEC.blocks[i].name).replace(/\s*\(Weeks?[^)]*\)\s*$/i, ''); }
  var BLOCKS = [
    { n: 1, phase: 'b1', from: 1, name: blockName(0), belt: 'white', derived: false, assumed: false, blurb: '3 weeks loading + 1 week deload. Loads are the kilograms in your program.' },
    { n: 2, phase: 'b2', from: 5, name: blockName(1), belt: 'blue', derived: true, assumed: false, blurb: '3 weeks loading + 1 week deload. Built from the Block 2 rules.' },
    { n: 3, phase: 'b3', from: 9, name: blockName(2), belt: 'purple', derived: true, assumed: false, blurb: '3 weeks peaking + 1 week deload. Built from the Block 3 rules.' },
    { n: 4, phase: 'b4', from: 13, name: blockName(3), belt: 'brown', derived: true, assumed: false,
      blurb: 'Block 1’s 4-week wave again at weights recalculated from your Block 3 peak, plus rucking, a 3 km timed run and push-up burnouts.' }
  ];
  function blockOf(week) {
    var b = BLOCKS[Math.min(3, Math.floor((week - 1) / 4))];
    var wb = week - b.from + 1;
    return { n: b.n, phase: b.phase, name: b.name, belt: b.belt, derived: b.derived, assumed: b.assumed, blurb: b.blurb, wb: wb, deload: wb === 4 };
  }

  /* ----------------------------------------------- reading the program text */
  function cap(s) { s = String(s || '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function fmtMin(s) { return String(s || '').replace(/(\d+)\s*-\s*(\d+)\s*m(?:ins?)?\b/i, '$1–$2 min').replace(/(\d+)\s*m(?:ins?)?\b/i, '$1 min'); }
  // Splits at a separator (a sticky regex) only where it is not inside brackets.
  function splitDepth0(str, sep) {
    var out = [], cur = '', depth = 0, i = 0, ch, m;
    str = String(str || '');
    while (i < str.length) {
      ch = str.charAt(i);
      if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
      if (depth === 0) {
        sep.lastIndex = i; m = sep.exec(str);
        if (m && m[0].length) { out.push(cur); cur = ''; i += m[0].length; continue; }
      }
      cur += ch; i++;
    }
    out.push(cur);
    return out.map(function (x) { return x.trim(); }).filter(Boolean);
  }
  var RE = { plus: /\s\+\s/y, arrow: /\s->\s/y, comma: /,\s*/y, sentence: /\.\s+(?=[A-Z])/y };
  function flat(a) { return [].concat.apply([], a); }
  // "A (..), B (..). C (..)" or "A + B" -> ["A (..)", "B (..)", "C (..)"]
  function splitItems(body) {
    return flat(splitDepth0(body, RE.sentence).map(function (s) {
      return flat(splitDepth0(s, RE.comma).map(function (t) { return splitDepth0(t, RE.plus); }));
    }));
  }
  // "Tendon Prep: Pause Split Squat Hold (...)" -> { head: 'Tendon Prep', body: 'Pause Split Squat Hold (...)' }
  function headOf(line) {
    var depth = 0, i, ch;
    for (i = 0; i < line.length; i++) {
      ch = line.charAt(i);
      if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (ch === ':' && depth === 0 && /\s/.test(line.charAt(i + 1))) return { head: line.slice(0, i).trim(), body: line.slice(i + 1).trim() };
    }
    return { head: '', body: String(line).trim() };
  }
  // "W1: 4x5 @52.5kg, W2-3: 3x15, W4: 2x3 @45kg deload" -> { 1: '4x5 @52.5kg', 2: '3x15', 3: '3x15', 4: '2x3 @45kg deload' }
  function parseWeeks(inner) {
    var map = {};
    String(inner).split(/,\s*(?=W\d)/).forEach(function (part) {
      var m = /^W(\d)(?:\s*-\s*(\d))?\s*:\s*(.*)$/.exec(part.trim());
      if (!m) return;
      for (var w = +m[1]; w <= +(m[2] || m[1]); w++) map[w] = m[3].trim();
    });
    return map;
  }
  function parseToken(tok) {
    var m = /^(.*?)\s*\((.*)\)\s*$/.exec(tok), name = m ? m[1].trim() : String(tok).trim(), inner = m ? m[2].trim() : '';
    return { name: name, inner: inner, weeks: /^W\d/.test(inner) ? parseWeeks(inner) : null };
  }
  // "4x5 @52.5kg", "1x10 @BW", "3x6 @2x12.5kg", "1x6 @BW+2.5kg", "3x10 @BW or 2x7.5kg DBs", "2x3 @45kg deload", "2x4 assisted", "2x20s"
  // -> { p: parsed target, kg: the weight to type (null = none given), loadNote, note }
  function parseCell(cell) {
    var s = String(cell || '').trim(), at = s.indexOf('@');
    var head = at >= 0 ? s.slice(0, at).trim() : s, tail = at >= 0 ? s.slice(at + 1).trim() : '';
    var out = { p: E.parseTarget(head), kg: null, loadNote: '', note: '' }, m, extra = '';
    if (tail) {
      if ((m = /^BW\s*\+\s*(\d+(?:\.\d+)?)\s*kg\b\s*(.*)$/i.exec(tail))) { out.kg = +m[1]; extra = m[2]; }
      else if ((m = /^BW\b(?:\s+or\s+2\s*x\s*(\d+(?:\.\d+)?)\s*kg(?:\s*DBs?)?)?\s*(.*)$/i.exec(tail))) {
        out.kg = m[1] ? 2 * +m[1] : 0; out.loadNote = m[1] ? 'Bodyweight, or 2 × ' + m[1] + ' kg dumbbells' : ''; extra = m[2];
      } else if ((m = /^2\s*x\s*(\d+(?:\.\d+)?)\s*kg\b\s*(.*)$/i.exec(tail))) { out.kg = 2 * +m[1]; out.loadNote = '2 × ' + m[1] + ' kg dumbbells'; extra = m[2]; }
      else if ((m = /^(\d+(?:\.\d+)?)\s*kg\b\s*(.*)$/i.exec(tail))) { out.kg = +m[1]; extra = m[2]; }
      else extra = tail;
    }
    out.note = cap(extra);
    return out;
  }
  function catOf(name) {
    if (/hollow|hanging|pallof|plank|leg raise|knee-to-elbow/i.test(name)) return 'core';
    if (/push-up|bench/i.test(name)) return 'push';
    if (/pull|row/i.test(name)) return 'pull';
    return 'main';
  }
  // The rest after a set when the program does not give one (it gives rests only for sprints and the contrast complex).
  function restFor(name, cat, inGroup) {
    if (inGroup) return 30;
    if (cat === 'tendon') return 60;
    if (cat === 'plyo') return 90;
    if (cat === 'finisher' || cat === 'core') return 45;
    if (/power clean/i.test(name)) return 150;
    if (/nordic|bulgarian/i.test(name)) return 90;
    return cat === 'main' ? 120 : 60;
  }
  function mkEx(o) {
    var p = o.parsed || E.parseTarget(o.reps);
    var mode = o.mode;
    if (!mode) mode = WEIGHTED_RE.test(o.name) ? 'weightReps' : p.unit === 'sec' ? 'hold' : p.unit === 'm' ? 'check' : 'reps';
    var ex = {
      id: o.id, name: o.name, cat: o.cat || 'main', mode: mode,
      unit: p.unit, suffix: p.suffix, lo: p.lo, hi: p.hi, target: p.lo,
      label: o.label != null ? o.label : E.fmtTarget(p),
      note: (o.note != null ? o.note : p.note) || '',
      sets: o.sets || p.sets || 1,
      liftKey: liftKeyOf(o.name), pct: null, rir: null, kg: o.kg != null ? o.kg : null,
      rest: o.rest != null ? o.rest : 60,
      restAfter: o.restAfter != null ? o.restAfter : (o.rest != null ? o.rest : 60),
      info: o.info || ''
    };
    if (mode === 'check' || mode === 'result') ex.target = null;
    return ex;
  }
  // One program item for week-in-block wb, or null when the program has no entry for that week.
  function exFromToken(tok, wb, o) {
    var it = parseToken(tok), cell = it.weeks ? it.weeks[wb] : it.inner;
    if (it.weeks && cell === undefined) return null;
    if (/warm-?up/i.test(it.name) && !it.weeks && !/^\d+\s*x/i.test(it.inner)) {
      return mkEx({ id: o.id, name: it.name, cat: 'warmup', mode: 'check', reps: '1', label: fmtMin(it.inner), rest: 0 });
    }
    var c = parseCell(cell), p = c.p, cat = o.cat || catOf(it.name), name = it.name;
    if (/split squat hold/i.test(name) && p.unit === 'sec' && !p.suffix) p.suffix = '/leg';
    if (/bulgarian split squat/i.test(name) && !p.suffix) p.suffix = '/leg';          // reps are counted per leg
    if (/^RDL$/i.test(name)) name = 'Romanian Deadlift (RDL)';                        // the name Ducky and the video search understand
    var keep = o.keepKg !== false && c.kg != null;
    var notes = [c.note, keep ? c.loadNote : ''].filter(Boolean);
    var rest = o.rest != null ? o.rest : restFor(name, cat, !!o.rounds);
    return mkEx({ id: o.id, name: name, cat: cat, parsed: p, sets: o.rounds || p.sets || 1, rest: rest,
                  restAfter: o.restAfter != null ? o.restAfter : (cat === 'tendon' ? 90 : rest), kg: keep ? c.kg : null,
                  note: notes.join('. '), label: p.lo == null ? '' : undefined });
  }
  function buildGroup(head, body, wb, id, keepKg) {
    var m = /^(Superset\s+[A-Z])\s*\((\d+)\s*Rounds?\)/i.exec(head) || [], rounds = +m[2] || 3;
    var toks = splitDepth0(body, RE.arrow);
    var exs = toks.map(function (tok, i) {
      return exFromToken(tok, wb, { id: id + '-' + i, rounds: rounds, keepKg: keepKg, rest: i < toks.length - 1 ? 30 : 90 });
    }).filter(Boolean);
    return { kind: 'group', label: m[1] || 'Superset', sub: '', variant: 'superset', rounds: rounds, restAfter: 90, exs: exs };
  }

  /* -------------------------------- Block 1: strength days (Days 1 and 5) */
  function buildSpecItems(dayKey, wb, ctx, keepKg) {
    var items = [], idx = 0;
    B1[dayKey].forEach(function (line) {
      var h = headOf(line), head = h.head, id = ctx.wid + '-' + (idx++);
      if (/^Superset/i.test(head)) { var g = buildGroup(head, h.body, wb, id, keepKg); if (g.exs.length) items.push(g); return; }
      var cat = /^Tendon/i.test(head) ? 'tendon' : /^Plyo/i.test(head) ? 'plyo' : /^Main/i.test(head) ? 'main' : /Finisher/i.test(head) ? 'finisher' : '';
      splitItems(h.body).forEach(function (tok, k) {
        var ex = exFromToken(tok, wb, { id: id + '-' + k, cat: cat, keepKg: keepKg });
        if (ex) items.push({ kind: 'ex', ex: ex });
      });
    });
    return items;
  }

  /* ----------------------------------------- Day 4: mobility and recovery */
  // "Side planks 15-25s", "Bird-dogs 3x5 with 8s hold", "Curl-up pyramids 10s->8s->6s", "Foam rolling (8m)", "3m nasal breathing with legs elevated"
  function looseEx(tok, id, cat) {
    var m, name, ex;
    if ((m = /^(.*?)\s*\((\d+x[^)]*)\)\s*$/i.exec(tok))) return mkEx({ id: id, name: cap(m[1]), cat: cat, reps: m[2], rest: 20 });
    if ((m = /^(.*?)\s*\((\d+(?:-\d+)?\s*m)\)\s*$/i.exec(tok))) return mkEx({ id: id, name: cap(m[1]), cat: cat, mode: 'check', reps: '1', label: fmtMin(m[2]), rest: 0 });
    if ((m = /^(\d+)\s*m\s+(.*)$/i.exec(tok))) return mkEx({ id: id, name: cap(m[2]), cat: cat, mode: 'check', reps: '1', label: m[1] + ' min', rest: 0 });
    if ((m = /->/.test(tok) && /^(.*?)\s+(\d+s(?:\s*->\s*\d+s)+)\s*$/i.exec(tok))) return mkEx({ id: id, name: cap(m[1]), cat: cat, mode: 'check', reps: '1', label: m[2].replace(/\s*->\s*/g, ' → '), rest: 0 });
    if ((m = /^(.*?)\s+(\d+x\d+(?:-\d+)?)\s*(.*)$/i.exec(tok))) {
      ex = mkEx({ id: id, name: cap(m[1]), cat: cat, reps: m[2], rest: 20 });
      if (m[3]) { ex.note = cap(m[3]); }
      return ex;
    }
    if ((m = /^(.*?)\s+(\d+(?:-\d+)?)\s*s$/i.exec(tok))) {
      ex = mkEx({ id: id, name: cap(m[1]), cat: cat, reps: m[2] + 's/side', rest: 20 });
      return ex;
    }
    name = cap(tok);
    return mkEx({ id: id, name: name, cat: cat, mode: 'check', reps: '1', label: '', rest: 0 });
  }
  function buildDay4(wb, ctx) {
    var items = [], idx = 0;
    B1.day4.forEach(function (line) {
      var h = headOf(line), title, toks, tm, pm;
      if (h.head) {
        tm = /^(.*?)\s*\((\d+\s*m)\)\s*$/.exec(h.head);
        title = tm ? tm[1] + ' (' + fmtMin(tm[2]) + ')' : h.head;
        toks = splitItems(h.body);
      } else {
        pm = /^(.*?)\s*\((.*)\)\s*$/.exec(h.body);
        title = pm ? pm[1] : h.body; toks = pm ? splitDepth0(pm[2], RE.comma) : [];
      }
      var cat = /McGill|Armor/i.test(title) ? 'core' : 'mobility';
      items.push({ kind: 'section', title: title });
      toks.forEach(function (tk) { items.push({ kind: 'ex', ex: looseEx(tk, ctx.wid + '-' + (idx++), cat) }); });
    });
    return items;
  }

  /* -------------------------------------------------------------- Day 6 speed */
  // The program gives the distances, the effort range and the rest; how many sprints is not in it. The counts below
  // (4, 5, 6, then 3 in the deload week) are carried over from the earlier version of the program.
  var SPRINT_N = [4, 5, 6, 3];
  function sprintSpec() {
    var line = B1.day6.filter(function (l) { return /Hill Sprints/i.test(l); })[0] || '';
    var m = /Flat\s+(\d+(?:-\d+)?)\s*m\s*@\s*(\d+)\s*-\s*(\d+)\s*%\s*vs\s*Steep Hill\s+(\d+(?:-\d+)?)\s*m\b.*?(\d+(?:-\d+)?)\s*s(?:ec)?\b/i.exec(line) || [];
    var lo = +m[2] || 90, hi = +m[3] || 95;
    return { fd: (m[1] || '15-20') + 'm', hd: (m[4] || '10-15') + 'm', lo: lo, hi: hi, rest: E.parseRest((m[5] || '90-120') + ' sec') };
  }
  // derived tables for Blocks 2 and 3 come from their rules (20-30 m flat and 15 m hill drives; 30 m flat, flying 20s and 20 m steep hills)
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
  function sprintItems(week, b, nextId) {
    var flatWeek = week % 2 === 1, items = [], label, n, rest, name = flatWeek ? 'Flat sprint' : 'Hill sprint', i = b.wb - 1;
    var t;
    if (b.phase === 'b2' || b.phase === 'b3') {
      t = SPRINT[b.phase][flatWeek ? 'flat' : 'hill']; n = t.n[i]; rest = E.parseRest(t.rest);
      label = flatWeek ? t.eff[i] + ' effort, ' + t.dist[i] : t.dist[i] + (i === 3 ? '' : ', max effort');
    } else {
      var sp = sprintSpec(), mid = Math.floor((sp.lo + sp.hi) / 2);
      n = SPRINT_N[i]; rest = sp.rest;
      label = flatWeek ? [sp.lo + '%', mid + '%', sp.hi + '%', '80%'][i] + ' effort, ' + (i === 3 ? '15m, light' : sp.fd)
                       : sp.hd + ' steep, ' + (i === 3 ? 'light' : 'max effort');
    }
    items.push({ kind: 'section', title: flatWeek ? 'Max-velocity sprints (flat)' : 'Hill sprints' });
    items.push({ kind: 'ex', ex: mkEx({ id: nextId(), name: name, cat: 'sprint', mode: 'result', reps: '1', sets: n, label: label, rest: rest }) });
    if (b.phase === 'b3' && flatWeek && t.fly) {
      items.push({ kind: 'ex', ex: mkEx({ id: nextId(), name: 'Flying 20', cat: 'sprint', mode: 'result', reps: '1', sets: t.fly[i],
                                          label: '20m fly after a 20-30m build-up', rest: rest }) });
    }
    return items;
  }
  function buildDay6(week, b, ctx) {
    var items = [], idx = 0, wbBase = (b.phase === 'b2' || b.phase === 'b3') ? (b.deload ? 4 : 3) : b.wb;
    function nextId() { return ctx.wid + '-' + (idx++); }
    var lines = B1.day6, h;
    // 1. warm-up + drills to prime the hips
    splitDepth0(lines[0], RE.plus).forEach(function (tk) {
      var t = parseToken(tk);
      if (/warm-?up/i.test(t.name)) items.push({ kind: 'ex', ex: mkEx({ id: nextId(), name: t.name, cat: 'warmup', mode: 'check', reps: '1', label: fmtMin(t.inner), rest: 60 }) });
      else items.push({ kind: 'ex', ex: mkEx({ id: nextId(), name: cap(t.name), cat: 'drill', mode: 'check', reps: '1', label: '', rest: 0 }) });
    });
    // 2. elastic drills
    h = headOf(lines[1]);
    items.push({ kind: 'section', title: h.head || 'Elastic Drills' });
    splitItems(h.body).forEach(function (tk) { var ex = exFromToken(tk, wbBase, { id: nextId(), cat: 'drill', rest: 60 }); if (ex) items.push({ kind: 'ex', ex: ex }); });
    // 3. the sprints
    items = items.concat(sprintItems(week, b, nextId));
    // 4. the post-sprint flow
    var post = lines[3] ? /^(.*?)\s*\((.*)\)\s*$/.exec(lines[3]) : null;
    if (post) {
      items.push({ kind: 'section', title: post[1] });
      splitDepth0(post[2], RE.comma).forEach(function (tk) { items.push({ kind: 'ex', ex: mkEx({ id: nextId(), name: cap(tk), cat: 'mobility', mode: 'check', reps: '1', label: '', rest: 0 }) }); });
    }
    return items;
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
    ex.lo = ex.hi = ex.target = reps; ex.sets = sets; ex.kg = null;     // from Block 2 on the weight is a percent of your 1RM, not a fixed load
    ex.label = E.fmtTarget({ lo: reps, hi: reps, unit: ex.unit, suffix: ex.suffix });
    ex.note = note || '';
  }
  function tuneMain(ex, phase, wb) {
    var T = TUNE[phase], i = wb - 1, dl = wb === 4;
    if (/nordic/i.test(ex.name)) { ex.suffix = ''; setTarget(ex, T.nordic[i][1], T.nordic[i][0], dl ? 'Deload' : 'Strict eccentric'); }
    else if (ex.liftKey === 'clean') setTarget(ex, T.clean[i], dl ? ex.sets : (T.cleanSets ? T.cleanSets[i] : ex.sets), dl ? 'Deload' : '');
    else if (ex.liftKey && ex.liftKey !== 'bss') setTarget(ex, T.lift[i], dl ? ex.sets : (T.liftSets ? T.liftSets[i] : ex.sets), dl ? 'Deload' : '');
    else setTarget(ex, T.bss[i], ex.sets, dl ? 'Deload' : '');
  }
  function tuneGroup(g, phase, wb) {
    var T = TUNE[phase], i = wb - 1, rounds = wb === 4 ? 2 : 3;
    g.rounds = rounds;
    g.exs.forEach(function (ex) {
      if (ex.liftKey === 'pullup') setTarget(ex, T.pull[i], rounds, wb === 4 ? 'Deload' : '');
      else if (ex.liftKey) setTarget(ex, T.lift[i], rounds, wb === 4 ? 'Deload' : (ex.liftKey === 'bench' && phase === 'b2' ? 'Block target: 27.5–30 kg dumbbells' : ''));
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
    var base = buildSpecItems(dayKey, b.deload ? 4 : 3, ctx, false), out = [], placed = false;
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

  /* -------------------------- Block 4: Pre-VAD transition (rucking, 3 km, burnouts) */
  // The program says "integrate progressive bi-weekly rucking (10-20kg), 3km timed run pacing, and post-lift push-up burnouts".
  // Where they go is not in it, so the app places them: rucks in weeks 13 and 15 (every other week) on the recovery day, the 3 km
  // timed run in place of the Day 1 easy run in weeks 14 and 16, and one push-up burnout after each lift in weeks 13 to 15.
  var RUCK = { 13: '10–15 kg pack, steady walking pace', 15: '15–20 kg pack, steady walking pace' };
  function block4Extras(w, ctx, b) {
    var items = [], idx = 0;
    if (w.day === 4 && RUCK[w.week]) {
      items.push({ kind: 'section', title: 'Pre-VAD: rucking' });
      items.push({ kind: 'ex', ex: mkEx({ id: ctx.wid + '-r' + (idx++), name: 'Ruck', cat: 'mobility', mode: 'check', reps: '1', label: RUCK[w.week], note: 'Placement chosen by the app', rest: 0 }) });
    }
    if ((w.day === 1 || w.day === 5) && !b.deload) {
      items.push({ kind: 'section', title: 'Post-lift' });
      var ex = mkEx({ id: ctx.wid + '-b' + (idx++), name: 'Push-up burnout', cat: 'push', mode: 'reps', reps: '1', label: 'Max reps', note: 'Stop at failure and keep the form. Log the reps you reach', sets: 1, rest: 0 });
      ex.target = null; ex.lo = ex.hi = null;
      items.push({ kind: 'ex', ex: ex });
    }
    if (w.day === 1 && w.am && (w.week === 14 || w.week === 16)) {
      w.am.text = '3 km timed run: practise your goal pace and log the time (Log a run). Replaces the easy Zone 2 run this week.';
      w.am.timed = true;
    }
    return items;
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
  function effortOf(day) {
    var m = /(\d+)\s*-\s*(\d+)\s*%\s*Effort/i.exec(SCHED['day' + day] || '');
    return m ? m[1] + '–' + m[2] + '% effort' : '';
  }
  function focusOf() {
    var m = /^(.*?)\s*\((.*)\)\s*$/.exec(B1.day2_3 || '');
    return m ? 'Post-BJJ decompression flow: ' + m[2] + '.' : String(B1.day2_3 || '');
  }
  function getWorkout(week, day) {
    var key = week * 10 + day;
    if (cache[key]) return cache[key];
    var b = blockOf(week), dk = 'day' + day, meta = DAY_META[day];
    var ctx = { week: week, day: day, wid: 'w' + week + 'd' + day };
    var w = {
      week: week, day: day, wid: ctx.wid, block: b.n, blockName: b.name, belt: b.belt, phase: b.phase, wb: b.wb,
      deload: b.deload, derived: b.derived, assumed: b.assumed, kind: meta.kind, title: SCHED[dk],
      shortTitle: meta.short, am: null, effort: '', focus: '', items: []
    };
    if (day === 1 || day === 5) {
      w.am = { text: 'Easy Zone 2 Run (30-45 mins). Post-run meal within 30-45 min.', minLo: 30, minHi: 45 };
      if (b.phase === 'b2' || b.phase === 'b3') w.items = deriveStrength(dk, b, ctx);
      else w.items = buildSpecItems(dk, b.wb, ctx, b.phase === 'b1');     // Block 4: Block 1's wave, loads as percent of 1RM
    } else if (day === 2 || day === 3) {
      w.effort = effortOf(day);
      w.focus = focusOf();
    } else if (day === 4) {
      w.items = buildDay4(b.wb, ctx);
    } else if (day === 6) {
      w.items = buildDay6(week, b, ctx);
    }
    if (b.phase === 'b4') w.items = w.items.concat(block4Extras(w, ctx, b));
    flatExs(w).forEach(function (ex) {
      if (ex.liftKey) {
        ex.rir = E.rirFor(w.phase, ex.liftKey);
        if (ex.kg == null) ex.pct = w.deload ? E.DELOAD_PCT : E.pctFor(ex.lo, ex.rir);
      }
    });
    cache[key] = w;
    return w;
  }

  /* --------------------------------------------------------------- summaries */
  function pctText(p) { return Math.round(p * 1000) / 10 + '%'; }
  // the fixed load of a Block 1 exercise in words
  function fixedText(ex, u, s) {
    var kg = E.fixedKg(ex.kg, s || { units: u });
    if (ex.liftKey === 'pullup') return kg > 0 ? '+' + E.fmtW(kg, u) + ' ' + u + ' added to bodyweight' : 'bodyweight';
    if (ex.liftKey === 'bss' && !(kg > 0)) return 'bodyweight';
    return E.fmtW(kg, u) + ' ' + u + (ex.liftKey === 'bench' ? ' per dumbbell' : ex.liftKey === 'bss' ? ' in total' : '');
  }
  // opts: { oneRM(key) -> kg|null, settings }  — adds working weights when 1RMs are known
  function exLine(ex, opts) {
    if (ex.mode === 'check') return ex.sets > 1 && ex.label ? ex.name + ': ' + ex.sets + ' x ' + ex.label : ex.name + (ex.label ? ' (' + ex.label + ')' : '');
    var s = ex.name + ': ' + ex.sets + ' x ' + ex.label, u = opts && opts.settings ? opts.settings.units || 'kg' : 'kg';
    var rm = ex.liftKey && opts && opts.oneRM ? opts.oneRM(ex.liftKey) : null;
    if (ex.kg != null) {
      s += ' at ' + fixedText(ex, u, opts && opts.settings);
      var pc = rm && opts.settings ? E.pctOfRM(ex.liftKey, E.fixedKg(ex.kg, opts.settings), rm, E.bodyKg(opts.settings)) : null;
      if (pc) s += ' (' + pctText(pc) + ' of estimated 1RM)';
    } else if (ex.pct) {
      s += ' at ' + pctText(ex.pct) + ' of 1RM';
      var kg = rm && opts.settings ? E.workingKg(ex.liftKey, rm, ex.pct, opts.settings) : null;
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

  /* ------------------------------------------- nutrition and sleep protocols */
  function stripDot(s) { return String(s || '').replace(/\.\s*$/, '').trim(); }
  // "AM Zone 2 run -> Post-AM meal (...). PM Heavy lift -> Post-PM meal (...)" and "Pre-BJJ meal (15:30-16:30): ... Intra-BJJ: ..."
  function parseMeals(raw) {
    var out = [];
    splitDepth0(raw, RE.sentence).forEach(function (s) {
      s = stripDot(s);
      var m = /^(.*?)\s*->\s*(.*?)\s*\((.*)\)\s*$/.exec(s);
      if (m) { out.push({ label: m[2], when: 'After the ' + m[1], text: m[3] }); return; }
      m = /^(.*?)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/.exec(s);
      if (m && m[1]) { out.push({ label: m[1], when: m[2] ? m[2].replace(/(\d)-(\d)/, '$1–$2') : '', text: m[3] }); return; }
      out.push({ label: '', when: '', text: s });
    });
    return out;
  }
  function mealsFor(day) {
    var key = day === 1 || day === 5 ? 'days1and5' : day === 2 || day === 3 ? 'days2and3' : day === 6 ? 'day6' : '';
    var raw = key && NUT.timelines ? NUT.timelines[key] : '';
    return raw ? parseMeals(raw) : [];
  }
  function daysIn(text) {
    var set = {}, re = /Days?\s*(\d)(?:\s*-\s*(\d))?/g, m, d;
    while ((m = re.exec(String(text || '')))) for (d = +m[1]; d <= +(m[2] || m[1]); d++) set[d] = 1;
    return set;
  }
  // Every day: creatine and water. On BJJ and sprint days: salt in the fluids (the days come from the program text).
  function baselineFor(day) {
    var b = NUT.dailyBaseline || {}, out = [], rest = day === 4 || day === 7;
    if (b.creatine) {
      var m = /^(.*?)\s*\(\s*(.*?)\s+on training days\s*;\s*(.*?)\s+on rest days\s*\)\s*$/i.exec(b.creatine);
      out.push({ label: 'Creatine', text: m ? m[1] + ', ' + (rest ? m[3] : m[2]) : b.creatine });
    }
    if (b.hydration) out.push({ label: 'Hydration', text: b.hydration.replace(/\s*daily\s*$/i, '') + ' a day' });
    if (b.electrolytes && daysIn(b.electrolytes)[day]) out.push({ label: 'Electrolytes', text: cap(stripDot(b.electrolytes).replace(/^On BJJ \(Days? [\d-]+\) and Sprint days \(Days? [\d-]+\),\s*/i, '')) });
    return out;
  }
  function fuelFor(day) { return { baseline: baselineFor(day), meals: mealsFor(day) }; }
  function sleepBlueprint() {
    return (NUT.sleepBlueprint || []).map(function (s) {
      var m = /^(.*?)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/.exec(s);
      return m ? { title: m[1], when: m[2] || '', text: m[3] } : { title: '', when: '', text: s };
    });
  }

  HA.program = {
    BLOCKS: BLOCKS, LIFT_KEYS: E.LIFT_KEYS, DAY_META: DAY_META, LIFT_LABEL: LIFT_LABEL, liftKeyOf: liftKeyOf,
    blockOf: blockOf, getWorkout: getWorkout, flatExs: flatExs, summarize: summarize, allExerciseNames: allExerciseNames,
    fuel: fuelFor, sleep: sleepBlueprint, programName: SPEC.programName, profile: SPEC.targetProfile
  };
})(typeof window !== 'undefined' ? window : globalThis);
