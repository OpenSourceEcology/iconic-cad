/**
 * members_export test: web/assets/lib/members.json (the artifact
 * scripts/export_members.mjs bakes from enumerateMembers()) must exist, cover
 * every module in ALL_MODULES, and be byte-identical to what enumerateMembers()
 * produces right now — the freshness contract seh_lib/wall_builder.py (Python)
 * depends on to build framing-lumber solids from the single source instead of
 * re-deriving stud/king/jack/header/cripple/sill/blocking positions itself.
 *
 * Run from repo root: node tests/members_export.mjs   (no FreeCAD needed)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { enumerateMembers } from '../web/js/members.js';
import { ALL_MODULES } from '../web/js/constants.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEMBERS_PATH = path.join(REPO_ROOT, 'web', 'assets', 'lib', 'members.json');

let passed = 0, failed = 0;
function fail(msg) { console.error(`  FAIL ${msg}`); failed++; }
function ok(msg) { passed++; if (process.env.VERBOSE) console.log(`  ok ${msg}`); }

let doc;
try {
  doc = JSON.parse(readFileSync(MEMBERS_PATH, 'utf8'));
  ok('members.json parses as JSON');
} catch (e) {
  fail(`members.json missing or invalid: ${e.message}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

// ---- covers every module -------------------------------------------------
const ids = ALL_MODULES.map(m => m.id).sort();
const docIds = Object.keys(doc).sort();
if (JSON.stringify(ids) === JSON.stringify(docIds)) {
  ok(`members.json covers all ${ids.length} ALL_MODULES ids`);
} else {
  const missing = ids.filter(i => !docIds.includes(i));
  const extra = docIds.filter(i => !ids.includes(i));
  fail(`members.json id set mismatch — missing: [${missing}] extra: [${extra}]`);
}

// ---- byte-identical to live enumerateMembers() (the freshness gate) -----
for (const mod of ALL_MODULES) {
  const fresh = enumerateMembers(mod);
  const committed = doc[mod.id];
  if (!committed) continue; // already flagged above
  if (JSON.stringify(fresh) === JSON.stringify(committed)) {
    ok(`members.json[${mod.id}] matches enumerateMembers()`);
  } else {
    fail(`members.json[${mod.id}] is stale — run node scripts/export_members.mjs`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
