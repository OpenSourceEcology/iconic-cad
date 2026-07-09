import { strict as assert } from 'node:assert';
import { buildEntryFiles, parseEntryJson } from '../web/js/entry_files.js';

const schema = {
  schema_name: 'Tiny_Assembly',
  units: 'in',
  name: 'Tiny Assembly',
  floor: { width_in: 96, depth_in: 48 },
  common_wall: { module_width_in: 48, stud_spacing_in: 24, lumber: '2x6' },
  walls: [
    { name: 'Front_Wall', side: 'front', modules: [{ type: 'standard' }, { type: 'door' }] },
  ],
};

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    if (process.env.VERBOSE) console.log(`  ok ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(err.stack || err.message);
  }
}

test('buildEntryFiles emits data-only schema, wip meta, and parseable canonical json', () => {
  const files = buildEntryFiles(schema, { id: 'Tiny Assembly', title: 'Tiny Assembly', owner: 'Tester', system: 'vcs12' }, {
    bbox_in: { x: [0, 96], y: [0, 48], z: [0, 104] },
    solidsLowerBound: 3,
  });
  assert.deepEqual(Object.keys(files), ['schema.py', 'compiler.py', 'meta.yaml', 'expect.yaml', 'tiny_assembly.json', 'README.txt']);
  assert.equal((files['schema.py'].match(/\bSCHEMA\s*=/g) || []).length, 1);
  assert.match(files['schema.py'], /^"""[^"]+"""\n\nSCHEMA = \{/);
  assert.doesNotMatch(files['schema.py'], /\bimport\b|\bdef\s+|\blambda\b/);
  assert.match(files['meta.yaml'], /^status: wip$/m);
  assert.match(files['expect.yaml'], /tolerance_in: 0\.5/);
  assert.match(files['expect.yaml'], /tolerance_in3: 0\.01/);

  const parsed = parseEntryJson(files['tiny_assembly.json']);
  assert.equal(parsed.id, 'tiny_assembly');
  assert.equal(parsed.layer, 'assembly');
  assert.equal(parsed.status, 'wip');
  assert.deepEqual(parsed.schema, schema);
  assert.deepEqual(parsed.interface, { system: 'vcs12', role: 'assembly' });
});

test('parseEntryJson reports shape field names', () => {
  assert.throws(() => parseEntryJson('{"id":"x","layer":"assembly"}'), /title/);
  assert.throws(() => parseEntryJson('{"id":"x","layer":"module","title":"X","owner":"O","status":"wip","schema":{},"interface":{}}'), /layer/);
  assert.throws(() => parseEntryJson('{"id":"x","layer":"assembly","title":"X","owner":"O","status":"wip","schema":{},"interface":{}}'), /interface\.system/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
