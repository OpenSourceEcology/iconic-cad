import { readFile } from 'node:fs/promises';
import { explodeAssembly } from '../../web/js/assembly_translate.js';
import { parseEntryJson } from '../../web/js/entry_files.js';
import { getSystemManifest } from '../../web/js/systems.js';
import { entityPlanRect, planBounds } from '../../web/js/plan_rects.js';

const IN_TO_MM = 25.4;
const CELL_IN = 6;

const entry = parseEntryJson(await readFile('web/data/builtin_library/cabin_walls_floor.json', 'utf8'));
const manifest = getSystemManifest('vcs12');
const { entities, warnings } = explodeAssembly(entry.schema, manifest);
const rects = entities.map(entity => ({
  id: entity.id,
  mod: entity.mod.id,
  dir: entity.dir,
  ...entityPlanRect(entity),
}));
const bounds = planBounds(entities);

console.log(`bounds: ${fmtIn(bounds.width_mm)}in x ${fmtIn(bounds.depth_mm)}in`);
if (warnings.length) console.log(`warnings: ${warnings.join('; ')}`);
console.log('rects:');
for (const r of rects) {
  console.log(
    `${r.dir.padEnd(5)} ${r.mod.padEnd(19)} ` +
    `x=${fmtIn(r.x0)}..${fmtIn(r.x1)}in y=${fmtIn(r.y0)}..${fmtIn(r.y1)}in`,
  );
}

const cols = Math.ceil((bounds.width_mm / IN_TO_MM) / CELL_IN);
const rows = Math.ceil((bounds.depth_mm / IN_TO_MM) / CELL_IN);
const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => '.'));
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    const cx = bounds.minX + (col + 0.5) * CELL_IN * IN_TO_MM;
    const cy = bounds.minY + (row + 0.5) * CELL_IN * IN_TO_MM;
    const hit = rects.find(r => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1);
    if (hit) grid[row][col] = mark(hit.dir);
  }
}

console.log(`ascii plan (${CELL_IN}in cells):`);
for (const row of grid) console.log(row.join(''));

function mark(dir) {
  if (dir === 'north') return 'N';
  if (dir === 'south') return 'S';
  if (dir === 'west') return 'W';
  if (dir === 'east') return 'E';
  return '#';
}

function fmtIn(mm) {
  return String(Math.round((mm / IN_TO_MM) * 1000) / 1000);
}
