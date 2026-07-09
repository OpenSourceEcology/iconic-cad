import { explodeAssembly } from './assembly_translate.js';
import { parseEntryJson } from './entry_files.js';
import { activeSystem } from './systems.js';
import { showNotice } from './notices.js';
import { entityPlanRect, planBounds } from './plan_rects.js';

const registry = new Map();
const BUILTIN_LIBRARY_GROUP = 'VILLAGE CONSTRUCTION SET';
const BUILTIN_LIBRARY_BASE = 'data/builtin_library';
let builtinLibraryPromise = null;
let builtinLibraryLoaded = false;

export function loadedCustomEntries(systemId = activeSystem().id) {
  return [...registry.values()].filter(entry => entry.interface.system === systemId);
}

export function loadedUserEntries(systemId = activeSystem().id) {
  return loadedCustomEntries(systemId).filter(entry => !entry.builtin);
}

export function loadedBuiltinEntries(systemId = activeSystem().id) {
  return loadedCustomEntries(systemId).filter(entry => entry.builtin);
}

export function clearCustomLibrary() {
  registry.clear();
  builtinLibraryPromise = null;
  builtinLibraryLoaded = false;
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

export async function ensureBuiltinLibrary(manifest = activeSystem()) {
  if (manifest.id !== 'vcs12') return { accepted: [], refused: [] };
  if (builtinLibraryLoaded) return { accepted: loadedBuiltinEntries(manifest.id), refused: [] };
  if (!builtinLibraryPromise) builtinLibraryPromise = loadBuiltinLibrary(manifest);
  return builtinLibraryPromise;
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
  const includeBuiltins = manifest.id === 'vcs12';
  if (includeBuiltins && !builtinLibraryLoaded) {
    ensureBuiltinLibrary(manifest).then(() => {
      renderCustomLibrary(container, { onPick, manifest });
    }).catch(err => console.warn(`Built-in library unavailable: ${err.message}`));
  }
  const controls = libraryControls();

  const fileInput = document.getElementById('custom-library-input');
  controls.querySelector('#btn-load-library')?.addEventListener('click', () => fileInput?.click());
  controls.querySelector('#btn-load-library-dir')?.addEventListener('click', async () => {
    try {
      await loadLibraryDirectory(manifest);
      renderCustomLibrary(container, { onPick, manifest });
    } catch (err) {
      if (err.name !== 'AbortError') showNotice(`Library folder load failed: ${err.message}`);
    }
  });

  const builtins = includeBuiltins ? loadedBuiltinEntries(manifest.id) : [];
  const userEntries = loadedUserEntries(manifest.id);
  if (includeBuiltins && !builtinLibraryLoaded && !userEntries.length) {
    container.appendChild(controls);
    return;
  }
  if (!builtins.length && !userEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'custom-library-empty';
    empty.textContent = includeBuiltins
      ? 'Assemblies load from library zips.'
      : 'Assemblies load from library zips; built-ins are VCS-12.';
    container.appendChild(empty);
  } else {
    if (builtins.length) appendEntryGroup(container, BUILTIN_LIBRARY_GROUP, builtins, manifest, onPick);
    for (const entry of userEntries) container.appendChild(customEntryCard(entry, manifest, onPick));
  }
  container.appendChild(controls);
}

export function customAssemblyBounds(entry, manifest = activeSystem()) {
  const { entities } = explodeAssembly(entry.schema, manifest);
  return { ...planBounds(entities), entities };
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
  if (entry.builtin || entry.status === 'wip') {
    const badge = document.createElement('span');
    badge.className = `custom-entry-badge${entry.builtin ? ' builtin' : ''}`;
    badge.textContent = entry.builtin ? 'built-in' : 'wip';
    text.querySelector('.custom-entry-meta').appendChild(badge);
  }
  item.appendChild(thumb);
  item.appendChild(text);
  item.addEventListener('click', () => onPick?.(entry));
  return item;
}

function appendEntryGroup(container, label, entries, manifest, onPick) {
  const group = document.createElement('div');
  group.className = 'custom-entry-group';
  const heading = document.createElement('div');
  heading.className = 'custom-entry-group-label';
  heading.textContent = label;
  group.appendChild(heading);
  for (const entry of entries) group.appendChild(customEntryCard(entry, manifest, onPick));
  container.appendChild(group);
}

function libraryControls() {
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
  return controls;
}

async function loadBuiltinLibrary(manifest) {
  const accepted = [];
  const refused = [];
  let filenames;
  try {
    const indexResp = await fetch(`${BUILTIN_LIBRARY_BASE}/index.json`, { cache: 'reload' });
    if (!indexResp.ok) throw new Error(`HTTP ${indexResp.status}`);
    filenames = await indexResp.json();
    if (!Array.isArray(filenames)) throw new Error('index must be an array');
  } catch (err) {
    console.warn(`Built-in library index skipped: ${err.message}`);
    builtinLibraryLoaded = true;
    return { accepted, refused: [err.message] };
  }

  for (const name of filenames) {
    try {
      if (typeof name !== 'string' || !name.endsWith('.json') || name.includes('/')) {
        throw new Error(`invalid filename: ${name}`);
      }
      const resp = await fetch(`${BUILTIN_LIBRARY_BASE}/${name}`, { cache: 'reload' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const entry = parseEntryJson(await resp.text());
      accepted.push(acceptBuiltinEntry(entry, manifest));
    } catch (err) {
      refused.push(`${name}: ${err.message}`);
      console.warn(`Built-in library entry skipped: ${name}: ${err.message}`);
    }
  }
  builtinLibraryLoaded = true;
  return { accepted, refused };
}

function acceptBuiltinEntry(entry, manifest) {
  return acceptCustomEntry({
    ...entry,
    builtin: true,
    builtinGroup: BUILTIN_LIBRARY_GROUP,
  }, manifest);
}

function drawEntryThumbnail(canvas, entry, manifest) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a1020';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    const bounds = customAssemblyBounds(entry, manifest);
    if (!bounds.entities.length) return;
    const margin = 2;
    const scale = Math.min(
      (canvas.width - margin * 2) / Math.max(bounds.width_mm, 1),
      (canvas.height - margin * 2) / Math.max(bounds.depth_mm, 1),
    );
    const ox = (canvas.width - bounds.width_mm * scale) / 2;
    const oy = (canvas.height - bounds.depth_mm * scale) / 2;
    for (const e of bounds.entities) {
      const r = entityPlanRect(e);
      const w = r.w_mm * scale;
      const h = r.h_mm * scale;
      const x = ox + (r.x0 - bounds.minX) * scale;
      const y = oy + (r.y0 - bounds.minY) * scale;
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
