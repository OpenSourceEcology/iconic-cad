#!/usr/bin/env node
// =====================================================
// export_members.mjs — bake web/assets/lib/members.json from
// enumerateMembers(mod), the single source of framing-lumber math
// (see design_decisions.md Decision 6).
//
// This is the "single enumerator" refactor's export step: it is the ONLY
// place the framing member list (studs, plates, kings, jacks, headers,
// cripples, sills, blocking) is derived for every module in ALL_MODULES.
// The Python geometry builder (seh_lib/wall_builder.py) reads this file
// instead of recomputing stud/cripple positions itself.
//
// Sheathing (OSB) is NOT single-sourced here — see the NOTE in
// seh_lib/wall_builder.py. members.json still carries 'sheathing' role
// entries (so JS consumers keep working unchanged); the Python side simply
// skips them and keeps its own OSB-with-a-cut-hole geometry, which is a
// pre-existing, audit-flagged (CAD-AUD-005) behavior difference from the
// JS/3D "sheathing strips" decomposition — NOT something this refactor
// resolves.
//
// Usage:
//   node scripts/export_members.mjs            # write web/assets/lib/members.json
//   node scripts/export_members.mjs --verify    # exit nonzero if committed file is stale
// =====================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { enumerateMembers } from '../web/js/members.js';
import { ALL_MODULES } from '../web/js/constants.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = path.join(REPO_ROOT, 'web', 'assets', 'lib', 'members.json');

function buildMembersDoc() {
  const out = {};
  for (const mod of [...ALL_MODULES].sort((a, b) => a.id.localeCompare(b.id))) {
    out[mod.id] = enumerateMembers(mod);
  }
  return out;
}

function serialize(doc) {
  return JSON.stringify(doc, null, 2) + '\n';
}

function main() {
  const verify = process.argv.includes('--verify');
  const doc = buildMembersDoc();
  const fresh = serialize(doc);

  if (verify) {
    let committed;
    try {
      committed = readFileSync(OUT_PATH, 'utf8');
    } catch (e) {
      console.error(`ERROR: ${OUT_PATH} does not exist — run node scripts/export_members.mjs`);
      process.exit(1);
    }
    if (committed !== fresh) {
      console.error(`ERROR: ${path.relative(REPO_ROOT, OUT_PATH)} is stale — run node scripts/export_members.mjs`);
      process.exit(1);
    }
    console.log(`OK: ${path.relative(REPO_ROOT, OUT_PATH)} matches enumerateMembers() for ${Object.keys(doc).length} modules`);
    return;
  }

  writeFileSync(OUT_PATH, fresh);
  console.log(`Wrote ${path.relative(REPO_ROOT, OUT_PATH)} (${Object.keys(doc).length} modules)`);
}

main();
