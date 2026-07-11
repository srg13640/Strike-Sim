/*
 * audio.js — CO-006 W3: the StrikeSim 2040 sound engine.
 *
 * UNCLASSIFIED // NOTIONAL RESEARCH TOOL
 *
 * Entirely procedural Web Audio — zero asset files, zero network. Four gain buses
 * (master / music / sfx / comms) with persisted preferences. The AudioContext is
 * created ONLY inside unlock(), which callers invoke from a user gesture (the boot
 * click), so no autoplay policy is ever violated. Every cue in the game routes
 * through play(name, opts) so the palette is data, not scattered calls.
 *
 * PRESENTATION LAYER ONLY: this module never reads match state, never touches the
 * seeded RNG, and never influences resolution. Cosmetic jitter uses Math.random(),
 * which is sanctioned for non-match presentation randomness (CO-006 invariant 4).
 */
window.AudioFXModule = (function () {
  'use strict';

  var CLASSIFICATION = 'UNCLASSIFIED // NOTIONAL RESEARCH TOOL';
  var PREFS_KEY = 'strikesim.co006.audio';
  var DEFAULT_PREFS = { master: 0.55, music: 0.8, sfx: 0.9, comms: 0.85, muted: false };

  var ctx = null;
  var buses = null;          // { master, music, sfx, comms } GainNodes
  var beds = { name: null, nodes: [], gain: null, pulseTimer: null };
  var prefs = readPrefs();

  function readPrefs() {
    try {
      var parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return Object.assign({}, DEFAULT_PREFS);
      var out = Object.assign({}, DEFAULT_PREFS);
      ['master', 'music', 'sfx', 'comms'].forEach(function (k) {
        var v = Number(parsed[k]);
        if (Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v));
      });
      out.muted = !!parsed.muted;
      return out;
    } catch (e) { return Object.assign({}, DEFAULT_PREFS); }
  }
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  /** Create the context + buses. MUST be called from a user gesture. */
  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
      return true;
    }
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      buses = { master: ctx.createGain(), music: ctx.createGain(), sfx: ctx.createGain(), comms: ctx.createGain() };
      buses.master.connect(ctx.destination);
      buses.music.connect(buses.master);
      buses.sfx.connect(buses.master);
      buses.comms.connect(buses.master);
      applyPrefs();
      return true;
    } catch (e) { ctx = null; buses = null; return false; }
  }
  function unlocked() { return !!ctx; }

  function applyPrefs() {
    if (!buses) return;
    buses.master.gain.value = prefs.muted ? 0 : prefs.master;
    buses.music.gain.value = prefs.music;
    buses.sfx.gain.value = prefs.sfx;
    buses.comms.gain.value = prefs.comms;
  }
  function setVolume(bus, v) {
    if (!(bus in DEFAULT_PREFS) || bus === 'muted') return prefs;
    prefs[bus] = Math.min(1, Math.max(0, Number(v) || 0));
    applyPrefs(); savePrefs();
    return Object.assign({}, prefs);
  }
  function setMuted(m) {
    prefs.muted = !!m;
    applyPrefs(); savePrefs();
    return prefs.muted;
  }
  function toggleMute() { return setMuted(!prefs.muted); }
  function getPrefs() { return Object.assign({}, prefs); }

  // ---------- synth helpers ----------
  function noiseBuffer(sec) {
    var b = ctx.createBuffer(1, Math.max(1, Math.round(ctx.sampleRate * sec)), ctx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function env(node, bus, peak, attack, release) {
    var g = ctx.createGain(); g.gain.value = 0;
    node.connect(g); g.connect(bus);
    var t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    return g;
  }

  // ---------- one-shot voices (the palette) ----------
  var VOICES = {
    tick: function (o) {           // UI hover / typing tick
      var osc = ctx.createOscillator(); osc.type = 'square';
      osc.frequency.value = 1800 + Math.random() * 900;
      env(osc, buses.sfx, (o && o.vol) || 0.03, 0.001, 0.03);
      osc.start(); osc.stop(ctx.currentTime + 0.05);
    },
    beep: function (o) {           // confirm / select
      var osc = ctx.createOscillator(); osc.type = 'sine';
      osc.frequency.value = (o && o.freq) || 880;
      var dur = (o && o.dur) || 0.25;
      env(osc, buses.sfx, (o && o.vol) || 0.08, 0.005, dur);
      osc.start(); osc.stop(ctx.currentTime + dur + 0.05);
    },
    thump: function (o) {          // low impact / heartbeat / stamp body
      var osc = ctx.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(90, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.18);
      env(osc, buses.sfx, (o && o.vol) || 0.22, 0.004, 0.35);
      osc.start(); osc.stop(ctx.currentTime + 0.4);
    },
    stamp: function () { VOICES.thump({ vol: 0.3 }); VOICES.tick({ vol: 0.06 }); },
    radio: function (o) {          // comms static burst — ducks the music bed
      var src = ctx.createBufferSource(); src.buffer = noiseBuffer((o && o.dur) || 0.12);
      var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 2.5;
      src.connect(bp);
      env(bp, buses.comms, (o && o.vol) || 0.04, 0.004, ((o && o.dur) || 0.12) + 0.05);
      src.start();
      duckMusic(0.5, 0.35);        // ~6 dB dip while the net talks
    },
    whooshIn: function () { whoosh(120, 2400); },
    whooshOut: function () { whoosh(2400, 120); },
    arm: function () {             // commit goes hot
      VOICES.beep({ freq: 520, vol: 0.09, dur: 0.5 });
      VOICES.thump({ vol: 0.2 });
    }
  };
  function whoosh(fromHz, toHz) {
    var src = ctx.createBufferSource(); src.buffer = noiseBuffer(1.2);
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
    var t = ctx.currentTime;
    lp.frequency.setValueAtTime(fromHz, t);
    lp.frequency.exponentialRampToValueAtTime(toHz, t + 1.0);
    src.connect(lp);
    var g = ctx.createGain(); g.gain.value = 0;
    lp.connect(g); g.connect(buses.sfx);
    g.gain.linearRampToValueAtTime(0.16, t + 0.35);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.15);
    src.start();
  }
  function duckMusic(depth, sec) {
    if (!buses) return;
    var g = buses.music.gain, t = ctx.currentTime, base = prefs.music;
    try {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(base * (1 - depth), t + 0.03);
      g.linearRampToValueAtTime(base, t + 0.03 + sec);
    } catch (e) {}
  }

  function play(name, opts) {
    if (!ctx || prefs.muted) return false;
    var voice = VOICES[name];
    if (!voice) return false;
    try { voice(opts); } catch (e) {}
    return true;
  }

  // ---------- drone beds (music bus) ----------
  // Same 55 Hz family per the reference grammar; each phase differs by filter
  // movement, never by register. WATCH deliberately has no bed: the war is
  // quieter than the menu (the DEFCON move).
  var BEDS = {
    title: { partials: [[55, 'sawtooth', 0.2], [55.7, 'sawtooth', 0.2], [110.4, 'sine', 0.12]], lp: 160, lfoHz: 0.07, lfoDepth: 40, level: 0.30, pulse: 2600 },
    brief: { partials: [[55, 'sawtooth', 0.16], [55.6, 'sawtooth', 0.16], [146.8, 'sine', 0.07]], lp: 200, lfoHz: 0.05, lfoDepth: 55, level: 0.24, pulse: 0 },
    plan:  { partials: [[55, 'sawtooth', 0.14], [82.4, 'sine', 0.10]], lp: 130, lfoHz: 0.09, lfoDepth: 30, level: 0.20, pulse: 3400 }
  };

  function stopBed(fadeSec) {
    if (beds.pulseTimer) { clearInterval(beds.pulseTimer); beds.pulseTimer = null; }
    if (beds.gain && ctx) {
      var g = beds.gain, t = ctx.currentTime;
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0.0001, t + (fadeSec == null ? 1.2 : fadeSec));
      } catch (e) {}
      var old = beds.nodes.slice();
      setTimeout(function () { old.forEach(function (n) { try { n.stop(); } catch (e) {} }); }, ((fadeSec == null ? 1.2 : fadeSec) + 0.2) * 1000);
    }
    beds = { name: null, nodes: [], gain: null, pulseTimer: null };
  }

  function startBed(name) {
    if (!ctx) return false;
    if (beds.name === name) return true;
    stopBed(0.8);
    var spec = BEDS[name];
    if (!spec) return false;
    var g = ctx.createGain(); g.gain.value = 0;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = spec.lp; lp.Q.value = 0.7;
    var nodes = [];
    spec.partials.forEach(function (p) {
      var osc = ctx.createOscillator(); osc.type = p[1]; osc.frequency.value = p[0];
      var og = ctx.createGain(); og.gain.value = p[2];
      osc.connect(og); og.connect(lp); osc.start(); nodes.push(osc);
    });
    var lfo = ctx.createOscillator(); lfo.frequency.value = spec.lfoHz;
    var lfoG = ctx.createGain(); lfoG.gain.value = spec.lfoDepth;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start(); nodes.push(lfo);
    lp.connect(g); g.connect(buses.music);
    g.gain.linearRampToValueAtTime(spec.level, ctx.currentTime + 3.5);
    beds = { name: name, nodes: nodes, gain: g, pulseTimer: null };
    if (spec.pulse) {
      beds.pulseTimer = setInterval(function () { if (!prefs.muted) play('thump', { vol: 0.05 }); }, spec.pulse);
    }
    return true;
  }

  return Object.freeze({
    CLASSIFICATION: CLASSIFICATION,
    unlock: unlock,
    unlocked: unlocked,
    play: play,
    startBed: startBed,
    stopBed: stopBed,
    setVolume: setVolume,
    setMuted: setMuted,
    toggleMute: toggleMute,
    getPrefs: getPrefs
  });
})();
