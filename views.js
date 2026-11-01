/* views.js — every screen as a pure function (state in, HTML string out). No DOM access here, so each
   screen can be rendered and checked in Node. app.js wires events and paints the strings. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  var E = HA.engine, P = HA.program, SS = HA.session, AI = HA.ai, Z = HA.zone2, SC = HA.sched;
  var esc = AI.esc;

  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var KIND_CODE = { strength: 'L', bjj: 'G', recovery: 'R', speed: 'S', rest: '–' };
  var KIND_NAME = { strength: 'Lift and run', bjj: 'BJJ', recovery: 'Recovery', speed: 'Sprints', rest: 'Rest' };
  var BELT = { white: 'White belt', blue: 'Blue belt', purple: 'Purple belt', brown: 'Brown belt' };

  /* ------------------------------------------------------------------- icons */
  function svg(inner, cls, vb) {
    return '<svg class="' + (cls || 'ico') + '" viewBox="' + (vb || '0 0 24 24') + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }
  var ICON = {
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'ico ico-check'),
    down: svg('<path d="M6 9l6 6 6-6"/>'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    minus: svg('<path d="M5 12h14"/>'),
    dots: svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
    pulse: svg('<path d="M3 12h4l2-6 4 12 2-6h6"/>'),
    left: svg('<path d="M15 6l-6 6 6 6"/>'),
    right: svg('<path d="M9 6l6 6-6 6"/>'),
    play: svg('<path d="M7 5l12 7-12 7z"/>'),
    send: svg('<path d="M5 12l15-7-5 15-3-6z"/>'),
    duck: svg('<circle cx="10" cy="8" r="4"/><path d="M13.6 9.2L20 10.5l-6 1.6M6 12.5c-2.5 1.2-3.5 4.7.5 7h9.5c4-1.3 4.6-5.3 1-7"/><circle cx="9" cy="7.2" r=".6" fill="currentColor"/>', 'ico ico-duck')
  };
  var NAV = [
    { id: 'today', label: 'Today', ico: svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M9 15l2 2 4-4"/>') },
    { id: 'program', label: 'Program', ico: svg('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>') },
    { id: 'lifts', label: 'Lifts', ico: svg('<path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/>') },
    { id: 'ducky', label: 'Ducky', ico: ICON.duck },
    { id: 'settings', label: 'Settings', ico: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>') }
  ];
  var GLYPH = {
    main: '<path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/>',
    tendon: '<circle cx="12" cy="13.5" r="7"/><path d="M12 9.5v4l2.5 1.5M10 3h4"/>',
    plyo: '<path d="M12 20V6M6 11.5l6-6 6 6"/>',
    contrast: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
    push: '<path d="M4 16h16M7 16v-6M17 16v-6M8 10h8"/>',
    pull: '<path d="M4 5h16M8 5v6M16 5v6M12 9v10M9 16l3 3 3-3"/>',
    core: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/>',
    sprint: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
    drill: '<path d="M4 17c3-9 5-9 8 0s5 9 8 0"/>',
    mobility: '<path d="M3 12c3-6 6 6 9 0s6 6 9 0"/>',
    warmup: '<path d="M3 12c3-6 6 6 9 0s6 6 9 0"/>'
  };
  function thumb(ex) {
    var map = HA.THUMBS || {}, url = map[E.normName(ex.name)] || map[E.normName(AI.searchName(ex.name))];
    if (url) return '<span class="thumb thumb-img"><img src="' + esc(url) + '" alt="" width="46" height="46" loading="lazy" decoding="async"></span>';
    var cat = GLYPH[ex.cat] ? ex.cat : 'main';
    return '<span class="thumb t-' + cat + '">' + svg(GLYPH[cat], 'ico') + '</span>';
  }

  /* ----------------------------------------------------------------- helpers */
  function dow(iso) { return DOW[E.parseISO(iso).getDay()]; }
  function longDate(iso) { var d = E.parseISO(iso); return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
  function units(c) { return c.S.settings.units || 'kg'; }
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s : m + ':' + (s < 10 ? '0' : '') + s;
  }
  // Big Shoulders digits are proportional, so each character of a ticking clock gets a fixed-width cell.
  function clockHTML(str) {
    return String(str).replace(/./g, function (ch) { return /\d/.test(ch) ? '<span class="dg">' + ch + '</span>' : '<span class="cl">' + esc(ch) + '</span>'; });
  }
  function fmtMin(sec) { var m = Math.round(sec / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min'; }
  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function pct(p) { return Math.round(p * 1000) / 10 + '%'; }
  function belt(name) { return '<span class="belt belt-' + name + '" role="img" aria-label="' + BELT[name] + '"></span>'; }
  function header(title, sub) { return '<header class="page-head"><h1>' + esc(title) + '</h1>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</header>'; }
  function dayDone(S, wk) {
    var logged = S.logs.some(function (l) { return l.wid === wk.wid; });
    if (wk.items.length) return logged;
    return !!S.marks[wk.wid];
  }
  function effortNum(txt) {
    var m = /(\d+)\s*[-–%]+\s*(\d+)\s*%/.exec(txt || '');
    return m ? m[1] + '–' + m[2] + '%' : '';
  }
  function liftRM(c, key) { return key ? E.oneRMFor(c.S, key, c.today) : null; }
  function workingWeight(c, ex) {
    var rm = liftRM(c, ex.liftKey);
    return rm && ex.pct ? E.workingKg(ex.liftKey, rm.kg, ex.pct, c.S.settings) : null;
  }
  // how a working weight reads: pull-ups show the weight ADDED to bodyweight ("+5 kg", or "BW")
  function wTxt(c, key, kg) {
    var u = units(c);
    if (key === 'pullup') return kg > 0 ? '+' + E.fmtW(kg, u) + ' ' + u : 'BW';
    return E.fmtW(kg, u) + ' ' + u;
  }
  function totalNote(key) { return key === 'pullup' ? ' total' : ''; }
  function targetPh(ex) { return ex.lo != null && ex.hi != null && ex.lo !== ex.hi ? ex.lo + '-' + ex.hi : (ex.target != null ? String(ex.target) : ''); }

  /* --------------------------------------------------------------- day detail */
  function pRow(c, ex) {
    var meta = ex.mode === 'check' ? ex.label : ex.sets + ' × ' + ex.label;
    var w = '';
    if (ex.pct) {
      var kg = workingWeight(c, ex);
      w = kg != null ? wTxt(c, ex.liftKey, kg) : pct(ex.pct);
    }
    return '<li class="p-row"><span class="p-name">' + esc(ex.name) + (ex.note ? ' <em>' + esc(ex.note) + '</em>' : '') + '</span>' +
           (meta ? '<span class="p-meta">' + esc(meta) + '</span>' : '') + (w ? '<span class="p-w">' + esc(w) + '</span>' : '') + '</li>';
  }
  function previewList(c, wk) {
    var h = '<ul class="plist">';
    wk.items.forEach(function (it) {
      if (it.kind === 'section') h += '<li class="p-sec">' + esc(it.title) + '</li>';
      else if (it.kind === 'ex') h += pRow(c, it.ex);
      else {
        h += '<li class="p-group g-' + it.variant + '"><div class="p-ghead"><b>' + esc(it.label) + '</b><span>' + esc(it.sub) + ', ' + it.rounds + ' rounds</span></div><ul>' +
             it.exs.map(function (e) { return pRow(c, e); }).join('') + '</ul></li>';
      }
    });
    return h + '</ul>';
  }
  function paceSource(pr) {
    return (pr.src === 'runs' ? 'From your ' + (pr.n === 1 ? 'last run' : pr.n + ' recent runs') : 'From your race result') + (pr.assumedRest ? ', resting heart rate assumed 60' : '');
  }
  function paceLine(c) {
    var u = c.S.settings.paceUnit || 'km', pr = Z.paceRange(c.S, c.today);
    if (pr.ok) return '<p class="run-pace"><b>' + Z.paceText(pr, u) + '</b> target pace</p><small>' + paceSource(pr) + '. A guide: heat, hills and fatigue move it.</small>';
    if (pr.why === 'ref') return '<button class="link" data-act="goto-settings" data-focus="pace">Add a run or a race time to see your target pace</button>';
    return '';
  }
  function zoneCard(c, wk) {
    var z = E.zone2(c.S.settings), done = !!c.S.marks[wk.wid + ':am'];
    var h = '<div class="card run"><div class="run-main">';
    if (z) {
      h += '<div class="run-hr"><span class="run-num">' + z.lo + '<i>–</i>' + z.hi + '</span><span class="run-unit">bpm</span></div>' +
           '<div class="run-txt"><h3>Morning Zone 2 run</h3><p>' + esc(wk.am.minLo + '–' + wk.am.minHi) + ' min, easy and conversational. Fuel after.</p>' +
           '<small>' + (z.method === 'karvonen' ? 'Karvonen, ' + z.loPct + '–' + z.hiPct + '% of heart-rate reserve' : z.loPct + '–' + z.hiPct + '% of max heart rate') + ', max ' + z.mhr + '</small>' + paceLine(c) + '</div>';
    } else {
      h += '<div class="run-txt"><h3>Morning Zone 2 run</h3><p>' + esc(wk.am.text) + '</p>' +
           '<button class="link" data-act="goto-settings" data-focus="hr">Add your age to see your target heart rate</button></div>';
    }
    h += '</div><div class="run-tools"><button class="btn btn-ghost" data-act="live-open">' + ICON.pulse + 'Live heart rate</button><button class="btn btn-ghost" data-act="run-log">Log a run</button></div>' +
         '<button class="mark' + (done ? ' on' : '') + '" data-act="mark" data-key="' + wk.wid + ':am" aria-pressed="' + done + '">' + (done ? ICON.check + 'Run done' : 'Mark run done') + '</button></div>';
    return h;
  }
  function startBar(c, wk) {
    var a = c.S.active, label = wk.kind === 'recovery' ? 'Start routine' : wk.kind === 'speed' ? 'Start session' : 'Start workout';
    var data = ' data-w="' + wk.week + '" data-d="' + wk.day + '"';
    if (a && a.wid === wk.wid) return '<button class="btn btn-primary btn-block" data-act="wk-resume">' + ICON.play + 'Resume workout</button>';
    if (a) return '<button class="btn btn-primary btn-block" data-act="wk-resume">' + ICON.play + 'Resume current workout</button>' +
                  '<button class="btn btn-ghost btn-block" data-act="start" data-replace="1"' + data + '>Discard it and start this one</button>';
    return '<button class="btn btn-primary btn-block" data-act="start"' + data + '>' + ICON.play + label + '</button>';
  }
  function workoutCard(c, wk) {
    var sets = 0, n = 0, lifts = {};
    P.flatExs(wk).forEach(function (e) { if (e.mode !== 'check') { sets += e.sets; n++; } if (e.liftKey) lifts[e.liftKey] = 1; });
    var missing = Object.keys(lifts).filter(function (k) { return !liftRM(c, k); });
    var logs = c.S.logs.filter(function (l) { return l.wid === wk.wid; });
    var h = '<div class="card wcard"><div class="wcard-head"><h3>' + (wk.am ? 'Evening session' : 'Session') + '</h3><span>' + (n ? n + ' exercises, ' + sets + ' sets' : 'Checklist') + '</span></div>';
    if (wk.deload) h += '<p class="deload-note"><b>Deload week.</b> Weights drop to ' + pct(E.DELOAD_PCT) + ' of 1RM and volume is cut.</p>';
    if (missing.length) h += '<div class="hint"><span>Enter your 1RMs and weights fill in for you.</span><button class="link" data-act="goto-lifts">Set 1RMs</button></div>';
    h += previewList(c, wk);
    if (logs.length) {
      var l = logs[logs.length - 1], cnt = 0; l.entries.forEach(function (e) { cnt += e.sets.length; });
      h += '<p class="logged">' + ICON.check + 'Logged ' + longDate(l.date) + ', ' + cnt + ' sets' + (l.volumeKg ? ', ' + fmtInt(E.toDisp(l.volumeKg, units(c))) + ' ' + units(c) + ' lifted' : '') + '</p>';
    }
    return h + '<div class="wcard-go">' + startBar(c, wk) + '</div></div>';
  }
  function bjjCard(c, wk) {
    var done = !!c.S.marks[wk.wid], num = effortNum(wk.effort);
    return '<div class="card bjj">' +
      '<div class="bjj-effort">' + (num ? '<span class="bjj-num">' + num + '</span><span class="bjj-lab">effort</span>' : '') + '<p>' + esc(wk.effort) + '</p></div>' +
      '<p class="bjj-focus">' + esc(wk.focus) + '</p>' +
      '<button class="mark' + (done ? ' on' : '') + '" data-act="mark" data-key="' + wk.wid + '" aria-pressed="' + done + '">' + (done ? ICON.check + 'Trained' : 'Mark as trained') + '</button></div>';
  }
  function restCard(c, wk) {
    var done = !!c.S.marks[wk.wid];
    return '<div class="card restday"><h3>Full rest</h3><p>No training. Sleep, eat well, walk if you feel like it. This is when the work from the week turns into adaptation.</p>' +
           '<button class="mark' + (done ? ' on' : '') + '" data-act="mark" data-key="' + wk.wid + '" aria-pressed="' + done + '">' + (done ? ICON.check + 'Rested' : 'Mark as rested') + '</button></div>';
  }
  function gcalLine(g) {
    if (!g.tokenOk) return '<button class="link" data-act="gcal-sync">Google Calendar: tap to sign in and sync</button>';
    return g.pending ? '<button class="link" data-act="gcal-sync">' + g.pending + (g.pending === 1 ? ' change is' : ' changes are') + ' not in Google Calendar yet. Sync now</button>' : 'In step with Google Calendar.';
  }
  function sessionList(c, wk, iso) {
    var list = SC.dayList(c.S, wk.week, wk.day).filter(function (e) { return !e.allDay; });
    if (!list.length) return '';
    var g = c.gcal, h = '<ul class="sched" aria-label="Session times">';
    list.forEach(function (e) {
      h += '<li><span class="sc-time">' + e.start + '–' + SC.endTime(e) + '</span><span class="sc-name">' + esc(e.label) +
           (e.date !== iso ? '<small>Moved to ' + longDate(e.date) + '</small>' : '') + '</span>' +
           '<button class="link" data-act="move-open" data-uid="' + e.uid + '" aria-label="Change time: ' + esc(e.label) + '">Change</button></li>';
    });
    h += '</ul>';
    if (g && g.on) h += '<p class="sched-sync">' + gcalLine(g) + '</p>';
    else h += calLinks(c, list);
    return h;
  }
  // One-tap "add to Google Calendar" links: a plain web address, no sign-in, nothing that can fail inside the app.
  function calLinks(c, list) {
    return '<div class="cal-links">' + list.map(function (e) {
      var f = SC.oneEvent(c.S, e.uid, true, c.today) || e, d = f.desc ? String(f.desc) : '';
      if (d.length > 700) d = d.slice(0, 700) + '…';                  // keeps the address short enough for every browser
      var link = E.googleLink({ title: f.title, date: f.date, start: f.start, mins: f.mins, desc: d + (f.note ? '\n' + f.note : '') });
      return '<a class="link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Add ' + esc(String(e.label).toLowerCase()) + ' to Google Calendar</a>';
    }).join('') + '</div>';
  }
  function dayBody(c, wk, iso) {
    var h = '<section class="day"><div class="day-head"><h2 class="day-title">' + esc(wk.shortTitle) + '</h2><p class="day-date">' + longDate(iso) + ', day ' + wk.day + '</p></div>';
    h += sessionList(c, wk, iso);
    if (wk.am) h += zoneCard(c, wk);
    if (wk.kind === 'bjj') h += bjjCard(c, wk);
    else if (wk.kind === 'rest') h += restCard(c, wk);
    else h += workoutCard(c, wk);
    return h + '</section>';
  }

  /* ------------------------------------------------------------------- Today */
  function statusLine(c, pos) {
    var st = c.S.settings;
    if (pos.state === 'before') return 'Your program starts ' + longDate(st.startDate) + ', in ' + pos.daysUntil + (pos.daysUntil === 1 ? ' day.' : ' days.');
    if (pos.state === 'after') return 'You finished all 16 weeks.';
    return c.view.week === pos.week && c.view.day === pos.day ? 'Today is day ' + pos.day + '.' : 'You are looking at another day. Today is week ' + pos.week + ', day ' + pos.day + '.';
  }
  function hero(c, pos) {
    var wk = P.getWorkout(c.view.week, c.view.day), st = c.S.settings;
    var tag = wk.assumed ? '<span class="tag tag-warn">Assumed block, not in your spec</span>' : wk.derived ? '<span class="tag">Built from your Block ' + wk.block + ' rules</span>' : '';
    var onToday = pos.state === 'active' && pos.week === c.view.week && pos.day === c.view.day;
    return '<header class="hero">' +
      '<div class="hero-belt">' + belt(wk.belt) + '<span class="hero-block">Block ' + wk.block + ', ' + esc(wk.blockName) + '</span></div>' +
      '<div class="hero-row"><button class="icon-btn" data-act="wk-prev" aria-label="Previous week">' + ICON.left + '</button>' +
      '<h1 class="hero-week">Week <b>' + c.view.week + '</b><span>of 16</span></h1>' +
      '<button class="icon-btn" data-act="wk-next" aria-label="Next week">' + ICON.right + '</button></div>' +
      '<p class="hero-sub">' + esc(statusLine(c, pos)) + '</p>' +
      '<div class="hero-tags">' + (wk.deload ? '<span class="tag tag-deload">Deload week</span>' : '') + tag +
      (!onToday && pos.state === 'active' ? '<button class="link" data-act="goto-today">Back to today</button>' : '') + '</div></header>';
  }
  function weekStrip(c) {
    var st = c.S.settings, h = '<nav class="strip" aria-label="Days of the week">';
    for (var d = 1; d <= 7; d++) {
      var wk = P.getWorkout(c.view.week, d), iso = E.dateFor(st.startDate, c.view.week, d);
      var cls = 'ds k-' + wk.kind + (d === c.view.day ? ' sel' : '') + (iso === c.today ? ' today' : '');
      h += '<button class="' + cls + '" data-act="pick-day" data-d="' + d + '" aria-label="' + longDate(iso) + ', ' + KIND_NAME[wk.kind] + '"' + (d === c.view.day ? ' aria-current="true"' : '') + '>' +
           '<span class="ds-dow">' + dow(iso) + '</span><span class="ds-num">' + E.parseISO(iso).getDate() + '</span><i class="ds-bar"></i>' +
           (dayDone(c.S, wk) ? '<b class="ds-done">' + ICON.check + '</b>' : '') + '</button>';
    }
    return h + '</nav>';
  }
  function programBanner(c, pos) {
    if (pos.state === 'before') {
      return '<div class="card banner"><p>You can look at any day, or begin week 1 right now.</p><button class="btn btn-ghost" data-act="start-today">Start the program today</button></div>';
    }
    if (pos.state === 'after') {
      return '<div class="card banner"><p>The wave is done. Run it again with weights recalibrated from your logs.</p><button class="btn btn-primary" data-act="restart">Start a new wave</button></div>';
    }
    return '';
  }
  function today(c) {
    var st = c.S.settings, pos = E.position(st.startDate, c.today), wk = P.getWorkout(c.view.week, c.view.day);
    var iso = E.dateFor(st.startDate, c.view.week, c.view.day);
    return hero(c, pos) + weekStrip(c) + programBanner(c, pos) + dayBody(c, wk, iso);
  }

  /* ----------------------------------------------------------------- Program */
  function program(c) {
    var st = c.S.settings, pos = E.position(st.startDate, c.today);
    var h = header('Program', '16 weeks in four blocks. Belts mark the block.');
    h += '<ul class="legend">';
    ['strength', 'bjj', 'recovery', 'speed', 'rest'].forEach(function (k) { h += '<li class="k-' + k + '"><i></i>' + KIND_CODE[k] + ' ' + KIND_NAME[k] + '</li>'; });
    h += '</ul>';
    P.BLOCKS.forEach(function (b) {
      h += '<section class="blk"><header class="blk-head">' + belt(b.belt) + '<div><h2>' + esc(b.name) + '</h2><p>Weeks ' + b.from + '–' + (b.from + 3) + '. ' + esc(b.blurb) + '</p></div></header>';
      for (var w = b.from; w < b.from + 4; w++) {
        var cur = pos.state === 'active' && pos.week === w;
        h += '<div class="wrow' + (cur ? ' cur' : '') + '"><span class="wnum">W' + w + '</span><div class="wdays">';
        for (var d = 1; d <= 7; d++) {
          var wk = P.getWorkout(w, d), iso = E.dateFor(st.startDate, w, d);
          var cls = 'dc k-' + wk.kind + (dayDone(c.S, wk) ? ' done' : '') + (iso === c.today ? ' today' : '');
          h += '<button class="' + cls + '" data-act="open-day" data-w="' + w + '" data-d="' + d + '" aria-label="Week ' + w + ', day ' + d + ', ' + KIND_NAME[wk.kind] + '">' +
               (d === 3 && wk.kind === 'bjj' ? 'N' : KIND_CODE[wk.kind]) + '</button>';
        }
        h += '</div>' + (w - b.from === 3 ? '<span class="wtag">Deload</span>' : '') + '</div>';
      }
      h += '</section>';
    });
    return h;
  }
  function daySheet(c, w, d) {
    var wk = P.getWorkout(w, d), iso = E.dateFor(c.S.settings.startDate, w, d);
    return sheet('Week ' + w + ', day ' + d, dayBody(c, wk, iso));
  }

  /* ------------------------------------------------------------------- Lifts */
  function spark(pts) {
    if (pts.length < 2) return '';
    var W = 220, H = 44, p = 4, min = Infinity, max = -Infinity;
    pts.forEach(function (x) { if (x.e1rm < min) min = x.e1rm; if (x.e1rm > max) max = x.e1rm; });
    if (max === min) { max += 1; min -= 1; }
    var d = pts.map(function (x, i) {
      return (i ? 'L' : 'M') + (p + (W - 2 * p) * i / (pts.length - 1)).toFixed(1) + ' ' + (H - p - (H - 2 * p) * (x.e1rm - min) / (max - min)).toFixed(1);
    }).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Estimated 1RM trend"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  function projection(c, key) {
    var rm = liftRM(c, key), head = '', row = '';
    for (var w = 1; w <= 16; w++) {
      var ex = P.flatExs(P.getWorkout(w, 1)).concat(P.flatExs(P.getWorkout(w, 5))).filter(function (e) { return e.liftKey === key; })[0];
      var b = P.blockOf(w), cur = c.view.week === w;
      head += '<th class="bk-' + b.belt + (cur ? ' cur' : '') + '">W' + w + '</th>';
      var kg = rm && ex ? E.workingKg(key, rm.kg, ex.pct, c.S.settings) : null;
      var shown = kg == null ? pct(ex.pct) : key === 'pullup' ? (kg > 0 ? '+' + E.fmtW(kg, units(c)) : 'BW') : E.fmtW(kg, units(c));
      row += '<td class="' + (b.deload ? 'dl' : '') + (cur ? ' cur' : '') + '"><b>' + shown + '</b><small>' + ex.sets + '×' + ex.lo + '</small>' + (kg != null ? '<small>' + pct(ex.pct) + '</small>' : '') + '</td>';
    }
    return '<div class="proj"><table><thead><tr>' + head + '</tr></thead><tbody><tr>' + row + '</tr></tbody></table></div>';
  }
  function lifts(c) {
    var u = units(c), h = header('Lifts', 'Your 1RMs drive every working weight in the plan.'), bw = E.bodyKg(c.S.settings);
    E.LIFT_KEYS.forEach(function (k) {
      var rm = liftRM(c, k), pts = E.e1rmPoints(c.S, k), base = c.S.baselines[k];
      var src = !rm ? 'Not set yet' : rm.src === 'baseline' ? 'Entered by you, ' + longDate(rm.date) : rm.src === 'logged' ? 'Best of the last 4 weeks, ' + longDate(rm.date) : 'Last logged ' + longDate(rm.date);
      if (k === 'bss') src += (rm ? '. ' : ' ') + 'Weight held in total, reps per leg';
      if (k === 'pullup' && rm && bw) src += '. Bodyweight ' + E.fmtW(bw, u) + ' + ' + E.fmtW(Math.max(0, rm.kg - bw), u) + ' ' + u + ' added';
      h += '<article class="lift"><header class="lift-head"><div><h2>' + P.LIFT_LABEL[k] + '</h2><p>' + esc(src) + '</p></div>' +
           '<div class="lift-num">' + (rm ? '<b>' + E.fmtW(rm.kg, u) + '</b><small>' + u + totalNote(k) + ' 1RM</small>' : '<b class="dim">–</b>') + '</div></header>' +
           (k === 'pullup' && !bw ? '<div class="note-row"><p>Pull-up weights are bodyweight plus the weight you add, so Hybrid Athlete needs your bodyweight.</p><button class="link" data-act="goto-settings" data-focus="bw">Add bodyweight</button></div>' : '') +
           spark(pts) + projection(c, k) +
           '<div class="lift-act"><button class="btn btn-ghost" data-act="edit-1rm" data-key="' + k + '">' + (rm ? 'Edit 1RM' : 'Set 1RM') + '</button>' +
           (base && pts.length ? '<button class="link" data-act="clear-1rm" data-key="' + k + '">Use logged estimate</button>' : '') + '</div></article>';
    });
    h += '<section class="card calc"><h3>1RM calculator</h3><p class="muted">Epley: weight × (1 + reps ÷ 30). A single rep counts as the 1RM. For pull-ups, enter the weight you added (0 for bodyweight only); your bodyweight comes from Settings.</p>' +
         '<div class="calc-row"><label>Weight<input class="in" id="calc-w" type="text" inputmode="decimal" placeholder="' + u + '" autocomplete="off"></label>' +
         '<label>Reps<input class="in" id="calc-r" type="text" inputmode="numeric" placeholder="reps" autocomplete="off"></label></div>' +
         '<p class="calc-out" id="calc-out" aria-live="polite">Enter a weight and reps.</p>' +
         '<div class="calc-row"><label>Save as<select class="in" id="calc-k">' + E.LIFT_KEYS.map(function (k) { return '<option value="' + k + '">' + P.LIFT_LABEL[k] + '</option>'; }).join('') + '</select></label>' +
         '<button class="btn btn-ghost" data-act="calc-save">Use as 1RM</button></div></section>';
    h += '<section class="hist"><h2>Recent sessions</h2>';
    var recent = c.S.logs.slice(-8).reverse();
    if (!recent.length) h += '<p class="muted empty">Nothing logged yet. Finish a workout and it shows up here.</p>';
    recent.forEach(function (l) {
      var cnt = 0; l.entries.forEach(function (e) { cnt += e.sets.length; });
      h += '<div class="hrow"><div><b>' + esc(l.title) + '</b><span>' + longDate(l.date) + ', week ' + l.week + ', ' + cnt + ' sets' + (l.volumeKg ? ', ' + fmtInt(E.toDisp(l.volumeKg, u)) + ' ' + u : '') + '</span></div>' +
           '<button class="icon-btn" data-act="del-log" data-id="' + esc(l.id) + '" aria-label="Delete this session">' + ICON.x + '</button></div>';
    });
    return h + '</section>';
  }

  /* ------------------------------------------------------------------- Ducky */
  function ducky(c) {
    var h = header('Ducky', 'Your coach. It only speaks when you ask.');
    if (!c.hasKey) {
      h += '<div class="card banner"><p>Ducky runs on your own Google Gemini API key. It is stored only on this device.</p><button class="btn btn-primary" data-act="goto-settings" data-focus="key">Add API key</button></div>';
    }
    h += '<div class="chat" id="chat" aria-live="polite">';
    if (!c.S.chat.length) {
      h += '<div class="chat-empty">' + ICON.duck + '<p>Ask about today’s session, a movement, or how to adjust when something is off.</p></div>';
    }
    c.S.chat.forEach(function (m, i) {
      if (m.role === 'user') { h += '<div class="msg me"><p>' + esc(m.text).replace(/\n/g, '<br>') + '</p></div>'; return; }
      h += '<div class="msg duck"><span class="avatar">' + ICON.duck + '</span><div class="bubble">' + AI.md(m.text);
      if (m.yt) h += '<a class="yt" href="' + esc(m.yt.url) + '" target="_blank" rel="noopener noreferrer">' + ICON.play + 'Watch: ' + esc(m.yt.name) + '</a>';
      if (m.mods && m.mods.length) {
        h += '<div class="mods"><ul>' + m.mods.map(function (x) {
          var bits = [];
          if (x.skip) bits.push('skip'); if (x.sets) bits.push(x.sets + ' sets'); if (x.reps) bits.push(x.reps + ' reps'); if (x.weightFactor) bits.push(Math.round(x.weightFactor * 100) + '% weight');
          return '<li><b>' + esc(x.exercise) + '</b> ' + esc(bits.join(', ')) + '</li>';
        }).join('') + '</ul>' +
        (m.applied ? '<p class="applied">' + ICON.check + esc(m.applied) + '</p>' : '<button class="btn btn-primary" data-act="apply-mods" data-i="' + i + '">Apply to ' + (c.S.active ? 'this workout' : 'the day’s workout') + '</button>') + '</div>';
      }
      h += '</div></div>';
    });
    if (c.ui && c.ui.pending) h += '<div class="msg duck"><span class="avatar">' + ICON.duck + '</span><div class="bubble typing" aria-label="Ducky is typing"><i></i><i></i><i></i></div></div>';
    if (c.ui && c.ui.error) h += '<div class="msg err" role="alert"><p>' + esc(c.ui.error) + '</p></div>';
    h += '</div>';
    h += '<div class="chips"><button class="chip" data-act="duck-modify">Modify today’s workout</button><button class="chip" data-act="duck-how">How do I perform…</button>' +
         '<button class="chip" data-act="duck-ask" data-q="I’m very fatigued today. What should I change?">I’m fatigued</button>' +
         (c.S.chat.length ? '<button class="chip chip-quiet" data-act="duck-clear">Clear chat</button>' : '') + '</div>';
    h += '<form class="composer" data-form="ducky"><textarea id="duck-input" rows="1" placeholder="Ask Ducky" aria-label="Message Ducky" enterkeyhint="send"></textarea>' +
         '<button class="send" type="submit" aria-label="Send">' + ICON.send + '</button></form>';
    return h;
  }
  function modifySheet(c) {
    var opts = ['I’m tired and run down.', 'My legs are sore.', 'I only have 30 minutes.', 'My lower back feels off.', 'My shoulder is bothering me.'];
    return sheet('Modify today’s workout', '<p class="muted">Tell Ducky what is going on. It adjusts sets, reps and weights for this session only.</p><div class="chips wrap">' +
      opts.map(function (o) { return '<button class="chip" data-act="duck-mod-go" data-q="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div>' +
      '<label class="field"><span>Something else</span><input class="in" id="mod-text" type="text" placeholder="Describe how you feel" autocomplete="off"></label>' +
      '<button class="btn btn-primary btn-block" data-act="duck-mod-custom">Ask Ducky</button>');
  }
  function howSheet(c) {
    var names = P.allExerciseNames();
    return sheet('How do I perform…', '<label class="field"><span>Exercise</span><select class="in" id="how-sel">' +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn btn-primary btn-block" data-act="duck-how-go">Ask Ducky</button>' +
      '<p class="muted">You can also type it in the chat, like “How do I perform Zercher squats?”.</p>');
  }

  /* ---------------------------------------------------------------- Settings */
  function field(label, control, hint) { return '<label class="field"><span>' + label + '</span>' + control + (hint ? '<small>' + hint + '</small>' : '') + '</label>'; }
  function num(path, val, ph) { return '<input class="in" type="text" inputmode="decimal" autocomplete="off" data-set="' + path + '" data-type="num" value="' + (val == null ? '' : esc(val)) + '" placeholder="' + esc(ph || '') + '">'; }
  function inp(path, val, type) { return '<input class="in" type="' + type + '" data-set="' + path + '" data-type="str" value="' + esc(val || '') + '">'; }
  function sel(path, val, options) {
    return '<select class="in" data-set="' + path + '" data-type="str">' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }
  function tog(path, on, label, hint) {
    return '<label class="switch-row"><span><b>' + label + '</b>' + (hint ? '<small>' + hint + '</small>' : '') + '</span><span class="switch"><input type="checkbox" data-set="' + path + '" data-type="bool"' + (on ? ' checked' : '') + '><i></i></span></label>';
  }

  /* ------------------------------------------------ running pace, runs, Google */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClockTime(ms) { var d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function paceResult(c) {
    var u = c.S.settings.paceUnit || 'km', pr = Z.paceRange(c.S, c.today);
    if (pr.ok) return 'Zone 2 pace: <b>' + Z.paceText(pr, u) + '</b><small class="sm">' + esc(paceSource(pr)) + '.</small>';
    return pr.why === 'hr' ? 'Add your age or max heart rate above first.' : 'Log a run or add a race result to see your target pace.';
  }
  function runsList(c) {
    var u = c.S.settings.paceUnit || 'km', runs = c.S.runs.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }).slice(0, 6);
    if (!runs.length) return '';
    var h = '<ul class="runs" aria-label="Logged runs">';
    runs.forEach(function (r) {
      h += '<li><span><b>' + longDate(r.date) + '</b> ' + E.fmtNum(Math.round(Z.fromKm(r.km, u) * 100) / 100) + ' ' + u + ', ' + Z.fmtDuration(r.sec) + ', ' + Z.fmtPace(r.sec / r.km, u) + ' /' + u + (r.hr ? ', ' + r.hr + ' bpm' : '') + '</span>' +
           '<button class="icon-btn" data-act="run-del" data-id="' + esc(r.id) + '" aria-label="Delete this run">' + ICON.x + '</button></li>';
    });
    return h + '</ul>';
  }
  function paceSection(c) {
    var st = c.S.settings, u = st.paceUnit || 'km', race = st.race || {};
    return '<section class="set-sec" id="sec-pace"><h2>Running pace</h2>' +
      '<p class="muted">Your pace at a heart rate tells us your pace in Zone 2, so the target comes from your own runs. With no runs yet, a recent race result is used.</p>' +
      '<div class="two">' + field('Show pace as', sel('paceUnit', u, [['km', 'min per km'], ['mi', 'min per mile']])) + '<div></div></div>' +
      '<div class="two">' + field('Race distance (' + u + ')', num('raceDist', race.km ? E.fmtNum(Math.round(Z.fromKm(race.km, u) * 100) / 100) : '', u === 'mi' ? '3.1' : '5')) +
      field('Race time', '<input class="in" type="text" inputmode="numeric" autocomplete="off" data-set="raceTime" data-type="str" value="' + esc(race.sec ? Z.fmtDuration(race.sec) : '') + '" placeholder="25:00">', 'm:ss or h:mm:ss') + '</div>' +
      '<p class="result" id="pace-result">' + paceResult(c) + '</p>' + runsList(c) +
      '<button class="btn btn-ghost btn-block" data-act="run-log">Log a run</button>' +
      tog('hrCue', st.hrCue !== false, 'Heart-rate cues on live runs', 'A beep and buzz when you stay above or below Zone 2.') + '</section>';
  }
  function gcalStatus(c) {
    var g = c.gcal || {}, st = c.S.settings, s;
    if (g.busy) return 'Syncing' + (g.prog ? ': ' + esc(g.prog) : '…');
    if (!g.configured) s = 'Paste a client ID to begin.';
    else if (!g.on) s = 'Not connected.';
    else if (!g.tokenOk) s = 'Connected earlier. Tap Sync now to sign in again; Google sign-in lasts about an hour.';
    else s = 'Connected. ' + (g.pending ? g.pending + (g.pending === 1 ? ' change is' : ' changes are') + ' waiting to be sent.' : 'Everything is in step.');
    if (g.lastSync) s += ' Last sync ' + fmtClockTime(g.lastSync) + '.';
    if (g.msg && g.lastSync) s += ' ' + g.msg + '.';
    return esc(s) + (g.err ? '<span class="sm warn">' + esc(g.err) + '</span>' : '');
  }
  function gcalBlock(c) {
    var st = c.S.settings, g = c.gcal || {}, origin = c.origin && c.origin !== 'null' ? c.origin : 'https://YOURNAME.github.io';
    var h = '<h3 class="sub">Two-way sync</h3><p class="muted">Makes a calendar called “Hybrid Athlete Schedule” and keeps it in step with the app. Change a session’s time here and it changes there; drag it in Google Calendar and it changes here. The app can only see the calendar it made, nothing else of yours.</p>' +
      field('Google client ID', '<input class="in" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-set="gcalClientId" data-type="str" value="' + esc(st.gcalClientId || '') + '" placeholder="123456789-abc.apps.googleusercontent.com">', 'Free from Google Cloud. Steps below.') +
      '<p class="result" id="gcal-status" aria-live="polite">' + gcalStatus(c) + '</p><div class="btn-row">';
    if (!g.on) h += '<button class="btn btn-primary" data-act="gcal-connect"' + (g.configured ? '' : ' disabled') + '>Connect Google Calendar</button>';
    else h += '<button class="btn btn-primary" data-act="gcal-sync">Sync now</button><button class="btn btn-ghost" data-act="gcal-disconnect">Disconnect</button>';
    h += '</div>' + (g.on ? '<button class="link" data-act="gcal-force">Rebuild every event, including descriptions</button>' : '');
    h += '<details class="how"><summary>How to get a client ID (about 5 minutes, free)</summary><ol class="steps">' +
      '<li>Open console.cloud.google.com and create a project. Any name works.</li>' +
      '<li>Go to APIs &amp; Services, then Library. Search for Google Calendar API and press Enable.</li>' +
      '<li>Open the OAuth consent screen (in newer consoles: Google Auth Platform). Choose External, add an app name and your email, and add your own Google account under Test users.</li>' +
      '<li>Go to Credentials, then Create credentials, then OAuth client ID. Choose Web application.</li>' +
      '<li>Under Authorized JavaScript origins add <b>' + esc(origin) + '</b> (the address of this app, without the page name). Leave redirect URIs empty.</li>' +
      '<li>Copy the Client ID into the box above and press Connect.</li></ol>' +
      '<p class="muted">Google will warn that the app is not verified, because it is yours. Choose Advanced, then Continue. Sign-in lasts about an hour; after that, tap Sync now once.</p></details>';
    return h;
  }

  /* ------------------------------------------------------------ live heart rate */
  function gaugePos(bpm, z) { var min = z.lo - 30, max = z.hi + 30; return Math.max(0, Math.min(100, (bpm - min) / (max - min) * 100)); }
  function zoneWords(L) { return L.zone === 'in' ? 'In Zone 2' : L.zone === 'low' ? 'Below Zone 2: pick it up' : 'Above Zone 2: ease off'; }
  function liveState(L) {
    if (L.source === 'manual' && L.fresh) return L.z ? zoneWords(L) : 'Add your age in Settings to see your zone.';
    if (!L.supported) return 'Bluetooth is not available in this browser.';
    if (L.status === 'connecting') return 'Connecting…';
    if (L.status === 'lost') return 'Signal lost. Reconnecting…';
    if (L.status !== 'live') return 'No sensor connected.';
    if (!L.fresh) return 'Waiting for a heart-rate reading…';
    return L.z ? zoneWords(L) : 'Add your age in Settings to see your zone.';
  }

  function liveActions(L) {
    var h = '';
    if (!L.supported) h += '<p class="muted">Bluetooth heart-rate sensors work in Chrome or Edge on Android, Windows, Mac and Chromebook, on an https page. Safari and Firefox do not have it. On an iPhone, the free Bluefy browser does. You can still type your heart rate below.</p>';
    if (!L.supported) { /* no sensor buttons here */ }
    else if (L.status === 'connecting') h += '<button class="btn btn-primary btn-block" disabled>Connecting…</button>';
    else if (L.status === 'idle' || L.status === 'lost') h += '<button class="btn btn-primary btn-block" data-act="live-connect">' + (L.status === 'lost' ? 'Connect again' : 'Connect sensor') + '</button><button class="link" data-act="live-connect-all">Show all Bluetooth devices</button>';
    if (L.running) h += '<button class="btn ' + (L.status === 'live' ? 'btn-primary' : 'btn-ghost') + ' btn-block" data-act="live-stop">Stop and save run</button>';
    else if (L.status === 'live') h += '<button class="btn btn-primary btn-block" data-act="live-start">Start run</button><button class="btn btn-ghost btn-block" data-act="live-disconnect">Disconnect</button>';
    if (L.err) h += '<p class="result warn">' + esc(L.err) + '</p>';
    if (L.status !== 'live') h += manualBox(L);
    if (L.supported && !L.running) h += '<details class="how"><summary>Using a Garmin watch</summary><p class="muted">Turn on heart-rate broadcasting on the watch. On many models: hold MENU on the heart-rate widget, then Heart Rate Options, then Broadcast Heart Rate. The exact menu depends on the model, and some older models only broadcast over ANT+, which a browser cannot read. Then tap Connect sensor and pick the watch. If it is not listed, use Show all Bluetooth devices.</p></details>';
    return h;
  }
  // No sensor, or no Bluetooth in this browser: type the number from your watch or a pulse count and see the same colours.
  function manualBox(L) {
    return '<div class="lr-manual"><label class="field" for="lr-manual"><span>No sensor? Type your heart rate</span>' +
      '<small>From your watch, or count your pulse for 15 seconds and multiply by 4.</small></label>' +
      '<div class="btn-row"><input class="in" id="lr-manual" type="text" inputmode="numeric" autocomplete="off" placeholder="bpm" value="' + (L.source === 'manual' ? L.bpm : '') + '">' +
      '<button class="btn btn-primary" data-act="live-manual">Check</button></div></div>';
  }
  function liveBody(c, L) {
    var z = L.z, zn = L.fresh && z ? L.zone || 'none' : 'none', u = c.S.settings.paceUnit || 'km', pr = Z.paceRange(c.S, c.today);
    var h = '<div class="lr"><div class="lr-main zone-' + zn + '" id="lr-main"><div class="lr-bpm" id="lr-bpm" aria-hidden="true">' + (L.fresh ? L.bpm : '–') + '</div>' +
      '<div class="lr-unit">bpm</div><p class="lr-state" id="lr-state" role="status">' + esc(liveState(L)) + '</p></div>';
    if (z) {
      var lo = gaugePos(z.lo, z), hi = gaugePos(z.hi, z);
      h += '<div class="lr-gauge" aria-hidden="true"><i class="lr-band" style="left:' + lo.toFixed(1) + '%;width:' + (hi - lo).toFixed(1) + '%"></i>' +
           '<b class="lr-mark" id="lr-mark"' + (L.fresh ? ' style="left:' + gaugePos(L.bpm, z).toFixed(1) + '%"' : ' hidden') + '></b></div>' +
           '<p class="lr-target">Zone 2 <b>' + z.lo + '–' + z.hi + ' bpm</b> <span>' + (z.method === 'karvonen' ? 'Karvonen' : '% of max') + '</span></p>';
    } else h += '<p class="lr-target"><button class="link" data-act="goto-settings" data-focus="hr">Add your age to see your zone</button></p>';
    h += '<dl class="lr-stats"><div><dt>Time</dt><dd id="lr-time">' + fmtClock(L.elapsed || 0) + '</dd></div><div><dt>In zone</dt><dd id="lr-inzone">' + (L.inPct == null ? '–' : L.inPct + '%') + '</dd></div>' +
         '<div><dt>Target pace</dt><dd>' + (pr.ok ? Z.paceText(pr, u) : '–') + '</dd></div></dl>';
    return h + '<div class="lr-actions" id="lr-actions">' + liveActions(L) + '</div></div>';
  }
  function liveRun(c, L) {
    return '<header class="wk-head"><button class="icon-btn" data-act="live-close" aria-label="' + (L.running ? 'Hide (the run keeps going)' : 'Close') + '">' + ICON.x + '</button><h2 class="lr-title">Live heart rate</h2></header>' +
           '<div class="lr-wrap" id="lr-wrap">' + liveBody(c, L) + '</div>';
  }

  /* ----------------------------------------------------- sheets: move, log a run */
  function moveSheet(c, uid) {
    var ev = SC.oneEvent(c.S, uid, false, c.today), b = SC.baseEvent(c.S, uid, false);
    if (!ev || !b) return '';
    return sheet('Change time',
      '<p class="muted">' + esc(ev.title) + '</p>' +
      '<div class="two">' + field('Date', '<input class="in" id="mv-date" type="date" value="' + ev.date + '">') + field('Starts', '<input class="in" id="mv-time" type="time" value="' + ev.start + '">') + '</div>' +
      field('Length (min)', '<input class="in" id="mv-mins" type="text" inputmode="numeric" autocomplete="off" value="' + ev.mins + '">') +
      '<p class="muted">Program time: ' + longDate(b.date) + ', ' + b.start + '. ' + (c.gcal && c.gcal.on ? 'A change goes to Google Calendar as soon as you save.' : 'Connect Google Calendar in Settings to keep both in step.') + '</p>' +
      '<button class="btn btn-primary btn-block" data-act="move-save" data-uid="' + uid + '">Save</button>' +
      (ev.moved ? '<button class="btn btn-ghost btn-block" data-act="move-reset" data-uid="' + uid + '">Back to program time</button>' : ''));
  }
  function runSheet(c, p) {
    p = p || {}; var u = c.S.settings.paceUnit || 'km';
    return sheet('Log a run',
      (p.note ? '<p class="result">' + esc(p.note) + '</p>' : '') +
      '<div class="two">' + field('Date', '<input class="in" id="run-date" type="date" value="' + esc(p.date || c.today) + '">') +
      field('Time', '<input class="in" id="run-time" type="text" inputmode="numeric" autocomplete="off" placeholder="42:30" value="' + esc(p.time || '') + '">', 'm:ss or h:mm:ss') + '</div>' +
      '<div class="two">' + field('Distance (' + u + ')', '<input class="in" id="run-dist" type="text" inputmode="decimal" autocomplete="off" placeholder="' + (u === 'mi' ? '5.0' : '8.0') + '" value="' + esc(p.dist || '') + '">') +
      field('Average heart rate', '<input class="in" id="run-hr" type="text" inputmode="numeric" autocomplete="off" placeholder="bpm" value="' + esc(p.hr || '') + '">') + '</div>' +
      '<p class="muted">Steady runs of 15 minutes or more with an average heart rate tune your target pace.</p>' +
      '<label class="btn btn-ghost btn-block file">Import from Garmin Connect (.tcx or .gpx)<input type="file" accept=".tcx,.gpx,.xml,application/xml,text/xml" data-act-change="run-import"></label>' +
      '<p class="muted" id="run-import-note">In Garmin Connect on the web, open the activity, choose the gear icon, then Export to TCX or Export to GPX.</p>' +
      '<button class="btn btn-primary btn-block" data-act="run-save">Save run</button>');
  }
  function installSection(c) {
    var pw = c.pwa || { sw: 'unsupported' }, h = '<section class="set-sec" id="sec-install"><h2>Install and offline</h2>';
    if (pw.standalone) h += '<p class="result">You are using Hybrid Athlete as an installed app.</p>';
    else if (pw.canPrompt) h += '<p class="muted">Add Hybrid Athlete to your home screen so it opens like an app.</p><button class="btn btn-primary btn-block" data-act="pwa-install">Install app</button>';
    else if (pw.ios) h += '<p class="muted">Add it to your home screen from Safari:</p><ol class="steps"><li>Tap the Share button.</li><li>Choose Add to Home Screen.</li><li>Tap Add.</li></ol>';
    else h += '<p class="muted">Open your browser menu and choose Install app or Add to Home screen.</p>';
    if (pw.sw === 'unsupported') h += '<p class="muted">Installing and offline mode need this page to be served from an https:// address. This copy was opened from a file or an address that does not allow them.</p>';
    else if (pw.sw === 'active') h += '<p class="result">Offline mode is on. After the first visit the app opens without a connection, and a finished rest can notify you while the app is in the background.</p>';
    else if (pw.sw === 'checking') h += '<p class="muted">Checking offline mode…</p>';
    else {
      h += '<p class="muted">' + (pw.sw === 'error' ? 'Offline mode could not start' + (pw.err ? ' (' + esc(pw.err) + ')' : '') + '. ' : 'Offline mode is off. ') +
           'A browser only accepts a service worker as its own file, so it cannot live inside this page.' +
           (pw.swSource ? ' Save sw.js, put it in the same folder as this page on your host, and reload.' : '') + '</p>' +
           (pw.swSource ? '<button class="btn btn-ghost btn-block" data-act="sw-download">Download sw.js</button>' : '');
    }
    return h + '</section>';
  }
  function settings(c) {
    var st = c.S.settings, t = st.times, z = E.zone2(st), h = header('Settings');
    h += '<section class="set-sec"><h2>Training</h2>' +
      field('Program start (Day 1)', inp('startDate', st.startDate, 'date'), 'Week 1, day 1 begins on this date. Everything else follows from it.') +
      '<div class="two">' + field('Units', sel('units', st.units, [['kg', 'Kilograms'], ['lb', 'Pounds']])) +
      field('Plate step', num('increment', st.increment, st.units === 'lb' ? '5' : '2.5'), 'Weights round to this.') + '</div>' +
      field('Bodyweight (' + (st.units === 'lb' ? 'lb' : 'kg') + ')', num('bodyKg', st.bodyKg ? E.fmtW(st.bodyKg, st.units) : '', st.units === 'lb' ? 'e.g. 176' : 'e.g. 80'), 'Pull-up weights are bodyweight plus the weight you add.') +
      tog('autoRest', st.autoRest, 'Start rest timer automatically', 'Starts when you tick a set.') +
      tog('sound', st.sound, 'Sound', 'Short beeps. They never pause your music.') +
      tog('vibrate', st.vibrate, 'Vibration', 'Not available on iPhone.') +
      tog('notify', st.notify, 'Notification when rest ends', 'Works when the app is in the background.') +
      tog('wakeLock', st.wakeLock, 'Keep screen on during workouts', 'Most reliable way to keep the timer running between sets.') + '</section>';
    h += '<section class="set-sec" id="sec-hr"><h2>Zone 2 heart rate</h2>' +
      '<div class="two">' + field('Age', num('age', st.age, 'years')) + field('Resting heart rate', num('rhr', st.rhr, 'bpm'), 'Morning, before getting up.') + '</div>' +
      '<div class="two">' + field('Max heart rate', num('mhr', st.mhr, 'auto'), 'Leave empty to calculate it.') +
      field('Formula', sel('mhrFormula', st.mhrFormula, [['classic', '220 minus age'], ['tanaka', '208 minus 0.7 × age']])) + '</div>' +
      field('Method', sel('hrMethod', st.hrMethod, [['karvonen', 'Karvonen (heart-rate reserve)'], ['mhr', 'Percent of max heart rate']]), 'Karvonen needs a resting heart rate.') +
      '<div class="two">' + field('Zone starts at %', num('zoneLo', st.zoneLo, '60')) + field('Zone ends at %', num('zoneHi', st.zoneHi, '70')) + '</div>' +
      '<p class="result">' + (z ? 'Target on run days: <b>' + z.lo + '–' + z.hi + ' bpm</b>' : 'Add your age to see your target range.') + '</p></section>';
    h += paceSection(c);
    var noSync = !!(c.gcal && c.gcal.off);
    h += '<section class="set-sec" id="sec-gcal"><h2>' + (noSync ? 'Calendar' : 'Google Calendar') + '</h2>' + (noSync ? '' : gcalBlock(c)) +
      '<h3 class="sub">Default session times</h3><p class="muted">Used for every week, with a reminder 30 minutes before. You can still change a single session from the Today screen.</p>' +
      '<div class="two">' + field('Morning run', inp('times.am', t.am, 'time')) + field('Run length (min)', num('times.amDur', t.amDur, '45')) + '</div>' +
      '<div class="two">' + field('Lifting', inp('times.pm', t.pm, 'time')) + field('Lifting length (min)', num('times.pmDur', t.pmDur, '90')) + '</div>' +
      '<div class="two">' + field('BJJ starts', inp('times.bjjStart', t.bjjStart, 'time')) + field('BJJ ends', inp('times.bjjEnd', t.bjjEnd, 'time')) + '</div>' +
      '<div class="two">' + field('Recovery day', inp('times.recovery', t.recovery, 'time')) + field('Length (min)', num('times.recDur', t.recDur, '60')) + '</div>' +
      '<div class="two">' + field('Sprint day', inp('times.sprint', t.sprint, 'time')) + field('Length (min)', num('times.sprDur', t.sprDur, '75')) + '</div>' +
      tog('includeRest', st.includeRest, 'Add rest days', 'All-day entries on day 7.') +
      '<h3 class="sub">' + (noSync ? 'Export to your calendar' : 'Or use a file') + '</h3><p class="muted">Exports all 16 weeks, dated from your start date. Importing the file again updates the same events instead of duplicating them. Times you moved are included.' + (noSync ? ' For a single session, use its Add to Google Calendar link on the Today screen.' : '') + '</p>' +
      '<button class="btn ' + (noSync ? 'btn-primary' : 'btn-ghost') + ' btn-block" data-act="cal-download">Download calendar file (.ics)</button>' +
      '<a class="btn btn-ghost btn-block" href="https://calendar.google.com/calendar/u/0/r/settings/export" target="_blank" rel="noopener noreferrer">Open Google Calendar import page</a>' +
      '<ol class="steps"><li>Download the file.</li><li>On a computer, open Google Calendar, then Settings, then Import &amp; export.</li><li>Choose the file and pick the calendar to add it to.</li></ol></section>';
    h += '<section class="set-sec" id="sec-key"><h2>Ducky (Gemini)</h2><p class="muted">Your key stays in this browser’s storage and goes only to Google when you ask Ducky something. Get one in Google AI Studio.</p>' +
      field('API key', '<input class="in" type="password" id="key-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + (c.hasKey ? 'Saved on this device' : 'Paste your key') + '">') +
      field('Model', sel('geminiModel', st.geminiModel, AI.MODELS.map(function (m) { return [m, m]; }).concat(AI.MODELS.indexOf(st.geminiModel) < 0 ? [[st.geminiModel, st.geminiModel]] : []))) +
      '<div class="btn-row"><button class="btn btn-primary" data-act="key-save">Save key</button><button class="btn btn-ghost" data-act="key-test">Test</button>' +
      (c.hasKey ? '<button class="btn btn-ghost" data-act="key-clear">Remove</button>' : '') + '</div>' +
      '<p class="result" id="key-result" aria-live="polite"></p></section>';
    h += installSection(c);
    h += '<section class="set-sec"><h2>Your data</h2><p class="muted">Everything lives on this device. Back it up before clearing browser data or switching phones. Backups never include your API key.</p>' +
      '<div class="btn-row"><button class="btn btn-ghost" data-act="data-export">Export backup</button><label class="btn btn-ghost file">Import backup<input type="file" accept="application/json,.json" data-act-change="data-import"></label></div>' +
      '<button class="link danger" data-act="data-reset">Erase all data on this device</button>' +
      (c.persistent === false ? '<p class="result warn">This browser is blocking storage, so changes will be lost when you close the tab.</p>' : '') + '</section>';
    return h;
  }

  /* --------------------------------------------------------------- the sheet */
  function sheet(title, body) {
    return '<div class="sheet-bd" data-act="sheet-bg"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><div class="sheet-grab"></div>' +
           '<header class="sheet-head"><h2>' + esc(title) + '</h2><button class="icon-btn" data-act="sheet-close" aria-label="Close">' + ICON.x + '</button></header><div class="sheet-body">' + body + '</div></div>';
  }
  function oneRMSheet(c, key) {
    var rm = liftRM(c, key), u = units(c);
    var pull = key === 'pullup', bw = E.bodyKg(c.S.settings);
    return sheet(P.LIFT_LABEL[key] + ' 1RM',
      '<p class="muted">Your tested or best-estimate one-rep max. Weights in the plan are percentages of this, and your logged sets keep it up to date from here.' +
      (key === 'bss' ? ' For the split squat that is the total weight you hold for one rep on one leg.' : '') +
      (pull ? ' For pull-ups it is the total load: bodyweight plus added weight. ' + (bw ? 'Type the total, or type + and the weight you added, for example +30.' : 'Add your bodyweight in Settings first.') : '') + '</p>' +
      '<label class="field"><span>1RM' + (pull ? ' total load' : '') + ' (' + u + ')</span><input class="in in-big" id="rm-input" type="text" inputmode="' + (pull ? 'text' : 'decimal') + '" autocomplete="off" value="' + (rm ? E.fmtW(rm.kg, u) : '') + '" placeholder="' + (pull && bw ? E.fmtW(bw + 30 * (u === 'lb' ? 2.2 : 1), u) + ' or +' + (u === 'lb' ? 66 : 30) : u) + '"></label>' +
      '<button class="btn btn-primary btn-block" data-act="save-1rm" data-key="' + key + '">Save</button>');
  }
  function confirmSheet(title, text, act, label, data) {
    return sheet(title, '<p>' + esc(text) + '</p><div class="btn-row"><button class="btn btn-ghost" data-act="sheet-close">Cancel</button><button class="btn btn-danger" data-act="' + act + '"' + (data || '') + '>' + esc(label) + '</button></div>');
  }
  function finishSheet(c, left) {
    return sheet('Finish workout?', '<p>' + left + (left === 1 ? ' set is' : ' sets are') + ' not done. Unfinished sets are not saved.</p>' +
      '<div class="btn-row"><button class="btn btn-ghost" data-act="sheet-close">Keep training</button><button class="btn btn-primary" data-act="wk-finish-go">Finish and save</button></div>' +
      '<button class="link danger" data-act="wk-discard">Discard this workout</button>');
  }
  function summarySheet(c, r) {
    var u = units(c);
    var h = '<div class="stats"><div><b>' + fmtMin(r.durationSec) + '</b><span>Time</span></div><div><b>' + r.sets + '</b><span>Sets</span></div>' +
            '<div><b>' + (r.volumeKg ? fmtInt(E.toDisp(r.volumeKg, u)) : '–') + '</b><span>' + (r.volumeKg ? u + ' lifted' : 'Volume') + '</span></div></div>';
    var d = r.deltas.filter(function (x) { return x.after != null; });
    if (d.length) {
      h += '<ul class="deltas">' + d.map(function (x) {
        var diff = x.before != null ? x.after - x.before : null;
        var txt = x.before == null ? 'estimated 1RM ' + E.fmtW(x.after, u) + ' ' + u + totalNote(x.key) : E.fmtW(x.before, u) + ' to ' + E.fmtW(x.after, u) + ' ' + u + totalNote(x.key) + (Math.abs(diff) >= 0.05 ? ' (' + (diff > 0 ? '+' : '') + E.fmtNum(E.toDisp(diff, u)) + ')' : ', unchanged');
        return '<li><b>' + P.LIFT_LABEL[x.key] + '</b><span class="' + (diff > 0.05 ? 'up' : diff < -0.05 ? 'down' : '') + '">' + txt + '</span></li>';
      }).join('') + '</ul><p class="muted">Next week’s weights are set from these numbers.</p>';
    }
    return sheet('Workout saved', h + '<button class="btn btn-primary btn-block" data-act="sheet-close">Done</button>');
  }

  /* ----------------------------------------------------------- live workout */
  function exSub(c, ex, inGroup) {
    var bits = [];
    var n = Array.isArray(ex.sets) ? ex.sets.length : ex.sets;
    if (ex.mode !== 'check') bits.push(inGroup ? ex.label : n + ' × ' + ex.label);
    if (ex.pct) bits.push(pct(ex.pct) + ' of 1RM');             // the weight itself is on the line below (rmLine)
    return bits.join(', ');
  }
  // The weight on the set you are about to do (first unfinished set with a weight, else the last one), shown as a
  // share of the estimated 1RM. Re-run as you type, so the number follows the weight you enter.
  function rmLine(c, ex, si) {
    if (!ex.liftKey || ex.mode !== 'weightReps') return '';
    var u = units(c), key = ex.liftKey, rm = ex.oneRM, bw = E.bodyKg(c.S.settings);
    if (key === 'pullup' && !bw) return 'Add your bodyweight in Settings to see pull-up percentages.';
    if (!rm) return 'Set your ' + P.LIFT_LABEL[key] + ' 1RM on the Lifts tab to see percentages.';
    var set = si != null ? ex.sets[si] : null, i;       // si: the set being edited right now
    for (i = 0; i < ex.sets.length && !set; i++) if (!ex.sets[i].done && ex.sets[i].w > 0) set = ex.sets[i];
    for (i = ex.sets.length - 1; i >= 0 && !set; i--) if (ex.sets[i].w > 0) set = ex.sets[i];
    var w = set ? +set.w : 0;
    if (key !== 'pullup' && !(w > 0)) return 'Estimated 1RM ' + E.fmtW(rm, u) + ' ' + u + '. Enter a weight to see its percentage.';
    var p = E.pctOfRM(key, w, rm, bw);
    var what = key === 'pullup' ? (w > 0 ? '+' + E.fmtW(w, u) + ' ' + u + ' added' : 'Bodyweight ' + E.fmtW(bw, u) + ' ' + u) : E.fmtW(w, u) + ' ' + u;
    return what + ' = ' + pct(p) + ' of estimated 1RM ' + E.fmtW(rm, u) + ' ' + u + totalNote(key);
  }
  function setRow(c, it, exi, ex, si, pend, prev) {
    var st = ex.sets[si], u = units(c), loc = ' data-it="' + it + '" data-ex="' + exi + '" data-set="' + si + '"';
    var pset = prev ? prev.sets[Math.min(si, prev.sets.length - 1)] : null;
    var now = pend && pend.it === it && pend.ex === exi && pend.set === si;
    var inField = function (f, val, ph, mode, label) {
      return '<input class="in in-' + f + '"' + loc + ' data-f="' + f + '" type="text" inputmode="' + mode + '" enterkeyhint="done" autocomplete="off" value="' + esc(val) + '" placeholder="' + esc(ph) + '" aria-label="' + label + ' for set ' + (si + 1) + '">';
    };
    var cells = '<span class="sn">' + (si + 1) + '</span>';
    if (ex.mode === 'check') cells += '<span class="prev tgt">' + esc(ex.label || 'Tick when done') + '</span>';
    else cells += '<span class="prev">' + esc(E.prevText(pset, ex, u)) + '</span>';
    if (ex.mode === 'weightReps') {
      cells += inField('w', st.w == null ? '' : E.fmtW(st.w, u), /pull|chin/i.test(ex.name) ? 'BW' : '–', 'decimal', 'Weight') +
               inField('r', st.r == null ? '' : st.r, targetPh(ex), 'numeric', 'Reps');
    } else if (ex.mode === 'reps' || ex.mode === 'hold') {
      cells += inField('r', st.r == null ? '' : st.r, targetPh(ex), 'numeric', ex.mode === 'hold' ? 'Seconds' : 'Reps');
    } else if (ex.mode === 'result') {
      cells += inField('r', st.r == null ? '' : st.r, 's', 'decimal', 'Time');
    }
    cells += '<button class="chk"' + loc + ' data-act="chk" aria-pressed="' + !!st.done + '" aria-label="' + (st.done ? 'Undo set ' : 'Complete set ') + (si + 1) + '">' + ICON.check + '</button>';
    return '<div class="srow m-' + ex.mode + (st.done ? ' done' : '') + (now ? ' now' : '') + '"' + loc + '>' + cells + '</div>';
  }
  function colHead(c, ex, inGroup) {
    var u = units(c);
    if (ex.mode === 'check') return '';
    var cols = { weightReps: ['Previous', u, 'Reps'], reps: ['Previous', 'Reps'], hold: ['Previous', 'Sec'], result: ['Previous', 'Time'], check: ['Target'] }[ex.mode];
    return '<div class="shead m-' + ex.mode + '"><span>' + (inGroup ? 'Rd' : 'Set') + '</span>' + cols.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '<span></span></div>';
  }
  function exCard(c, it, exi, ex, pend, inGroup) {
    var loc = ' data-it="' + it + '" data-ex="' + exi + '"';
    if (ex.skipped) {
      return '<article class="ex skipped"' + loc + '><div class="ex-head">' + thumb(ex) + '<div class="ex-id"><h4>' + esc(ex.name) + '</h4><p>Skipped</p></div><button class="link" data-act="unskip"' + loc + '>Undo</button></div></article>';
    }
    var prev = ex.mode === 'check' ? null : E.prevSets(c.S, ex.name), h = '';
    h += '<article class="ex cat-' + esc(ex.cat) + '"' + loc + '><header class="ex-head">' + thumb(ex) +
         '<div class="ex-id"><h4>' + esc(ex.name) + '</h4><p>' + esc(exSub(c, ex, inGroup)) + '</p>' +
         (ex.liftKey && ex.mode === 'weightReps' ? '<p class="ex-rm" id="rm-' + it + '-' + exi + '">' + esc(rmLine(c, ex)) + '</p>' : '') + '</div>' +
         '<details class="more"><summary aria-label="More for ' + esc(ex.name) + '">' + ICON.dots + '</summary><div class="more-menu">' +
         '<a href="' + esc(AI.youtubeLink(ex.name)) + '" target="_blank" rel="noopener noreferrer">How to perform it</a>' +
         '<button data-act="ask-duck" data-name="' + esc(ex.name) + '">Ask Ducky</button>' +
         '<button data-act="skip-ex"' + loc + '>Skip this exercise</button></div></details></header>';
    var tags = '';
    if (ex.modified) tags += '<span class="tag tag-duck">Changed by Ducky</span>';
    if (ex.note) tags += '<span class="tag">' + esc(ex.note) + '</span>';
    if (ex.info) tags += '<p class="ex-info">' + esc(ex.info) + '</p>';
    if (tags) h += '<div class="ex-tags">' + tags + '</div>';
    h += '<div class="sets">' + colHead(c, ex, inGroup);
    for (var s = 0; s < ex.sets.length; s++) h += setRow(c, it, exi, ex, s, pend, prev);
    h += '</div>';
    if (!inGroup && ex.mode !== 'check') {
      h += '<div class="ex-act"><button class="btn btn-ghost btn-sm" data-act="add-set"' + loc + '>' + ICON.plus + 'Add set</button>' +
           '<button class="btn btn-quiet btn-sm" data-act="rm-set"' + loc + '>' + ICON.minus + 'Remove set</button></div>';
    }
    return h + '</article>';
  }
  function workoutBody(c) {
    var ses = c.S.active, pend = SS.nextPending(ses), h = '';
    ses.items.forEach(function (it, i) {
      if (it.kind === 'section') { h += '<h3 class="wk-sec">' + esc(it.title) + '</h3>'; return; }
      if (it.kind === 'ex') { h += exCard(c, i, 0, it.ex, pend, false); return; }
      var rounds = 0; it.exs.forEach(function (e) { if (!e.skipped && e.sets.length > rounds) rounds = e.sets.length; });
      var live = it.exs.filter(function (e) { return !e.skipped; });
      var finished = live.every(function (e) { return e.sets.every(function (st) { return st.done; }); });
      var chip = finished ? 'Done' : pend && pend.it === i ? 'Round ' + (pend.set + 1) + ' of ' + rounds : rounds + (rounds === 1 ? ' round' : ' rounds');
      h += '<section class="group g-' + it.variant + '" data-it="' + i + '"><header class="group-head"><div><h3>' + esc(it.label) + '</h3><p>' + esc(it.sub) + '</p></div><span class="round-chip">' + chip + '</span></header>' +
           it.exs.map(function (e, k) { return exCard(c, i, k, e, pend, true); }).join('') +
           '<div class="ex-act"><button class="btn btn-ghost btn-sm" data-act="add-round" data-it="' + i + '">' + ICON.plus + 'Add round</button>' +
           '<button class="btn btn-quiet btn-sm" data-act="rm-round" data-it="' + i + '">' + ICON.minus + 'Remove round</button></div></section>';
    });
    return h;
  }
  function workout(c) {
    var ses = c.S.active, pr = SS.progress(ses), w = pr.total ? Math.round(100 * pr.done / pr.total) : 0;
    return '<header class="wk-head"><button class="icon-btn" data-act="wk-min" aria-label="Minimise workout">' + ICON.down + '</button>' +
      '<div class="wk-title"><b>' + esc(ses.title) + '</b><span>Week ' + ses.week + ', day ' + ses.day + (ses.deload ? ', deload' : '') + '</span></div>' +
      '<span class="wk-clock" id="elapsed" role="timer" aria-label="Workout time">' + clockHTML(fmtClock((Date.now() - ses.startedAt) / 1000)) + '</span>' +
      '<button class="btn btn-primary btn-sm" data-act="wk-finish">Finish</button></header>' +
      '<div class="wk-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + w + '"><i id="wk-fill" style="width:' + w + '%"></i></div>' +
      '<div class="wk-body" id="wk-body">' + workoutBody(c) + '</div>' +
      '<div class="restbar" id="restbar" hidden><div class="rest-track"><i id="rest-fill"></i></div><div class="rest-row">' +
      '<div class="rest-clock" id="rest-time" role="timer" aria-label="Rest remaining">' + clockHTML('0:00') + '</div><div class="rest-info"><span class="rest-lab" id="rest-lab">Rest</span><span class="rest-next" id="rest-next"></span></div>' +
      '<div class="rest-btns"><button data-act="rest-sub" aria-label="15 seconds less">−15</button><button data-act="rest-add" aria-label="15 seconds more">+15</button><button data-act="rest-skip">Skip</button></div></div></div>';
  }
  function resumePill(c) {
    var a = c.S.active;
    return a ? '<button class="pill" data-act="wk-resume">' + ICON.play + '<span>' + esc(a.title) + '</span><b id="pill-clock">' + clockHTML(fmtClock((Date.now() - a.startedAt) / 1000)) + '</b></button>' : '';
  }
  function nav(active) {
    return NAV.map(function (n) {
      return '<button class="nav-btn' + (n.id === active ? ' on' : '') + '" data-act="tab" data-tab="' + n.id + '"' + (n.id === active ? ' aria-current="page"' : '') + '>' + n.ico + '<span>' + n.label + '</span></button>';
    }).join('');
  }

  HA.views = {
    ICON: ICON, esc: esc, fmtClock: fmtClock, clockHTML: clockHTML, longDate: longDate,
    today: today, program: program, lifts: lifts, ducky: ducky, settings: settings, nav: nav, resumePill: resumePill,
    rmLine: rmLine, sheet: sheet, daySheet: daySheet, oneRMSheet: oneRMSheet, confirmSheet: confirmSheet, finishSheet: finishSheet, summarySheet: summarySheet,
    modifySheet: modifySheet, howSheet: howSheet, workout: workout, workoutBody: workoutBody,
    moveSheet: moveSheet, runSheet: runSheet, liveRun: liveRun, liveBody: liveBody, liveActions: liveActions, liveState: liveState, gaugePos: gaugePos, paceResult: paceResult, gcalStatus: gcalStatus
  };
})(typeof window !== 'undefined' ? window : globalThis);
