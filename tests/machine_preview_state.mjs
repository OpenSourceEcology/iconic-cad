import { previewStateFor } from '../web/js/machine-core.js';

let passed = 0; let failed = 0;
const ok = message => { passed++; if (process.env.VERBOSE) console.log(`  ok ${message}`); };
const fail = message => { failed++; console.error(`  FAIL ${message}`); };
const assert = (test, message) => test ? ok(message) : fail(message);
assert(previewStateFor(0, 0, 0) === 'empty', 'empty workspaces settle as empty');
assert(previewStateFor(3, 3, 0) === 'ready', 'ready requires every expected instance to render');
assert(previewStateFor(3, 2, 0) === 'error', 'missing rendered instances never settle ready');
assert(previewStateFor(3, 3, 1) === 'error', 'failed meshes never settle ready');
try { previewStateFor(1, -1, 0); fail('rejects invalid preview counts'); } catch { ok('rejects invalid preview counts'); }
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
