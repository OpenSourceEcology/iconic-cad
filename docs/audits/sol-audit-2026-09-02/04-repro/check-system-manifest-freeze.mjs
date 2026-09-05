#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { MODULES } from '/Users/cct/code/iconic-cad/web/js/constants.js';
import { getSystemManifest, loadSystemManifests } from '/Users/cct/code/iconic-cad/web/js/systems.js';

const docs = {
  seh: JSON.parse(readFileSync('/Users/cct/code/iconic-cad/web/data/systems/seh.json', 'utf8')),
  vcs12: JSON.parse(readFileSync('/Users/cct/code/iconic-cad/web/data/systems/vcs12.json', 'utf8')),
};
docs.seh.palette[0].width_in = 60;

globalThis.fetch = async url => {
  const id = url.endsWith('vcs12.json') ? 'vcs12' : 'seh';
  return { ok: true, json: async () => docs[id] };
};

await loadSystemManifests('/ignored');
const liveWidth = getSystemManifest('seh').palette[0].width_in;
const exportedWidth = MODULES[0].width_mm / 25.4;
console.log(`loaded seh.json width: ${liveWidth} in`);
console.log(`constants.js MODULES width after load: ${exportedWidth} in`);
process.exit(liveWidth !== exportedWidth ? 1 : 0);
