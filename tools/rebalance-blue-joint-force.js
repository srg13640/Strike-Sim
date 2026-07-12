#!/usr/bin/env node
'use strict';

/*
 * Repeatable Blue-force conversion: Army-centric future-force study ->
 * Taiwan-led Joint Force network. Existing node IDs and links stay stable so saved
 * references fail safely through the scenario fingerprint rather than dangling.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'grokblue90.json');
const ZERO = Object.freeze({ kinetic: 0, cyber: 0, ew: 0, sof: 0 });

const sources = [
  { id: 'TWN-QDR-2025', title: '2025 Quadrennial Defense Review', publisher: 'Taiwan Ministry of National Defense', year: 2025, url: 'https://www.mnd.gov.tw/InformationServices/QDRFile/6/2/2025QDR%E8%8B%B1%E6%96%87%E7%89%88.pdf', supports: 'Multi-domain denial, resilient defense, redundant C2 and logistics; not exact modeled formations.' },
  { id: 'TWN-NDR-2025', title: 'National Defense Report 2025', publisher: 'Taiwan Ministry of National Defense', year: 2025, url: 'https://www.mnd.gov.tw/newupload/ndr/114/114ndreng.pdf', supports: 'Taiwan force development, joint readiness and whole-of-society resilience.' },
  { id: 'USN-C7F', title: 'Seventh Fleet Facts Sheet', publisher: 'U.S. Seventh Fleet', year: 2025, url: 'https://www.c7f.navy.mil/About-Us/Facts-Sheet/', supports: 'Public maritime command, surface, undersea and naval aviation capability classes; not scenario presence or readiness.' },
  { id: 'USN-PACFLT', title: 'Pacific Fleet Organization', publisher: 'U.S. Pacific Fleet', year: 2026, url: 'https://www.cpf.navy.mil/About-Us/Organization/', supports: 'Distributed maritime operations, information warfare and fleet readiness mission areas.' },
  { id: 'USN-SUBPAC', title: 'Commander, Submarine Force Pacific Mission', publisher: 'U.S. Navy', year: 2026, url: 'https://www.csp.navy.mil/About-SUBPAC/', supports: 'Public undersea warfare, strike, ISR, mine and special-warfare mission classes.' },
  { id: 'USN-P8', title: 'P-8A Poseidon Fact File', publisher: 'U.S. Navy', year: 2025, url: 'https://www.navy.mil/Resources/Fact-Files/Display-FactFiles/Article/2166300/p-8a-poseidon-multi-mission-maritime-aircraft-mma/', supports: 'Maritime patrol, reconnaissance and anti-submarine mission class.' },
  { id: 'USN-MQ4C', title: 'MQ-4C Triton', publisher: 'Naval Air Systems Command', year: 2026, url: 'https://www.navair.navy.mil/product/MQ-4C', supports: 'Persistent maritime ISR capability class.' },
  { id: 'USMC-3MLR', title: '3d Marine Littoral Regiment', publisher: 'U.S. Marine Corps', year: 2026, url: 'https://www.3rdmlr.marines.mil/', supports: 'Stand-in force, reconnaissance, counter-reconnaissance and sea-denial roles.' },
  { id: 'USMC-FORCE-DESIGN', title: 'Force Design', publisher: 'U.S. Marine Corps', year: 2026, url: 'https://www.marines.mil/Force-Design/', supports: 'Littoral, sensing, fires, protection and logistics capability direction.' },
  { id: 'USAF-PACAF', title: 'PACAF Mission, Vision and Priorities', publisher: 'Pacific Air Forces', year: 2026, url: 'https://www.pacaf.af.mil/Info/Mission-Vision-Priorities/PACAFSelectorButton/', supports: 'Joint air, space and cyberspace integration with allies and partners.' },
  { id: 'USAF-ACE', title: 'Agile Combat Employment', publisher: 'U.S. Air Force Doctrine', year: 2022, url: 'https://www.doctrine.af.mil/Portals/61/documents/AFDN_1-21/AFDN%201-21%20ACE.pdf', supports: 'Distributed, resilient air operations from dispersed locations.' },
  { id: 'USAF-BTF', title: 'Bomber Task Force 25-1', publisher: 'Air Force Global Strike Command', year: 2025, url: 'https://www.afgsc.af.mil/News/Article-Display/Article/4053007/btf-25-1-projects-indo-pacific-air-power-capabilities/', supports: 'Public long-range strike, refueling and joint/coalition training context.' },
  { id: 'USAF-CCA', title: 'Collaborative Combat Aircraft Mission Design Series', publisher: 'U.S. Air Force', year: 2025, url: 'https://www.aflcmc.af.mil/NEWS/Article-Display/Article/4096130/air-force-designates-two-mission-design-series-for-collaborative-combat-aircraft/', supports: 'Current CCA development; scaled 2040 formations remain notional.' },
  { id: 'USSF-INDOPAC', title: 'U.S. Space Forces Indo-Pacific', publisher: 'U.S. Space Force', year: 2026, url: 'https://www.spaceforce.mil/About-Us/-Space-Force-Components/US-Space-Forces-Indo-Pacific/', supports: 'Theater space integration, command, awareness, targeting and partner cooperation.' },
  { id: 'SDA-PWSA', title: 'Proliferated Warfighter Space Architecture FAQ', publisher: 'Space Development Agency', year: 2026, url: 'https://www.sda.mil/home/about-us/faq/', supports: 'Transport, tracking, tactical data and battle-management service classes.' },
  { id: 'USCYBERCOM-2025', title: '2025 Posture Statement', publisher: 'U.S. Cyber Command', year: 2025, url: 'https://www.cybercom.mil/Media/News/Article/4150133/posture-statement-of-lieutenant-general-william-j-hartman/', supports: 'JFHQ-C, defensive cyber, partner activity, mission assurance and theater support.' },
  { id: 'US-ARMY-MDTF', title: 'Multi-Domain Task Force Fact Sheet', publisher: 'U.S. Army', year: 2023, url: 'https://api.army.mil/e2/c/downloads/2023/10/16/93d3689c/multi-domain-task-force-fact-sheet.pdf', supports: 'Public MDTF organization and all-domain sensing/effects mission framing.' },
  { id: 'MSC-FE', title: 'MSC Far East Mission, Vision and History', publisher: 'Military Sealift Command', year: 2026, url: 'https://www.msc.usff.navy.mil/Organization/MSC-Area-Commands/MSC-Far-East/Mission-Vision-History/', supports: 'Combat logistics, special mission, prepositioning and strategic sealift roles.' },
  { id: 'SOCOM-FACT-2025', title: '2025 USSOCOM Fact Book', publisher: 'U.S. Special Operations Command', year: 2025, url: 'https://www.socom.mil/FactBook/2025%20Fact%20Book.pdf', supports: 'SOCPAC as the theater functional component; not fungible strike capacity.' },
  { id: 'PHL-US-2024', title: 'Philippines-United States 2+2 Ministerial Dialogue', publisher: 'U.S. Department of Defense', year: 2024, url: 'https://www.defense.gov/News/Releases/Release/Article/3854902/joint-statement-on-the-philippines-united-states-fourth-22-ministerial-dialogue/', supports: 'Alliance cooperation and access context; not guaranteed contingency participation.' },
  { id: 'JPN-MOD-2026', title: 'Direction of Defense Capability Transformation', publisher: 'Japan Ministry of Defense', year: 2026, url: 'https://www.mod.go.jp/en/d_policy/defense-capability-transformation/images/6th_19-mar-2026a.pdf', supports: 'Current cyber, space, data and electromagnetic direction; participation remains conditional.' },
  { id: 'AUS-JCG', title: 'Joint Capabilities Group', publisher: 'Australian Department of Defence', year: 2026, url: 'https://www.defence.gov.au/about/who-we-are/organisation-structure/joint-capabilities-group', supports: 'Current joint cyber, space and information organizations; participation remains conditional.' },
  { id: 'TWN-MODA-RESILIENCE', title: 'Communications and Cyber Resilience', publisher: 'Taiwan Ministry of Digital Affairs', year: 2026, url: 'https://moda.gov.tw/en/digital-affairs/communications-cyber-resilience/operations/310', supports: 'Civil communications-resilience architecture; military integration remains a scenario assumption.' }
];

const OWNER = {
  JOINT: { nation: 'United States', serviceOwner: 'U.S. Joint Force', component: 'USINDOPACOM Joint Task Force', refs: ['USCYBERCOM-2025', 'SOCOM-FACT-2025', 'USN-PACFLT'] },
  ARMY: { nation: 'United States', serviceOwner: 'U.S. Army', component: 'U.S. Army Pacific', refs: ['US-ARMY-MDTF'] },
  NAVY: { nation: 'United States', serviceOwner: 'U.S. Navy', component: 'U.S. Pacific Fleet', refs: ['USN-C7F', 'USN-PACFLT', 'USN-SUBPAC', 'USN-P8', 'USN-MQ4C', 'MSC-FE'] },
  AIR: { nation: 'United States', serviceOwner: 'U.S. Air Force', component: 'Pacific Air Forces', refs: ['USAF-PACAF', 'USAF-ACE', 'USAF-BTF', 'USAF-CCA'] },
  MARINE: { nation: 'United States', serviceOwner: 'U.S. Marine Corps', component: 'Marine Forces Pacific', refs: ['USMC-3MLR', 'USMC-FORCE-DESIGN'] },
  SPACE: { nation: 'United States', serviceOwner: 'U.S. Space Force', component: 'U.S. Space Forces Indo-Pacific', refs: ['USSF-INDOPAC', 'SDA-PWSA'] },
  TAIWAN: { nation: 'Taiwan', serviceOwner: 'Taiwan Armed Forces', component: 'Taiwan Joint Force', refs: ['TWN-QDR-2025', 'TWN-NDR-2025'] },
  PARTNER: { nation: 'Conditional partner', serviceOwner: 'Conditional Partner Forces', component: 'Mission Partner Package', refs: ['PHL-US-2024', 'JPN-MOD-2026', 'AUS-JCG'] },
  COMMERCIAL: { nation: 'Commercial', serviceOwner: 'Commercial & Civil Resilience', component: 'Contracted Service Portfolio', refs: ['TWN-MODA-RESILIENCE'] }
};

const NAMES = {
  command: {
    JOINT: ['Combined Joint Task Force Coordination Element — Theater', 'Joint Fires and Targeting Coordination Center', 'Joint Logistics Coordination Center', 'Joint Data and Mission-Partner Operations Center', 'SOCPAC Joint Special Operations Coordination Element'],
    NAVY: ['Joint Force Maritime Component / Seventh Fleet MOC', 'Distributed Surface and Undersea Warfare Command Element', 'Military Sealift and Fleet Logistics Coordination Cell'],
    AIR: ['Joint Force Air Component / Distributed Air Operations Center'],
    MARINE: ['Marine Littoral Force Command Element'],
    ARMY: ['Army Multi-Domain Task Force Integration Cell'],
    PARTNER: ['Philippines Access and Logistics Coordination Cell', 'Australia Access and Force Posture Coordination Cell']
  },
  fires: {
    ARMY: ['Army Multi-Domain Long-Range Fires Package', 'Army Mobile Mid-Range Capability Package', 'Army PrSM Distributed Fires Package', 'Army Theater Air and Missile Defense Fires', 'Army Counter-UAS and Point-Defense Fires'],
    NAVY: ['SSN Undersea Denial Group', 'Distributed Surface Action Group — Maritime Strike', 'Carrier Air Wing Maritime Strike Package', 'Aegis Surface IAMD / Strike Group', 'Unmanned Surface and Subsurface Denial Web — 2040', 'Naval Long-Range Fires Magazine'],
    AIR: ['Long-Range Bomber Strike Package', 'Air-Superiority Fighter Package', 'Collaborative Combat Aircraft Team — 2040', 'Standoff Maritime Strike Package', 'Suppression of Enemy Air Defenses Package', 'Distributed Counter-Air Package'],
    MARINE: ['Marine Littoral Regiment Sea-Denial Package', 'NMESIS Expeditionary Maritime Strike Package', 'F-35B Expeditionary Strike Package', 'Littoral Counter-Air / Counter-UAS Package'],
    TAIWAN: ['Taiwan Distributed Coastal-Defense Force', 'Taiwan Mobile Anti-Ship Missile Group', 'Taiwan Integrated Air-Defense Fires', 'Taiwan Dispersed Precision-Fires Group', 'Taiwan Uncrewed Littoral Denial Web — 2040', 'Taiwan Counter-Landing Fires Reserve']
  },
  sensor: {
    ARMY: ['MDTF All-Domain Sensing and TITAN Fusion Service', 'Theater Ground Moving-Target Sensor Network', 'Air and Missile Defense Radar Network', 'Expeditionary Multi-INT Sensor Package'],
    NAVY: ['P-8A Maritime Patrol and ASW Group', 'MQ-4C Triton Maritime ISR Service', 'E-2D Airborne Early Warning Package'],
    AIR: ['Airborne Battle Management and ISR Package', 'RC-135 Signals Intelligence Mission Package', 'Distributed Airborne Early Warning Service — 2040', 'MQ-9 Maritime and Land ISR Package'],
    MARINE: ['MLR Reconnaissance / Counter-Reconnaissance Network', 'G/ATOR Littoral Sensor Package'],
    SPACE: ['Proliferated Missile Warning and Tracking Layer — 2040', 'Theater Space Domain Awareness Service'],
    TAIWAN: ['Taiwan Joint Maritime and Air Awareness Network', 'Taiwan Dispersed Passive-Sensor Network']
  },
  relay: {
    ARMY: ['Army Expeditionary Data Mesh', 'Army Resilient Beyond-Line-of-Sight Relay', 'Army Tactical Edge Mission Network'],
    NAVY: ['Naval Distributed Maritime Operations Data Mesh'],
    AIR: ['Airborne Battle Network Relay Package', 'ACE Resilient Airbase Mission Network'],
    MARINE: ['MLR Expeditionary Relay and Data Mesh', 'Littoral Line-of-Sight / Beyond-Line-of-Sight Relay'],
    SPACE: ['Proliferated Space Transport Layer — 2040', 'Resilient SATCOM Service Portfolio', 'Protected Tactical SATCOM Gateway', 'Assured PNT and Timing Service'],
    JOINT: ['Combined Mission Partner Environment', 'Joint All-Domain Data Fabric', 'Alternate Joint Command Network', 'Coalition Data-Release and Cross-Domain Service']
  },
  logistics: {
    ARMY: ['Theater Sustainment and Port-Opening Package', 'Army Watercraft and Intra-Theater Distribution Group', 'Distributed Land Logistics and Repair Network'],
    NAVY: ['Military Sealift Command Combat Logistics Force', 'Strategic Sealift and Prepositioning Package'],
    AIR: ['Air Mobility and Tanker Bridge', 'ACE Theater Airlift and Rapid Airfield Repair'],
    MARINE: ['Littoral Logistics Battalion Package', 'Expeditionary Fuel, Maintenance and Shore Distribution'],
    TAIWAN: ['Taiwan Distributed Fuel and Ammunition Network', 'Taiwan Civil-Military Repair and Mobility Network'],
    JOINT: ['Joint Logistics Common Operating Picture / Allocation Cell']
  },
  protection: {
    ARMY: ['Army THAAD / Patriot IAMD Package', 'Army Mobile Short-Range Air Defense Package', 'Army Counter-UAS Protection Package', 'Army Base and Port Protection Package'],
    NAVY: ['Aegis Fleet Air and Missile Defense Screen'],
    AIR: ['ACE Airbase Defense and Recovery Package'],
    MARINE: ['Marine Littoral Anti-Air Battalion Package', 'MADIS Expeditionary Air-Defense Package'],
    TAIWAN: ['Taiwan Layered Integrated Air and Missile Defense', 'Taiwan Critical-Site and Mobile Force Protection']
  },
  information: {
    ARMY: ['Army MDTF Cyber / Electromagnetic Activities Element'],
    NAVY: ['Fleet Cyber and Electromagnetic Maneuver Package'],
    AIR: ['Air Component Cyber and Spectrum Operations Package'],
    MARINE: ['Marine Littoral Cyberspace / EW Support Package'],
    SPACE: ['Space Cyber Mission Assurance Package', 'Space Electromagnetic Warfare Mission Package', 'Theater Space Battle Management Service'],
    JOINT: ['Joint Cyber Mission Force Package — Theater', 'JFHQ-C Defensive Cyber and Partner Support Package', 'Joint Electromagnetic Spectrum Operations Package']
  }
};

const KIND = {
  command: { subsystem: 'Joint Command & Mission Networks', type: 'Command', jointFunction: 'Command and control', tempoRole: 'command' },
  fires: { subsystem: 'Integrated Fires & Denial', type: 'Fires', jointFunction: 'Fires', tempoRole: 'none' },
  sensor: { subsystem: 'Joint Sensing & Targeting', type: 'Sensor', jointFunction: 'Intelligence and targeting', tempoRole: 'none' },
  relay: { subsystem: 'Mission Networks & Resilient C2', type: 'Relay', jointFunction: 'Command and control', tempoRole: 'relay' },
  logistics: { subsystem: 'Contested Joint Logistics', type: 'Logistics', jointFunction: 'Sustainment', tempoRole: 'logistics' },
  protection: { subsystem: 'Integrated Air & Missile Defense', type: 'Protection', jointFunction: 'Protection', tempoRole: 'none' },
  information: { subsystem: 'Space, Cyber & Spectrum', type: 'Information Capability', jointFunction: 'Information', tempoRole: 'none' }
};

function cap(input = ZERO) {
  return { kinetic: Number(input.kinetic || 0), cyber: Number(input.cyber || 0), ew: Number(input.ew || 0), sof: Number(input.sof || 0) };
}
function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function idList(scenario, prefix) {
  return scenario.nodes.filter(node => node.id.startsWith(prefix)).map(node => node.id)
    .sort((a, b) => Number(a.match(/(\d+)$/)?.[1] || 0) - Number(b.match(/(\d+)$/)?.[1] || 0));
}
function domainFor(ownerKey, kind, name, resources) {
  const domains = [];
  const add = value => { if (!domains.includes(value)) domains.push(value); };
  if (ownerKey === 'NAVY') add(/SSN|subsurface|undersea/i.test(name) ? 'Subsurface' : 'Sea');
  else if (ownerKey === 'AIR') add('Air');
  else if (ownerKey === 'MARINE') { add('Land'); add('Sea'); }
  else if (ownerKey === 'SPACE') add('Space');
  else if (ownerKey === 'TAIWAN') {
    if (kind === 'command') ['Land', 'Sea', 'Air', 'Cyber', 'EW'].forEach(add);
    else if (kind === 'logistics') ['Land', 'Sea'].forEach(add);
    else if (kind === 'protection') ['Land', 'Air'].forEach(add);
    else if (kind === 'relay') ['Land', 'Cyber'].forEach(add);
    else add(kind === 'information' ? 'Cyber' : 'Land');
  }
  else if (ownerKey === 'JOINT') {
    if (kind === 'command') ['Land', 'Sea', 'Air', 'Space', 'Cyber'].forEach(add);
    else if (kind === 'logistics') ['Land', 'Sea', 'Air'].forEach(add);
    else add('Cyber');
  }
  else add('Land');
  if (/air|airborne|fighter|bomber|F-35|P-8|E-2|MQ-|CCA/i.test(name)) add('Air');
  if (/maritime|fleet|naval|sea|littoral|coastal|ship/i.test(name)) add('Sea');
  if (/space|satcom|PNT|missile warning|tracking layer/i.test(name)) add('Space');
  if (resources.cyber > 0 || /cyber|data|network|mission partner|cross-domain/i.test(name)) add('Cyber');
  if (resources.ew > 0 || /electromagnetic|spectrum|EW\b/i.test(name)) add('EW');
  return domains;
}
function sourcesFor(ownerKey, id) {
  if (ownerKey !== 'PARTNER') return OWNER[ownerKey].refs;
  if (id.startsWith('JPN')) return ['JPN-MOD-2026'];
  if (id.startsWith('AUS') || id === 'USA-CMD-013') return ['AUS-JCG'];
  return ['PHL-US-2024'];
}
function accessFor(ownerKey) {
  if (ownerKey === 'TAIWAN') return [];
  if (ownerKey === 'PARTNER') return ['Independent national decision', 'Mission-specific access and release authority'];
  if (ownerKey === 'COMMERCIAL') return ['Contract activation', 'Provider capacity and continued service'];
  if (ownerKey === 'JOINT') return ['Taiwan request and combined planning authority'];
  return ['Theater tasking', 'Host-nation, overflight or maritime access as applicable'];
}
function availabilityFor(ownerKey, name) {
  if (ownerKey === 'PARTNER') return 'conditional-partner';
  if (ownerKey === 'COMMERCIAL') return 'commercial-contract';
  return /2040/.test(name) ? 'future-notional' : 'scenario-active';
}
function patchNode(scenario, id, ownerKey, kind, name, resources = ZERO, potential) {
  const node = scenario.nodes.find(item => item.id === id);
  if (!node) throw new Error(`Missing node ${id}`);
  const owner = OWNER[ownerKey];
  const model = KIND[kind];
  const active = cap(resources);
  const notional = /2040|collaborative|unmanned|uncrewed|proliferated/i.test(name);
  const availability = availabilityFor(ownerKey, name);
  const nation = ownerKey === 'PARTNER'
    ? (id.startsWith('JPN') ? 'Japan' : id.startsWith('AUS') || id === 'USA-CMD-013' ? 'Australia' : 'Philippines')
    : owner.nation;
  const assumption = ownerKey === 'PARTNER'
    ? 'Participation, access, release authority, readiness and the exact package are independent scenario decisions; no active capacity is assumed.'
    : ownerKey === 'COMMERCIAL'
      ? 'Contracted capacity, provider willingness, routing and service continuity are scenario assumptions.'
      : name.includes('SOCPAC')
        ? 'SOCPAC is represented as an organization, but contributes zero fungible SOF capacity until the engine models typed availability and magazines symmetrically.'
        : `Public sources support the capability class. The exact 2040 package, scale, readiness, location, access and mission output are notional scenario assumptions.`;
  Object.assign(node, {
    name,
    team: 'blue',
    nation,
    serviceOwner: owner.serviceOwner,
    component: ownerKey === 'PARTNER' ? `${nation} Mission Partner Package` : owner.component,
    subsystem: model.subsystem,
    type: model.type,
    jointFunction: model.jointFunction,
    operationalRole: `Provide ${name.toLowerCase()} as a theater-level joint mission aggregate.`,
    tempoRole: ownerKey === 'PARTNER' || ownerKey === 'COMMERCIAL' ? 'none' : model.tempoRole,
    accessDependencies: accessFor(ownerKey),
    domain: domainFor(ownerKey, kind, name, active),
    health: 100,
    healthMax: 100,
    status: ownerKey === 'PARTNER' || ownerKey === 'COMMERCIAL' ? 'Conditional' : 'Active',
    difficulty: kind === 'command' ? 'Hardened' : kind === 'fires' ? 'Dispersed' : kind === 'sensor' ? 'Mobile' : 'Distributed',
    vulnerabilities: ['Kinetic', 'Cyber', 'EW'],
    importance: kind === 'command' ? 7 : kind === 'logistics' || kind === 'relay' ? 6 : 5,
    cascScore: kind === 'command' ? 3 : kind === 'logistics' || kind === 'relay' ? 3 : 2,
    resourceGenByType: active,
    resourceGen: Object.values(active).reduce((sum, value) => sum + value, 0),
    locationPrecision: 'representative-operating-area',
    scenarioEnabled: ownerKey !== 'PARTNER' && ownerKey !== 'COMMERCIAL',
    capabilityProfile: {
      category: slug(model.subsystem),
      functions: [slug(name)],
      evidenceClass: notional ? 'notional-2040' : 'assessed',
      confidence: notional ? 'low' : 'medium',
      availability,
      sourceRefs: sourcesFor(ownerKey, id),
      assumption
    }
  });
  if (potential) node.capabilityProfile.potentialResourceGenByType = cap(potential);
  else delete node.capabilityProfile.potentialResourceGenByType;
}
function allocate(scenario, ids, kind, ownerPlans) {
  let cursor = 0;
  for (const plan of ownerPlans) {
    const names = NAMES[kind][plan.owner];
    names.forEach((name, index) => {
      const value = Array.isArray(plan.capacity) ? plan.capacity[index] : ZERO;
      patchNode(scenario, ids[cursor++], plan.owner, kind, name,
        typeof value === 'number' ? { kinetic: value } : value || ZERO);
    });
  }
  if (cursor !== ids.length) throw new Error(`${kind} allocation used ${cursor}/${ids.length} IDs`);
}
function setObjective(node, importance, cascScore, difficulty = 'Hardened') {
  node.importance = importance; node.cascScore = cascScore; node.difficulty = difficulty;
}
function addLinks(scenario, pairs) {
  const ids = new Set(scenario.nodes.map(node => node.id));
  const seen = new Set(scenario.links.map(link => [String(link.source), String(link.target)].sort().join('\u0000')));
  for (const [source, target] of pairs) {
    if (!ids.has(source) || !ids.has(target)) throw new Error(`Cannot link ${source} -> ${target}`);
    const key = [source, target].sort().join('\u0000');
    if (!seen.has(key)) { scenario.links.push({ source, target }); seen.add(key); }
  }
}

function main() {
  const scenario = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  allocate(scenario, idList(scenario, 'USA-CMD-'), 'command', [
    { owner: 'JOINT' }, { owner: 'NAVY' }, { owner: 'AIR' }, { owner: 'MARINE' }, { owner: 'ARMY' }, { owner: 'PARTNER' }
  ]);
  allocate(scenario, idList(scenario, 'USA-FIR-'), 'fires', [
    { owner: 'ARMY', capacity: [3, 3, 2, 2, 2] },
    { owner: 'NAVY', capacity: [5, 4, 4, 4, 4, 4] },
    { owner: 'AIR', capacity: [4, 4, 4, 4, 4, 4] },
    { owner: 'MARINE', capacity: [3, 3, 3, 3] },
    { owner: 'TAIWAN', capacity: [4, 4, 4, 4, 4, 4] }
  ]);
  allocate(scenario, idList(scenario, 'USA-SEN-'), 'sensor', [
    { owner: 'ARMY' }, { owner: 'NAVY' }, { owner: 'AIR' }, { owner: 'MARINE' }, { owner: 'SPACE' }, { owner: 'TAIWAN' }
  ]);
  allocate(scenario, idList(scenario, 'USA-REL-'), 'relay', [
    { owner: 'ARMY' }, { owner: 'NAVY' }, { owner: 'AIR' }, { owner: 'MARINE' }, { owner: 'SPACE' }, { owner: 'JOINT' }
  ]);
  allocate(scenario, idList(scenario, 'USA-LOG-'), 'logistics', [
    { owner: 'ARMY' }, { owner: 'NAVY' }, { owner: 'AIR' }, { owner: 'MARINE' }, { owner: 'TAIWAN' }, { owner: 'JOINT' }
  ]);
  allocate(scenario, idList(scenario, 'USA-SUP-'), 'protection', [
    { owner: 'ARMY' }, { owner: 'NAVY' }, { owner: 'AIR' }, { owner: 'MARINE' }, { owner: 'TAIWAN' }
  ]);
  allocate(scenario, idList(scenario, 'USA-IAK-'), 'information', [
    { owner: 'ARMY', capacity: [{ cyber: 2, ew: 1 }] },
    { owner: 'NAVY', capacity: [{ cyber: 2, ew: 2 }] },
    { owner: 'AIR', capacity: [{ cyber: 2, ew: 2 }] },
    { owner: 'MARINE', capacity: [{ cyber: 1, ew: 1 }] },
    { owner: 'SPACE', capacity: [{ cyber: 2 }, { ew: 2 }, { ew: 1 }] },
    { owner: 'JOINT', capacity: [{ cyber: 2, ew: 1 }, { cyber: 2, ew: 1 }, { cyber: 1, ew: 1 }] }
  ]);

  const taiwanRoles = [
    ['TWN-CMD-001', 'command', 'Taiwan Integrated Joint Operations Center', ZERO],
    ['TWN-REL-001', 'relay', 'Taiwan Distributed Defense Data Fabric', ZERO],
    ['TWN-REL-002', 'relay', 'Taiwan Terrestrial Fiber / Microwave Backbone', ZERO],
    ['TWN-REL-003', 'relay', 'Taiwan Mobile and Public-Safety Communications Layer', ZERO],
    ['TWN-REL-004', 'relay', 'Taiwan Multi-Orbit Emergency Access Cluster — 2040', ZERO],
    ['TWN-REL-005', 'relay', 'Taiwan Mission Partner Gateway', ZERO],
    ['TWN-CYB-001', 'information', 'Taiwan Military Network Defense / SOC Pool', { cyber: 2 }],
    ['TWN-CYB-002', 'information', 'Taiwan Critical-Infrastructure Cyber Coordination', { cyber: 2 }],
    ['TWN-CYB-003', 'information', 'Taiwan Clean Backup and Autonomous Service Recovery — 2040', { cyber: 1 }],
    ['TWN-EW-001', 'information', 'Taiwan Spectrum Awareness and Management Service', { ew: 1 }],
    ['TWN-EW-002', 'information', 'Taiwan Dispersed Electronic Protection / EW Package', { ew: 2 }],
    ['TWN-SEN-001', 'sensor', 'Taiwan EO / SAR Mission Service', ZERO],
    ['TWN-REL-006', 'relay', 'Taiwan Satellite Ground and Mission Operations Service', ZERO],
    ['TWN-INF-001', 'information', 'Taiwan Cognitive Defense and Attribution Cell', ZERO],
    ['TWN-REL-007', 'relay', 'Taiwan Public Alert and Trusted Distribution Network', ZERO]
  ];
  taiwanRoles.forEach(([id, kind, name, resources]) => patchNode(scenario, id, 'TAIWAN', kind, name, resources));

  patchNode(scenario, 'BLU-REL-001', 'COMMERCIAL', 'relay', 'Multi-Provider Commercial SATCOM Portfolio', ZERO);
  patchNode(scenario, 'BLU-REL-002', 'COMMERCIAL', 'relay', 'Overseas Cloud, CDN and International Transit Portfolio', ZERO);
  patchNode(scenario, 'USA-SPC-001', 'SPACE', 'relay', 'Hybrid SATCOM / PNT Mission Service', ZERO);
  patchNode(scenario, 'JPN-CYB-001', 'PARTNER', 'information', 'Japan Cyber / EW Coordination Package', ZERO, { cyber: 2, ew: 1 });
  patchNode(scenario, 'AUS-CYB-001', 'PARTNER', 'information', 'Australia Joint Cyber Coordination Package', ZERO, { cyber: 2 });

  // Keep the key-terrain set intentionally joint: two Joint, then Taiwan, Navy, Air,
  // Army, Marines and Space, spanning C2, sensing, fires and sustainment.
  const byId = new Map(scenario.nodes.map(node => [node.id, node]));
  [
    ['TWN-CMD-001', 10, 5], ['USA-CMD-001', 10, 5], ['USA-CMD-006', 9, 5],
    ['USA-CMD-009', 9, 5], ['USA-FIR-001', 9, 4], ['USA-FIR-018', 9, 4],
    ['USA-SEN-014', 9, 5], ['USA-LOG-012', 9, 5]
  ].forEach(([id, importance, casc]) => setObjective(byId.get(id), importance, casc));

  addLinks(scenario, [
    ['USA-FIR-008', 'USA-CMD-006'], ['USA-FIR-025', 'TWN-CMD-001'],
    ['USA-REL-013', 'USA-CMD-001'], ['USA-REL-015', 'USA-CMD-009'],
    ['USA-LOG-005', 'USA-CMD-008'], ['USA-LOG-009', 'TWN-CMD-001'],
    ['USA-SUP-006', 'USA-CMD-006'], ['TWN-CMD-001', 'USA-CMD-001'],
    ['TWN-CMD-001', 'USA-CMD-006'], ['TWN-CMD-001', 'USA-CMD-009'],
    ['TWN-REL-001', 'USA-REL-016'], ['TWN-SEN-001', 'USA-SEN-014'],
    ['TWN-CYB-001', 'USA-IAK-008'], ['TWN-EW-002', 'USA-IAK-010']
  ]);

  scenario.metadata = {
    ...(scenario.metadata || {}),
    scenarioName: 'Taiwan-led Joint Force denial network — 2040 notional',
    description: 'Sovereign Taiwan defense integrated with U.S. joint maritime, air, land, space, cyber and logistics mission packages; partner and commercial access remains conditional.',
    version: '3.0.0-joint-force',
    classification: 'UNCLASSIFIED // NOTIONAL',
    resourceModel: 'resource-model-v2',
    updated: '2026-07-11',
    forceDesignBoundary: 'Capability aggregates and representative operating areas; not a literal order of battle, target list, readiness estimate or prediction of participation.'
  };
  scenario.sources = sources;

  fs.writeFileSync(FILE, JSON.stringify(scenario, null, 2) + '\n');
  console.log(`Updated ${path.basename(FILE)}: ${scenario.nodes.length} nodes / ${scenario.links.length} links / ${scenario.sources.length} sources`);
}

main();
