/**
 * SOL-18 regression (docs/audits/sol-audit-2026-09-02/02-findings.md): the
 * editor's import map loaded three.js from cdn.jsdelivr.net, so a CDN outage
 * (or an offline workshop) blocked editor boot although web/vendor/three was
 * already in the repo. Every import map must resolve to vendored files, and
 * every three/addons import used by the app must exist in the vendor tree.
 *
 * Run from repo root: node tests/sol18_offline_importmap.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const web = resolve('web');
let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) passed++; else { failed++; console.error(`  FAIL ${msg}`); } };

const pages = [
  ...readdirSync(web).filter(f => f.endsWith('.html')).map(f => join(web, f)),
  ...readdirSync(join(web, 'tools')).filter(f => f.endsWith('.html')).map(f => join(web, 'tools', f)),
];
const maps = [];
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const m of html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)) {
    const { imports } = JSON.parse(m[1]);
    maps.push({ page, imports });
    for (const [spec, target] of Object.entries(imports)) {
      check(!/^https?:/.test(target), `${page}: "${spec}" loads from the network (${target})`);
      const onDisk = resolve(dirname(page), target);
      check(existsSync(onDisk), `${page}: "${spec}" -> ${target} does not exist`);
    }
  }
}
check(maps.some(m => m.page.endsWith('/web/index.html')), 'web/index.html has no import map');

// Every addon the app imports exists under the vendored addons directory.
const addons = new Set();
const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) {
  if (e.isDirectory()) walk(join(d, e.name));
  else if (e.name.endsWith('.js')) for (const m of readFileSync(join(d, e.name), 'utf8').matchAll(/from\s+['"]three\/addons\/([^'"]+)['"]/g)) addons.add(m[1]);
} };
walk(join(web, 'js'));
for (const a of addons) check(existsSync(join(web, 'vendor/three/addons', a)), `three/addons/${a} is not vendored`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
