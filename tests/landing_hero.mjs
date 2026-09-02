/**
 * Landing hero freshness/data test. The committed generated block must match
 * the selected active runtime module and enumerateMembers() without FreeCAD.
 *
 * Run from repo root: node tests/landing_hero.mjs
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { ALL_MODULES, IN_TO_MM } from '../web/js/constants.js';
import { enumerateMembers } from '../web/js/members.js';
import {
  GENERATED_END,
  GENERATED_START,
  MODULE_ID,
  buildHeroBlock,
  generatedBlockIsFresh,
} from '../scripts/gen_landing_hero.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANDING_PATH = path.join(REPO_ROOT, 'landing', 'index.html');
const GENERATOR_PATH = path.join(REPO_ROOT, 'scripts', 'gen_landing_hero.mjs');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    if (process.env.VERBOSE) console.log(`  ok ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(error.stack || error.message);
  }
}

const document = readFileSync(LANDING_PATH, 'utf8');
const moduleRecord = ALL_MODULES.find(mod => mod.id === MODULE_ID);
const members = enumerateMembers(moduleRecord);
const framing = members.filter(member => member.role !== 'sheathing');
const sheathing = members.filter(member => member.role === 'sheathing');
const header = members.find(member => member.role === 'header');

test('generator --verify accepts the committed hero', () => {
  const result = spawnSync(process.execPath, [GENERATOR_PATH, '--verify'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /matches .*enumerateMembers\(\)/);
});

test('landing contains exactly one byte-current generated block', () => {
  assert.equal(document.split(GENERATED_START).length - 1, 1);
  assert.equal(document.split(GENERATED_END).length - 1, 1);
  assert.equal(generatedBlockIsFresh(document), true);
  assert.ok(document.includes(buildHeroBlock()));
  assert.equal(generatedBlockIsFresh(document.replace('sill_height_in:', 'stale_sill_height_in:')), false);
});

test('stated parameters come from the selected active module record', () => {
  const clean = value => Number(value.toFixed(3));
  const widthFt = clean(moduleRecord.width_mm / IN_TO_MM / 12);
  const heightFt = clean(moduleRecord.height_mm / IN_TO_MM / 12);
  const spacingIn = clean(moduleRecord.stud_spacing_mm / IN_TO_MM);
  const topPlateCount = members.filter(member => member.role === 'top_plate').length;
  const hero = buildHeroBlock();

  assert.match(hero, new RegExp(`nominal_width_ft:</span> <span class="v">${widthFt}</span>`));
  assert.match(hero, new RegExp(`nominal_height_ft:</span> <span class="v">${heightFt}</span>`));
  assert.match(hero, new RegExp(`stud_spacing_oc_in:</span> <span class="v">${spacingIn}</span>`));
  assert.match(hero, new RegExp(`top_plate_count:</span> <span class="v">${topPlateCount}</span>`));
  assert.ok(hero.includes(`rough_opening_in:</span> <span class="v">[${moduleRecord.aperture.ro_w_in}, ${moduleRecord.aperture.ro_h_in}]</span>`));
  assert.ok(hero.includes(`sill_height_in:</span> <span class="v">${moduleRecord.aperture.sill_in}</span>`));
  assert.ok(hero.includes(`{nominal: ${header.nominal}, plies: ${header.plies}}`));
});

test('drawing and stated counts come from enumerateMembers()', () => {
  const hero = buildHeroBlock();
  assert.equal((hero.match(/<rect class="m"/g) || []).length, framing.length);
  assert.ok(hero.includes(`All ${members.length} member records`));
  assert.ok(hero.includes(`shows its ${framing.length} lumber rectangles`));
  assert.ok(hero.includes(`(${sheathing.length} sheathing pieces omitted for clarity)`));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
