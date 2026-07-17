#!/usr/bin/env node
/* =====================================================================================
 * UNCLASSIFIED // NOTIONAL — CO-007 online-layer proof (offline-safe slice)
 * =====================================================================================
 * Contracts for the flag file, the share codec, the Director wiring, and the replay
 * verifier. The e2e legs mint REAL fixtures — a scripted human-blue match on the
 * default graph and one on the authored variant — and require the verifier to
 * reproduce them exactly, reject tampering, and refuse malformed payloads.
 *
 *   node tools/online-layer-proof.js            # everything
 *   node tools/online-layer-proof.js --static   # source/codec contracts only (fast)
 *   node tools/online-layer-proof.js --e2e      # engine fixtures + verifier legs only
 * ===================================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODE = process.argv.includes('--static') ? 'static' : process.argv.includes('--e2e') ? 'e2e' : 'all';

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function src(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

// ---- headless module loaders -----------------------------------------------------------
function loadShare(flagsOverride, locationHash) {
  const ctx = { window: {}, Buffer, console, Promise, Math, Date, JSON };
  ctx.window.window = ctx.window;
  if (locationHash != null) {
    ctx.location = { href: 'file:///StrikeSim2040.html' + locationHash, hash: locationHash };
    ctx.window.location = ctx.location;
    ctx.history = { replaceState: function () {} };
    ctx.window.history = ctx.history;
  }
  vm.createContext(ctx);
  vm.runInContext(src('online-flags.js'), ctx, { filename: 'online-flags.js' });
  if (flagsOverride) ctx.window.OnlineFlags = flagsOverride;   // kill-switch simulation
  vm.runInContext(src('share.js'), ctx, { filename: 'share.js' });
  return ctx.window;
}
function loadGame(graph) {
  const c = { console, window: {}, Math, Date, setTimeout, clearTimeout };
  c.window.window = c.window;
  c.window.AppState = { activeGraph: () => graph };
  vm.createContext(c);
  for (const f of ['moe.js', 'red-mind.js', 'strategic-state.js', 'logistics.js', 'game.js']) {
    vm.runInContext(src(f), c, { filename: f });
  }
  return c.window.GameModule;
}
function readJson(f) { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function encZ(payload) {
  return 'SS1z.' + zlib.deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64url');
}

// ---- STATIC CONTRACTS --------------------------------------------------------------------
function staticContracts() {
  console.log('— static: flag file —');
  const w = loadShare();
  const OF = w.OnlineFlags;
  check('S1 flag file loads headless and exposes enabled()', !!OF && typeof OF.enabled === 'function');
  check('S1 network features default OFF (dailySeed, careerSync, feedback)',
    OF && !OF.enabled('dailySeed') && !OF.enabled('careerSync') && !OF.enabled('feedback'));
  check('S1 share is ON in the offline build (serverless by design)', OF && OF.enabled('share') === true);
  check('S1 unknown flags read false', OF && OF.enabled('nonexistent') === false);
  check('S1 flag object is frozen', OF && Object.isFrozen(OF) && Object.isFrozen(OF.flags));
  check('S1 build identity is offline', OF && OF.build === 'offline');

  console.log('— static: html wiring —');
  const html = src('StrikeSim2040.html');
  const iFlags = html.indexOf('src="online-flags.js'), iShare = html.indexOf('src="share.js'),
    iWargame = html.indexOf('src="wargame.js');
  check('HTML includes online-flags.js exactly once', iFlags >= 0 && (html.match(/src="online-flags\.js/g) || []).length === 1);
  check('HTML includes share.js exactly once', iShare >= 0 && (html.match(/src="share\.js/g) || []).length === 1);
  check('HTML order: flags → share → wargame', iFlags < iShare && iShare < iWargame);
  check('NOTIONAL header on online-flags.js', /UNCLASSIFIED \/\/ NOTIONAL/.test(src('online-flags.js')));
  check('NOTIONAL header on share.js', /UNCLASSIFIED \/\/ NOTIONAL/.test(src('share.js')));
  check('NOTIONAL header on replay-verify.js', /UNCLASSIFIED \/\/ NOTIONAL/.test(src('tools/replay-verify.js')));

  console.log('— static: no-network / no-unseeded-randomness —');
  for (const f of ['online-flags.js', 'share.js', 'tools/replay-verify.js']) {
    const s = src(f);
    check('no sockets in ' + f, !/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource)\s*\(/.test(s) &&
      !/new\s+(XMLHttpRequest|WebSocket|EventSource)/.test(s));
    check('no Math.random in ' + f, !/Math\.random/.test(s));
  }

  console.log('— static: director wiring —');
  const dir = src('director.js');
  check('AAR challenge button is flag-gated', /ShareModule && ShareModule\.active\(\)[\s\S]{0,200}challenge-link/.test(dir));
  check('challenge seed only ever comes from op.challenge', /seed:\s*op\.challenge \? op\.challenge\.seed : undefined/.test(dir));
  check('pre-match model stashed for replay payloads (I-4)', /op\.startModel = op\.challenge \? null : readPlayerModel\(\)/.test(dir));
  check('challenge plays the NEUTRAL habit model (I-4)', /playerModel:\s*op\.startModel/.test(dir));
  const chipVoids = (dir.match(/voidChallenge\(\);? (briefOpts|if \(selectVariant)/g) || []).length +
    (dir.match(/voidChallenge\(\);\s*\n?\s*if \(selectVariant/g) || []).length;
  check('every BRIEF chip branch voids an active challenge', (dir.match(/voidChallenge\(\)/g) || []).length >= 5);
  check('director consumes the payload exactly once via consumePending', /ShareModule\.consumePending === 'function' && ShareModule\.consumePending\(\)/.test(dir));

  console.log('— static: codec —');
  const SM = w.ShareModule;
  const record = {
    seed: 4242, winner: 'blue', fingerprint: { v: 1, hash: 11, nodes: 2, links: 1 },
    cfg: { turnLimit: 8, difficulty: { red: 'hard' }, roeId: 'denial' },
    result: { reason: 'halt' }, lodgment: { value: 0.25 },
    history: [{ turn: 1, orders: { blue: [{ kind: 'strike', targetId: 'r1', methodKey: 'kinetic', sourceId: 'b1' }] } }]
  };
  const payload = SM.buildPayload('replay', record, {
    variantId: 'default', callsign: 'PROOF',
    forecastEntries: [{ questionId: 'q1', turn: 1, player: 0.9, house: 0.5, outcome: 1 }],
    startModel: null
  });
  check('buildPayload emits a spec-valid replay payload', !!payload && payload.kind === 'replay' && payload.turns.length === 1);
  check('payload carries the pm field even when neutral (I-4)', payload && 'pm' in payload && payload.pm === null);
  let rt = null, gz = null, gk = null, big = null;
  const done = SM.encodePayload(payload)
    .then(enc => {
      check('encodePayload produces SS1j in a stream-less host', typeof enc === 'string' && enc.startsWith('SS1j.'));
      return SM.decodePayload(enc);
    })
    .then(dec => { rt = dec; return SM.decodePayload('SS1j.@@@not-base64url@@@'); })
    .then(g => { gz = g; return SM.decodePayload('SS1j.' + Buffer.from(JSON.stringify({ v: 1, kind: 'replay', seed: 1, variantId: 'default', cfg: { turnLimit: 8, redDiff: 'hard', roeId: 'denial' }, turns: [{ t: 1, orders: [{ k: 'nuke', tid: 'x' }] }] })).toString('base64url')); })
    .then(b => { gk = b; return SM.decodePayload('SS1j.' + 'A'.repeat(17000)); })
    .then(o => { big = o; });
  return done.then(() => {
    check('codec round-trip is exact (j path)', JSON.stringify(rt) === JSON.stringify(payload));
    check('garbage payloads decode to null, silently', gz === null);
    check('unknown order kinds are rejected by validation', gk === null);
    check('oversized payloads are refused', big === null);
    // z path: zlib-encode here, decode through the verifier's own intake below (e2e),
    // and through validatePayload for shape equivalence now.
    const viaZ = SM.validatePayload(JSON.parse(zlib.inflateRawSync(Buffer.from(encZ(payload).slice(5), 'base64url')).toString()));
    check('z path carries the identical payload (zlib mirror of CompressionStream)', JSON.stringify(viaZ) === JSON.stringify(payload));

    console.log('— static: kill switch —');
    // j encoding throughout the intake tests: the headless vm has no DecompressionStream,
    // so a decodable-by-this-host payload is the only honest probe of the FLAG gate.
    const jEnc = 'SS1j.' + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const off = loadShare(Object.freeze({ version: 't', build: 'offline', flags: Object.freeze({}), enabled: () => false }),
      '#op=' + jEnc);
    check('share flag off ⇒ ShareModule inert (active() false)', off.ShareModule.active() === false);
    let cbUrl = 'unset';
    off.ShareModule.copyChallengeLink(record, {}, u => { cbUrl = u; });
    check('share flag off ⇒ copyChallengeLink yields null, no side effects', cbUrl === null);
    return new Promise(r => setTimeout(r, 30)).then(() => {
      check('share flag off ⇒ boot intake ignores a VALID, DECODABLE #op= payload', off.ShareModule.pending() === null);
      const on = loadShare(null, '#op=' + jEnc);
      return new Promise(r => setTimeout(r, 30)).then(() => {
        check('share flag on ⇒ boot intake stashes the payload once', !!on.ShareModule.pending() && on.ShareModule.consumePending().seed === 4242 && on.ShareModule.pending() === null);
        const bad = loadShare(null, '#op=SS1z.corrupt~payload');
        return new Promise(r => setTimeout(r, 30)).then(() => {
          check('malformed #op= dies silently at intake (I-5)', bad.ShareModule.pending() === null);
        });
      });
    });
  });
}

// ---- E2E CONTRACTS -------------------------------------------------------------------------
function scriptedRun(game, opts) {
  game.init({});
  game.newMatch(Object.assign({
    control: { blue: 'human', red: 'ai' },
    difficulty: { blue: 'hard', red: 'hard' },
    roeId: 'denial', playerModel: null
  }, opts));
  let st = game.getState();
  while (st && st.phase !== 'over') {
    let struck = false, hardened = 0, feinted = opts._noFeint || st.turn !== 1;
    const s = game.serialize();
    for (const id of Object.keys(s.health)) {
      if (!s.health[id].a) continue;
      const bn = game.boardNode(id); if (!bn) continue;
      if (!struck && bn.team === 'red') {
        for (const m of game.methodKeys()) {
          const av = game.canStrike('blue', id, m);
          if (av.ok) { struck = game.queueOrder('blue', { kind: 'strike', targetId: id, methodKey: m, sourceId: av.sourceId }); break; }
        }
      } else if (!feinted && bn.team === 'red') {
        feinted = game.queueOrder('blue', { kind: 'feint', targetId: id });
      } else if (hardened < 1 && bn.team === 'blue') {
        if (game.queueOrder('blue', { kind: 'harden', targetId: id })) hardened++;
      }
      if (struck && feinted && hardened >= 1) break;
    }
    game.commitTurn();
    st = game.getState();
    if (st.phase === 'resolved') st = game.nextTurn();
  }
  return game.serialize();
}

function runVerifier(payloadFile) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'replay-verify.js'), '--payload', payloadFile, '--quiet'],
    { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  return r.status;
}

function e2eContracts() {
  console.log('— e2e: default-graph fixture —');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'co007-proof-'));
  const red = readJson('grok150red.json'), blue = readJson('grokblue90.json');
  const graph = { nodes: clone(red.nodes || []).concat(clone(blue.nodes || [])), links: clone(red.links || []).concat(clone(blue.links || [])) };
  const rec = scriptedRun(loadGame(graph), { seed: 20260711, turnLimit: 6 });
  check('fixture match reached a verdict', !!rec.winner || (rec.result && rec.result.reason));

  const w = loadShare();
  const payload = w.ShareModule.buildPayload('replay', rec, {
    variantId: 'default', callsign: 'PROOF',
    forecastEntries: [{ questionId: 'qA', turn: 1, player: 0.8, house: 0.55, outcome: 1 },
      { questionId: 'qB', turn: 2, player: 0.3, house: 0.5, outcome: 0 }],
    startModel: null
  });
  check('fixture payload builds and validates', !!payload);
  const enc = encZ(payload);
  check('replay payload stays link-sized (< 8000 chars)', enc.length < 8000, enc.length + ' chars');
  const fMain = path.join(tmp, 'fixture.txt'); fs.writeFileSync(fMain, enc);
  check('verifier reproduces the fixture exactly (exit 0)', runVerifier(fMain) === 0);

  const tClaim = clone(payload); tClaim.claim.winner = tClaim.claim.winner === 'blue' ? 'red' : 'blue';
  const fClaim = path.join(tmp, 'tamper-claim.txt'); fs.writeFileSync(fClaim, encZ(tClaim));
  check('tampered CLAIM is caught (exit 1)', runVerifier(fClaim) === 1);

  const tOrder = clone(payload); tOrder.turns[0].orders[0].tid = 'no-such-node';
  const fOrder = path.join(tmp, 'tamper-order.txt'); fs.writeFileSync(fOrder, encZ(tOrder));
  check('tampered ORDER is rejected by the engine (exit 1)', runVerifier(fOrder) === 1);

  const bare = clone(payload); delete bare.turns; bare.kind = 'challenge';
  const fBare = path.join(tmp, 'bare.txt'); fs.writeFileSync(fBare, encZ(bare));
  check('bare challenge (no order log) is MALFORMED for verification (exit 2)', runVerifier(fBare) === 2);

  const fGarb = path.join(tmp, 'garbage.txt'); fs.writeFileSync(fGarb, 'SS1z.!!!!');
  check('garbage payload is MALFORMED (exit 2)', runVerifier(fGarb) === 2);

  const drift = clone(payload); drift.fp = { v: 1, hash: 123456789, nodes: drift.fp.nodes, links: drift.fp.links };
  const fDrift = path.join(tmp, 'drift.txt'); fs.writeFileSync(fDrift, encZ(drift));
  check('scenario fingerprint drift is caught (exit 1)', runVerifier(fDrift) === 1);

  console.log('— e2e: authored-variant fixture —');
  const variant = readJson('scenarios/small-island-fait-accompli.json');
  const vGraph = { nodes: clone(variant.nodes), links: clone(variant.links || []) };
  const mc = variant.matchConfig || {};
  const vRec = scriptedRun(loadGame(vGraph), {
    seed: 777001, turnLimit: mc.turnLimit || 6,
    lodgmentRequiredTurns: mc.lodgmentRequiredTurns, doctrinePrior: mc.doctrinePrior,
    strategic: mc.strategic, _noFeint: true
  });
  const vPayload = w.ShareModule.buildPayload('replay', vRec, { variantId: variant.metadata.id, callsign: 'PROOF', startModel: null });
  check('variant fixture payload builds', !!vPayload);
  const fVar = path.join(tmp, 'variant.txt'); fs.writeFileSync(fVar, encZ(vPayload));
  check('verifier reproduces the VARIANT fixture via scenarios/ lookup (exit 0)', runVerifier(fVar) === 0);

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp cleanup best-effort */ }
  return Promise.resolve();
}

// ---- run -------------------------------------------------------------------------------------
console.log('CO-007 online-layer proof — mode: ' + MODE + '\n');
const chain = (MODE === 'e2e' ? Promise.resolve() : staticContracts())
  .then(() => (MODE === 'static' ? null : e2eContracts()));
chain.then(() => {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(e => {
  console.error('PROOF CRASHED:', e && e.stack || e);
  process.exit(1);
});
