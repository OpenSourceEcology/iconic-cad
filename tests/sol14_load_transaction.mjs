/**
 * SOL-14 regression (docs/audits/sol-audit-2026-09-02/02-findings.md): a load
 * reset the live document BEFORE validating, silently dropped unknown modules,
 * and a later error left a half-loaded document. A load must now validate the
 * whole file first and either apply all of it or leave the document untouched.
 *
 * Run from repo root: node tests/sol14_load_transaction.mjs
 */
import { doc } from '../web/js/state.js';
import { applyLoadedData } from '../web/js/load.js';

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) passed++; else { failed++; console.error(`  FAIL ${msg}`); } };

const project = {
  name: 'Repro', system: 'seh', stories: 1,
  climate: { iecc_zone: 5, frost_mm: 750, snow_psf: 30, wind_mph: 115, seismic_class: 'B' },
};
const valid = {
  id: 'valid', kind: 'wall', module: 'wall_4x8_2x6_16oc', system: 'seh',
  direction: 'north', x_mm: 0, y_mm: 0, level: 'L1', layer: 'structural',
};
const file = entities => ({ version: 2, units: 'mm', project: { ...project, name: 'Incoming' }, entities });

// The user's current design.
applyLoadedData({ version: 2, units: 'mm', project, entities: [{ ...valid, id: 'prior' }] });
const snapshot = () => JSON.stringify({ ids: doc.entities.map(e => e.id), name: doc.project.name, levels: doc.levels });
const before = snapshot();

function rejects(label, data, pattern) {
  let err = null;
  try { applyLoadedData(data); } catch (e) { err = e; }
  check(err !== null, `${label}: load returned normally`);
  if (err && pattern) check(pattern.test(err.message), `${label}: message ${JSON.stringify(err.message)} !~ ${pattern}`);
  check(snapshot() === before, `${label}: document changed to ${snapshot()}`);
}

rejects('unknown module', file([valid, { ...valid, id: 'missing', module: 'module_does_not_exist' }]), /module_does_not_exist/);
rejects('mixed system', file([valid, { ...valid, id: 'wrong-system', system: 'vcs12' }]), /Mixed construction systems/);
rejects('duplicate id', file([valid, { ...valid }]), /Duplicate entity id: valid/);
rejects('non-finite coordinate', file([{ ...valid, x_mm: 'NaN' }]), /x_mm/);
rejects('unknown system', { ...file([valid]), project: { ...project, system: 'nope' } }, /Unknown construction system/);
// Every problem is reported, not just the first.
rejects('all errors collected',
  file([{ ...valid, id: 'a', module: 'bad_one' }, { ...valid, id: 'b', module: 'bad_two' }]), /bad_one[\s\S]*bad_two/);

// A valid file still applies in full.
applyLoadedData(file([valid, { ...valid, id: 'second', x_mm: 1219.2 }]));
check(JSON.stringify(doc.entities.map(e => e.id)) === '["valid","second"]', `valid load ids ${doc.entities.map(e => e.id)}`);
check(doc.project.name === 'Incoming', 'valid load did not apply project');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
