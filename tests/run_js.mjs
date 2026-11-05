// Run every JS test in tests/ (top level, *.mjs) in its own Node process.
//
// CI used to list test files by hand, so new tests could exist without ever
// running (member_overlaps, plate_policy, system_load and systems_manifest ran
// in neither GitHub nor GitLab CI). Discovery makes "add a file" enough.
//
// Usage: node tests/run_js.mjs [name-substring ...]
//   With arguments, runs only tests whose file name contains one of them.
// Exit status is 1 if any test fails.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const self = basename(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);

const tests = readdirSync(here)
  .filter(f => f.endsWith('.mjs') && f !== self)
  .filter(f => filters.length === 0 || filters.some(s => f.includes(s)))
  .sort();

if (tests.length === 0) {
  console.error(`run_js: no tests matched ${filters.join(', ') || 'tests/*.mjs'}`);
  process.exit(1);
}

const failed = [];
for (const file of tests) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [join(here, file)], { encoding: 'utf8' });
  const ms = Date.now() - started;
  if (r.status === 0) {
    console.log(`PASS ${file} (${ms} ms)`);
  } else {
    failed.push(file);
    console.log(`FAIL ${file} (exit ${r.status ?? r.signal}, ${ms} ms)`);
    const out = `${r.stdout || ''}${r.stderr || ''}`.trimEnd();
    if (out) console.log(out.split('\n').map(l => `  | ${l}`).join('\n'));
  }
}

console.log(`\n${tests.length - failed.length}/${tests.length} JS tests passed`);
if (failed.length) {
  console.log(`failed: ${failed.join(', ')}`);
  process.exit(1);
}
