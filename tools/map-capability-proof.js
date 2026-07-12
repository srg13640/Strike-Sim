#!/usr/bin/env node
'use strict';

// Focused proof for the read-only capability profile used by both Leaflet marker paths.
// The helper is pure, so this test does not need a browser or Leaflet runtime.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const scenario = {
  nodes: [],
  links: [],
  sources: [
    { id: 'PUBLIC', title: 'Public cyber posture <report>', publisher: 'Example Publisher', year: 2026, url: 'https://example.mil/report?q=1&view=public' },
    { id: 'BLOCKED', title: 'Blocked URL', publisher: 'Unsafe', year: 2026, url: 'javascript:alert(1)' }
  ]
};
const context = {
  console,
  URL,
  Map,
  Set,
  window: { AppState: { activeGraph: () => scenario } }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'map.js'), 'utf8'), context, { filename: 'map.js' });

const popup = context.window.MapModule._internal.capabilityPopupHtml({
  id: 'CYB-<1>',
  name: 'Cyber <img src=x onerror=alert(1)>',
  team: 'blue',
  nation: 'United <States>',
  serviceOwner: 'U.S. Joint Force',
  jointFunction: 'Command and control',
  operationalRole: 'Integrate <service> effects',
  accessDependencies: ['Host-nation approval', 'Mission-partner data release'],
  type: 'Support',
  subsystem: 'Counter C2',
  resourceGenByType: { kinetic: 0, cyber: 4, ew: 2, sof: 0 },
  capabilityProfile: {
    category: 'cyber-mission-force',
    functions: ['cyber-effects', 'defensive <support>'],
    evidenceClass: 'observed',
    confidence: 'medium',
    availability: 'conditional-partner',
    assumption: 'Illustrative <theater> aggregate.',
    sourceRefs: ['PUBLIC', 'BLOCKED'],
    potentialResourceGenByType: { kinetic: 0, cyber: 2, ew: 1, sof: 0 }
  }
}, scenario);

assert.match(popup, /<details class="map-cap-details">/);
assert.match(popup, /Active capacity<\/span>Kinetic 0 · Cyber 4 · EW 2 · SOF 0/);
assert.match(popup, /Conditional capacity<\/span><b>Kinetic 0 · Cyber 2 · EW 1 · SOF 0/);
assert.match(popup, /observed · medium confidence/);
assert.match(popup, /conditional-partner/);
assert.match(popup, /blue · United &lt;States&gt; · U\.S\. Joint Force/);
assert.match(popup, /Joint function<\/span><b>Command and control/);
assert.match(popup, /Operational role<\/span><b>Integrate &lt;service&gt; effects/);
assert.match(popup, /Access depends on<\/span><b>Host-nation approval, Mission-partner data release/);
assert.match(popup, /href="https:\/\/example\.mil\/report\?q=1&amp;view=public"/);
assert.doesNotMatch(popup, /href="javascript:/i);
assert.doesNotMatch(popup, /<img/i);
assert.match(popup, /Cyber &lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(popup, /Illustrative &lt;theater&gt; aggregate\./);

const blue = JSON.parse(fs.readFileSync(path.join(ROOT, 'grokblue90.json'), 'utf8'));
const activeCyber = blue.nodes.find(node => node.id === 'USA-IAK-008');
const activePopup = context.window.MapModule._internal.capabilityPopupHtml(activeCyber, blue);
assert.match(activePopup, /Joint Cyber Mission Force Package/);
assert.match(activePopup, /Active capacity<\/span>Kinetic 0 · Cyber 2 · EW 1 · SOF 0/);
assert.match(activePopup, /assessed · medium confidence/);
assert.match(activePopup, /href="https:\/\/www\.cybercom\.mil\//);

const conditionalPartner = blue.nodes.find(node => node.id === 'JPN-CYB-001');
const conditionalPopup = context.window.MapModule._internal.capabilityPopupHtml(conditionalPartner, blue);
assert.match(conditionalPopup, /Active capacity<\/span>Kinetic 0 · Cyber 0 · EW 0 · SOF 0/);
assert.match(conditionalPopup, /Conditional capacity<\/span><b>Kinetic 0 · Cyber 2 · EW 1 · SOF 0/);
assert.match(conditionalPopup, /Participation, access, release authority, readiness/);

console.log('Map capability popup: PASS (bundled profiles, capacity, source allowlist, escaping)');
