import { explodeAssembly } from './assembly_translate.js';
import { parseEntryJson } from './entry_files.js';
import { activeSystem } from './systems.js';
import { showNotice } from './notices.js';

const registry = new Map();

export function loadedCustomEntries(systemId = activeSystem().id) {
  return [...registry.values()].filter(entry => entry.interface.system === systemId);
}

export function clearCustomLibrary() {
  registry.clear();
}

export function missingEntryModuleRefs(entry, manifest = activeSystem()) {
  const ids = new Set((manifest.palette || []).map(p => p.id));
  const types = new Set((manifest.palette || []).map(p => p.type).filter(Boolean));
  const refs = new Set();
  for (const wall of entry.schema?.walls || []) {
    for (const module of wall.modules || []) {
      const ref = module.id || module.module_id || module.module || module.type;
      if (ref) refs.add(ref);
    }
  }
  return [...refs].filter(ref => !ids.has(ref) && !types.has(ref));
}

export function acceptCustomEntry(entry, manifest = activeSystem()) {
  if (entry.interface.system !== manifest.id) {
    throw new Error(`${entry.id} is for ${entry.interface.system}, not ${manifest.id}`);
  }
  const missing = missingEntryModuleRefs(entry, manifest);
  if (missing.length) {
    throw new Error(`${entry.id} missing modules: ${missing.join(', ')}`);
  }
  registry.set(entry.id, entry);
  return entry;
}

export async function loadLibraryZipFile(file, manifest = activeSystem()) {
  const { default: JSZip } = await import('../vendor/jszip.min.mjs');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const jsonFiles = Object.values(zip.files)
    .filter(item => !item.dir && item.name.split('/').pop().endsWith('.json'));
  if (!jsonFiles.length) throw new Error(`${file.name} has no entry json`);

  const accepted = [];
  const refused = [];
  for (const item of jsonFiles) {
    try {
      const entry = parseEntryJson(await item.async('string'));
      accepted.push(acceptCustomEntry(entry, manifest));
    } catch (err) {
      refused.push(err.message);
    }
  }
  reportLoadResult(file.name, accepted, refused);
  return { accepted, refused };
}

export async function loadLibraryZipFiles(files, manifest = activeSystem()) {
  const results = [];
  for (const file of files) results.push(await loadLibraryZipFile(file, manifest));
  return results;
}

export async function loadLibraryDirectory(manifest = activeSystem()) {
  if (typeof showDirectoryPicker !== 'function') return null;
  const root = await showDirectoryPicker();
  const files = [];
  await collectJsonHandles(root, '', files);
  const accepted = [];
  const refused = [];
  for (const item of files) {
    try {
      const entry = parseEntryJson(await item.file.text());
      accepted.push(acceptCustomEntry(entry, manifest));
    } catch (err) {
      refused.push(`${item.path}: ${err.message}`);
    }
  }
  reportLoadResult(root.name || 'directory', accepted, refused);
  return { accepted, refused };
}

export function renderCustomLibrary(container, { onPick, manifest = activeSystem() } = {}) {
  container.innerHTML = '';
  const controls = document.createElement('div');
  controls.className = 'custom-library-controls';
  const loadButton = document.createElement('button');
  loadButton.id = 'btn-load-library';
  loadButton.type = 'button';
  loadButton.textContent = 'LOAD LIBRARY';
  controls.appendChild(loadButton);

  const dirButton = document.createElement('button');
  dirButton.id = 'btn-load-library-dir';
  dirButton.type = 'button';
  dirButton.textContent = 'LOAD FOLDER';
  dirButton.hidden = typeof showDirectoryPicker !== 'function';
  controls.appendChild(dirButton);
  container.appendChild(controls);

  const fileInput = document.getElementById('custom-library-input');
  loadButton.addEventListener('click', () => fileInput?.click());
  dirButton.addEventListener('click', async () => {
    try {
      await loadLibraryDirectory(manifest);
      renderCustomLibrary(container, { onPick, manifest });
    } catch (err) {
      if (err.name !== 'AbortError') showNotice(`Library folder load failed: ${err.message}`);
    }
  });

  const entries = loadedCustomEntries(manifest.id);
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'custom-library-empty';
    empty.textContent = 'Load a library zip exported from this editor, or an entry folder with a canonical <id>.json view.';
    container.appendChild(empty);
    return;
  }
  for (const entry of entries) container.appendChild(customEntryCard(entry, manifest, onPick));
}

export function customAssemblyBounds(entry, manifest = activeSystem()) {
  const { entities } = explodeAssembly(entry.schema, manifest);
  if (!entities.length) return { width_mm: 0, depth_mm: 0, entities };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of entities) {
    const horizontal = e.dir === 'north' || e.dir === 'south';
    const w = horizontal ? e.mod.width_mm : e.mod.depth_mm;
    const h = horizontal ? e.mod.depth_mm : e.mod.width_mm;
    minX = Math.min(minX, e.x_mm);
    minY = Math.min(minY, e.y_mm);
    maxX = Math.max(maxX, e.x_mm + w);
    maxY = Math.max(maxY, e.y_mm + h);
  }
  return { width_mm: maxX - minX, depth_mm: maxY - minY, minX, minY, entities };
}

function customEntryCard(entry, manifest, onPick) {
  const item = document.createElement('div');
  item.className = 'iso-item custom-entry-card';
  item.title = `${entry.title} - place custom assembly`;
  const thumb = document.createElement('canvas');
  thumb.width = 72;
  thumb.height = 48;
  drawEntryThumbnail(thumb, entry, manifest);
  const text = document.createElement('div');
  text.className = 'iso-text';
  text.innerHTML =
    `<div class="iso-label"></div>` +
    `<div class="iso-hint"></div>` +
    `<div class="custom-entry-meta"></div>`;
  text.querySelector('.iso-label').textContent = entry.title;
  text.querySelector('.iso-hint').textContent = entry.id;
  text.querySelector('.custom-entry-meta').textContent = `${entry.owner} | ${entry.status}`;
  if (entry.status === 'wip') {
    const badge = document.createElement('span');
    badge.className = 'custom-entry-badge';
    badge.textContent = 'wip';
    text.querySelector('.custom-entry-meta').appendChild(badge);
  }
  item.appendChild(thumb);
  item.appendChild(text);
  item.addEventListener('click', () => onPick?.(entry));
  return item;
}

function drawEntryThumbnail(canvas, entry, manifest) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a1020';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const bounds = customAssemblyBounds(entry, manifest);
    if (!bounds.entities.length) return;
    const scale = Math.min(
      (canvas.width - 12) / Math.max(bounds.width_mm, 1),
      (canvas.height - 12) / Math.max(bounds.depth_mm, 1),
    );
    const ox = (canvas.width - bounds.width_mm * scale) / 2;
    const oy = (canvas.height - bounds.depth_mm * scale) / 2;
    for (const e of bounds.entities) {
      const horizontal = e.dir === 'north' || e.dir === 'south';
      const w = (horizontal ? e.mod.width_mm : e.mod.depth_mm) * scale;
      const h = (horizontal ? e.mod.depth_mm : e.mod.width_mm) * scale;
      const x = ox + (e.x_mm - bounds.minX) * scale;
      const y = oy + (e.y_mm - bounds.minY) * scale;
      ctx.fillStyle = e.mod.type === 'window' ? '#285f77' : (e.mod.type === 'door' ? '#6a5430' : '#25436d');
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
  } catch (err) {
    ctx.fillStyle = '#ff5252';
    ctx.fillRect(8, 22, canvas.width - 16, 4);
  }
}

async function collectJsonHandles(dirHandle, prefix, out) {
  for await (const [name, handle] of dirHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      await collectJsonHandles(handle, path, out);
    } else if (name.endsWith('.json')) {
      out.push({ path, file: await handle.getFile() });
    }
  }
}

function reportLoadResult(source, accepted, refused) {
  if (refused.length) showNotice(`${source}: refused ${refused.join('; ')}`);
  else showNotice(`${source}: loaded ${accepted.length} custom ${accepted.length === 1 ? 'entry' : 'entries'}`);
}
