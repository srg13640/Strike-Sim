#!/usr/bin/env node
/* =====================================================================================
 * UNCLASSIFIED // NOTIONAL — StrikeSim 2040 replay verifier (CO-007 S4)
 * =====================================================================================
 * Determinism is the anti-cheat. A challenge payload's claim is not a trusted number:
 * this tool rebuilds the payload's scenario, re-injects the committed blue order log
 * through the SHIPPED engine (moe → red-mind → strategic-state → game, the canonical
 * load order), lets seeded Red re-derive its own war, and compares what actually
 * happens against what the payload claims. The daily-seed service (PARKED) will shell
 * this same script — one resolver, everywhere, forever (CO-007 I-2).
 *
 * Usage:
 *   node tools/replay-verify.js --payload "SS1z.…"        # payload string
 *   node tools/replay-verify.js --payload path/to/file    # file containing string/URL
 *   node tools/replay-verify.js --url "…#op=SS1z.…"       # full share URL
 *   [--quiet]                                             # exit code only
 *
 * Exit codes: 0 VERIFIED · 1 MISMATCH (claim ≠ replay, order rejected, content drift)
 *             2 MALFORMED (undecodable/invalid payload or unavailable scenario)
 *
 * Brier note: `f` rows are re-scored ARITHMETICALLY from stated p/h/o. Re-deriving the
 * outcomes o and house line h server-side needs the ghost-forecast harness and lands
 * with the daily-seed activation (documented cut in the CO-007 plan of record).
 * ===================================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');

function arg(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : null;
}
function say(...parts) { if (!QUIET) console.log(...parts); }
function die(code, msg) {
  if (!QUIET) console.error((code === 2 ? 'MALFORMED: ' : 'MISMATCH: ') + msg);
  process.exit(code);
}

// ---- payload intake ------------------------------------------------------------------
function rawPayloadString() {
  let s = arg('--payload') || null;
  const url = arg('--url');
  if (!s && url) s = url;
  if (!s) die(2, 'no --payload or --url given');
  // A file path? Read it (may contain a URL or the bare payload).
  try { if (fs.existsSync(s) && fs.statSync(s).isFile()) s = fs.readFileSync(s, 'utf8').trim(); } catch (e) { /* treat as literal */ }
  const m = s.match(/[#&]op=([A-Za-z0-9._-]+)/);
  if (m) s = m[1];
  return s.trim();
}

/** Decode SS1z/SS1j here with zlib (Node side of the browser codec), then hand the
 *  object to share.js's OWN validatePayload — one validator, zero spec drift. */
function decodeRaw(str) {
  const zip = str.startsWith('SS1z.'), plain = str.startsWith('SS1j.');
  if (!zip && !plain) return null;
  let bytes;
  try { bytes = Buffer.from(str.slice(5).replace(/-/g, '+').replace(/_/g, '/'), 'base64'); } catch (e) { return null; }
  if (!bytes || !bytes.length) return null;
  let json;
  try { json = zip ? zlib.inflateRawSync(bytes).toString('utf8') : bytes.toString('utf8'); } catch (e) { return null; }
  try { return JSON.parse(json); } catch (e) { return null; }
}

function loadShareValidator() {
  const ctx = { window: {}, Buffer, console, Promise, Math, Date, JSON };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'online-flags.js'), 'utf8'), ctx, { filename: 'online-flags.js' });
  ctx.window.OnlineFlags = ctx.window.OnlineFlags || ctx.OnlineFlags;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'share.js'), 'utf8'), ctx, { filename: 'share.js' });
  if (!ctx.window.ShareModule || typeof ctx.window.ShareModule.validatePayload !== 'function') {
    throw new Error('share.js did not expose validatePayload');
  }
  return ctx.window.ShareModule;
}

// ---- scenario assembly (mirrors the live intake: default graphs or authored variant) --
function readJson(file) { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

function defaultGraph() {
  const red = readJson('grok150red.json');
  const blue = readJson('grokblue90.json');
  return {
    nodes: clone(red.nodes || []).concat(clone(blue.nodes || [])),
    links: clone(red.links || []).concat(clone(blue.links || []))
  };
}

function findVariant(variantId) {
  const dir = path.join(ROOT, 'scenarios');
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = readJson(path.join('scenarios', f));
      if (s && s.metadata && s.metadata.id === variantId) return s;
    } catch (e) { /* skip unreadable */ }
  }
  return null;
}

function loadGame(graph) {
  const context = { console, window: {}, Math, Date, setTimeout, clearTimeout };
  context.window.window = context.window;
  context.window.AppState = { activeGraph: () => graph };
  vm.createContext(context);
  // The canonical order (CO-005 harness rule): moe → red-mind → strategic-state → game.
  for (const f of ['moe.js', 'red-mind.js', 'strategic-state.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  }
  if (!context.window.MoeModule || !context.window.GameModule) {
    throw new Error('engine failed to load — MoeModule/GameModule missing');
  }
  return context.window.GameModule;
}

// ---- the replay ------------------------------------------------------------------------
function main() {
  const raw = rawPayloadString();
  const obj = decodeRaw(raw);
  if (!obj) die(2, 'payload is not a decodable SS1z/SS1j string');
  const SM = loadShareValidator();
  const payload = SM.validatePayload(obj);
  if (!payload) die(2, 'payload failed spec-v1 validation');
  if (payload.kind !== 'replay' || !payload.turns || !payload.turns.length) {
    die(2, 'payload has no order log (kind must be "replay" with turns) — a bare challenge cannot be verified');
  }

  // Scenario: default combined graphs, or the authored variant by metadata.id.
  let graph, matchConfig = {};
  if (payload.variantId === 'default') {
    graph = defaultGraph();
  } else {
    const variant = findVariant(payload.variantId);
    if (!variant || !Array.isArray(variant.nodes) || !variant.nodes.length) {
      die(2, 'variant "' + payload.variantId + '" not found under scenarios/');
    }
    graph = { nodes: clone(variant.nodes), links: clone(variant.links || []) };
    matchConfig = variant.matchConfig || {};
  }

  const game = loadGame(graph);
  game.init({});

  // Content-drift gate: the payload was minted against a specific scenario fingerprint.
  const liveFp = game._internal.computeFingerprint(graph);
  if (payload.fp && !game._internal.fingerprintsMatch(payload.fp, liveFp)) {
    die(1, 'scenario fingerprint drift — payload fp ' + JSON.stringify(payload.fp) +
      ' vs live ' + JSON.stringify(liveFp) + '. The content changed since this link was minted.');
  }
  if (!payload.fp) say('note: payload carries no fingerprint; drift gate skipped');

  // The live intake's exact cfg: variant matchConfig + the issuer's chips + forced seed.
  // pm rides the payload (I-4); null means the neutral model — normalize handles it.
  game.newMatch({
    seed: payload.seed,
    turnLimit: payload.cfg.turnLimit,
    lodgmentRequiredTurns: matchConfig.lodgmentRequiredTurns,
    doctrinePrior: matchConfig.doctrinePrior,
    strategic: matchConfig.strategic,
    playerModel: payload.pm,
    control: { blue: 'human', red: 'ai' },
    difficulty: { blue: 'hard', red: payload.cfg.redDiff },
    roeId: payload.cfg.roeId
  });

  let state = game.getState();
  for (const row of payload.turns) {
    if (!state || state.phase === 'over') {
      die(1, 'order log continues past the end of the match (log turn ' + row.t + ')');
    }
    if (state.turn !== row.t) {
      die(1, 'turn misalignment — log says turn ' + row.t + ', match is at turn ' + state.turn);
    }
    for (const o of row.orders) {
      const ok = game.queueOrder('blue', {
        kind: o.k, targetId: o.tid,
        methodKey: o.m || null, sourceId: o.src || undefined,
        axis: o.axis || undefined, targetClass: o.tc || undefined
      });
      if (!ok) {
        die(1, 'turn ' + row.t + ': engine REJECTED order ' + JSON.stringify(o) +
          ' — tampered payload or rules drift');
      }
    }
    game.commitTurn();
    state = game.getState();
    if (state.phase === 'resolved') state = game.nextTurn();
  }
  if (state && state.phase !== 'over' && payload.claim && payload.claim.winner) {
    die(1, 'order log ended at turn ' + state.turn + ' but the match is not over — incomplete log');
  }

  // ---- compare world claim -------------------------------------------------------------
  const finalState = game.getState();
  const record = game.serialize();
  const got = {
    winner: finalState.winner || null,
    turns: (record.history || []).length || null,
    reason: (record.result && record.result.reason) || null,
    lodgment: record.lodgment && typeof record.lodgment.value === 'number'
      ? Math.round(record.lodgment.value * 1000) / 1000 : null
  };
  const claim = payload.claim || {};
  const diffs = [];
  for (const k of ['winner', 'turns', 'reason', 'lodgment']) {
    if (claim[k] == null) continue;   // unclaimed fields don't gate
    const same = k === 'lodgment' ? Math.abs(Number(claim[k]) - Number(got[k])) <= 0.0015 : claim[k] === got[k];
    if (!same) diffs.push(k + ': claimed ' + JSON.stringify(claim[k]) + ', replay produced ' + JSON.stringify(got[k]));
  }

  // ---- Brier arithmetic over stated forecasts -------------------------------------------
  let brierLine = 'no forecast rows — calibration unchecked';
  const rows = [].concat(...payload.turns.map(t => t.f || [])).filter(e => e.p != null && e.o != null);
  if (rows.length) {
    const pMean = rows.reduce((s, e) => s + Math.pow(e.p - e.o, 2), 0) / rows.length;
    const hRows = rows.filter(e => e.h != null);
    const hMean = hRows.length ? hRows.reduce((s, e) => s + Math.pow(e.h - e.o, 2), 0) / hRows.length : null;
    const bss = hMean != null && hMean > 1e-12 ? 1 - pMean / hMean : null;
    brierLine = rows.length + ' forecast rows · player Brier ' + pMean.toFixed(4) +
      (hMean != null ? ' · house ' + hMean.toFixed(4) : '') +
      (bss != null ? ' · BSS ' + (bss >= 0 ? '+' : '') + bss.toFixed(3) : '');
    if (claim.bss != null && bss != null && Math.abs(claim.bss - bss) > 0.002) {
      diffs.push('bss: claimed ' + claim.bss + ', recomputed ' + bss.toFixed(3) + ' (arithmetic check)');
    }
  }

  if (diffs.length) {
    die(1, 'replay diverged from the claim —\n  ' + diffs.join('\n  '));
  }
  say('VERIFIED — seed ' + payload.seed + ' · ' + payload.variantId +
    ' · ' + (got.winner || 'no winner') + ' in ' + got.turns + ' turns (' + (got.reason || 'n/a') + ')' +
    (got.lodgment != null ? ' · lodgment ' + got.lodgment : ''));
  say('  ' + brierLine);
  say('  fingerprint ' + (payload.fp ? 'MATCH' : 'ABSENT') + ' · issuer ' + (payload.callsign || 'unnamed') +
    ' · UNCLASSIFIED // NOTIONAL');
  process.exit(0);
}

try { main(); } catch (e) {
  die(2, 'verifier error: ' + (e && e.message ? e.message : String(e)));
}
