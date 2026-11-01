/* gcal-off.js — stands in for gcal.js in the "safe" single-file build (the default of build-single.js).
   The safe edition has no Google sign-in and no two-way sync: nothing here loads a script from Google, signs in, or calls an API.
   Calendar export is the .ics file and the one-tap "Add to Google Calendar" links, which need no account and cannot fail the app.
   It answers the same questions the app asks of the real module (status, sync, connect, ...) with "off", so app.js needs no special cases. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  function create() {
    var off = new Error('Google sync is not part of this edition.');
    return {
      sync: function () { return Promise.resolve({ busy: false, pulled: 0, pushed: 0, conflicts: 0, removed: 0, errors: 0 }); },
      connect: function () { return Promise.reject(off); },
      disconnect: function () {}, forget: function () {}, preload: function () { return Promise.resolve(); },
      tokenOk: function () { return false; }, pending: function () { return 0; },
      status: function () { return { off: true, configured: false, on: false, tokenOk: false, calendarId: null, lastSync: 0, pending: 0, busy: false, msg: '', err: '', gis: false }; }
    };
  }
  HA.gcal = { off: true, SCOPE: '', API: '', GIS_URL: '', CAL_NAME: '', create: create, loadGIS: function () { return Promise.reject(new Error('off')); } };
})(typeof window !== 'undefined' ? window : globalThis);
