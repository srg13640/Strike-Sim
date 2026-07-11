#!/usr/bin/env node
'use strict';

/*
 * validate-scenarios.js — focused proof for the canonical Strike Sim resource model.
 *
 * This intentionally validates the authored scenario JSON rather than silently
 * accepting the compatibility aliases supported by game.js. Run from anywhere:
 *
 *   node tools/validate-scenarios.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SCENARIO_FILES = ['grok150red.json', 'grokblue90.json'];
const RESOURCE_KEYS = ['kinetic', 'cyber', 'ew', 'sof'];
const RESOURCE_KEY_SET = new Set(RESOURCE_KEYS);
const errors = [];

function fail(scope, message) {
  errors.push(`${scope}: ${message}`);
}

function readScenario(file) {
  const fullPath = path.join(ROOT, file);
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    fail(file, `could not parse JSON (${error.message})`);
    return null;
  }
}

function endpointId(endpoint) {
  return endpoint && typeof endpoint === 'object' ? endpoint.id : endpoint;
}

function isInformationDomainCapability(node) {
  const domains = (Array.isArray(node.domain) ? node.domain : [node.domain])
    .filter(Boolean)
    .map(value => String(value).toLowerCase());
  if (domains.some(domain => ['cyber', 'cyberspace', 'ew', 'space', 'information'].includes(domain))) {
    return true;
  }

  const profile = node.capabilityProfile || {};
  const descriptor = [node.subsystem, node.type, node.name, profile.category]
    .concat(Array.isArray(profile.functions) ? profile.functions : [])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\b(?:cyber(?:space)?|information|spectrum|counterspace|aerospace|space|ew|cognitive|influence)\b|electronic (?:warfare|attack|support|protection|countermeasure)|electromagnetic|network operations/.test(descriptor);
}

function validateCanonicalResourceObject(scope, label, resources) {
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) {
    fail(scope, `${label} must be an object with exactly kinetic, cyber, ew, and sof`);
    return false;
  }

  const actualKeys = Object.keys(resources);
  if (actualKeys.includes('jam') || actualKeys.includes('jamming')) {
    fail(scope, `${label} contains legacy jam/jamming; author canonical ew or cyber explicitly`);
  }
  const missing = RESOURCE_KEYS.filter(key => !Object.prototype.hasOwnProperty.call(resources, key));
  const extra = actualKeys.filter(key => !RESOURCE_KEY_SET.has(key));
  if (missing.length || extra.length) {
    fail(scope, `${label} keys must be exactly ${RESOURCE_KEYS.join(', ')} (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
  }

  for (const key of RESOURCE_KEYS) {
    const value = resources[key];
    if (!Number.isInteger(value) || value < 0 || value > 10) {
      fail(scope, `${label}.${key} must be an integer from 0 through 10 (received ${JSON.stringify(value)})`);
    }
  }
  return true;
}

function validateResources(file, node) {
  const scope = `${file} node ${node.id || '<missing-id>'}`;
  const resources = node.resourceGenByType;
  if (!validateCanonicalResourceObject(scope, 'resourceGenByType', resources)) return;

  if (isInformationDomainCapability(node) && resources.sof !== 0) {
    fail(scope, `information/cyber/EW/space capability cannot generate SOF (received ${JSON.stringify(resources.sof)})`);
  }

  const potential = node.capabilityProfile && node.capabilityProfile.potentialResourceGenByType;
  if (potential != null) {
    validateCanonicalResourceObject(scope, 'capabilityProfile.potentialResourceGenByType', potential);
    if (isInformationDomainCapability(node) && potential.sof !== 0) {
      fail(scope, `information/cyber/EW/space capability cannot have potential SOF capacity (received ${JSON.stringify(potential.sof)})`);
    }
  }
}

function sourceIdsFor(file, scenario) {
  if (scenario.sources == null) return new Set();
  if (!Array.isArray(scenario.sources)) {
    fail(file, 'top-level sources must be an array when present');
    return new Set();
  }
  const ids = new Set();
  for (const source of scenario.sources) {
    const id = source && source.id;
    if (!id || typeof id !== 'string') {
      fail(file, 'every top-level source must have a non-empty string id');
      continue;
    }
    if (ids.has(id)) fail(file, `duplicate source id ${id}`);
    ids.add(id);
  }
  return ids;
}

function validateScenario(file, scenario, teamTotals) {
  if (!scenario) return null;
  if (!Array.isArray(scenario.nodes)) {
    fail(file, 'nodes must be an array');
    return null;
  }
  if (!Array.isArray(scenario.links)) {
    fail(file, 'links must be an array');
    return null;
  }

  const nodeIds = new Set();
  const sources = sourceIdsFor(file, scenario);
  const totals = { kinetic: 0, cyber: 0, ew: 0, sof: 0 };

  for (const node of scenario.nodes) {
    const id = node && node.id;
    if (!id || typeof id !== 'string') {
      fail(file, 'every node must have a non-empty string id');
      continue;
    }
    if (nodeIds.has(id)) fail(file, `duplicate node id ${id}`);
    nodeIds.add(id);
    validateResources(file, node);

    const resources = node.resourceGenByType || {};
    for (const key of RESOURCE_KEYS) {
      if (Number.isInteger(resources[key])) totals[key] += resources[key];
    }
    if (node.team === 'red' || node.team === 'blue') {
      for (const key of RESOURCE_KEYS) {
        if (Number.isInteger(resources[key])) teamTotals[node.team][key] += resources[key];
      }
    }

    if (node.capabilityProfile != null) {
      const refs = node.capabilityProfile.sourceRefs;
      if (refs != null && !Array.isArray(refs)) {
        fail(`${file} node ${id}`, 'capabilityProfile.sourceRefs must be an array when present');
      } else {
        for (const ref of refs || []) {
          if (typeof ref !== 'string' || !ref) {
            fail(`${file} node ${id}`, 'capabilityProfile.sourceRefs entries must be non-empty strings');
          } else if (!sources.has(ref)) {
            fail(`${file} node ${id}`, `capabilityProfile sourceRef ${ref} does not resolve to top-level sources`);
          }
        }
      }
    }
  }

  const undirectedLinks = new Set();
  for (let index = 0; index < scenario.links.length; index += 1) {
    const link = scenario.links[index] || {};
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    const scope = `${file} link ${index}`;
    if (!nodeIds.has(source)) fail(scope, `source endpoint ${JSON.stringify(source)} does not resolve`);
    if (!nodeIds.has(target)) fail(scope, `target endpoint ${JSON.stringify(target)} does not resolve`);
    if (typeof source !== 'string' || typeof target !== 'string') continue;
    const key = [source, target].sort().join('\u0000');
    if (undirectedLinks.has(key)) {
      fail(scope, `duplicate undirected link ${source} <-> ${target}`);
    }
    undirectedLinks.add(key);
  }

  return {
    file,
    nodes: scenario.nodes.length,
    links: scenario.links.length,
    sources: sources.size,
    totals
  };
}

function loadGameModule() {
  const context = {
    console: { log() {}, warn() {}, error() {} },
    window: {},
    Math,
    Date,
    setTimeout,
    clearTimeout
  };
  context.window.window = context.window;
  context.window.AppState = { activeGraph: () => ({ nodes: [], links: [] }) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'moe.js'), 'utf8'), context, { filename: 'moe.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'red-mind.js'), 'utf8'), context, { filename: 'red-mind.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8'), context, { filename: 'game.js' });
  return context.window.GameModule;
}

function proveMethodIsolation() {
  const game = loadGameModule();
  if (!game || !game._internal || typeof game._internal.canStrikeBoard !== 'function') {
    fail('game.js proof', 'GameModule._internal.canStrikeBoard is unavailable');
    return false;
  }

  const graph = {
    nodes: [
      {
        id: 'BLUE-CYBER', name: 'Cyber-only source', team: 'blue', subsystem: 'Counter C2',
        domain: ['Cyber'], type: 'Cyber', resourceGenByType: { kinetic: 0, cyber: 1, ew: 0, sof: 0 }
      },
      {
        id: 'BLUE-EW', name: 'EW-only source', team: 'blue', subsystem: 'Counter C2',
        domain: ['EW'], type: 'EW', resourceGenByType: { kinetic: 0, cyber: 0, ew: 1, sof: 0 }
      },
      {
        id: 'RED-TARGET', name: 'Red target', team: 'red', subsystem: 'Command and Control',
        domain: ['Land'], type: 'Command', resourceGenByType: { kinetic: 0, cyber: 0, ew: 0, sof: 0 }
      }
    ],
    links: []
  };
  const board = game._internal.buildBoard(graph);
  const check = game._internal.canStrikeBoard;
  const cyberPositive = check(board, 'blue', 'RED-TARGET', 'cyber', 'BLUE-CYBER');
  const ewPositive = check(board, 'blue', 'RED-TARGET', 'ew', 'BLUE-EW');
  const ewCannotCyber = check(board, 'blue', 'RED-TARGET', 'cyber', 'BLUE-EW');
  const cyberCannotEw = check(board, 'blue', 'RED-TARGET', 'ew', 'BLUE-CYBER');

  if (!cyberPositive.ok) fail('game.js proof', `Cyber-only positive control failed (${cyberPositive.reason})`);
  if (!ewPositive.ok) fail('game.js proof', `EW-only positive control failed (${ewPositive.reason})`);
  if (ewCannotCyber.ok) fail('game.js proof', 'EW-only source was incorrectly accepted for a Cyber strike');
  if (cyberCannotEw.ok) fail('game.js proof', 'Cyber-only source was incorrectly accepted for an EW strike');
  return cyberPositive.ok && ewPositive.ok && !ewCannotCyber.ok && !cyberCannotEw.ok;
}

function main() {
  const teamTotals = {
    red: { kinetic: 0, cyber: 0, ew: 0, sof: 0 },
    blue: { kinetic: 0, cyber: 0, ew: 0, sof: 0 }
  };
  const summaries = SCENARIO_FILES
    .map(file => validateScenario(file, readScenario(file), teamTotals))
    .filter(Boolean);

  for (const team of ['red', 'blue']) {
    if (teamTotals[team].cyber <= 0) fail(`${team} totals`, 'Cyber mission capacity must be greater than zero');
    if (teamTotals[team].ew <= 0) fail(`${team} totals`, 'EW mission capacity must be greater than zero');
  }

  const isolationPassed = proveMethodIsolation();
  for (const summary of summaries) {
    const r = summary.totals;
    console.log(`${summary.file}: ${summary.nodes} nodes, ${summary.links} links, ${summary.sources} sources; ` +
      `capacity KE ${r.kinetic} / Cyber ${r.cyber} / EW ${r.ew} / SOF ${r.sof}`);
  }
  console.log(`Team totals: Red Cyber ${teamTotals.red.cyber} / EW ${teamTotals.red.ew}; ` +
    `Blue Cyber ${teamTotals.blue.cyber} / EW ${teamTotals.blue.ew}`);
  console.log(`Method isolation: ${isolationPassed ? 'PASS' : 'FAIL'} ` +
    '(Cyber-only and EW-only sources remain mutually exclusive)');

  if (errors.length) {
    const limit = 80;
    console.error(`\nSCENARIO VALIDATION FAILED (${errors.length} issue${errors.length === 1 ? '' : 's'})`);
    errors.slice(0, limit).forEach(error => console.error(`- ${error}`));
    if (errors.length > limit) console.error(`- ... ${errors.length - limit} additional issues omitted`);
    process.exit(1);
  }

  console.log('\nSCENARIO VALIDATION PASSED');
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
