import { strict as assert } from 'node:assert';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { explodeAssembly } from '../web/js/assembly_translate.js';
import { parseEntryJson } from '../web/js/entry_files.js';
import { getSystemManifest } from '../web/js/systems.js';

const dir = 'web/data/builtin_library';
const manifest = getSystemManifest('vcs12');

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    if (process.env.VERBOSE) console.log(`  ok ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(err.stack || err.message);
  }
}

await test('index lists exactly bundled entry json files', async () => {
  const listed = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  const present = (await readdir(dir))
    .filter(name => name.endsWith('.json') && name !== 'index.json')
    .sort();
  assert.deepEqual([...listed].sort(), present);
});

for (const filename of ['cabin_walls_floor.json', 'cabin_walls_floor_top_plate.json']) {
  await test(`${filename} parses and explodes against VCS-12`, async () => {
    const entry = parseEntryJson(await readFile(join(dir, filename), 'utf8'));
    assert.equal(entry.interface.system, 'vcs12');
    const { entities, warnings } = explodeAssembly(entry.schema, manifest);
    const moduleIds = new Set(manifest.palette.map(item => item.id));
    assert.ok(entities.length >= 10, `${filename} exploded to ${entities.length} entities`);
    assert.deepEqual(entities.filter(entity => !moduleIds.has(entity.mod.id)), []);
    assert.ok(warnings.length >= 1, 'expected non-placed decorative warnings');
    assert.deepEqual(warnings.filter(warning => !/not placed$/.test(warning)), []);
    if (filename.includes('top_plate')) assert.ok(warnings.includes('single_top_plate not placed'));
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
