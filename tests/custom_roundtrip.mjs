import { strict as assert } from 'node:assert';
import JSZip from '../web/vendor/jszip.min.mjs';
import { explodeAssembly, composeAssembly } from '../web/js/assembly_translate.js';
import { buildEntryFiles, parseEntryJson } from '../web/js/entry_files.js';
import { getSystemManifest } from '../web/js/systems.js';
import { acceptCustomEntry, clearCustomLibrary, missingEntryModuleRefs } from '../web/js/custom_library.js';

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

const sourceSchema = {
  schema_name: 'Roundtrip_Custom',
  units: 'in',
  name: 'Roundtrip Custom',
  floor: { width_in: 96, depth_in: 54 },
  common_wall: { module_width_in: 48, stud_spacing_in: 24, lumber: '2x6' },
  walls: [
    { name: 'Front_Wall', side: 'front', modules: [{ type: 'standard' }, { type: 'window' }] },
    { name: 'Right_Wall', side: 'right', modules: [{ type: 'door' }] },
  ],
};

await test('custom assembly full data loop preserves entity geometry', () => {
  const originals = explodeAssembly(sourceSchema, manifest).entities;
  const schema = composeAssembly(originals, { manifest, id: 'Roundtrip Custom', title: 'Roundtrip Custom' });
  const files = buildEntryFiles(schema, {
    id: 'Roundtrip Custom',
    title: 'Roundtrip Custom',
    owner: 'Tester',
    author: 'Tester',
    system: manifest.id,
    manifest,
  });
  const entry = parseEntryJson(files['roundtrip_custom.json']);
  const restored = explodeAssembly(entry.schema, manifest).entities;
  assert.deepEqual(geometry(restored), geometry(originals));
});

await test('custom library refuses entries with absent active-system module refs', () => {
  clearCustomLibrary();
  const entry = {
    id: 'bad_custom',
    layer: 'assembly',
    title: 'Bad Custom',
    owner: 'Tester',
    status: 'wip',
    interface: { system: 'vcs12', role: 'assembly' },
    schema: {
      walls: [{ name: 'Front_Wall', side: 'front', modules: [{ type: 'standard' }, { type: 'absent_module' }] }],
    },
  };
  assert.deepEqual(missingEntryModuleRefs(entry, manifest), ['absent_module']);
  assert.throws(() => acceptCustomEntry(entry, manifest), /bad_custom missing modules: absent_module/);
});

await test('custom assembly zip contains one entry-id folder', async () => {
  const schema = composeAssembly(explodeAssembly(sourceSchema, manifest).entities, {
    manifest,
    id: 'Zip Custom',
    title: 'Zip Custom',
  });
  const files = buildEntryFiles(schema, {
    id: 'Zip Custom',
    title: 'Zip Custom',
    owner: 'Tester',
    author: 'Tester',
    system: manifest.id,
    manifest,
  });
  const zip = new JSZip();
  for (const [name, text] of Object.entries(files)) zip.file(`zip_custom/${name}`, text);
  const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.deepEqual(
    Object.keys(loaded.files).filter(name => !loaded.files[name].dir).sort(),
    [
      'zip_custom/README.txt',
      'zip_custom/compiler.py',
      'zip_custom/expect.yaml',
      'zip_custom/meta.yaml',
      'zip_custom/schema.py',
      'zip_custom/zip_custom.json',
    ],
  );
});

function geometry(entities) {
  return entities.map(e => ({
    mod: e.mod.id,
    system: e.system,
    dir: e.dir,
    x_mm: e.x_mm,
    y_mm: e.y_mm,
    width_mm: e.mod.width_mm,
    depth_mm: e.mod.depth_mm,
  })).sort((a, b) =>
    a.dir.localeCompare(b.dir) ||
    a.x_mm - b.x_mm ||
    a.y_mm - b.y_mm ||
    a.mod.localeCompare(b.mod));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
