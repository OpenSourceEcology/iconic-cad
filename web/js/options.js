// =====================================================
// OPTIONS — the Project Options modal.
// A one-time, write-once project-setup popup shown on "DESIGN ECO HOME".
// Captures project-level intent (name, stories, climate zone) and bakes it into
// doc.project. Mirrors the export-modal pattern. NOTE: there is no per-story
// wall-height field — wall height follows from module choice. (Per-story height
// UI is a deferred feature, see CAD-AUD-003; do not infer one from this modal.)
//
// WRITE-ONCE: the only exit is GO. No X, no backdrop, no Esc. Once GO fires the
// modal closes and is NOT reopenable this session. Editing-after-confirm is a
// separate future feature and is deliberately out of scope here.
//
// This page ONLY writes doc.project. It does NOT touch doc.levels, the
// enumerator, the library, 3D, or any trade. The climate bundle is latent —
// stored for later features to read. See the seam comment below.
// =====================================================
import { doc } from './state.js';
import { setActiveSystem } from './systems.js';

// ---------------------------------------------------------------------------
// resolveClimate(zone) — PURE. The reference implementation of the
// "pick once at setup, autogenerate downstream" pattern. Given an IECC/IRC
// climate zone (1-8) returns a resolved climate bundle.
//
// frost_mm / snow_psf are zone-derived directional estimates — "autogenerate?"
// grade, NOT engineered values. wind_mph / seismic_class do NOT track thermal
// zones, so they are seeded from the OSE Missouri baseline (not zone-resolved).
// TODO: refine wind/seismic against real ASCE wind & seismic maps later.
//
// SEAM: the returned bundle is latent. Nothing consumes it yet. The foundation
// frost-skirt trade owns the first "autogenerate?" demo that reads frost_mm.
// Do NOT add an autogenerate hook here.
// ---------------------------------------------------------------------------
const CLIMATE_TABLE = {
  1: { frost_mm: 0,    snow_psf: 0  }, // Hot
  2: { frost_mm: 0,    snow_psf: 5  }, // Hot-humid/dry
  3: { frost_mm: 150,  snow_psf: 5  }, // Warm
  4: { frost_mm: 450,  snow_psf: 20 }, // Mixed
  5: { frost_mm: 750,  snow_psf: 30 }, // Cool (default — OSE / Missouri)
  6: { frost_mm: 1200, snow_psf: 50 }, // Cold
  7: { frost_mm: 1500, snow_psf: 70 }, // Very cold
  8: { frost_mm: 1800, snow_psf: 90 }, // Subarctic
};

export function resolveClimate(zone) {
  const z = CLIMATE_TABLE[zone] ? zone : 5;
  const { frost_mm, snow_psf } = CLIMATE_TABLE[z];
  return {
    iecc_zone: z,
    frost_mm,
    snow_psf,
    wind_mph: 115,        // Missouri baseline — not zone-resolved (TODO: wind maps)
    seismic_class: 'B',   // Missouri baseline — not zone-resolved (TODO: seismic maps)
  };
}

// ---------------------------------------------------------------------------
// Transient form state — local to the modal, flushed to doc.project on GO.
// ---------------------------------------------------------------------------
const form = {
  name: 'Untitled Eco Home',
  system: 'seh',
  stories: 1,
  zone: 5,
};

let _confirmed = false; // write-once latch — GO sets this; modal never reopens

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderStories() {
  const single = document.getElementById('opt-stories-single');
  const double = document.getElementById('opt-stories-double');
  const pill = document.getElementById('opt-stories-pill');
  if (!single || !double) return;
  single.classList.toggle('active', form.stories === 1);
  double.classList.toggle('active', form.stories === 2);
  // Slide the highlight thumb via a data-attr the CSS animates.
  if (pill) pill.dataset.pos = form.stories === 1 ? 'left' : 'right';
}

function validate() {
  // Every field defaults valid, so GO is green on open. Name is optional and
  // never blocks. Gray only ever appears if a future required field is cleared.
  const valid = form.stories === 1 || form.stories === 2;
  const go = document.getElementById('opt-go');
  if (go) go.disabled = !valid;
  return valid;
}

// ---------------------------------------------------------------------------
// GO — flush form → doc.project, close, latch shut.
// ---------------------------------------------------------------------------
function onGo() {
  if (!validate()) return;

  doc.project = {
    name: (form.name || '').trim() || 'Untitled Eco Home',
    system: form.system,
    stories: form.stories,
    climate: resolveClimate(form.zone), // latent bundle; no consumer yet (seam above)
  };
  setActiveSystem(form.system);

  _confirmed = true;
  document.getElementById('options-modal').classList.remove('open');
  // Tell the UI the project intent is set (the floor switcher shows for 2-story).
  window.dispatchEvent(new Event('iconic:project'));
}

// ---------------------------------------------------------------------------
// Reset — called from home.js when a fresh design starts. Drops the write-once
// latch and the transient form so "Design new home" re-prompts cleanly each
// time (previously GO latched shut for the whole session, so a 2nd new-design
// silently skipped the modal and kept stale state).
// ---------------------------------------------------------------------------
export function resetProjectOptions() {
  _confirmed = false;
  form.name = 'Untitled Eco Home';
  form.system = 'seh';
  form.stories = 1;
  form.zone = 5;
  const nameInput = document.getElementById('opt-name');
  if (nameInput) nameInput.value = form.name;
  const zoneSel = document.getElementById('opt-zone');
  if (zoneSel) zoneSel.value = String(form.zone);
  const systemSel = document.getElementById('opt-system');
  if (systemSel) {
    systemSel.value = form.system;
    systemSel.disabled = doc.entities.length > 0;
  }
}

// ---------------------------------------------------------------------------
// Open — called from home.js right after showDesign(). No-op once confirmed.
// ---------------------------------------------------------------------------
export function openProjectOptions() {
  if (_confirmed) return; // write-once: never reopen this session
  document.getElementById('options-modal').classList.add('open');
  renderStories();
  validate();
}

// ---------------------------------------------------------------------------
// Init — call once from main.js. Wires inputs; no open/close-by-backdrop/Esc.
// ---------------------------------------------------------------------------
export function initProjectOptions() {
  const nameInput = document.getElementById('opt-name');
  if (nameInput) {
    nameInput.value = form.name;
    nameInput.addEventListener('input', () => { form.name = nameInput.value; validate(); });
  }

  const systemSel = document.getElementById('opt-system');
  if (systemSel) {
    systemSel.value = form.system;
    systemSel.addEventListener('change', () => {
      if (doc.entities.length > 0) {
        systemSel.value = form.system;
        return;
      }
      form.system = systemSel.value;
      setActiveSystem(form.system);
      validate();
    });
  }

  document.getElementById('opt-stories-single')
    ?.addEventListener('click', () => { form.stories = 1; renderStories(); validate(); });
  document.getElementById('opt-stories-double')
    ?.addEventListener('click', () => { form.stories = 2; renderStories(); validate(); });

  const zoneSel = document.getElementById('opt-zone');
  if (zoneSel) {
    zoneSel.value = String(form.zone);
    zoneSel.addEventListener('change', () => { form.zone = parseInt(zoneSel.value, 10); validate(); });
  }

  document.getElementById('opt-go')?.addEventListener('click', onGo);
}
