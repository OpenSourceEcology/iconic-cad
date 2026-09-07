/**
 * Static DOM hook smoke check for machines.html / machines.js.
 * It catches startup-breaking omissions in the ui map before a browser is
 * needed: every literal ui reference must be mapped and every map entry must
 * resolve to an element id in the page.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0; let failed = 0;
const ok = message => { passed++; if (process.env.VERBOSE) console.log(`  ok ${message}`); };
const fail = message => { failed++; console.error(`  FAIL ${message}`); };
const script = readFileSync(fileURLToPath(new URL('../web/js/machines.js', import.meta.url)), 'utf8');
const page = readFileSync(fileURLToPath(new URL('../web/machines.html', import.meta.url)), 'utf8');
const declaration = script.match(/const ui = Object\.fromEntries\(\[(.*?)\]\.map\(/s);
if (!declaration) fail('finds the machine ui map declaration');
const mapped = new Set([...((declaration?.[1] || '').matchAll(/'([^']+)'/g))].map(match => match[1]));
const accessed = new Set([
  ...[...script.matchAll(/ui\[['"]([^'"]+)['"]\]/g)].map(match => match[1]),
  ...[...script.matchAll(/\bui\.([A-Za-z_$][\w$]*)/g)].map(match => match[1]),
]);
for (const id of accessed) {
  if (mapped.has(id)) ok(`maps accessed ui id ${id}`);
  else fail(`ui access ${id} is missing from the ui map`);
}
for (const id of mapped) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\bid=["']${escaped}["']`).test(page)) ok(`page provides mapped ui id ${id}`);
  else fail(`mapped ui id ${id} is absent from machines.html`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
