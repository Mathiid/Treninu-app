/* zone2.js — Zone 2 running maths. Pure functions (no DOM, no Bluetooth), so every rule can be tested in Node.
     karvonen / zoneOf    target heart rate and which side of it a reading is on
     makeWatcher          turns a stream of readings into "too high / too low / back in zone" cues, with a grace period
     makeRecorder         time-weighted average heart rate and time in zone for a run
     paceRange            a Zone 2 pace range, from your own logged runs or from a race result
     parseHRM             the Bluetooth Heart Rate Measurement characteristic (0x2A37)
     parseRunFile         a Garmin Connect export (.tcx or .gpx) */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  var E = HA.engine;
  var KM_PER_MI = 1.609344;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ------------------------------------------------------------ heart-rate zones */
  // Karvonen: target = (max - rest) x intensity + rest
  function karvonen(hrMax, hrRest, pct) { return Math.round((hrMax - hrRest) * pct + hrRest); }
  // 'low' (below the zone), 'in', 'high' (above it); null when there is no usable reading or no zone.
  function zoneOf(bpm, z) {
    if (!z || !(bpm > 0)) return null;
    return bpm < z.lo ? 'low' : bpm > z.hi ? 'high' : 'in';
  }

  /* A cue is raised only when a reading has been outside the zone for `graceSec` (a brief spike is not worth a beep),
     then repeated every `repeatSec` while it stays out. Going back into the zone after a cue gives one "back" cue.
     "Too low" is silenced for the first `warmupSec`, because every run starts below the zone. */
  function makeWatcher(o) {
    o = o || {};
    var grace = (o.graceSec == null ? 10 : o.graceSec) * 1000, repeat = (o.repeatSec == null ? 30 : o.repeatSec) * 1000;
    var warm = (o.warmupSec == null ? 180 : o.warmupSec) * 1000;
    var cur = 'in', since = 0, lastCue = 0, alerted = false, t0 = 0;
    return {
      begin: function (ts) { t0 = ts; cur = 'in'; since = ts; alerted = false; lastCue = 0; },
      feed: function (bpm, ts, z) {
        var zn = zoneOf(bpm, z);
        if (!zn) return null;
        if (!t0) t0 = ts;
        if (zn !== cur) {
          var had = alerted;
          cur = zn; since = ts; alerted = false; lastCue = 0;
          return zn === 'in' && had ? { type: 'back' } : null;
        }
        if (zn === 'in') return null;
        if (zn === 'low' && ts - t0 < warm) return null;
        if (!alerted && ts - since >= grace) { alerted = true; lastCue = ts; return { type: zn }; }
        if (alerted && ts - lastCue >= repeat) { lastCue = ts; return { type: zn }; }
        return null;
      },
      zone: function () { return cur; }
    };
  }

  // Seconds in each zone, weighted by how long each reading stood (capped, so a gap in the signal is not counted).
  function makeRecorder() {
    var r;
    function reset() { r = { last: null, hrSum: 0, hrSec: 0, max: 0, inSec: 0, lowSec: 0, highSec: 0, n: 0 }; }
    reset();
    return {
      begin: function () { reset(); },
      feed: function (bpm, ts, z) {
        if (!(bpm > 0)) return;
        var dt = r.last != null ? Math.min((ts - r.last) / 1000, 10) : 0;
        r.last = ts; r.n++;
        if (r.max < bpm) r.max = bpm;
        if (dt <= 0) return;
        r.hrSum += bpm * dt; r.hrSec += dt;
        var zn = zoneOf(bpm, z);
        if (zn === 'in') r.inSec += dt; else if (zn === 'low') r.lowSec += dt; else if (zn === 'high') r.highSec += dt;
      },
      stats: function () {
        return { avgHr: r.hrSec ? Math.round(r.hrSum / r.hrSec) : null, maxHr: r.max || null, hrSec: Math.round(r.hrSec),
                 inSec: Math.round(r.inSec), lowSec: Math.round(r.lowSec), highSec: Math.round(r.highSec), samples: r.n };
      }
    };
  }

  /* ------------------------------------------------------------------ pace */
  function parseDuration(txt) {
    var t = String(txt == null ? '' : txt).trim().replace(',', '.');
    if (!t) return null;
    if (/^\d+(\.\d+)?$/.test(t)) { var min = parseFloat(t); return min > 0 ? Math.round(min * 60) : null; }   // a bare number is minutes
    var m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    var h = m[1] == null ? 0 : +m[1], mm = +m[2], ss = +m[3];
    if (ss > 59 || (m[1] != null && mm > 59)) return null;
    var sec = h * 3600 + mm * 60 + ss;
    return sec > 0 ? sec : null;
  }
  function fmtDuration(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }
  function fmtPace(secPerKm, unit) {
    var s = Math.round(unit === 'mi' ? secPerKm * KM_PER_MI : secPerKm);
    return Math.floor(s / 60) + ':' + pad(s % 60);
  }
  function paceText(range, unit) {
    return fmtPace(range.fast, unit) + '–' + fmtPace(range.slow, unit) + ' /' + (unit === 'mi' ? 'mi' : 'km');
  }
  function toKm(dist, unit) { return unit === 'mi' ? dist * KM_PER_MI : dist; }
  function fromKm(km, unit) { return unit === 'mi' ? km / KM_PER_MI : km; }

  // Daniels and Gilbert: oxygen cost of running at speed v (m/min), and the share of VO2max you can hold for t minutes.
  function vdot(km, sec) {
    var t = sec / 60, v = km * 1000 / t;
    var vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
    var pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
    return vo2 / pct;
  }
  function speedAtVO2(vo2) {                                  // m/min, solving 0.000104 v^2 + 0.182258 v - 4.60 = vo2
    var a = 0.000104, b = 0.182258, c = -4.60 - vo2;
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  }
  // Heart-rate reserve and VO2 reserve rise together, so a Karvonen fraction f is also the fraction of (VO2max - 3.5) in use.
  function racePace(vd, f) { return 60000 / speedAtVO2(3.5 + f * (vd - 3.5)); }      // seconds per km

  function median(a) {
    var s = a.slice().sort(function (x, y) { return x - y; }), n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }
  function restOf(st) { return +st.rhr > 0 ? +st.rhr : 60; }

  /* Pace is close to proportional to heart-rate reserve for steady aerobic running, so one run at a known heart rate
     predicts the pace at any other: pace(f) = pace(f0) x f0 / f. We take the median over your recent steady runs.
     With no usable runs, a recent race result sets the pace through the Daniels equations instead.
     Returns { ok:true, fast, slow, src:'runs'|'race', n, assumedRest } (seconds per km) or { ok:false, why:'hr'|'ref' }. */
  function paceRange(S, todayISO) {
    var st = S.settings, z = E.zone2(st);
    if (!z) return { ok: false, why: 'hr' };
    var rest = restOf(st), span = z.mhr - rest;
    var fLo = (z.lo - rest) / span, fHi = (z.hi - rest) / span;
    if (!(span >= 20) || !(fLo > 0.2) || !(fHi > fLo)) return { ok: false, why: 'hr' };
    var out = { ok: true, assumedRest: !(+st.rhr > 0), src: null, n: 0, fast: 0, slow: 0 };
    var since = todayISO ? E.addDaysISO(todayISO, -56) : '0000-00-00';
    var runs = (S.runs || []).filter(function (r) {
      var f0 = (r.hr - rest) / span;
      return r.km >= 1.5 && r.sec >= 900 && r.hr > 0 && f0 >= 0.4 && f0 <= 0.92 && r.date >= since;
    }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }).slice(0, 5);
    if (runs.length) {
      var slows = [], fasts = [];
      runs.forEach(function (r) {
        var f0 = (r.hr - rest) / span, p0 = r.sec / r.km;
        slows.push(p0 * f0 / fLo); fasts.push(p0 * f0 / fHi);
      });
      out.src = 'runs'; out.n = runs.length; out.slow = median(slows); out.fast = median(fasts);
    } else if (st.race && st.race.km > 0 && st.race.sec > 0) {
      var vd = vdot(st.race.km, st.race.sec);
      out.src = 'race'; out.n = 1; out.vdot = vd; out.slow = racePace(vd, fLo); out.fast = racePace(vd, fHi);
    } else return { ok: false, why: 'ref' };
    return out;
  }

  /* -------------------------------------------- Bluetooth Heart Rate Measurement */
  // dv: a DataView on the characteristic value. Heart Rate Service 0x180D, characteristic 0x2A37.
  function parseHRM(dv) {
    if (!dv || dv.byteLength < 2) return null;
    var f = dv.getUint8(0), i = 1, bpm;
    if (f & 1) { if (dv.byteLength < 3) return null; bpm = dv.getUint16(1, true); i = 3; } else { bpm = dv.getUint8(1); i = 2; }
    var supported = !!(f & 4), rr = [];
    if (f & 8) i += 2;                                          // energy expended
    if (f & 16) { while (i + 1 < dv.byteLength) { rr.push(Math.round(dv.getUint16(i, true) / 1024 * 1000)); i += 2; } }
    return { bpm: bpm, contact: supported ? !!(f & 2) : null, rr: rr };
  }

  /* ---------------------------------------------- Garmin Connect files (TCX, GPX) */
  function haversine(a, b) {
    var R = 6371000, rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function parseTCX(text) {
    var pts = [];
    String(text).replace(/<Trackpoint>([\s\S]*?)<\/Trackpoint>/g, function (_, b) {
      var t = /<Time>([^<]+)<\/Time>/.exec(b), d = /<DistanceMeters>([^<]+)<\/DistanceMeters>/.exec(b), h = /<HeartRateBpm[^>]*>\s*<Value>(\d+)<\/Value>/.exec(b);
      var ms = t ? Date.parse(t[1]) : NaN;
      if (!isNaN(ms)) pts.push({ t: ms, hr: h ? +h[1] : 0, dist: d ? parseFloat(d[1]) : null });
    });
    return pts;
  }
  function parseGPX(text) {
    var pts = [], prev = null, cum = 0;
    String(text).replace(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g, function (_, attrs, b) {
      var la = /lat="([^"]+)"/.exec(attrs), lo = /lon="([^"]+)"/.exec(attrs), t = /<time>([^<]+)<\/time>/.exec(b), h = /<(?:\w+:)?hr>(\d+)<\/(?:\w+:)?hr>/.exec(b);
      var ms = t ? Date.parse(t[1]) : NaN;
      if (isNaN(ms) || !la || !lo) return;
      var p = { lat: parseFloat(la[1]), lon: parseFloat(lo[1]) };
      if (prev) cum += haversine(prev, p);
      prev = p;
      pts.push({ t: ms, hr: h ? +h[1] : 0, dist: cum });
    });
    return pts;
  }
  /* Moving time (gaps over 30 s are pauses), distance, time-weighted heart rate, and time in the zone. */
  function summarizePoints(pts, z) {
    if (pts.length < 2) return null;
    var sec = 0, hrSum = 0, hrSec = 0, max = 0, inSec = 0, lowSec = 0, highSec = 0;
    for (var i = 1; i < pts.length; i++) {
      var dt = (pts[i].t - pts[i - 1].t) / 1000;
      if (dt <= 0 || dt > 30) continue;
      sec += dt;
      if (pts[i].hr > 0) {
        hrSum += pts[i].hr * dt; hrSec += dt; if (pts[i].hr > max) max = pts[i].hr;
        var zn = zoneOf(pts[i].hr, z);
        if (zn === 'in') inSec += dt; else if (zn === 'low') lowSec += dt; else if (zn === 'high') highSec += dt;
      }
    }
    var d0 = pts[0].dist, d1 = pts[pts.length - 1].dist;
    var km = d0 != null && d1 != null && d1 > d0 ? (d1 - d0) / 1000 : 0;
    if (!(sec > 0)) return null;
    return { date: E.isoDate(new Date(pts[0].t)), sec: Math.round(sec), km: Math.round(km * 100) / 100,
             avgHr: hrSec ? Math.round(hrSum / hrSec) : null, maxHr: max || null, inSec: Math.round(inSec), lowSec: Math.round(lowSec), highSec: Math.round(highSec), points: pts.length };
  }
  function parseRunFile(text, z) {
    var s = String(text), pts;
    if (/<TrainingCenterDatabase/i.test(s)) pts = parseTCX(s);
    else if (/<gpx[\s>]/i.test(s)) pts = parseGPX(s);
    else return null;
    return summarizePoints(pts, z);
  }

  HA.zone2 = {
    KM_PER_MI: KM_PER_MI, karvonen: karvonen, zoneOf: zoneOf, makeWatcher: makeWatcher, makeRecorder: makeRecorder,
    parseDuration: parseDuration, fmtDuration: fmtDuration, fmtPace: fmtPace, paceText: paceText, toKm: toKm, fromKm: fromKm,
    vdot: vdot, racePace: racePace, paceRange: paceRange, parseHRM: parseHRM, parseTCX: parseTCX, parseGPX: parseGPX,
    summarizePoints: summarizePoints, parseRunFile: parseRunFile
  };
})(typeof window !== 'undefined' ? window : globalThis);
