import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fallbackCatalogPath, validateCatalog } from '../web/js/machine-core.js';

let passed = 0; let failed = 0;
const ok = message => { passed++; if (process.env.VERBOSE) console.log(`  ok ${message}`); };
const fail = message => { failed++; console.error(`  FAIL ${message}`); };
const assert = (test, message) => test ? ok(message) : fail(message);
assert(fallbackCatalogPath(404) === 'data/machine-example.json', 'uses the bundled example only for a missing primary catalog');
for (const status of [0, 200, 401, 500, undefined]) assert(fallbackCatalogPath(status) === null, `does not mask primary catalog status ${status}`);
const example = JSON.parse(readFileSync(fileURLToPath(new URL('../web/data/machine-example.json', import.meta.url)), 'utf8'));
assert(validateCatalog(example).ok, 'accepts the cleared-license bundled example catalog');
assert(example.entries.every(entry => entry.license_review === 'cleared'), 'marks bundled original examples as license-review cleared');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
