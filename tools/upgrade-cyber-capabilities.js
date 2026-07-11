#!/usr/bin/env node
'use strict';

/*
 * One-time/idempotent scenario upgrade for resource-model-v2.
 *
 * The historical libraries serialized {kinetic, ew, jam, sof}. Cyber capacity
 * was hidden in `jam`, while dedicated EW and platform self-protection were
 * sometimes mixed together. This script authors the canonical four-ledger model,
 * adds source-aware theater capability aggregates, and mirrors the release data.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site', 'public', 'strike-sim');
const ZERO = Object.freeze({ kinetic: 0, cyber: 0, ew: 0, sof: 0 });

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}

function capacity(values = {}) {
  const value = key => Math.max(0, Math.min(10, Math.round(Number(values[key] || 0))));
  return { kinetic: value('kinetic'), cyber: value('cyber'), ew: value('ew'), sof: value('sof') };
}

function potential(values = {}) {
  return capacity(values);
}

function profile(category, functions, evidenceClass, confidence, availability, sourceRefs, assumption, possible) {
  const result = { category, functions, evidenceClass, confidence, availability, sourceRefs, assumption };
  if (possible) result.potentialResourceGenByType = potential(possible);
  return result;
}

function roleText(node) {
  return [node.name, node.type, node.subsystem, ...(Array.isArray(node.domain) ? node.domain : [node.domain])]
    .filter(Boolean).join(' ').toLowerCase();
}

function canonicalizeNode(node) {
  const old = node.resourceGenByType || {};
  const text = roleText(node);
  const domains = (Array.isArray(node.domain) ? node.domain : [node.domain])
    .filter(Boolean).map(value => String(value).toLowerCase());
  const cyberRole = domains.some(value => value === 'cyber' || value === 'cyberspace') ||
    /\bcyber(?:space)?\b|network operations/.test(text);
  const ewRole = domains.some(value => value === 'ew') ||
    /\belectronic warfare\b|\belectronic attack\b|\belectronic support\b|\belectronic protection\b|\belectromagnetic\b|\bspectrum\b|\bjamming\b|\bcountermeasure\b|\bdecoy\b/.test(text);
  const sofRole = domains.some(value => value === 'sof') || /\bsof\b|special operations/.test(text);
  const jam = Number(old.jam ?? old.jamming ?? 0);
  const hasCanonical = Object.prototype.hasOwnProperty.call(old, 'cyber');
  const next = capacity({
    kinetic: old.kinetic,
    cyber: hasCanonical ? old.cyber : (cyberRole ? jam : 0),
    // Only dedicated spectrum-capability nodes create fungible EW mission capacity.
    // A ship's self-protection suite remains implicit in its defenses/counters.
    ew: ewRole ? Math.max(Number(old.ew || 0), jam) : 0,
    sof: sofRole ? old.sof : 0
  });
  node.resourceGenByType = next;
  node.resourceGen = Object.values(next).reduce((sum, value) => sum + value, 0);
  if (!Array.isArray(node.domain)) node.domain = node.domain ? [node.domain] : ['Land'];
  return node;
}

function patchNode(scenario, id, patch) {
  const node = scenario.nodes.find(item => item.id === id);
  if (!node) throw new Error(`Missing node ${id}`);
  Object.assign(node, patch);
  if (patch.resourceGenByType) {
    node.resourceGenByType = capacity(patch.resourceGenByType);
    node.resourceGen = Object.values(node.resourceGenByType).reduce((sum, value) => sum + value, 0);
  }
  return node;
}

function makeNode(spec) {
  const resources = capacity(spec.resourceGenByType || ZERO);
  return {
    id: spec.id,
    name: spec.name,
    team: spec.team,
    subsystem: spec.subsystem,
    domain: spec.domain,
    type: spec.type,
    health: 100,
    healthMax: 100,
    status: 'Active',
    difficulty: spec.difficulty || 'Hardened',
    vulnerabilities: spec.vulnerabilities || ['Cyber', 'Kinetic'],
    importance: spec.importance || 6,
    cascScore: spec.cascScore || 2,
    resourceGenByType: resources,
    resourceGen: Object.values(resources).reduce((sum, value) => sum + value, 0),
    lat: spec.lat,
    lon: spec.lon,
    locationPrecision: 'theater-aggregate',
    capabilityProfile: spec.capabilityProfile
  };
}

function upsertNode(scenario, spec) {
  const built = makeNode(spec);
  const index = scenario.nodes.findIndex(node => node.id === built.id);
  if (index >= 0) scenario.nodes[index] = { ...scenario.nodes[index], ...built };
  else scenario.nodes.push(built);
}

function addLinks(scenario, pairs) {
  pairs.forEach(([source, target]) => scenario.links.push({ source, target }));
}

function dedupeLinks(scenario) {
  const ids = new Set(scenario.nodes.map(node => node.id));
  const seen = new Set();
  scenario.links = scenario.links.filter(link => {
    const source = typeof link.source === 'object' ? link.source.id : link.source;
    const target = typeof link.target === 'object' ? link.target.id : link.target;
    if (!ids.has(source) || !ids.has(target) || source === target) return false;
    const key = [String(source), String(target)].sort().join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    link.source = source;
    link.target = target;
    return true;
  });
}

const redSources = [
  {
    id: 'DOD-CMPR-2024', title: 'Military and Security Developments Involving the PRC 2024',
    publisher: 'U.S. Department of Defense', year: 2024,
    url: 'https://media.defense.gov/2024/Dec/18/2003615520/-1/-1/0/MILITARY-AND-SECURITY-DEVELOPMENTS%20-INVOLVING-THE-PEOPLES-REPUBLIC-OF-CHINA-2024.PDF',
    supports: 'PLA 2024 reorganization and present-day information-force context; not exact modeled units or locations.'
  },
  {
    id: 'DOD-CMPR-2025', title: 'Military and Security Developments Involving the PRC 2025',
    publisher: 'U.S. Department of Defense', year: 2025,
    url: 'https://media.defense.gov/2025/Dec/23/2003849070/-1/-1/1/ANNUAL-REPORT-TO-CONGRESS-MILITARY-AND-SECURITY-DEVELOPMENTS-INVOLVING-THE-PEOPLES-REPUBLIC-OF-CHINA-2025.PDF',
    supports: 'Public assessment of PLA cyber, information-support, space, and Taiwan-contingency mission areas.'
  },
  {
    id: 'CISA-VOLT-2024', title: 'PRC State-Sponsored Actors Compromise and Maintain Persistent Access to U.S. Critical Infrastructure',
    publisher: 'CISA, NSA, FBI and partners', year: 2024,
    url: 'https://www.cisa.gov/sites/default/files/2024-02/aa24-038a-jcsa-prc-state-sponsored-actors-compromise-us-critical-infrastructure_1.pdf',
    supports: 'Public basis for modeling pre-positioned access risk; not proof of on-demand effects in this scenario.'
  },
  {
    id: 'ODIN-WEG', title: 'World Equipment Guide taxonomy', publisher: 'U.S. Army ODIN', year: 2026,
    url: 'https://odin.t2com.army.mil', supports: 'Equipment taxonomy separating cyber and EW, including electronic attack, support, and protection.'
  },
  {
    id: 'ODIN-J16D', title: 'J-16D Electronic Warfare Aircraft', publisher: 'U.S. Army ODIN', year: 2026,
    url: 'https://odin.t2com.army.mil/content.19cbc56d-c92e-4bbd-a013-a705f4910b4b', supports: 'Public equipment-class reference; not modeled quantity, readiness, or deployment.'
  },
  {
    id: 'ODIN-Y9LG', title: 'Y-9LG Electronic Warfare Aircraft', publisher: 'U.S. Army ODIN', year: 2026,
    url: 'https://odin.t2com.army.mil/content.e98a9282-33ed-49bc-9cf9-be31fd36ef76', supports: 'Public equipment-class reference for airborne spectrum operations.'
  },
  {
    id: 'ODIN-Y9JB', title: 'Y-9JB Electronic Intelligence Aircraft', publisher: 'U.S. Army ODIN', year: 2026,
    url: 'https://odin.t2com.army.mil/content.8adf51ed-1958-4247-bbf4-d86194d486a6', supports: 'Public equipment-class reference for airborne emitter collection.'
  },
  {
    id: 'ODIN-TYPE815G', title: 'Type 815G Intelligence Collection Ship', publisher: 'U.S. Army ODIN', year: 2026,
    url: 'https://odin.t2com.army.mil/content.570e9578-dbac-4811-ba9a-7221c0865138', supports: 'Public equipment-class reference for maritime electronic support.'
  },
  {
    id: 'USSF-FOE-2040', title: 'Future Operating Environment 2040', publisher: 'U.S. Space Force', year: 2026,
    url: 'https://www.spaceforce.mil/Portals/2/Documents/SAF_2026/Future_Operating_Environment_2040_Final.pdf',
    supports: 'Future-environment framing for hybrid, proliferated, automated, and contested space services; not exact force structure.'
  }
];

const blueSources = [
  {
    id: 'TWN-QDR-2025', title: '2025 Quadrennial Defense Review', publisher: 'Taiwan Ministry of National Defense', year: 2025,
    url: 'https://www.mnd.gov.tw/InformationServices/QDRFile/6/2/2025QDR%E8%8B%B1%E6%96%87%E7%89%88.pdf',
    supports: 'Sovereign command, cyber monitoring, spectrum management, mobile/redundant C2, multi-cloud, and resilience direction.'
  },
  {
    id: 'TWN-ICEFCOM-2024', title: 'ICEFCOM information-services publication', publisher: 'Taiwan Ministry of National Defense', year: 2024,
    url: 'https://www.mnd.gov.tw/en/informationservices/publication/83514', supports: 'Public confirmation of ICEFCOM cyber-defense and information-security responsibilities.'
  },
  {
    id: 'TWN-MODA-RESILIENCE', title: 'Communications and Cyber Resilience', publisher: 'Taiwan Ministry of Digital Affairs', year: 2026,
    url: 'https://moda.gov.tw/en/digital-affairs/communications-cyber-resilience/operations/310',
    supports: 'Civil communications-resilience architecture; military integration in this graph remains a scenario assumption.'
  },
  {
    id: 'USCYBERCOM-2025', title: '2025 Posture Statement', publisher: 'U.S. Cyber Command', year: 2025,
    url: 'https://www.cybercom.mil/Media/News/Article/4150133/posture-statement-of-lieutenant-general-william-j-hartman/',
    supports: 'JFHQ-C support, defensive cyber, hunt-forward, partner activity, and AI-adoption context.'
  },
  {
    id: 'US-ARMY-MDTF', title: 'Multi-Domain Task Force Fact Sheet', publisher: 'U.S. Army', year: 2023,
    url: 'https://api.army.mil/e2/c/downloads/2023/10/16/93d3689c/multi-domain-task-force-fact-sheet.pdf', supports: 'Public multi-domain effects organization and mission framing.'
  },
  {
    id: 'USSF-INDOPAC', title: 'U.S. Space Forces Indo-Pacific', publisher: 'U.S. Space Force', year: 2026,
    url: 'https://www.spaceforce.mil/About-Us/-Space-Force-Components/US-Space-Forces-Indo-Pacific/', supports: 'Theater space integration, command and control, awareness, and partner-cooperation roles.'
  },
  {
    id: 'USSF-FOE-2040', title: 'Future Operating Environment 2040', publisher: 'U.S. Space Force', year: 2026,
    url: 'https://www.spaceforce.mil/Portals/2/Documents/SAF_2026/Future_Operating_Environment_2040_Final.pdf', supports: 'Future-environment framing, not exact 2040 forces or guaranteed access.'
  },
  {
    id: 'JPN-MOD-2026', title: 'Direction of Defense Capability Transformation', publisher: 'Japan Ministry of Defense', year: 2026,
    url: 'https://www.mod.go.jp/en/d_policy/defense-capability-transformation/images/6th_19-mar-2026a.pdf', supports: 'Cyber, space, cloud, data, and electromagnetic-spectrum direction; participation remains conditional.'
  },
  {
    id: 'AUS-JCG', title: 'Joint Capabilities Group', publisher: 'Australian Department of Defence', year: 2026,
    url: 'https://www.defence.gov.au/about/who-we-are/organisation-structure/joint-capabilities-group', supports: 'Current cyber, space, information, and strategic-communications organizations; participation remains conditional.'
  }
];

function defaultProfiles(scenario, side) {
  scenario.nodes.forEach(node => {
    const text = roleText(node);
    const r = node.resourceGenByType;
    const info = /information attack|counter c2|\bcyber\b|\bew\b|electronic|spectrum|counterspace|network operations/.test(text) || r.cyber > 0 || r.ew > 0;
    if (!info || node.capabilityProfile) return;
    node.capabilityProfile = profile(
      'capability-service',
      r.cyber > 0 ? ['cyber-operations'] : r.ew > 0 ? ['electromagnetic-spectrum-operations'] : ['information-domain-enabler'],
      'assessed', 'medium', 'scenario-active',
      [side === 'red' ? 'DOD-CMPR-2025' : 'USCYBERCOM-2025'],
      'The node is a scenario-level capability aggregate. Its marker, mission capacity, readiness, and contingency tasking are illustrative.'
    );
    if (!node.locationPrecision) node.locationPrecision = 'illustrative';
  });
}

function upgradeRed(scenario) {
  scenario.nodes.forEach(canonicalizeNode);
  scenario.sources = redSources;
  scenario.metadata = {
    scenarioName: 'PLA cross-strait operating system — 2040 notional',
    description: 'Open-source-informed capability graph with explicit assessed and notional-2040 aggregates.',
    version: '2.0.0', classification: 'UNCLASSIFIED // NOTIONAL', resourceModel: 'resource-model-v2', updated: '2026-07-10'
  };

  const observed = (category, functions, refs, assumption, confidence = 'high') =>
    profile(category, functions, 'observed', confidence, 'scenario-active', refs, assumption);
  const assessed = (category, functions, refs, assumption) =>
    profile(category, functions, 'assessed', 'medium', 'scenario-active', refs, assumption);
  const future = (category, functions, refs, assumption) =>
    profile(category, functions, 'notional-2040', 'low', 'future-notional', refs, assumption);

  patchNode(scenario, 'PLA-CMD-011', {
    name: 'CMC Information Support Force Network Operations Center', domain: ['Cyber', 'Land'], locationPrecision: 'theater-aggregate',
    capabilityProfile: observed('network-information-support', ['network-operations', 'joint-information-support'], ['DOD-CMPR-2024', 'DOD-CMPR-2025'], 'Observed organization and mission class; the modeled operations center, marker, and theater relationship are analytical aggregates.')
  });
  patchNode(scenario, 'PLA-CMD-012', {
    name: 'CMC Aerospace Force Space Operations Center', locationPrecision: 'theater-aggregate',
    capabilityProfile: observed('space-command', ['space-command-and-control', 'mission-integration'], ['DOD-CMPR-2024', 'DOD-CMPR-2025'], 'Observed force role represented as a single service node; location and capacity are illustrative.')
  });
  patchNode(scenario, 'PLA-CMD-016', {
    name: 'Eastern Theater Joint Information Operations Fusion Center', locationPrecision: 'theater-aggregate',
    capabilityProfile: assessed('theater-fusion', ['multi-domain-fusion', 'effects-coordination'], ['DOD-CMPR-2025'], 'The exact center is an assessed theater-level aggregation, not a claimed unit or facility.')
  });
  patchNode(scenario, 'PLA-CMD-017', {
    name: 'Southern Theater Joint Information Support Element', locationPrecision: 'theater-aggregate',
    capabilityProfile: assessed('theater-information-support', ['network-support', 'data-relay-coordination'], ['DOD-CMPR-2025'], 'The exact element and marker are scenario abstractions.')
  });
  patchNode(scenario, 'PLA-REL-002', { name: 'Eastern Theater SATCOM and Data Relay Gateway', locationPrecision: 'theater-aggregate' });
  patchNode(scenario, 'PLA-REL-010', {
    name: 'Protected Backbone Segment — Beijing–Fuzhou', locationPrecision: 'theater-aggregate',
    capabilityProfile: future('protected-backbone', ['resilient-data-transport'], ['USSF-FOE-2040'], 'A more resilient protected backbone is a 2040 scenario assumption; no claim of universal quantum communications or immunity is made.')
  });
  patchNode(scenario, 'PLA-REL-011', { name: 'Information Support Force Mobile SATCOM Element', locationPrecision: 'theater-aggregate' });
  patchNode(scenario, 'PLA-REL-016', { name: 'Protected Backbone Relay — Hainan', locationPrecision: 'theater-aggregate' });
  patchNode(scenario, 'PLA-REL-017', { name: 'Eastern Theater Tactical Data Link Hub', locationPrecision: 'theater-aggregate' });
  patchNode(scenario, 'PLA-BLK-009', {
    name: 'Aerospace Force Reversible Counterspace Group', type: 'EW/Cyber', subsystem: 'Information Attack', domain: ['Space', 'EW'],
    resourceGenByType: { ew: 3 }, locationPrecision: 'theater-aggregate',
    capabilityProfile: assessed('reversible-counterspace', ['satcom-interference', 'pnt-interference'], ['DOD-CMPR-2025', 'ODIN-WEG'], 'This models a reversible theater effect package. It is not an always-available kinetic ASAT unit or a claimed deployment.')
  });

  const redUpdates = {
    'PLA-IAK-001': ['CMC Cyberspace Force Operations Center', ['Cyber'], ZERO, observed('cyber-command', ['cyber-command-and-control'], ['DOD-CMPR-2024', 'DOD-CMPR-2025'], 'Observed force role represented as an aggregate command service; no offensive capacity is assigned to the headquarters itself.')],
    'PLA-IAK-002': ['Taiwan Theater Cyber Mission Group', ['Cyber'], { cyber: 4 }, assessed('cyber-effects', ['c4isr-disruption', 'network-access'], ['DOD-CMPR-2025'], 'The mission group and value are analytical aggregates; exact force structure, access, and timing are unknown.')],
    'PLA-IAK-003': ['Eastern Theater Spectrum Warfare Brigade', ['EW'], { ew: 5 }, assessed('electromagnetic-warfare', ['electronic-attack', 'electronic-support', 'electronic-protection'], ['DOD-CMPR-2025', 'ODIN-WEG'], 'The brigade label and capacity aggregate theater-level spectrum effects rather than identify a verified formation.')],
    'PLA-IAK-004': ['Airborne Electronic Attack Group — J-16D/J-15D aggregate', ['Air', 'EW'], { ew: 4 }, assessed('airborne-electronic-attack', ['escort-jamming', 'stand-in-electronic-attack'], ['DOD-CMPR-2025', 'ODIN-J16D'], 'ODIN anchors the J-16D equipment class; the mixed group, availability, marker, and capacity are scenario assumptions.')],
    'PLA-IAK-005': ['Taiwan Cognitive Operations Cell', ['Information'], ZERO, assessed('cognitive-operations', ['influence-support', 'narrative-amplification'], ['DOD-CMPR-2025'], 'Modeled as an information capability with no generic cyber, EW, or SOF currency.')],
    'PLA-IAK-006': ['PNT and SATCOM Denial Group', ['Space', 'EW'], { ew: 3 }, assessed('space-electromagnetic-warfare', ['pnt-interference', 'satcom-interference'], ['DOD-CMPR-2025', 'ODIN-WEG'], 'This is a reversible spectrum-effects aggregate, not a claim of exact unit structure or continuous coverage.')],
    'PLA-IAK-007': ['Eastern Theater Electronic Countermeasures Group', ['EW'], { ew: 4 }, assessed('electromagnetic-warfare', ['electronic-attack', 'electronic-protection'], ['DOD-CMPR-2025', 'ODIN-WEG'], 'Capacity and marker are theater-level analytical abstractions.')],
    'PLA-IAK-008': ['PNT / Navigation Warfare Battalion', ['EW', 'Space'], { ew: 4 }, assessed('navigation-warfare', ['pnt-interference', 'navigation-deception'], ['DOD-CMPR-2025', 'ODIN-WEG'], 'The battalion name and capacity are game abstractions; effect range and availability are not public facts.')],
    'PLA-IAK-009': ['Critical Infrastructure Access Portfolio', ['Cyber'], { cyber: 3 }, assessed('cyber-access', ['pre-positioned-access', 'critical-infrastructure-risk'], ['CISA-VOLT-2024'], 'The source supports persistent-access risk, not guaranteed wartime access, effect, attribution, or timing.')]
  };
  Object.entries(redUpdates).forEach(([id, [name, domain, resources, capabilityProfile]]) => {
    patchNode(scenario, id, { name, domain, resourceGenByType: resources, capabilityProfile, locationPrecision: 'theater-aggregate' });
  });

  const redNew = [
    ['PLA-IAK-010', 'Space / C4ISR Cyber Access Group', ['Cyber', 'Space'], 'EW/Cyber', { cyber: 3 }, assessed('cyber-access', ['c4isr-access', 'space-ground-segment-access'], ['DOD-CMPR-2025'], 'The group and access are assessed scenario abstractions; access can be discovered, denied, or unavailable.'), 27.0, 119.0],
    ['PLA-IAK-011', 'Force-Projection and Logistics Cyber Effects Group', ['Cyber'], 'EW/Cyber', { cyber: 3 }, assessed('cyber-effects', ['logistics-disruption', 'force-flow-disruption'], ['DOD-CMPR-2025', 'CISA-VOLT-2024'], 'Public reporting supports target classes, not guaranteed access or on-demand effects.'), 26.4, 118.8],
    ['PLA-IAK-012', 'Cyberspace Mission Assurance Group', ['Cyber'], 'EW/Cyber', { cyber: 2 }, assessed('cyber-defense', ['mission-assurance', 'incident-response', 'service-recovery'], ['DOD-CMPR-2025'], 'The defensive mission grouping and capacity are scenario abstractions.'), 30.5, 114.3],
    ['PLA-IAK-013', 'Spectrum Reconnaissance and Emitter-Mapping Group', ['Air', 'EW'], 'Sensor', { ew: 2 }, assessed('electronic-support', ['spectrum-reconnaissance', 'emitter-mapping'], ['ODIN-Y9LG', 'ODIN-Y9JB', 'ODIN-TYPE815G'], 'ODIN anchors equipment classes; the cross-platform group and availability are not claimed real units.'), 27.4, 120.3],
    ['PLA-IAK-014', 'Distributed Cognitive EW Mesh', ['EW'], 'EW/Cyber', { ew: 3 }, future('adaptive-electromagnetic-warfare', ['adaptive-waveforms', 'distributed-emitter-coordination'], ['USSF-FOE-2040'], 'AI-assisted distributed EW at this maturity is an explicit 2040 game assumption, not a current capability claim.'), 25.8, 119.4],
    ['PLA-IAK-015', 'Autonomous Cyber Support and Recovery Cell', ['Cyber'], 'EW/Cyber', { cyber: 2 }, future('cyber-mission-assurance', ['automated-triage', 'assisted-service-recovery'], ['USSF-FOE-2040'], 'Automation assists human-authorized recovery; it is not autonomous victory or perfect defense.'), 31.0, 118.4],
    ['PLA-IAK-016', 'Proliferated LEO Data Relay and Reconstitution Service', ['Space'], 'Comms', ZERO, future('space-data-service', ['proliferated-relay', 'responsive-reconstitution'], ['USSF-FOE-2040'], 'A mature proliferated and reconstitutable service is a 2040 scenario assumption; exact architecture is unspecified.'), 32.0, 112.0],
    ['PLA-IAK-017', 'State-Media and Proxy Amplification Network', ['Information'], 'Support', ZERO, assessed('external-information-enabler', ['content-amplification', 'proxy-distribution'], ['DOD-CMPR-2025'], 'This is an external Red enabler, not represented as a PLA formation and not given cyber/EW/SOF currency.'), 35.0, 110.0]
  ];
  redNew.forEach(([id, name, domain, type, resources, capabilityProfile, lat, lon]) => upsertNode(scenario, {
    id, name, team: 'red', subsystem: 'Information Attack', domain, type, resourceGenByType: resources,
    capabilityProfile, lat, lon, vulnerabilities: ['Cyber', 'Kinetic', 'EW'], importance: 6, cascScore: 3
  }));

  addLinks(scenario, [
    ['PLA-IAK-010', 'PLA-CMD-011'], ['PLA-IAK-010', 'PLA-CMD-016'], ['PLA-IAK-010', 'PLA-REL-017'],
    ['PLA-IAK-011', 'PLA-CMD-011'], ['PLA-IAK-011', 'PLA-CMD-016'], ['PLA-IAK-011', 'PLA-LOG-001'],
    ['PLA-IAK-012', 'PLA-CMD-011'], ['PLA-IAK-012', 'PLA-REL-017'],
    ['PLA-IAK-013', 'PLA-CMD-016'], ['PLA-IAK-013', 'PLA-SEN-003'], ['PLA-IAK-013', 'PLA-IAK-003'], ['PLA-IAK-013', 'PLA-IAK-004'],
    ['PLA-IAK-014', 'PLA-CMD-016'], ['PLA-IAK-014', 'PLA-IAK-013'], ['PLA-IAK-014', 'PLA-REL-005'],
    ['PLA-IAK-015', 'PLA-CMD-011'], ['PLA-IAK-015', 'PLA-IAK-002'], ['PLA-IAK-015', 'PLA-IAK-009'],
    ['PLA-IAK-016', 'PLA-CMD-012'], ['PLA-IAK-016', 'PLA-REL-002'], ['PLA-IAK-016', 'PLA-REL-013'],
    ['PLA-IAK-017', 'PLA-CMD-016'], ['PLA-IAK-017', 'PLA-IAK-005'], ['PLA-IAK-017', 'PLA-REL-017']
  ]);
  defaultProfiles(scenario, 'red');
  dedupeLinks(scenario);
}

function upgradeBlue(scenario) {
  scenario.nodes.forEach(canonicalizeNode);
  // Directed-energy fires are kinetic capabilities, not fungible EW mission packages.
  ['USA-FIR-015', 'USA-FIR-016', 'USA-FIR-025'].forEach(id => patchNode(scenario, id, {
    resourceGenByType: { ...scenario.nodes.find(node => node.id === id).resourceGenByType, ew: 0 }
  }));
  scenario.sources = blueSources;
  scenario.metadata = {
    scenarioName: 'Taiwan-led defense network with conditional partners — 2040 notional',
    description: 'Sovereign Taiwan resilience core plus active U.S. services and explicitly conditional partner/commercial support.',
    version: '2.0.0', classification: 'UNCLASSIFIED // NOTIONAL', resourceModel: 'resource-model-v2', updated: '2026-07-10'
  };

  const observed = (category, functions, refs, assumption, confidence = 'high', availability = 'scenario-active', possible) =>
    profile(category, functions, 'observed', confidence, availability, refs, assumption, possible);
  const assessed = (category, functions, refs, assumption, availability = 'scenario-active', possible) =>
    profile(category, functions, 'assessed', 'medium', availability, refs, assumption, possible);
  const future = (category, functions, refs, assumption) =>
    profile(category, functions, 'notional-2040', 'low', 'future-notional', refs, assumption);

  patchNode(scenario, 'USA-CMD-005', {
    name: 'INDOPACOM Multi-Domain Effects Coordination Node', domain: ['Land', 'Cyber', 'EW'],
    resourceGenByType: ZERO, locationPrecision: 'theater-aggregate',
    capabilityProfile: assessed('effects-coordination', ['multi-domain-effects-coordination', 'authorities-management'], ['US-ARMY-MDTF', 'USCYBERCOM-2025'], 'This is a theater coordination service, not a claimed brigade at a named installation or a source of effects itself.')
  });

  const blueUpdates = {
    'USA-IAK-001': ['Joint Cyber Mission Force Package — Theater', ['Cyber'], { cyber: 4 }, observed('cyber-mission-force', ['cyber-effects', 'defensive-cyber-support'], ['USCYBERCOM-2025'], 'The mission-force construct is public; exact contingency package, access, marker, and capacity are scenario assumptions.', 'medium')],
    'USA-IAK-002': ['Space Forces Indo-Pacific Integration Cell', ['Space'], ZERO, observed('theater-space-integration', ['space-command-and-control', 'space-domain-awareness'], ['USSF-INDOPAC'], 'Observed theater role represented as a single service node; it does not create a generic space-attack resource.')],
    'USA-IAK-003': ['Multi-Domain Effects Battalion — Cyber / EW Element', ['Cyber', 'EW'], { cyber: 2, ew: 2 }, assessed('multi-domain-effects', ['cyber-support', 'electromagnetic-warfare'], ['US-ARMY-MDTF'], 'The combined package and values are analytical abstractions, not an exact deployed formation.')],
    'USA-IAK-004': ['Joint Electromagnetic Spectrum Operations Package', ['EW'], { ew: 4 }, assessed('joint-electromagnetic-spectrum-operations', ['electronic-attack', 'electronic-support', 'electronic-protection'], ['US-ARMY-MDTF'], 'The package is a theater-level capability aggregate; location and capacity are illustrative.')],
    'USA-IAK-005': ['Taiwan Mission Partner Cyber Defense Package', ['Cyber'], { cyber: 2 }, assessed('partner-cyber-defense', ['threat-hunting', 'incident-response'], ['TWN-QDR-2025', 'USCYBERCOM-2025'], 'Availability, authorities, access, and capacity are scenario assumptions; the package does not imply unrestricted network access.')],
    'USA-IAK-006': ['Space Electromagnetic Warfare Mission Package', ['Space', 'EW'], { ew: 3 }, assessed('space-electromagnetic-warfare', ['satcom-protection', 'spectrum-effects'], ['USSF-INDOPAC'], 'This aggregate models reversible spectrum activity and does not imply destructive counterspace or an Australian deployment.')],
    'USA-IAK-007': ['Japan Cyber / EW Coordination Package', ['Cyber', 'EW'], ZERO, assessed('partner-coordination', ['cyber-coordination', 'spectrum-coordination'], ['JPN-MOD-2026'], 'Japanese support requires an independent political, legal, and operational decision.', 'conditional-partner', { cyber: 1, ew: 1 })],
    'USA-IAK-008': ['Electromagnetic Battle Management Service', ['EW'], { ew: 2 }, assessed('electromagnetic-battle-management', ['spectrum-awareness', 'frequency-coordination'], ['US-ARMY-MDTF'], 'The service is an aggregate theater function; marker and capacity are illustrative.')],
    'USA-IAK-009': ['JFHQ-C / Defensive Cyber Package', ['Cyber'], { cyber: 3 }, observed('defensive-cyber', ['combatant-command-support', 'hunt', 'incident-response'], ['USCYBERCOM-2025'], 'The role is public; the contingency package, partner access, marker, and capacity are scenario assumptions.', 'medium')],
    'USA-IAK-010': ['U.S. Space Cyber Mission Assurance Package', ['Cyber', 'Space'], { cyber: 2 }, assessed('space-cyber-defense', ['mission-assurance', 'ground-segment-defense'], ['USSF-INDOPAC', 'USSF-FOE-2040'], 'This is an abstract mission-assurance service, not a claimed company or Japanese deployment.')]
  };
  Object.entries(blueUpdates).forEach(([id, [name, domain, resources, capabilityProfile]]) => {
    patchNode(scenario, id, { name, domain, resourceGenByType: resources, capabilityProfile, locationPrecision: 'theater-aggregate' });
  });

  const blueNew = [
    ['TWN-CMD-001', 'ICEFCOM Joint Operations Center', ['Land', 'Cyber', 'EW'], 'Command', ZERO, observed('national-information-command', ['cyber-defense-coordination', 'communications-coordination', 'electromagnetic-spectrum-coordination'], ['TWN-ICEFCOM-2024', 'TWN-QDR-2025'], 'Observed responsibilities are represented as one national command-service node; marker and wartime organization are illustrative.'), 23.7, 120.9, 9, 4],
    ['TWN-REL-001', 'Distributed Defense Data Fabric', ['Cyber', 'Land'], 'Relay', ZERO, future('defense-data-service', ['distributed-data', 'edge-compute', 'identity-services'], ['TWN-QDR-2025', 'USSF-FOE-2040'], 'A mature distributed defense data fabric is a 2040 scenario assumption.'), 23.6, 120.8, 8, 4],
    ['TWN-REL-002', 'Terrestrial Fiber / Microwave Backbone', ['Land'], 'Relay', ZERO, observed('terrestrial-transport', ['fiber-transport', 'microwave-transport'], ['TWN-QDR-2025', 'TWN-MODA-RESILIENCE'], 'Public resilience direction supports the service class; military topology and marker are illustrative.'), 23.4, 120.7, 7, 3],
    ['TWN-REL-003', 'Mobile / PPDR Communications Layer', ['Land'], 'Relay', ZERO, assessed('mobile-resilient-communications', ['mobile-command-connectivity', 'priority-public-safety-communications'], ['TWN-QDR-2025', 'TWN-MODA-RESILIENCE'], 'Civil and defense service integration is a scenario assumption.'), 23.9, 121.0, 7, 3],
    ['TWN-REL-004', 'NGSO Emergency Access Cluster', ['Space'], 'Relay', ZERO, assessed('commercial-satellite-access', ['emergency-backhaul', 'alternate-satcom'], ['TWN-MODA-RESILIENCE'], 'This aggregates contracted emergency access; provider participation, terminals, bandwidth, and wartime availability are conditional.'), 24.1, 121.1, 6, 3],
    ['TWN-REL-005', 'Taiwan Mission Partner Gateway', ['Cyber', 'Land'], 'Relay', ZERO, future('mission-partner-gateway', ['cross-domain-sharing', 'identity-and-release-controls'], ['TWN-QDR-2025', 'USSF-FOE-2040'], 'A mature coalition gateway and data-release regime are explicit 2040 scenario assumptions.'), 24.0, 120.7, 8, 4],
    ['TWN-CYB-001', 'Military Network Defense / SOC Pool', ['Cyber'], 'Support', { cyber: 3 }, observed('defensive-cyber', ['monitoring', 'isolation', 'incident-response'], ['TWN-ICEFCOM-2024', 'TWN-QDR-2025'], 'Observed mission responsibilities are aggregated into one capacity pool; team count and readiness are not asserted.'), 23.8, 120.6, 8, 3],
    ['TWN-CYB-002', 'Critical Infrastructure Cyber Coordination', ['Cyber'], 'Support', { cyber: 2 }, assessed('civil-military-cyber-coordination', ['telecom-coordination', 'energy-coordination', 'port-and-cloud-coordination'], ['TWN-MODA-RESILIENCE', 'TWN-QDR-2025'], 'Cross-sector operational integration and capacity are scenario assumptions.'), 23.2, 120.8, 7, 3],
    ['TWN-CYB-003', 'Clean Backup and Service Recovery Layer', ['Cyber'], 'Support', { cyber: 1 }, future('cyber-recovery', ['clean-backup', 'credential-rotation', 'service-rebuild'], ['TWN-QDR-2025', 'USSF-FOE-2040'], 'Automated assistance and recovery depth are 2040 assumptions; human authorization remains required.'), 23.5, 121.1, 7, 3],
    ['TWN-EW-001', 'Spectrum Awareness and Management Service', ['EW'], 'Sensor', { ew: 1 }, observed('spectrum-management', ['interference-detection', 'frequency-coordination'], ['TWN-QDR-2025'], 'The mission is public; the aggregate node and capacity are scenario abstractions.'), 24.2, 120.8, 7, 3],
    ['TWN-EW-002', 'Dispersed Electronic Protection / EW Package', ['EW'], 'Support', { ew: 3 }, assessed('electromagnetic-warfare', ['electronic-protection', 'deception', 'limited-jamming'], ['TWN-QDR-2025'], 'Exact systems, dispersal, authorities, range, and capacity are not public facts.'), 22.9, 120.7, 7, 3],
    ['TWN-SEN-001', 'Taiwan EO / SAR Mission Service', ['Space'], 'Sensor', ZERO, future('space-imagery-service', ['electro-optical-imagery', 'synthetic-aperture-radar-imagery'], ['TWN-QDR-2025', 'USSF-FOE-2040'], 'Sovereign and contracted imagery are aggregated as a future service; access and survivability are not guaranteed.'), 24.3, 121.0, 7, 3],
    ['TWN-REL-006', 'Satellite Ground and Mission Operations Service', ['Space', 'Land'], 'Relay', ZERO, assessed('space-ground-service', ['tasking', 'downlink', 'mission-data-processing'], ['TWN-QDR-2025'], 'The node represents a distributed service, not a single targetable facility.'), 23.0, 121.0, 7, 3],
    ['TWN-INF-001', 'Cognitive Defense and Attribution Cell', ['Information', 'Cyber'], 'Support', ZERO, assessed('cognitive-defense', ['incident-verification', 'attribution-support', 'deception-exposure'], ['TWN-QDR-2025'], 'This capability affects trust and decision quality and does not generate generic cyber damage.'), 25.0, 121.0, 6, 2],
    ['TWN-REL-007', 'Public Alert and Trusted Distribution Network', ['Information', 'Land'], 'Relay', ZERO, observed('trusted-public-information', ['public-warning', 'trusted-distribution'], ['TWN-MODA-RESILIENCE'], 'The public service class is observed; defense integration and wartime behavior are scenario assumptions.'), 23.1, 120.6, 6, 2],
    ['BLU-REL-001', 'Multi-Provider Commercial SATCOM Portfolio', ['Space'], 'Relay', ZERO, assessed('commercial-satcom', ['alternate-connectivity', 'bulk-transport'], ['TWN-MODA-RESILIENCE', 'USSF-FOE-2040'], 'Service depends on contracts, provider willingness, terminals, bandwidth, policy, and technical reachability.', 'commercial-contract'), 21.0, 133.0, 6, 2],
    ['BLU-REL-002', 'Overseas Cloud / CDN and International Transit', ['Cyber'], 'Relay', ZERO, assessed('commercial-cloud-and-transit', ['external-hosting', 'content-delivery', 'international-transit'], ['TWN-MODA-RESILIENCE'], 'Service is commercial and conditional; loss should degrade availability rather than imply physical destruction.', 'commercial-contract'), 20.0, 138.0, 6, 2],
    ['USA-REL-016', 'Mission Partner Environment / CJADC2 Service', ['Cyber', 'Land'], 'Relay', ZERO, future('mission-partner-data-service', ['controlled-data-sharing', 'joint-data-integration'], ['USCYBERCOM-2025', 'USSF-FOE-2040'], 'Seamless coalition interoperability is not assumed; this node represents an authorized, controlled 2040 service.'), 18.0, 140.0, 7, 3],
    ['USA-SPC-001', 'Hybrid SATCOM / PNT Service', ['Space'], 'Relay', ZERO, future('hybrid-space-service', ['satcom', 'pnt', 'service-rerouting'], ['USSF-INDOPAC', 'USSF-FOE-2040'], 'Military, allied, and commercial services are aggregated; Taiwan access is not automatic.'), 16.0, 145.0, 7, 3],
    ['JPN-CYB-001', 'JSDF Cyber Defense Package', ['Cyber'], 'Support', ZERO, observed('partner-cyber-defense', ['cyber-situational-awareness', 'incident-response'], ['JPN-MOD-2026'], 'Japanese participation and network access require independent political, legal, and operational decisions.', 'medium', 'conditional-partner', { cyber: 2 }) , 35.7, 139.7, 6, 2],
    ['AUS-CYB-001', 'ADF Cyber Command Package', ['Cyber'], 'Support', ZERO, observed('partner-cyber-defense', ['defensive-cyber', 'information-warfare-support'], ['AUS-JCG'], 'Australian participation and network access require independent government and operational decisions.', 'medium', 'conditional-partner', { cyber: 2 }), -25.3, 133.8, 6, 2]
  ];
  blueNew.forEach(([id, name, domain, type, resources, capabilityProfile, lat, lon, importance, cascScore]) => upsertNode(scenario, {
    id, name, team: 'blue', subsystem: 'Counter C2', domain, type, resourceGenByType: resources,
    capabilityProfile, lat, lon, importance, cascScore, vulnerabilities: ['Cyber', 'Kinetic', 'EW']
  }));

  addLinks(scenario, [
    ['TWN-CMD-001', 'TWN-REL-001'], ['TWN-CMD-001', 'TWN-CYB-001'], ['TWN-CMD-001', 'TWN-EW-001'],
    ['TWN-REL-001', 'TWN-REL-002'], ['TWN-REL-001', 'TWN-REL-003'], ['TWN-REL-001', 'TWN-REL-004'],
    ['TWN-REL-001', 'TWN-REL-005'], ['TWN-REL-001', 'TWN-REL-006'], ['TWN-REL-001', 'TWN-REL-007'],
    ['TWN-REL-001', 'BLU-REL-001'], ['TWN-REL-001', 'BLU-REL-002'],
    ['TWN-CYB-001', 'TWN-CYB-002'], ['TWN-CYB-001', 'TWN-CYB-003'], ['TWN-CYB-001', 'TWN-CMD-001'],
    ['TWN-EW-001', 'TWN-EW-002'], ['TWN-EW-001', 'TWN-CMD-001'],
    ['TWN-SEN-001', 'TWN-REL-006'], ['TWN-SEN-001', 'TWN-REL-001'],
    ['TWN-INF-001', 'TWN-REL-007'], ['TWN-INF-001', 'TWN-CYB-002'],
    ['TWN-REL-005', 'USA-CMD-005'], ['TWN-REL-005', 'USA-IAK-001'], ['TWN-REL-005', 'USA-REL-016'],
    ['TWN-REL-005', 'JPN-CYB-001'], ['TWN-REL-005', 'AUS-CYB-001'],
    ['BLU-REL-001', 'TWN-REL-004'], ['BLU-REL-001', 'USA-SPC-001'],
    ['BLU-REL-002', 'TWN-REL-001'], ['BLU-REL-002', 'TWN-REL-005'],
    ['USA-REL-016', 'USA-CMD-005'], ['USA-REL-016', 'USA-IAK-001'],
    ['USA-SPC-001', 'USA-IAK-002'], ['USA-SPC-001', 'USA-IAK-006'], ['USA-SPC-001', 'USA-IAK-010']
  ]);
  defaultProfiles(scenario, 'blue');
  dedupeLinks(scenario);
}

function write(name, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(path.join(ROOT, name), text);
  if (fs.existsSync(SITE)) fs.writeFileSync(path.join(SITE, name), text);
}

function totals(scenario) {
  return scenario.nodes.reduce((sum, node) => {
    Object.keys(sum).forEach(key => { sum[key] += node.resourceGenByType[key]; });
    return sum;
  }, { kinetic: 0, cyber: 0, ew: 0, sof: 0 });
}

const red = read('grok150red.json');
const blue = read('grokblue90.json');
upgradeRed(red);
upgradeBlue(blue);
write('grok150red.json', red);
write('grokblue90.json', blue);

console.log(`Red: ${red.nodes.length} nodes / ${red.links.length} links / ${JSON.stringify(totals(red))}`);
console.log(`Blue: ${blue.nodes.length} nodes / ${blue.links.length} links / ${JSON.stringify(totals(blue))}`);
