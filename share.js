/* =====================================================================================
 * UNCLASSIFIED // NOTIONAL — StrikeSim 2040 share/challenge links (CO-007 S2)
 * =====================================================================================
 * Serverless "beat my world" links: a finished operation's seed, configuration, and
 * committed order log ride a URL fragment so another machine can rebuild the exact
 * world (challenge) or re-run the exact operation (replay verification). No sockets:
 * the payload IS the transport, which is why this module is allowed in the offline
 * build (CO-007 candidate #2). Determinism is the anti-cheat — a claim is only a
 * claim until tools/replay-verify.js re-resolves it through the shipped engine.
 *
 * Payload spec v1 (CO-007 plan of record):
 *   #op=SS1<z|j>.<base64url>     z = deflate-raw, j = plain JSON fallback
 *   { v:1, kind:'challenge'|'replay', seed, variantId, fp, cfg:{turnLimit,redDiff,roeId},
 *     pm, callsign, ts, claim:{winner,turns,reason,lodgment,bss},
 *     turns:[{t, orders:[{k,tid,m,src,axis,tc}], f:[{q,p,h,o}]}] }
 *
 * INVARIANTS (CO-007): fail-silent on anything malformed (I-5); every behavior gated
 * on OnlineFlags 'share' (I-3); the pre-match player model rides `pm` because Red's
 * exploit policy depends on it (I-4); no unseeded randomness, no network, no console noise.
 * ===================================================================================== */
(function () {
  'use strict';

  var PREFIX_Z = 'SS1z.';
  var PREFIX_J = 'SS1j.';
  var HASH_KEY = 'op';
  var MAX_ENCODED = 16000;    // URL sanity ceiling (practical browser limits are higher)
  var MAX_JSON = 262144;      // decoded JSON ceiling — refuse anything bigger, silently
  var ORDER_KINDS = { strike: 1, harden: 1, repair: 1, feint: 1, decoy: 1 };

  function flagsOn() {
    return !!(window.OnlineFlags && typeof window.OnlineFlags.enabled === 'function' &&
      window.OnlineFlags.enabled('share'));
  }

  // ---- base64url over UTF-8 bytes (browser btoa/atob, Buffer fallback for the
  //      headless proof harness — same file, same code path, no forks) ----------------
  function bytesToB64u(bytes) {
    var b64;
    if (typeof btoa === 'function') {
      var s = '';
      for (var i = 0; i < bytes.length; i += 0x8000) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      b64 = btoa(s);
    } else if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(bytes).toString('base64');
    } else return null;
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uToBytes(s) {
    if (typeof s !== 'string' || /[^A-Za-z0-9_-]/.test(s)) return null;
    var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    try {
      if (typeof atob === 'function') {
        var bin = atob(b64), out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
      if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    } catch (e) { /* fail-silent */ }
    return null;
  }
  function utf8Encode(str) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(str);
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'utf8'));
    return null;
  }
  function utf8Decode(bytes) {
    if (typeof TextDecoder === 'function') return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8');
    return null;
  }

  // ---- deflate-raw via the streams API when the browser has it; 'j' otherwise -------
  function deflateRaw(bytes) {   // Promise<Uint8Array|null>
    if (typeof CompressionStream !== 'function' || typeof Response !== 'function') {
      return Promise.resolve(null);
    }
    try {
      var cs = new CompressionStream('deflate-raw');
      var stream = new Response(new Blob([bytes]).stream().pipeThrough(cs));
      return stream.arrayBuffer().then(function (buf) { return new Uint8Array(buf); })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function inflateRaw(bytes) {   // Promise<Uint8Array|null>
    if (typeof DecompressionStream !== 'function' || typeof Response !== 'function') {
      return Promise.resolve(null);
    }
    try {
      var ds = new DecompressionStream('deflate-raw');
      var stream = new Response(new Blob([bytes]).stream().pipeThrough(ds));
      return stream.arrayBuffer().then(function (buf) { return new Uint8Array(buf); })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  // ---- codec -------------------------------------------------------------------------
  /** Promise<string|null>. Prefers SS1z, falls back to SS1j; null when oversized. */
  function encodePayload(payload) {
    var json;
    try { json = JSON.stringify(payload); } catch (e) { return Promise.resolve(null); }
    if (!json || json.length > MAX_JSON) return Promise.resolve(null);
    var bytes = utf8Encode(json);
    if (!bytes) return Promise.resolve(null);
    return deflateRaw(bytes).then(function (deflated) {
      var out = null;
      if (deflated && deflated.length) {
        var z = bytesToB64u(deflated);
        if (z) out = PREFIX_Z + z;
      }
      if (!out) {
        var j = bytesToB64u(bytes);
        if (j) out = PREFIX_J + j;
      }
      return out && out.length <= MAX_ENCODED ? out : null;
    });
  }

  /** Promise<object|null>. Accepts SS1z/SS1j strings; never throws, never rejects. */
  function decodePayload(str) {
    if (typeof str !== 'string' || str.length > MAX_ENCODED) return Promise.resolve(null);
    var zip = str.indexOf(PREFIX_Z) === 0, plain = str.indexOf(PREFIX_J) === 0;
    if (!zip && !plain) return Promise.resolve(null);
    var bytes = b64uToBytes(str.slice(PREFIX_Z.length));
    if (!bytes || !bytes.length) return Promise.resolve(null);
    var text = zip
      ? inflateRaw(bytes).then(function (out) { return out ? utf8Decode(out) : null; })
      : Promise.resolve(utf8Decode(bytes));
    return text.then(function (json) {
      if (!json || json.length > MAX_JSON) return null;
      var obj;
      try { obj = JSON.parse(json); } catch (e) { return null; }
      return validatePayload(obj);
    }).catch(function () { return null; });
  }

  // ---- validation (I-5: anything foreign dies here, silently) ------------------------
  function finitePos(v) { return typeof v === 'number' && isFinite(v) && v > 0; }
  function cleanStr(v, max) {
    return typeof v === 'string' && v.length <= (max || 64) ? v : null;
  }
  function validatePayload(p) {
    if (!p || typeof p !== 'object' || p.v !== 1) return null;
    if (p.kind !== 'challenge' && p.kind !== 'replay') return null;
    if (!finitePos(p.seed)) return null;
    if (!cleanStr(p.variantId, 80)) return null;
    if (!p.cfg || typeof p.cfg !== 'object') return null;
    var cfg = {
      turnLimit: finitePos(p.cfg.turnLimit) && p.cfg.turnLimit <= 30 ? Math.round(p.cfg.turnLimit) : null,
      redDiff: cleanStr(p.cfg.redDiff, 16),
      roeId: cleanStr(p.cfg.roeId, 32)
    };
    if (!cfg.turnLimit || !cfg.redDiff || !cfg.roeId) return null;
    var out = {
      v: 1, kind: p.kind, seed: p.seed, variantId: p.variantId, cfg: cfg,
      fp: p.fp && typeof p.fp === 'object' ? p.fp : null,
      pm: p.pm && typeof p.pm === 'object' ? p.pm : null,
      callsign: cleanStr(p.callsign, 24) || null,
      ts: finitePos(p.ts) ? p.ts : null,
      claim: null, turns: null
    };
    if (p.claim && typeof p.claim === 'object') {
      out.claim = {
        winner: cleanStr(p.claim.winner, 16),
        turns: finitePos(p.claim.turns) ? Math.round(p.claim.turns) : null,
        reason: cleanStr(p.claim.reason, 32),
        lodgment: typeof p.claim.lodgment === 'number' && isFinite(p.claim.lodgment) ? p.claim.lodgment : null,
        bss: typeof p.claim.bss === 'number' && isFinite(p.claim.bss) ? p.claim.bss : null
      };
    }
    if (p.kind === 'replay') {
      if (!Array.isArray(p.turns) || p.turns.length > 40) return null;
      var turns = [];
      for (var i = 0; i < p.turns.length; i++) {
        var row = p.turns[i];
        if (!row || typeof row !== 'object' || !finitePos(row.t)) return null;
        var orders = Array.isArray(row.orders) ? row.orders : [];
        if (orders.length > 24) return null;
        var cleanOrders = [];
        for (var j = 0; j < orders.length; j++) {
          var o = orders[j];
          if (!o || typeof o !== 'object' || !ORDER_KINDS[o.k] || !cleanStr(o.tid, 80)) return null;
          var co = { k: o.k, tid: o.tid };
          if (cleanStr(o.m, 32)) co.m = o.m;
          if (cleanStr(o.src, 80)) co.src = o.src;
          if (cleanStr(o.axis, 48)) co.axis = o.axis;
          if (cleanStr(o.tc, 48)) co.tc = o.tc;
          cleanOrders.push(co);
        }
        var f = [];
        if (Array.isArray(row.f) && row.f.length <= 24) {
          for (var k = 0; k < row.f.length; k++) {
            var e = row.f[k];
            if (!e || typeof e !== 'object' || !cleanStr(e.q, 96)) continue;
            f.push({
              q: e.q,
              p: typeof e.p === 'number' && isFinite(e.p) ? Math.max(0, Math.min(1, e.p)) : null,
              h: typeof e.h === 'number' && isFinite(e.h) ? Math.max(0, Math.min(1, e.h)) : null,
              o: e.o === 1 || e.o === 0 ? e.o : null
            });
          }
        }
        turns.push({ t: Math.round(row.t), orders: cleanOrders, f: f });
      }
      out.turns = turns;
    }
    return out;
  }

  // ---- payload builders ---------------------------------------------------------------
  // `record` is GameModule.serialize() at AAR time; opts supplies what the engine record
  // can't know: the variant chip, the PRE-match player model (I-4), forecasts, callsign.
  function packOrder(o) {
    if (!o || !ORDER_KINDS[o.kind]) return null;
    var out = { k: o.kind, tid: o.targetId };
    if (o.methodKey) out.m = o.methodKey;
    if (o.kind === 'strike' && o.sourceId) out.src = o.sourceId;
    if (o.kind === 'feint' || o.kind === 'decoy') {
      if (o.axis) out.axis = o.axis;
      if (o.targetClass) out.tc = o.targetClass;
    }
    return out.tid ? out : null;
  }

  function claimFrom(record, forecastEntries) {
    var claim = {
      winner: record.winner || null,
      turns: (record.history || []).length || null,
      reason: (record.result && record.result.reason) || null,
      lodgment: record.lodgment && typeof record.lodgment.value === 'number'
        ? Math.round(record.lodgment.value * 1000) / 1000 : null,
      bss: null
    };
    try {
      if (forecastEntries && forecastEntries.length && window.ForecastingModule &&
          typeof window.ForecastingModule.brierSkill === 'function') {
        var skill = window.ForecastingModule.brierSkill(forecastEntries);
        if (skill && typeof skill.value === 'number' && isFinite(skill.value)) {
          claim.bss = Math.round(skill.value * 1000) / 1000;
        }
      }
    } catch (e) { /* display-only */ }
    return claim;
  }

  function buildPayload(kind, record, opts) {
    if (!record || !finitePos(record.seed)) return null;
    opts = opts || {};
    var payload = {
      v: 1, kind: kind,
      seed: record.seed,
      variantId: opts.variantId || 'default',
      fp: record.fingerprint || null,
      cfg: {
        turnLimit: (record.cfg && record.cfg.turnLimit) || 8,
        redDiff: (record.cfg && record.cfg.difficulty && record.cfg.difficulty.red) || 'hard',
        roeId: (record.cfg && record.cfg.roeId) || 'denial'
      },
      pm: opts.startModel || null,
      callsign: opts.callsign || null,
      ts: Date.now(),
      claim: claimFrom(record, opts.forecastEntries)
    };
    if (kind === 'replay') {
      var byTurn = {};
      (opts.forecastEntries || []).forEach(function (e) {
        if (!e || e.turn == null || typeof e.questionId !== 'string') return;
        (byTurn[e.turn] = byTurn[e.turn] || []).push({
          q: e.questionId,
          p: typeof e.player === 'number' ? e.player : null,
          h: typeof e.house === 'number' ? e.house : null,
          o: e.outcome === 1 || e.outcome === 0 ? e.outcome : null
        });
      });
      payload.turns = (record.history || []).map(function (h) {
        return {
          t: h.turn,
          orders: ((h.orders && h.orders.blue) || []).map(packOrder).filter(Boolean),
          f: byTurn[h.turn] || []
        };
      });
    }
    return validatePayload(payload);   // one gate for both directions — never emit what we wouldn't accept
  }

  // ---- URL + boot intake ---------------------------------------------------------------
  function baseUrl() {
    try { return String(location.href).split('#')[0]; } catch (e) { return ''; }
  }
  function buildUrl(payload) {   // Promise<string|null>
    return encodePayload(payload).then(function (enc) {
      var base = baseUrl();
      return enc && base ? base + '#' + HASH_KEY + '=' + enc : null;
    });
  }
  function rawFromLocation() {
    try {
      var h = String(location.hash || '');
      var m = h.match(new RegExp('[#&]' + HASH_KEY + '=([^&]+)'));
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  // Boot-time intake: decode once, stash, expose synchronously. Consumers never await.
  var pending = null;
  var raw = (typeof location !== 'undefined') ? rawFromLocation() : null;
  if (raw) {
    decodePayload(raw).then(function (payload) {
      if (payload && flagsOn()) pending = payload;
    }).catch(function () { /* I-5 */ });
  }
  function consumePending() {
    var p = pending;
    pending = null;
    if (p) {
      try { history.replaceState(null, '', baseUrl()); } catch (e) { /* file:// quirks — harmless */ }
    }
    return p;
  }

  // ---- clipboard -----------------------------------------------------------------------
  function copyText(text, done) {
    function ok() { if (done) done(true); }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        var fine = false;
        try { fine = document.execCommand('copy'); } catch (e) {}
        ta.remove();
        if (done) done(!!fine);
      } catch (e) { if (done) done(false); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(fallback);
    } else fallback();
  }

  /** Build a replay link from a finished operation and put it on the clipboard.
   *  cb(url|null). Silent no-op when the share flag is off. */
  function copyChallengeLink(record, opts, cb) {
    if (!flagsOn()) { if (cb) cb(null); return; }
    var payload = buildPayload('replay', record, opts);
    if (!payload) { if (cb) cb(null); return; }
    buildUrl(payload).then(function (url) {
      if (!url) { if (cb) cb(null); return; }
      copyText(url, function (copied) { if (cb) cb(copied ? url : null); });
    });
  }

  window.ShareModule = {
    version: 'co007-p1',
    active: flagsOn,
    encodePayload: encodePayload,
    decodePayload: decodePayload,
    validatePayload: validatePayload,
    buildPayload: buildPayload,
    buildUrl: buildUrl,
    copyChallengeLink: copyChallengeLink,
    pending: function () { return pending; },
    consumePending: consumePending
  };
})();
