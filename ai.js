/* ai.js — Ducky, the on-demand coach, powered by the user's own Gemini API key.
   Ducky only speaks when asked. Its system prompt carries the exact 16-week program plus today's
   resolved workout, so "Modify today's workout" returns structured changes the app can apply. */
(function (root) {
  'use strict';
  var HA = root.HA = root.HA || {};
  var E = HA.engine, P = HA.program;

  var DEFAULT_MODEL = 'gemini-2.5-flash';
  var FALLBACKS = ['gemini-flash-latest', 'gemini-2.5-flash'];
  var ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* --------------------------------------------------------------- YouTube */
  // "Pallof Press (or DB Drag Plank)" -> "pallof press"; "Power Clean or High Pull" -> "power clean"
  function searchName(name) {
    return String(name).replace(/\(.*?\)/g, ' ').split(/\s+or\s+/i)[0].replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function youtubeLink(name) {
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent('how to do ' + searchName(name)).replace(/%20/g, '+');
  }
  // Pulls the exercise out of "How do I perform X?" (or any form/cue question that names a program exercise).
  function detectTutorial(text, names) {
    var t = String(text || '').trim(), q = E.normName(t), m, cand = null, best = null;
    m = /how\s+(?:do|should|can|to)(?:\s+(?:i|we|you))?\s+(?:perform|do|execute|properly\s+do)\s+(?:a\s+|an\s+|the\s+|my\s+)?(.+?)[\s?.!]*$/i.exec(t);
    if (m) cand = m[1].trim();
    (names || []).forEach(function (n) {
      var nn = E.normName(searchName(n));
      if (nn.length >= 5 && q.indexOf(nn) >= 0 && (!best || nn.length > E.normName(searchName(best)).length)) best = n;
    });
    if (cand) {
      var c = E.normName(cand), hit = null;
      (names || []).forEach(function (n) {
        var nn = E.normName(searchName(n));
        if (nn.length >= 4 && (c.indexOf(nn) >= 0 || nn.indexOf(c) >= 0) && (!hit || nn.length > E.normName(searchName(hit)).length)) hit = n;
      });
      return hit || (cand.length <= 60 ? cand : null);
    }
    if (best && /form|cue|technique|tutorial|how|teach|show/i.test(t)) return best;
    return null;
  }

  /* ------------------------------------------------------------ markdown-lite */
  function mdInline(s) {
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]*[^\s<).,;!?])/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return s;
  }
  function md(text) {
    var out = [], list = null, para = [];
    function flush() { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } }
    function close() { if (list) { out.push('</' + list + '>'); list = null; } }
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var m;
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
        flush(); if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
        out.push('<li>' + mdInline(m[1]) + '</li>');
      } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
        flush(); if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; }
        out.push('<li>' + mdInline(m[1]) + '</li>');
      } else if (/^\s*$/.test(line)) { flush(); close(); }
      else if ((m = /^#{1,4}\s+(.*)$/.exec(line))) { flush(); close(); out.push('<p><strong>' + mdInline(m[1]) + '</strong></p>'); }
      else { close(); para.push(mdInline(line)); }
    });
    flush(); close();
    return out.join('');
  }

  /* --------------------------------------------------- reply -> text + changes */
  function parseReply(text) {
    var mods = [], clean = String(text || ''), re = /```(?:json)?\s*([\s\S]*?)```/gi, m, cut = [];
    while ((m = re.exec(clean))) {
      try {
        var j = JSON.parse(m[1]);
        if (j && Array.isArray(j.modifications)) { mods = mods.concat(E.sanitizeMods(j)); cut.push(m[0]); }
      } catch (e) { /* not our block */ }
    }
    cut.forEach(function (c) { clean = clean.replace(c, ''); });
    return { text: clean.replace(/\n{3,}/g, '\n\n').trim(), mods: mods };
  }

  /* ----------------------------------------------------------- system prompt */
  function systemPrompt(S, view, todayISO) {
    var st = S.settings, units = st.units || 'kg';
    var wk = P.getWorkout(view.week, view.day);
    var oneRM = function (k) { var r = k ? E.oneRMFor(S, k, todayISO) : null; return r ? r.kg : null; };
    var opts = { oneRM: oneRM, settings: st };
    var bw = E.bodyKg(st);
    var lifts = E.LIFT_KEYS.map(function (k) {
      var r = oneRM(k);
      return P.LIFT_LABEL[k] + ': ' + (r ? E.fmtW(r, units) + ' ' + units + (k === 'pullup' ? ' total load' : '') + ' (estimated 1RM)' : 'unknown');
    }).join('; ') + (bw ? '; bodyweight ' + E.fmtW(bw, units) + ' ' + units : '');
    var z = E.zone2Text(st);
    var next = [];
    for (var i = 1; i <= 3; i++) {
      var idx = (view.week - 1) * 7 + (view.day - 1) + i;
      if (idx < E.TOTAL_DAYS) { var n = P.getWorkout(Math.floor(idx / 7) + 1, (idx % 7) + 1); next.push('Week ' + n.week + ' Day ' + n.day + ': ' + n.title); }
    }
    return [
      'You are Ducky, a calm, practical rubber-duck coach inside the "Hybrid Athlete Tracker" app. The athlete trains strength, power, sprinting, Zone 2 running and Brazilian jiu-jitsu.',
      '',
      'RULES',
      '- Answer only what the athlete asked. Never volunteer extra coaching, and never interrupt a workout. Keep replies short: plain sentences or a few bullets, usually under 150 words.',
      '- You know their exact program (JSON below). Weeks 13-16 are not in the JSON: they repeat Block 1 at recalibrated weights.',
      '- Weights are in ' + units + '. Intensities are percentages of the estimated 1RMs listed below.',
      '- Pull-ups are weighted: the 1RM and the percentage are about the total load (bodyweight plus added weight), and the weight in the plan is the ADDED weight. The Bulgarian split squat weight is the total weight held, with reps counted per leg.',
      '- If they are fatigued, sore or hurt, adapt volume and intensity conservatively. Sharp, worsening or lingering pain, numbness, or a possible serious injury: tell them to stop that movement and see a clinician. You are not a doctor.',
      '',
      'WHEN ASKED TO MODIFY A WORKOUT',
      '- Reply with 2-4 short bullets saying what you changed and why, then ONE fenced json block, exactly this shape and nothing after it:',
      '```json',
      '{"modifications":[{"exercise":"<exact name from TODAY\'S WORKOUT>","sets":2,"reps":6,"weightFactor":0.85,"skip":false,"note":"short reason"}]}',
      '```',
      '- Include only the fields you change. "sets" is the new total sets (for a superset it is the number of rounds). "weightFactor" is a multiplier from 0.5 to 1.0. "skip": true drops the exercise. Only list exercises that exist in TODAY\'S WORKOUT.',
      '',
      'WHEN ASKED HOW TO PERFORM AN EXERCISE',
      '- Give 4-6 concise cue bullets (setup, execution, common mistake), then this link on its own line: https://www.youtube.com/results?search_query=how+to+do+<exercise+name+with+plus+signs>',
      '',
      'ATHLETE',
      '- Today: ' + todayISO + '. Viewing Week ' + view.week + ', Day ' + view.day + ' (Block ' + wk.block + ': ' + wk.blockName + (wk.deload ? ', DELOAD week' : '') + (wk.assumed ? ', assumed block' : '') + ').',
      '- ' + lifts,
      z ? '- ' + z : '- Zone 2 heart rate not configured.',
      '',
      "TODAY'S WORKOUT (Week " + wk.week + ' Day ' + wk.day + ': ' + wk.title + ')',
      P.summarize(wk, opts).join('\n') || 'No exercises (rest or BJJ day).',
      '',
      'COMING UP',
      next.join('\n') || 'End of the program.',
      '',
      'FULL PROGRAM SPEC (JSON)',
      JSON.stringify(HA.SPEC)
    ].join('\n');
  }

  /* ------------------------------------------------------------------ calling */
  function AiError(kind, message) { var e = new Error(message); e.kind = kind; return e; }
  function friendly(status, msg) {
    msg = String(msg || '');
    if (status === 400 && /api key/i.test(msg)) return AiError('key', 'Gemini rejected the API key. Check it in Settings.');
    if (status === 401 || status === 403) return AiError('key', 'Gemini refused this key or request (' + status + '). Check the key and that the Generative Language API is enabled for it.' + (msg ? ' ' + msg : ''));
    if (status === 404) return AiError('model', 'Model not found. Pick another model in Settings. ' + msg);
    if (status === 429) return AiError('quota', 'Gemini rate limit or free-tier quota reached. Wait a minute and try again.');
    if (status >= 500) return AiError('server', 'Gemini is having trouble right now (' + status + '). Try again shortly.');
    return AiError('api', 'Gemini error ' + status + (msg ? ': ' + msg : ''));
  }
  function extract(data) {
    var c = data && data.candidates && data.candidates[0];
    var text = c && c.content && c.content.parts ? c.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
    if (text) return text;
    var block = data && data.promptFeedback && data.promptFeedback.blockReason;
    if (block) throw AiError('blocked', 'Gemini blocked that prompt (' + block + '). Try rephrasing.');
    throw AiError('empty', 'Gemini returned no text' + (c && c.finishReason ? ' (' + c.finishReason + ')' : '') + '. Try again.');
  }
  // chat: [{role:'user'|'duck', text}]  ->  Gemini contents, starting with a user turn
  function toHistory(chat, n) {
    var h = (chat || []).slice(-(n || 12)).map(function (m) { return { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }; });
    while (h.length && h[0].role !== 'user') h.shift();
    return h;
  }
  async function ask(o) {
    var f = o.fetchImpl || root.fetch;
    if (!o.key) throw AiError('key', 'Add your Gemini API key in Settings first.');
    var models = [o.model || DEFAULT_MODEL].concat(FALLBACKS).filter(function (m, i, a) { return m && a.indexOf(m) === i; });
    var body = JSON.stringify({
      systemInstruction: { parts: [{ text: o.system }] },
      contents: (o.history || []).concat([{ role: 'user', parts: [{ text: o.user }] }]),
      generationConfig: { temperature: 0.5, maxOutputTokens: 4096 }
    });
    var lastErr = null;
    for (var i = 0; i < models.length; i++) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var to = ctl ? setTimeout(function () { ctl.abort(); }, 45000) : null;
      var res;
      try {
        res = await f(ENDPOINT + encodeURIComponent(models[i]) + ':generateContent', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.key }, body: body, signal: ctl ? ctl.signal : undefined
        });
      } catch (e) {
        if (to) clearTimeout(to);
        throw AiError('network', e && e.name === 'AbortError' ? 'Gemini took too long to answer. Try again.' : 'Could not reach Gemini. Check your connection.');
      }
      if (to) clearTimeout(to);
      var data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (res.ok) return { text: extract(data), model: models[i] };
      lastErr = friendly(res.status, data && data.error && data.error.message || res.statusText);
      if (res.status !== 404) throw lastErr;                 // only a missing model is worth trying another model
    }
    throw lastErr;
  }

  HA.ai = {
    DEFAULT_MODEL: DEFAULT_MODEL, MODELS: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-flash-latest'],
    esc: esc, searchName: searchName, youtubeLink: youtubeLink, detectTutorial: detectTutorial, md: md, parseReply: parseReply,
    systemPrompt: systemPrompt, toHistory: toHistory, ask: ask, friendly: friendly
  };
})(typeof window !== 'undefined' ? window : globalThis);
