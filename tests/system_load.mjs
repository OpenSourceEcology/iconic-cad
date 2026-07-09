import { doc } from '../web/js/state.js';
import { applyLoadedData } from '../web/js/load.js';

let passed = 0, failed = 0;
const fail = m => { console.error(`  FAIL ${m}`); failed++; };
const ok = m => { passed++; if (process.env.VERBOSE) console.log(`  ok ${m}`); };
const eq = (got, want, label) => got === want ? ok(`${label} = ${want}`) : fail(`${label} = ${got}, want ${want}`);

applyLoadedData({
  project: { name: 'Round trip', system: 'vcs12', stories: 1 },
  entities: [{ module: 'extwall_standard', system: 'vcs12', direction: 'north', x_mm: 0, y_mm: 0 }],
});
eq(doc.project.system, 'vcs12', 'project.system round trip');
eq(doc.entities[0].system, 'vcs12', 'entity system');
eq(doc.entities[0].mod.id, 'extwall_standard', 'vcs module loaded');

let mixedFailed = false;
try {
  applyLoadedData({
    project: { system: 'vcs12', stories: 1 },
    entities: [{ module: 'wall_4x8_2x6_16oc', system: 'seh', direction: 'north', x_mm: 0, y_mm: 0 }],
  });
} catch (e) {
  mixedFailed = /Mixed construction systems/.test(String(e.message));
}
if (mixedFailed) ok('mixed-system doc fails'); else fail('mixed-system doc did not fail');

applyLoadedData({ entities: [{ module: 'wall_4x8_2x6_16oc', direction: 'north', x_mm: 0, y_mm: 0 }] });
eq(doc.project.system, 'seh', 'legacy project.system default');
eq(doc.entities[0].system, 'seh', 'legacy entity system default');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
