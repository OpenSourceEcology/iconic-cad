import { doc } from './state.js';
import { activeSystem } from './systems.js';
import { composeAssembly } from './assembly_translate.js';
import { buildEntryFiles, parseEntryJson } from './entry_files.js';
import { showNotice } from './notices.js';
import { entityPlanRect } from './plan_rects.js';

const IN_TO_MM = 25.4;

export function saveableExteriorEntities(manifest = activeSystem()) {
  const typedIds = new Set((manifest.palette || []).filter(p => p.type).map(p => p.id));
  return doc.entities.filter(e =>
    e.kind === 'wall' &&
    e.level === doc.activeLevel &&
    (e.system || e.mod?.system || doc.project.system) === manifest.id &&
    typedIds.has(e.mod?.id));
}

export async function saveCustomModuleFromDocument({ title, author } = {}) {
  const manifest = activeSystem();
  const entities = saveableExteriorEntities(manifest);
  if (!entities.length) {
    showNotice('No same-system exterior wall modules are available to save.');
    return null;
  }
  const counts = countByModule(entities);
  const summary = Object.entries(counts).map(([id, count]) => `${id}: ${count}`).join('\n');
  if (typeof confirm === 'function' &&
      !confirm(`Save these placed ${manifest.label} exterior wall modules as a custom module?\n\n${summary}`)) {
    return null;
  }
  if (!title || !author) throw new Error('title and author are required');
  return saveCustomModuleZip(entities, { title, author, manifest });
}

export async function saveCustomModuleZip(entities, { title, author, manifest = activeSystem() }) {
  try {
    const schema = composeAssembly(entities, {
      manifest,
      title,
      name: title,
      id: title,
    });
    const files = buildEntryFiles(schema, {
      id: title,
      title,
      owner: author,
      author,
      system: manifest.id,
      manifest,
    }, expectInputsForEntities(entities));
    const jsonName = Object.keys(files).find(name => name.endsWith('.json'));
    const entry = parseEntryJson(files[jsonName]);

    const { default: JSZip } = await import('../vendor/jszip.min.mjs');
    const zip = new JSZip();
    for (const [name, text] of Object.entries(files)) {
      zip.file(`${entry.id}/${name}`, text);
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    downloadBlob(blob, `${entry.id}.zip`);
    showNotice(`Saved ${entry.id}.zip`);
    return { id: entry.id, files };
  } catch (err) {
    showNotice(`Custom module save failed: ${err.message}`);
    throw err;
  }
}

function expectInputsForEntities(entities) {
  if (!entities.length) return {};
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = 0;
  for (const e of entities) {
    const r = entityPlanRect(e);
    minX = Math.min(minX, r.x0);
    minY = Math.min(minY, r.y0);
    maxX = Math.max(maxX, r.x1);
    maxY = Math.max(maxY, r.y1);
    maxZ = Math.max(maxZ, e.mod.height_mm || 0);
  }
  return {
    bbox_in: {
      x: [roundIn(minX), roundIn(maxX)],
      y: [roundIn(minY), roundIn(maxY)],
      z: [0, roundIn(maxZ)],
    },
    solidsLowerBound: entities.length,
  };
}

function roundIn(mm) {
  return Math.round((mm / IN_TO_MM) * 1000) / 1000;
}

function countByModule(entities) {
  const counts = {};
  for (const e of entities) counts[e.mod.id] = (counts[e.mod.id] || 0) + 1;
  return counts;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
