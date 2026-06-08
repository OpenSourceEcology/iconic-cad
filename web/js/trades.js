// =====================================================
// TRADES — the build flow over the left trade rail + the bottom-center NEXT
// TRADE gate. Fixed order: FRAMING → FOUNDATION → 3D PREVIEW.
//
// FRONTIER MODEL. `ui.reachedTrade` is the index of the furthest trade committed
// via NEXT TRADE. A trade behind the frontier (index < reachedTrade) is LOCKED:
// read-only. Framing controls are disabled once you advance past framing. To
// change a locked trade you press its EDIT (framing) / REGENERATE (foundation)
// button, confirm the warning, and everything AHEAD of it is un-generated — the
// foundation entity is deleted, the frontier drops back, and editing resumes.
//
// Going BACK to a locked trade to LOOK is free (no regenerate). Going FORWARD
// again through already-done trades via NEXT is also free.
//
// Per-trade done-ness is DERIVED from the model (region enclosure / foundation
// entity), never stored.
// =====================================================
import { doc, ui } from './state.js';
import { regionForLevel } from './region.js';
import { switchTab } from './ui.js';
import { setRenderMode, resize3d } from './render3d.js';
import { openFoundationModal } from './foundation.js';
import { markModelChanged } from './app.js';

export const TRADES = ['framing', 'foundation', '3d'];

const RAIL_ID = { framing: 'btn-tab-framing', foundation: 'btn-tab-foundation', '3d': 'btn-tab-3d' };
const NEXT_HINT = {
  framing:    'Finish a true silhouette for each story before continuing.',
  foundation: 'Generate the foundation to continue.',
  '3d':       'Final step — view your whole build.',
};
const EDIT_LABEL = { framing: 'EDIT', foundation: 'REGENERATE' };

// ---- Derived done-conditions ---------------------------------------------
export function framingDone() {
  const levels = [...new Set(doc.entities.filter(e => e.kind === 'wall').map(e => e.level || 'L1'))];
  if (!levels.length) return false;
  return levels.every(l => regionForLevel(l).isEnclosed);
}
export function foundationDone() {
  return doc.entities.some(e => e.kind === 'foundation');
}
export function tradeDone(trade) {
  if (trade === 'framing')    return framingDone();
  if (trade === 'foundation') return foundationDone();
  return true; // 3d preview is terminal — no gate
}

// Framing editing is allowed ONLY while framing is the frontier (nothing built
// downstream). Once you advance, framing locks until an explicit EDIT.
export function framingEditable() {
  return ui.activeTrade === 'framing' && ui.reachedTrade === 0;
}

// ---- Downstream invalidation ---------------------------------------------
function clearFoundation() {
  for (let i = doc.entities.length - 1; i >= 0; i--) {
    if (doc.entities[i].kind === 'foundation') doc.entities.splice(i, 1);
  }
}
// Un-generate every trade's work AHEAD of trade index `keepIdx`.
function ungenerateAbove(keepIdx) {
  if (keepIdx < 1) clearFoundation(); // foundation is trade index 1's output
  // 3d preview (index 2) produces no document entities — nothing to clear.
}

// ---- View + layout per trade ---------------------------------------------
// framing → 2D build grid (library shown). foundation/3d → 3D viewport with the
// library tray HIDDEN so the viewport grows into that space.
function applyLayout(trade) {
  const is3d = trade !== 'framing';
  const footer = document.getElementById('footer-bar');
  if (footer) footer.style.display = is3d ? 'none' : '';

  if (trade === 'framing') {
    switchTab('2d');
    setRenderMode('solid');
  } else if (trade === 'foundation') {
    switchTab('3d');
    setRenderMode('foundation-review');
  } else {
    switchTab('3d');
    setRenderMode('solid');
  }
  if (is3d) resize3d(); // viewport reclaims the hidden library tray
  document.getElementById('next-trade-wrap')?.classList.toggle('lowered', is3d);

  // Dim + disable framing controls when viewing a locked framing trade.
  const locked = trade === 'framing' && ui.reachedTrade > 0;
  document.getElementById('main-area')?.classList.toggle('editing-locked', locked);
}

export function setActiveTrade(trade) {
  ui.activeTrade = trade;
  applyLayout(trade);
  refreshTradeUI();
  // Foundation at the frontier and not yet generated → open the autogen popup.
  // Reviewing a locked (already-generated) foundation just shows the review.
  if (trade === 'foundation' && TRADES.indexOf(trade) === ui.reachedTrade && !foundationDone()) {
    openFoundationModal();
  }
}

// ---- Rail + NEXT/EDIT rendering ------------------------------------------
export function refreshTradeUI() {
  const ai = TRADES.indexOf(ui.activeTrade);
  const reached = ui.reachedTrade;

  TRADES.forEach((t, i) => {
    const btn = document.getElementById(RAIL_ID[t]);
    if (!btn) return;
    btn.classList.remove('trade-current', 'trade-done', 'trade-locked');
    if (i === ai)        btn.classList.add('trade-current'); // active highlight
    else if (i <= reached) btn.classList.add('trade-done');  // reached — blue, view it
    else                 btn.classList.add('trade-locked');  // ahead of frontier — gated
  });

  const wrap = document.getElementById('next-trade-wrap');
  const next = document.getElementById('btn-next-trade');
  const edit = document.getElementById('btn-edit-trade');
  const hint = document.getElementById('next-trade-hint');
  if (!wrap || !next || !hint) return;

  const terminal = ui.activeTrade === '3d';
  wrap.classList.toggle('terminal', terminal);
  hint.textContent = NEXT_HINT[ui.activeTrade];

  if (terminal) {
    next.style.display = 'none';
  } else {
    next.style.display = '';
    const ready = tradeDone(ui.activeTrade);
    next.classList.toggle('ready', ready);
    next.disabled = !ready;
  }

  // EDIT / REGENERATE — only when viewing a LOCKED (committed) trade.
  if (edit) {
    const locked = ai < reached;
    edit.style.display = locked ? '' : 'none';
    if (locked) edit.textContent = EDIT_LABEL[ui.activeTrade] || 'EDIT';
  }
}

// ---- Flashes --------------------------------------------------------------
let _lockedTimer = null;
function flashLocked() {
  const el = document.getElementById('trade-locked-hint');
  if (!el) return;
  el.classList.add('show');
  clearTimeout(_lockedTimer);
  _lockedTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

// ---- Wiring ---------------------------------------------------------------
function onRailClick(trade) {
  const ti = TRADES.indexOf(trade);
  if (ti > ui.reachedTrade) { flashLocked(); return; } // ahead of frontier — gated
  setActiveTrade(trade);                                // reached/current → view it
}

function onNext() {
  const ai = TRADES.indexOf(ui.activeTrade);
  if (ai >= TRADES.length - 1) return;
  if (!tradeDone(ui.activeTrade)) return; // gray/disabled anyway
  ui.reachedTrade = Math.max(ui.reachedTrade, ai + 1); // commit + lock the trade we leave
  setActiveTrade(TRADES[ai + 1]);
}

// EDIT (framing) / REGENERATE (foundation) a locked trade: warn, un-generate
// everything ahead, drop the frontier back, resume control here.
function onEdit() {
  const ai = TRADES.indexOf(ui.activeTrade);
  if (ai >= ui.reachedTrade) return; // not a locked trade — nothing to edit

  if (ui.activeTrade === 'framing') {
    if (!confirm('Editing framing will un-generate the foundation and every later trade. Continue?')) return;
    ungenerateAbove(0);
    ui.reachedTrade = 0;
    markModelChanged();
    setActiveTrade('framing'); // frontier → controls resume
  } else if (ui.activeTrade === 'foundation') {
    if (!confirm('Regenerating the foundation will un-generate every later trade. Continue?')) return;
    ungenerateAbove(1);  // clear anything ahead of foundation (none yet)
    clearFoundation();   // drop the current foundation so the popup regenerates it
    ui.reachedTrade = 1;
    markModelChanged();
    setActiveTrade('foundation'); // frontier + not-done → reopens the autogen popup
  }
}

export function initTrades() {
  TRADES.forEach(t => {
    document.getElementById(RAIL_ID[t])?.addEventListener('click', () => onRailClick(t));
  });
  document.getElementById('btn-next-trade')?.addEventListener('click', onNext);
  document.getElementById('btn-edit-trade')?.addEventListener('click', onEdit);

  // GO in the foundation popup wrote the entity → enter review + re-gate.
  window.addEventListener('iconic:foundation', () => {
    setRenderMode('foundation-review');
    refreshTradeUI();
  });

  // Model changed (place/erase/load) → the framing gate may have flipped.
  window.addEventListener('iconic:model', refreshTradeUI);

  // New design / Options GO → start fresh at the framing frontier.
  window.addEventListener('iconic:project', () => setActiveTrade('framing'));

  // Successful load → set the frontier to match what's already built, then land
  // on framing (locked for review if anything downstream exists).
  window.addEventListener('iconic:loaded', () => {
    ui.reachedTrade = foundationDone() ? 2 : (framingDone() ? 1 : 0);
    setActiveTrade('framing');
  });

  refreshTradeUI();
}
