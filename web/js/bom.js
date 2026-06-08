// =====================================================
// BOM ESTIMATOR — runs on model change only (not per mousemove).
//
// Model: the BOM is the SUM of generic line items {material_key, qty, unit},
// contributed by one source per trade layer, priced against a flat material
// catalog (pricing.json lumber + hardware). Today there is exactly one source:
// structural framing (via lineItemsForEntity -> enumerateMembers). A future
// trade (electrical, foundation, roofing…) is just another source emitting the
// same shape into the same aggregator. The aggregator below is therefore
// generic: it sums by material_key and never references roles/nominals/studs.
// =====================================================
import { doc } from './state.js';
import { enumerateMembers } from './members.js';
import { IN_TO_MM } from './constants.js';
import { regionForLevel } from './region.js';
import { getModuleBBox } from './geometry.js';
import { inFrac } from './designs.js';

let pricingData = null;

export async function loadPricing() {
  const resp = await fetch('pricing.json');
  pricingData = await resp.json();
}

// Member roles that are cut from stud stock vs plate stock (display + stocking).
const STUD_ROLES = new Set(['stud', 'king', 'jack', 'top_cripple', 'lower_cripple']);
const PLATE_ROLES = new Set(['bottom_plate', 'top_plate', 'sill', 'subheader', 'sill_block']);

// Map one framing member to its catalog stock key.
function stockKeyFor(m, is2x4, plateLenFt) {
  if (PLATE_ROLES.has(m.role)) {
    return is2x4 ? (plateLenFt <= 4 ? '2x4_8ft' : '2x4_10ft')
                 : (plateLenFt <= 4 ? '2x6_8ft' : '2x6_12ft');
  }
  if (m.role === 'header') return m.nominal; // TODO: catalog lacks 2x8/2x12 header stock; priced 0 until added
  return is2x4 ? '2x4_8ft' : '2x6_8ft'; // stud-like
}

// The ONE adapter that knows about "members". Everything downstream is generic.
// For a structural framing entity it expands the member list into stock line
// items; other (future) layers return their own items or nothing.
export function lineItemsForEntity(entity) {
  const items = [];
  if (entity.kind !== 'wall' && entity.kind !== 'iwall') return items; // ignore non-framing layers
  const mod = entity.mod;
  const is2x4 = !!mod.interior;
  const s = pricingData && pricingData.module_specs[mod.id];
  const plateLenFt = s ? s.plate_length_ft : (mod.width_mm / IN_TO_MM / 12);

  for (const m of enumerateMembers(mod)) {
    if (m.role === 'sheathing') continue; // OSB sourced as sheets via the shim below
    items.push({ material_key: stockKeyFor(m, is2x4, plateLenFt), qty: m.plies || 1, unit: 'each' });
  }

  // Framing-specific shim: quantities the enumerator does not model yet (OSB
  // sheets, nails, screws). These become derived once their enumerators exist.
  if (s) {
    if (s.osb_sheets) items.push({ material_key: 'osb_7_16_4x8', qty: s.osb_sheets, unit: 'sheet' });
    const nails = (s.nails_edge || 0) + (s.nails_center || 0);
    if (nails) items.push({ material_key: 'nail_16d_sinker', qty: nails, unit: 'each' });
    if (s.corner_screws) items.push({ material_key: 'screw_3in', qty: s.corner_screws, unit: 'each' });
  }
  return items;
}

// Framing-aware DISPLAY breakdown (studs vs plates per nominal). Only the cost
// aggregator must stay generic; the rendered rows may name framing concepts.
function framingBreakdown(placed) {
  const b = { studs2x6: 0, plates2x6: 0, studs2x4: 0, plates2x4: 0 };
  for (const p of placed) {
    if (p.kind !== 'wall' && p.kind !== 'iwall') continue;
    const is2x4 = !!p.mod.interior;
    for (const m of enumerateMembers(p.mod)) {
      if (m.nominal !== '2x6' && m.nominal !== '2x4') continue;
      if (STUD_ROLES.has(m.role)) b[is2x4 ? 'studs2x4' : 'studs2x6']++;
      else if (PLATE_ROLES.has(m.role)) b[is2x4 ? 'plates2x4' : 'plates2x6']++;
    }
  }
  return b;
}

// Generic aggregate: sum every source's line items by material_key. This is THE
// summation — the build-summary cut/pick sheet (render_summary.js) re-renders
// this, it does not re-sum. Pure over the entity list.
export function aggregateLineItems(entities) {
  const agg = {};
  for (const e of entities) {
    for (const li of lineItemsForEntity(e)) agg[li.material_key] = (agg[li.material_key] || 0) + li.qty;
  }
  return agg;
}

// Flat priced catalog (lumber + hardware), or {} before pricing loads.
export function getCatalog() {
  return pricingData ? { ...pricingData.lumber, ...pricingData.hardware } : {};
}

// Friendly part name per member role (cut-list display only; summation stays generic).
const PART_LABEL = {
  stud: 'Stud', king: 'King stud', jack: 'Jack stud',
  top_cripple: 'Cripple', lower_cripple: 'Cripple',
  bottom_plate: 'Plate', top_plate: 'Plate',
  sill: 'Sill', subheader: 'Subheader', sill_block: 'Sill block',
  header: 'Header', sheathing: 'OSB sheathing',
};
const inRound = mm => Math.round(mm / IN_TO_MM);

// Framing cut list grouped by {part, nominal, length}. Framing-aware DISPLAY
// (like framingBreakdown), built from the one member enumerator — not a second
// BOM. Returns rows {part, nominal, lengthLabel, qty} sorted part then longest.
export function cutListGrouped(entities) {
  const map = new Map();
  for (const e of entities) {
    if (e.kind !== 'wall' && e.kind !== 'iwall') continue;
    for (const m of enumerateMembers(e.mod)) {
      const part = PART_LABEL[m.role] || m.role;
      let lengthLabel, sortLen;
      if (m.role === 'sheathing') { lengthLabel = `${inRound(m.w_mm)}×${inRound(m.h_mm)}″`; sortLen = 1e9; }
      // Cut length via the shared fractional formatter (nearest 1/8") — never
      // whole-inch rounding (an 81.5" jack must print 81½", not 82). Group by the
      // normalized fractional label so equal cut lengths stack into one row.
      else { const Lin = m.length_mm / IN_TO_MM; lengthLabel = `${inFrac(Lin)}″`; sortLen = Lin; }
      const key = `${part}|${m.nominal}|${lengthLabel}`;
      const cur = map.get(key) || { part, nominal: m.nominal, lengthLabel, qty: 0, sortLen };
      cur.qty += (m.plies || 1);
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => a.part.localeCompare(b.part) || b.sortLen - a.sortLen);
}

// Foundation estimate — DERIVED from the foundation entity's params + the L1
// silhouette (same source the 3D geometry uses). Concrete = slab (silhouette
// area × thickness) + grade beam (perimeter × beam_w × beam_d). EPS skirt =
// perimeter × skirt_depth at skirt_thickness. Estimates, not engineered takeoff.
export function foundationEstimate(entities) {
  const f = entities.find(e => e.kind === 'foundation');
  if (!f) return null;
  const p = f.params;
  const region = regionForLevel('L1');
  const slabArea = region.rects.reduce((s, r) => s + r.w_mm * r.h_mm, 0); // mm²
  let perim = 0; // sum of L1 exterior-wall run lengths = perimeter (incl. L-shapes)
  for (const w of entities) {
    if (w.kind !== 'wall' || (w.level || 'L1') !== 'L1') continue;
    const bb = getModuleBBox(w.mod, w.dir);
    perim += Math.max(bb.w, bb.h);
  }
  const concrete_m3 = (slabArea * p.slab_thickness_mm + perim * p.beam_w_mm * p.beam_d_mm) / 1e9;
  const eps_m2 = (perim * p.skirt_depth_mm) / 1e6;
  return { concrete_m3, eps_m2, eps_sf: eps_m2 * 10.7639 };
}

export function updateBOM() {
  const el = document.getElementById('bom-content');
  if (!el) return;
  const placed = doc.entities;
  if (!pricingData || placed.length === 0) {
    el.innerHTML = 'Place modules to see estimate';
    return;
  }

  // Generic aggregate, priced against the flat catalog. No framing concepts here.
  const catalog = getCatalog();
  const agg = aggregateLineItems(placed);
  let totalCost = 0;
  for (const [key, qty] of Object.entries(agg)) {
    const c = catalog[key];
    if (c) totalCost += qty * c.unit_price;
  }

  const b = framingBreakdown(placed);
  const totalOSB = agg['osb_7_16_4x8'] || 0;
  const totalNails = agg['nail_16d_sinker'] || 0;
  const totalScrews = agg['screw_3in'] || 0;
  const fe = foundationEstimate(placed);

  el.innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <tr><td>Modules</td><td style="text-align:right">${placed.length}</td></tr>
      <tr><td colspan="2" style="border-top:1px solid #333; padding-top:4px; color:#667; font-weight:bold;">Lumber</td></tr>
      ${b.studs2x6 ? `<tr><td>2x6 studs</td><td style="text-align:right">${b.studs2x6}</td></tr>` : ''}
      ${b.plates2x6 ? `<tr><td>2x6 plates</td><td style="text-align:right">${b.plates2x6}</td></tr>` : ''}
      ${b.studs2x4 ? `<tr><td>2x4 studs</td><td style="text-align:right">${b.studs2x4}</td></tr>` : ''}
      ${b.plates2x4 ? `<tr><td>2x4 plates</td><td style="text-align:right">${b.plates2x4}</td></tr>` : ''}
      <tr><td>OSB sheets</td><td style="text-align:right">${totalOSB}</td></tr>
      <tr><td colspan="2" style="border-top:1px solid #333; padding-top:4px; color:#667; font-weight:bold;">Hardware</td></tr>
      <tr><td>16d nails</td><td style="text-align:right">${totalNails}</td></tr>
      <tr><td>3" screws</td><td style="text-align:right">${totalScrews}</td></tr>
      ${fe ? `
      <tr><td colspan="2" style="border-top:1px solid #333; padding-top:4px; color:#667; font-weight:bold;">Foundation <span style="color:#557; font-weight:normal;">(est.)</span></td></tr>
      <tr><td>Concrete</td><td style="text-align:right">${fe.concrete_m3.toFixed(2)} m³</td></tr>
      <tr><td>EPS skirt</td><td style="text-align:right">${fe.eps_sf.toFixed(0)} sf</td></tr>` : ''}
      <tr><td colspan="2" style="border-top:1px solid #333; padding-top:6px; color:#4fc3f7; font-weight:bold;">Est. cost</td></tr>
      <tr><td colspan="2" style="text-align:right; font-size:14px; color:#4fc3f7; font-weight:bold;">$${totalCost.toFixed(2)}</td></tr>
    </table>
  `;
}
