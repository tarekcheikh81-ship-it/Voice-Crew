/* Connects the Voice Crew screen to your own server and to this device's voice.
   The screen was built for a sandbox that offers three things: asking the team, speaking, and listening.
   Here they are provided by /api/sample (your agents) and the browser's own speech features. */
(function () {
  'use strict';
  var KEYNAME = 'crew-key';

  /* ---------- passcode ---------- */
  function getKey() { try { return localStorage.getItem(KEYNAME) || ''; } catch (e) { return ''; } }
  function askKey() {
    if (document.getElementById('crew-gate')) return;
    var d = document.createElement('div');
    d.id = 'crew-gate';
    d.style.cssText = 'position:fixed;inset:0;z-index:99;display:grid;place-items:center;background:rgba(2,6,14,.94);padding:16px';
    d.innerHTML = '<form style="width:min(360px,100%);display:grid;gap:12px;padding:18px;border:1px solid #27406A;background:#0A1220;color:#D8E6F7;font:14px/1.4 system-ui,sans-serif">' +
      '<b style="font-size:16px;letter-spacing:.12em;text-transform:uppercase">Team passcode</b>' +
      '<span style="color:#8196B3">Enter the passcode you set for your team server.</span>' +
      '<input type="password" autocomplete="current-password" aria-label="Passcode" style="padding:12px;border:1px solid #27406A;border-radius:2px;background:#040810;color:#D8E6F7;font-size:16px">' +
      '<button style="padding:12px;border:1px solid #27E0F5;border-radius:2px;background:#27E0F5;color:#021117;font-weight:600;font-size:15px">Continue</button></form>';
    document.body.appendChild(d);
    var f = d.querySelector('form'), i = d.querySelector('input');
    i.focus();
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      try { localStorage.setItem(KEYNAME, i.value.trim()); } catch (x) {}
      location.reload();
    });
  }

  /* ---------- asking the team ---------- */
  function flatten(input) {
    if (typeof input === 'string') return input;
    if (Array.isArray(input)) return input.map(function (m) { return m && m.content ? m.content : ''; }).join('\n\n');
    return String(input || '');
  }
  function post(path, body, signal) {
    return fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-crew-key': getKey() },
      body: JSON.stringify(body),
      signal: signal
    }).then(function (r) {
      if (r.status === 401) { askKey(); throw { code: 'session_expired' }; }
      if (r.status === 429) throw { code: 'rate_limited' };
      if (!r.ok) throw { code: 'upstream_error' };
      return r.json();
    }, function (e) {
      if (e && e.name === 'AbortError') throw { code: 'cancelled' };
      throw { code: 'upstream_error' };
    });
  }
  /* while the team works, ask the server what each teammate is doing and hand it to the screen's
     "Now working" panel */
  var inflight = 0, pollT = 0;
  function poll() {
    if (typeof window.crewProgress !== 'function') return;
    fetch('/api/progress', { headers: { 'x-crew-key': getKey() } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.agents) return;
      Object.keys(d.agents).forEach(function (k) {
        var a = d.agents[k];
        if (a && a.state === 'working' && a.id) { try { window.crewProgress(a.id, { text: a.text, tool: a.tool, chars: a.chars }); } catch (e) {} }
      });
    }).catch(function () {});
  }
  function track(p) {
    inflight++;
    if (!pollT) pollT = setInterval(poll, 1200);
    var done = function () { inflight = Math.max(0, inflight - 1); if (!inflight && pollT) { clearInterval(pollT); pollT = 0; } };
    p.then(done, done);
    return p;
  }
  /* the server says when something was held back because the owner has not granted access yet */
  function noteNeeds(d) {
    if (d && d.needs && d.needs.length && typeof window.crewNeeds === 'function') { try { window.crewNeeds(d.needs); } catch (e) {} }
  }
  function sample(input, opts) {
    opts = opts || {};
    return track(post('/api/sample', { prompt: flatten(input) }, opts.signal).then(function (d) {
      noteNeeds(d);
      if (opts.onText) { try { opts.onText({ text: d.text, delta: d.text }); } catch (e) {} }
      return { text: d.text || '', truncated: false };
    }));
  }
  sample.json = function (input, opts) {
    opts = opts || {};
    return track(post('/api/sample', { prompt: flatten(input), json_mode: true }, opts.signal).then(function (d) {
      noteNeeds(d);
      if (d.json == null) throw { code: 'invalid_json' };
      return d.json;
    }));
  };
  sample.limits = function () { return Promise.resolve({ images: false }); };

  /* what the owner has allowed, and the server's own record of what the team did */
  function api(path, method, body) {
    return fetch(path, {
      method: method || 'GET',
      headers: { 'content-type': 'application/json', 'x-crew-key': getKey() },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401) { askKey(); throw { code: 'session_expired' }; }
      if (!r.ok) throw { code: 'upstream_error' };
      return r.json();
    });
  }
  window.crewApi = {
    grants: function () { return api('/api/grants'); },
    setGrant: function (id, on) { return api('/api/grants', 'POST', { id: id, granted: !!on }); },
    activity: function (n) { return api('/api/activity?limit=' + (n || 80)); }
  };

  /* ---------- speaking ---------- */
  var synth = window.speechSynthesis;
  var dictActive = function () { return false; };
  var tts = null;
  /* who is who: gender decides the voice pool, the number picks a different voice in it */
  var PERSON = {
    lead:      { g: 'm', i: 0, pitch: 0.94 },
    Architect: { g: 'f', i: 0, pitch: 1.06 },
    Frontend:  { g: 'm', i: 1, pitch: 1.02 },
    Backend:   { g: 'm', i: 2, pitch: 0.88 },
    Tester:    { g: 'f', i: 1, pitch: 0.98 },
    Reviewer:  { g: 'm', i: 3, pitch: 0.96 },
    DevOps:    { g: 'f', i: 2, pitch: 1.1 },
    Assistant: { g: 'f', i: 3, pitch: 1.03 },  /* Freya: her own slot in the female voices */
    Sheets:    { g: 'f', i: 4, pitch: 0.97 }   /* Martina: and so does she */
  };
  var VOICE_OFFSET = { buttery: 0, airy: 1, glassy: 2, rounded: 3 };
  var FEM = /\b(samantha|zira|jenny|aria|susan|allison|ava|nicky|karen|kathy|victoria|joanna|emma|michelle|sara|salli|kendra|kimberly|ivy|female|fiona|moira|tessa|serena|amy)\b/i;
  var MAL = /\b(alex|aaron|fred|david|mark|guy|matthew|tom|daniel|eddy|reed|rocko|ryan|christopher|eric|john|james|joey|justin|male|arthur|oliver|gordon)\b/i;

  function pools() {
    var all = synth.getVoices() || [];
    var en = all.filter(function (v) { return /^en[-_]us/i.test(v.lang); });
    if (!en.length) en = all.filter(function (v) { return /^en/i.test(v.lang); });
    if (!en.length) en = all;
    var f = en.filter(function (v) { return FEM.test(v.name); });
    var m = en.filter(function (v) { return MAL.test(v.name) && !FEM.test(v.name); });
    var rest = en.filter(function (v) { return f.indexOf(v) < 0 && m.indexOf(v) < 0; });
    return {
      f: f.length ? f : (rest.length ? rest : en), m: m.length ? m : (rest.length ? rest : en),
      hasF: f.length > 0, hasM: m.length > 0
    };
  }
  function personOf(line) {
    var base = String(line.id || '').split('-')[0];
    return PERSON[base] || PERSON.lead;
  }

  if (synth && window.SpeechSynthesisUtterance) {
    var queue = [], cur = null, speaking = false, stateFns = [], lineFns = [];
    var emit = function (s, r) { stateFns.forEach(function (f) { try { f({ state: s, reason: r }); } catch (e) {} }); };
    var next = function () {
      if (cur) return;
      if (!queue.length) {
        if (speaking) { speaking = false; emit('idle', 'completed'); }
        return;
      }
      var it = queue.shift(); cur = it;
      var p = personOf(it.line), pl = pools(), pool = p.g === 'f' ? pl.f : pl.m;
      var off = VOICE_OFFSET[it.line.voice] || 0;
      var u = new SpeechSynthesisUtterance(it.line.text);
      if (pool.length) u.voice = pool[(p.i + off) % pool.length];
      u.lang = it.line.language || 'en-US';
      u.rate = Math.max(0.7, Math.min(1.5, it.line.rate || 1));
      var matched = p.g === 'f' ? pl.hasF : pl.hasM;
      u.pitch = Math.max(0.5, Math.min(1.6, p.pitch * (matched ? 1 : (p.g === 'f' ? 1.12 : 0.82))));
      u.onstart = function () {
        if (!speaking) { speaking = true; emit('speaking'); }
        lineFns.forEach(function (f) { try { f({ id: it.line.id, line: it.line }); } catch (e) {} });
      };
      u.onend = function () { if (it.dead) return; cur = null; if (it.last) it.res(); next(); };
      u.onerror = function (e) {
        if (it.dead) return;
        if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
        cur = null; if (it.last) it.res(); next();
      };
      try { synth.speak(u); } catch (e) { cur = null; if (it.last) it.rej({ code: 'upstream_error' }); next(); }
    };
    var add = function (lines) {
      if (dictActive()) return Promise.reject({ code: 'busy' });
      var arr = (Array.isArray(lines) ? lines : [lines]).filter(function (l) { return l && l.text; });
      if (!arr.length) return Promise.resolve();
      return new Promise(function (res, rej) {
        arr.forEach(function (l, i) { queue.push({ line: l, last: i === arr.length - 1, res: res, rej: rej }); });
        next();
      });
    };
    var stop = function (reason) {
      var pending = queue.slice(); if (cur) pending.push(cur);
      queue = []; cur = null;
      try { synth.cancel(); } catch (e) {}
      pending.forEach(function (it) { if (it.last) it.rej({ code: 'viewer_stopped' }); });
      if (speaking) { speaking = false; emit('idle', reason || 'viewer_stopped'); }
    };
    /* a long reading can be cut off by the browser (and phones pause it when the screen is off):
       keep it moving, and say the interrupted line again when the page is back */
    setInterval(function () {
      if (cur && synth.speaking && !synth.paused && /Chrome/.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent)) {
        try { synth.pause(); synth.resume(); } catch (e) {}   /* stops Chrome's voices from dropping out after ~15 seconds */
      }
    }, 10000);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      try { synth.resume(); } catch (e) {}
      if (cur && !synth.speaking && !synth.pending) {
        var old = cur; old.dead = true; cur = null;
        queue.unshift({ line: old.line, last: old.last, res: old.res, rej: old.rej });
        next();
      }
    });
    tts = {
      speak: function (lines) { stop('replaced'); return add(lines); },
      add: add,
      stop: function () { stop('viewer_stopped'); return Promise.resolve(); },
      setRate: function () {},
      pause: function () { try { synth.pause(); } catch (e) {} },
      resume: function () { try { synth.resume(); } catch (e) {} },
      onState: function (f) { stateFns.push(f); },
      onLine: function (f) { lineFns.push(f); },
      onPosition: function () {}
    };
  }

  /* ---------- listening ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var dict = null;
  if (SR) {
    var rec = null, active = false, stopping = false, reason = null, pf = [], ff = [], sf = [];
    var es = function (s, r) { sf.forEach(function (f) { try { f({ state: s, reason: r }); } catch (e) {} }); };
    var android = /Android/i.test(navigator.userAgent);
    dict = {
      /* start() must run straight from a tap or key press */
      start: function () {
        if (active) return Promise.resolve();
        try {
          rec = new SR();
          rec.lang = 'en-US';
          rec.continuous = !android;       /* phones end the session after each phrase; the page opens it again */
          rec.interimResults = true;
          rec.maxAlternatives = 1;
        } catch (e) { return Promise.reject({ code: 'unavailable' }); }
        stopping = false; reason = null; active = true;
        rec.onstart = function () { es('listening'); };
        rec.onresult = function (ev) {
          var interim = '';
          for (var i = ev.resultIndex; i < ev.results.length; i++) {
            var r = ev.results[i], t = r[0].transcript;
            if (r.isFinal) ff.forEach(function (f) { f({ text: t.trim() + ' ' }); }); else interim += t;
          }
          pf.forEach(function (f) { f({ text: interim }); });
        };
        rec.onerror = function (ev) {
          var c = ev && ev.error;
          if (c === 'not-allowed' || c === 'service-not-allowed') reason = 'not_granted';
          else if (c === 'audio-capture') reason = 'unavailable';
          else if (c === 'network') reason = 'upstream_error';
        };
        rec.onend = function () {
          active = false; rec = null;
          es('idle', reason || (stopping ? 'viewer_stopped' : 'stopped'));
        };
        es('starting');
        try { rec.start(); }
        catch (e) { active = false; rec = null; es('idle', 'upstream_error'); return Promise.reject({ code: 'no_gesture' }); }
        return Promise.resolve();
      },
      stop: function () {
        if (!rec) return Promise.resolve();
        stopping = true;
        return new Promise(function (res) {
          var r0 = rec, orig = r0.onend;
          r0.onend = function () { if (orig) orig.apply(this, arguments); res(); };
          try { r0.stop(); } catch (e) { res(); }
        });
      },
      active: function () { return active; },
      onPartial: function (f) { pf.push(f); },
      onFinal: function (f) { ff.push(f); },
      onState: function (f) { sf.push(f); }
    };
    dictActive = function () { return active; };
  }

  window.claude = {
    use: function (name) {
      if (name === 'sample') return Promise.resolve(sample);
      if (name === 'tts') return Promise.resolve(tts);
      if (name === 'dictation') return Promise.resolve(dict);
      return Promise.resolve(null);
    }
  };
})();
