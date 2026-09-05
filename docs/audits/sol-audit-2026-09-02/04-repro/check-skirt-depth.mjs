#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { computeRegion } from '/Users/cct/code/iconic-cad/web/js/region.js';
import { foundationSolids } from '/Users/cct/code/iconic-cad/web/js/foundation_geom.js';

const data = JSON.parse(readFileSync('/Users/cct/code/iconic-cad/tests/fixtures/foundation_rect.json', 'utf8'));
const entities = data.entities.map(e => ({
  ...e,
  dir: e.direction,
  mod: { id: e.module, width_mm: e.width_mm, depth_mm: e.depth_mm },
}));
const walls = entities.filter(e => e.kind === 'wall');
const region = computeRegion(entities);
const silhouette = {
  rects: region.rects,
  walls,
  containsPoint: region.containsPoint,
};
const base = {
  slab_thickness_mm: 101.6,
  beam_w_mm: 304.8,
  beam_d_mm: 457.2,
  skirt_thickness_mm: 50.8,
};

const shallow = foundationSolids({ ...base, skirt_depth_mm: 150 }, silhouette);
const deep = foundationSolids({ ...base, skirt_depth_mm: 1800 }, silhouette);
console.log(`150 mm depth pieces: ${shallow.length}`);
console.log(`1800 mm depth pieces: ${deep.length}`);
console.log(`geometry byte-identical: ${JSON.stringify(shallow) === JSON.stringify(deep)}`);
process.exit(JSON.stringify(shallow) === JSON.stringify(deep) ? 1 : 0);
