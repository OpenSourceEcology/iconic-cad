/** Static guard for the viewport rules that make the Three canvas fill its panel. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0; let failed = 0;
const ok = message => { passed++; if (process.env.VERBOSE) console.log(`  ok ${message}`); };
const fail = message => { failed++; console.error(`  FAIL ${message}`); };
const css = readFileSync(fileURLToPath(new URL('../web/css/machines.css', import.meta.url)), 'utf8');
const script = readFileSync(fileURLToPath(new URL('../web/js/machines.js', import.meta.url)), 'utf8');
if (/\.viewport-panel\s*>\s*#viewport\s*\{[^}]*position:absolute;[^}]*inset:0;/s.test(css)) ok('viewport fills the viewport panel'); else fail('viewport must be absolute with inset:0');
if (/\.empty-state\[hidden\]\s*\{\s*display:none;\s*\}/.test(css)) ok('hidden empty state does not overlay a loaded model'); else fail('empty-state hidden rule missing');
if (/grid\.scale\.setScalar/.test(script) && /grid\.position\.set/.test(script) && /axes\.scale\.setScalar/.test(script)) ok('fit view scales and positions inspection helpers'); else fail('fit view helper scaling missing');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
