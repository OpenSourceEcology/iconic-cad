/**
 * Show that a load silently drops unknown module IDs and that a later validation
 * error leaves the already-reset document partially populated.
 */
import { doc } from '../../../../../../code/iconic-cad/web/js/state.js';
import { applyLoadedData } from '../../../../../../code/iconic-cad/web/js/load.js';

const project = {
  name: 'Repro', system: 'seh', stories: 1,
  climate: { iecc_zone: 5, frost_mm: 750, snow_psf: 30, wind_mph: 115, seismic_class: 'B' },
};
const valid = {
  id: 'valid', kind: 'wall', module: 'wall_4x8_2x6_16oc', system: 'seh',
  direction: 'north', x_mm: 0, y_mm: 0, level: 'L1', layer: 'structural',
};

applyLoadedData({ version: 2, units: 'mm', project, entities: [
  valid, { ...valid, id: 'missing', module: 'module_does_not_exist' },
] });
console.log('unknown-module load returned normally:', true);
console.log('requested entities:', 2, 'loaded entities:', doc.entities.length);

try {
  applyLoadedData({ version: 2, units: 'mm', project, entities: [
    valid, { ...valid, id: 'wrong-system', system: 'vcs12' },
  ] });
} catch (err) {
  console.log('later mixed-system error:', err.message);
}
console.log('entities left after failed load:', doc.entities.map(e => e.id));
