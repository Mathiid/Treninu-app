/* hr.js — live heart rate from a Bluetooth sensor (Web Bluetooth, Heart Rate Service 0x180D), and the run that uses it.
   Works with chest straps, optical armbands, and Garmin watches set to broadcast heart rate. Web Bluetooth exists in Chrome and Edge
   (Android, Windows, macOS, ChromeOS) and over https or localhost only; Safari and Firefox do not have it.
   A run is: readings -> time in zone (recorder) + cues when you drift out of the zone (watcher). */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  var Z = HA.zone2, T = HA.timer;

  var st = { status: 'idle', name: '', bpm: 0, ts: 0, contact: null, err: '', cue: '' };       // status: idle | connecting | live | lost
  var listeners = [], device = null, chr = null, retry = 0, want = false, run = null, retryTimer = null;

  function emit() { listeners.forEach(function (f) { try { f(st); } catch (e) { /* a listener must not stop the stream */ } }); }
  function supported() {
    return !!(root.navigator && root.navigator.bluetooth) && root.isSecureContext !== false;
  }
  function cfg() { try { return HA.store.get().settings; } catch (e) { return {}; } }

  function onValue(ev) {
    var m = Z.parseHRM(ev && ev.target && ev.target.value);
    if (!m) return;
    var now = Date.now();
    st.contact = m.contact;
    if (m.bpm > 0 && m.contact !== false) {
      st.bpm = m.bpm; st.ts = now;
      if (run) {
        run.rec.feed(m.bpm, now, run.z);
        var c = run.watch.feed(m.bpm, now, run.z);
        st.cue = run.watch.zone();
        if (c && cfg().hrCue !== false && T) T.cue(c.type);
      }
    } else st.bpm = 0;                                       // no skin contact, or the sensor sends 0
    emit();
  }
  async function attach() {
    var server = await device.gatt.connect();
    var svc = await server.getPrimaryService('heart_rate');
    chr = await svc.getCharacteristic('heart_rate_measurement');
    chr.addEventListener('characteristicvaluechanged', onValue);
    await chr.startNotifications();
    st.status = 'live'; st.err = ''; retry = 0; emit();
  }
  function onDrop() {
    chr = null;
    if (!want) { st.status = 'idle'; st.bpm = 0; emit(); return; }
    st.status = 'lost'; st.bpm = 0; emit();
    if (retry >= 6) { st.err = 'The sensor stopped answering. Check it is on and in range, then connect again.'; want = false; emit(); return; }
    retry++;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (!want || !device) return;
      attach().catch(function () { onDrop(); });
    }, Math.min(2000 * retry, 10000));
  }

  /* all: list every Bluetooth device, not only those that advertise a heart-rate service (some watches do not). */
  async function connect(all) {
    if (!supported()) { st.err = 'This browser cannot connect to Bluetooth sensors.'; emit(); throw new Error(st.err); }
    st.status = 'connecting'; st.err = ''; emit();
    try {
      device = await root.navigator.bluetooth.requestDevice(all ? { acceptAllDevices: true, optionalServices: ['heart_rate'] } : { filters: [{ services: ['heart_rate'] }] });
      st.name = device.name || 'Heart-rate sensor'; want = true; retry = 0;
      device.addEventListener('gattserverdisconnected', onDrop);
      await attach();
    } catch (e) {
      st.status = 'idle'; want = false;
      st.err = e && e.name === 'NotFoundError' ? (all ? 'No device was chosen.' : 'No heart-rate sensor was chosen. If your watch is not listed, try "Show all devices".')
             : e && e.name === 'SecurityError' ? 'Bluetooth is blocked for this page.'
             : e && /Service|GATT|heart_rate/i.test(String(e.message || '')) ? 'That device has no heart-rate data. Turn on heart-rate broadcast on a watch, or pick a chest strap.'
             : 'Could not connect: ' + String(e && e.message || e).slice(0, 100);
      emit(); throw e;
    }
  }
  function disconnect() {
    want = false;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    try { if (chr) chr.removeEventListener('characteristicvaluechanged', onValue); } catch (e) { /* ignore */ }
    try { if (device) { device.removeEventListener('gattserverdisconnected', onDrop); if (device.gatt && device.gatt.connected) device.gatt.disconnect(); } } catch (e) { /* ignore */ }
    chr = null; device = null; st.status = 'idle'; st.bpm = 0; st.cue = ''; emit();
  }

  /* ---------------------------------------------------------------- the run */
  function startRun(z, now) {
    now = now || Date.now();
    run = { t0: now, z: z, rec: Z.makeRecorder(), watch: Z.makeWatcher() };
    run.watch.begin(now); st.cue = '';
    if (T) { T.unlock(); T.keepAwake(true); }
    emit();
  }
  function running() { return !!run; }
  function elapsed(now) { return run ? Math.max(0, Math.round(((now || Date.now()) - run.t0) / 1000)) : 0; }
  // Ends the run and returns { sec, avgHr, maxHr, inSec, lowSec, highSec, ... }.
  function stopRun(now) {
    if (!run) return null;
    var out = run.rec.stats(); out.sec = elapsed(now);
    run = null; st.cue = '';
    if (T) T.keepAwake(false);
    emit();
    return out;
  }
  // A reading counts as live while it is recent; a watch that stops sending shows dashes after a few seconds.
  function fresh(now) { return st.status === 'live' && st.bpm > 0 && (now || Date.now()) - st.ts < 8000; }

  HA.hr = {
    supported: supported, connect: connect, disconnect: disconnect, startRun: startRun, stopRun: stopRun, running: running, elapsed: elapsed, fresh: fresh,
    stats: function () { return run ? run.rec.stats() : null; },
    state: function () { return st; }, on: function (fn) { listeners.push(fn); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
