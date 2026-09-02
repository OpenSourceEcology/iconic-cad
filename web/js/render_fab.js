// =====================================================
// RENDER FAB — the per-design fabrication CARD (parametric SVG).
//
// The card is a THIRD consumer of the member list (after the 3D view and the
// BOM). Its LEFT/derived half — elevation, dimensions, cut list — is drawn
// straight from enumerateMembers(mod) so it can never drift from the model.
// Its RIGHT/authored half — materials, tools, procedure, QC, interconnect
// detail — comes from a per-archetype JSON template (web/data/card_templates)
// merged with instance numbers. Browser-only: no server, no kernel.
//
// Also hosts the build-book composer (buildBookHTML) + download helper, reused
// by the build-summary packet (render_summary.js).
// =====================================================
import { enumerateMembers } from './members.js';
import { IN_TO_MM, STUD_THICK } from './constants.js';
import { doc } from './state.js';
import { cutListGrouped } from './bom.js';
import { shellEnclosed } from './export_gate.js';
import {
  esc, f2, inFrac, ftInLabel, lumberStyle, SHEATH_DEFS, SHEET_CSS,
  panelHeightMM, bayFaces, studLayoutIn, designIdFor, archetypeOf,
} from './designs.js';

const G = '#0f8a57'; // dimension green (§9)

// ---- instance numbers feeding the authored template tokens ----------------
function ocOf(mod) {
  return mod.stud_spacing_mm / IN_TO_MM;
}

function numbers(mod) {
  const members = enumerateMembers(mod);
  const W = mod.width_mm, H = panelHeightMM(members);
  const widthIn = W / IN_TO_MM, heightIn = H / IN_TO_MM;
  const fullHeight = members.find(m => m.role === 'stud') || members.find(m => m.role === 'king');
  const studLenIn = fullHeight ? fullHeight.h_mm / IN_TO_MM : 0;
  const studCount = members.filter(m => m.role === 'stud').length;
  const gaps = bayFaces(members).map(b => b.gap / IN_TO_MM);
  const oc = ocOf(mod);
  return {
    width: inFrac(widthIn),
    height: inFrac(heightIn),
    stud_len: inFrac(studLenIn),
    stud_count: String(studCount),
    plate_count: String(1 + mod.top_plate_count),
    top_plate_count: String(mod.top_plate_count),
    bay_count: String(gaps.length),
    oc: oc ? String(oc) : 'single',
    layout: studLayoutIn(members).join(', '),
    first_bay: gaps.length ? inFrac(gaps[0]) : '—',
    last_bay: gaps.length ? inFrac(gaps[gaps.length - 1]) : '—',
    wrap_width: inFrac(widthIn + 12.75),
    gasket_len: String(Math.round(widthIn * 2 + 9)),
  };
}

const fill = (str, nums) => String(str).replace(/\{(\w+)\}/g, (_, k) => (k in nums ? nums[k] : `{${k}}`));

// ---- template loading (cached) --------------------------------------------
let _templates = null;
export async function loadCardTemplates() {
  if (_templates) return _templates;
  const out = {};
  for (const n of ['standard', 'window', 'door']) {
    try { out[n] = await (await fetch(`data/card_templates/${n}.json`)).json(); }
    catch (e) { console.warn(`card template ${n}.json unavailable`, e); out[n] = null; }
  }
  _templates = out;
  return out;
}

function templateFor(templates, mod) {
  const t = templates && templates[archetypeOf(mod)];
  return t || (templates && templates.standard) || {};
}

// Authored non-lumber materials for one instance, tokens filled. Used by the
// build-summary pick list to tally non-lumber across all placed instances.
export function instanceMaterials(templates, mod) {
  const tpl = templateFor(templates, mod);
  const nums = numbers(mod);
  return (tpl.materials_nonlumber || []).map(it => ({ qty: fill(it.qty, nums), text: fill(it.text, nums) }));
}

// =====================================================
// DIMENSION PRIMITIVES — green, tick-slash, witness lines (all OUTSIDE panel)
// =====================================================
function slash(p, x, y) {
  p.push(`<line x1="${f2(x - 3)}" y1="${f2(y + 3)}" x2="${f2(x + 3)}" y2="${f2(y - 3)}" stroke="${G}" stroke-width=".9"/>`);
}
function dimV(p, x, ya, yb, label) {
  p.push(`<line x1="${f2(x)}" y1="${f2(ya)}" x2="${f2(x)}" y2="${f2(yb)}" stroke="${G}" stroke-width=".8"/>`);
  slash(p, x, ya); slash(p, x, yb);
  const my = (ya + yb) / 2;
  p.push(`<text x="${f2(x - 5)}" y="${f2(my)}" transform="rotate(-90 ${f2(x - 5)} ${f2(my)})" fill="${G}" font-size="9.5" text-anchor="middle" class="bsmono">${esc(label)}</text>`);
}
function dimH(p, y, xa, xb, label) {
  p.push(`<line x1="${f2(xa)}" y1="${f2(y)}" x2="${f2(xb)}" y2="${f2(y)}" stroke="${G}" stroke-width=".8"/>`);
  slash(p, xa, y); slash(p, xb, y);
  p.push(`<text x="${f2((xa + xb) / 2)}" y="${f2(y - 4)}" fill="${G}" font-size="9.5" text-anchor="middle" class="bsmono">${esc(label)}</text>`);
}
function witnessV(p, x, y1, y2) { p.push(`<line x1="${f2(x)}" y1="${f2(y1)}" x2="${f2(x)}" y2="${f2(y2)}" stroke="${G}" stroke-width=".5"/>`); }
function witnessH(p, y, x1, x2) { p.push(`<line x1="${f2(x1)}" y1="${f2(y)}" x2="${f2(x2)}" y2="${f2(y)}" stroke="${G}" stroke-width=".5"/>`); }

// naive word-wrap to ~maxChars per line
function wrap(str, maxChars) {
  const words = String(str).split(/\s+/), lines = []; let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

// =====================================================
// THE CARD
// =====================================================
// opts: { label (instance tag e.g. "A-1"), templates (loaded map), owner }
export function cardSVG(entity, opts = {}) {
  const mod = entity.mod;
  const members = enumerateMembers(mod);
  const isInt = !!mod.interior;
  const studNom = isInt ? '2x4' : '2x6';
  const nums = numbers(mod);
  const tpl = templateFor(opts.templates, mod);

  const W = mod.width_mm, H = panelHeightMM(members);
  const PT = STUD_THICK;
  const topPlates = members.filter(m => m.role === 'top_plate');
  const topPlateBottom = Math.min(...topPlates.map(m => m.z_mm));
  const topPlateStackH = H - topPlateBottom;

  const SVW = 850, SVH = 1040;
  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVW} ${SVH}" font-family="'Helvetica Neue',Arial,sans-serif">`);
  p.push(`<defs>${SHEATH_DEFS}<style>${SHEET_CSS}` +
    `.dl{stroke:${G};stroke-width:.8}.wl{stroke:${G};stroke-width:.6}.dim{fill:${G}}</style></defs>`);
  p.push(`<rect x="0" y="0" width="${SVW}" height="${SVH}" fill="#ffffff"/>`);
  p.push(`<rect x="12" y="12" width="826" height="1016" fill="none" stroke="#d8d2c6" stroke-width="1"/>`);

  // ---- HEADER ----
  p.push(`<rect x="12" y="12" width="826" height="60" fill="#faf8f4"/>`);
  p.push(`<line x1="12" y1="72" x2="838" y2="72" stroke="#1a1a1a" stroke-width="2"/>`);
  const title = tpl.title || (isInt ? 'INTERIOR WALL PANEL' : 'WALL PANEL');
  p.push(`<text x="40" y="46" class="ink" font-size="18" font-weight="700" letter-spacing=".5">${esc(title)}</text>`);
  p.push(`<text x="40" y="62" class="sub bsmono" font-size="11">${esc(nums.width)}″ × ${esc(nums.height)}″ · ${studNom} @ ${esc(nums.oc)}${nums.oc === 'single' ? '' : '″ O.C.'}</text>`);
  const did = designIdFor(mod);
  p.push(`<text x="810" y="40" class="ink" font-size="14" font-weight="700" text-anchor="end">${esc(did)}${opts.label ? ` · ${esc(opts.label)}` : ''}</text>`);
  p.push(`<text x="810" y="60" class="faint bsmono" font-size="9" text-anchor="end">FreeCAD / video: links TBD</text>`);

  // ===================== LEFT — ELEVATION =====================
  p.push(`<text x="40" y="96" class="sec">ELEVATION · INTERIOR FACE <tspan class="faint" font-size="8" letter-spacing="0"> — derived from model</tspan></text>`);
  p.push(`<line x1="40" y1="104" x2="465" y2="104" stroke="#d8d2c6" stroke-width=".8"/>`);

  const ELEV_TOP = 122, ELEV_H = 430, PANEL_X = 178;
  const scale = ELEV_H / H;
  const dW = W * scale, dH = ELEV_H;
  const px = x => PANEL_X + x * scale;
  const py = z => ELEV_TOP + (H - z) * scale;
  const drawBot = ELEV_TOP + dH;

  // framing members (skip OSB; shown as ext strip)
  for (const m of members) {
    if (m.role === 'sheathing') continue;
    p.push(`<rect x="${f2(px(m.x_mm))}" y="${f2(py(m.z_mm + m.h_mm))}" width="${f2(m.w_mm * scale)}" height="${f2(m.h_mm * scale)}" ${lumberStyle(m.nominal)}/>`);
  }
  // OSB exterior strip
  if (!isInt) {
    const sx = px(W) + 5, sw = 8;
    p.push(`<rect x="${f2(sx)}" y="${f2(ELEV_TOP)}" width="${sw}" height="${f2(dH)}" fill="url(#bs-sheath)" stroke="#c2b594" stroke-width=".6"/>`);
    p.push(`<text x="${f2(sx + sw + 2)}" y="${f2(ELEV_TOP + 8)}" class="sub bsmono" font-size="8">7/16″ OSB</text>`);
  }

  // ---- LEFT HEIGHT CHAIN (outside, left of panel) ----
  const cx1 = PANEL_X - 24, cx2 = PANEL_X - 52;
  for (const z of [0, PT, topPlateBottom, H]) witnessH(p, py(z), px(0), cx1);
  dimV(p, cx1, py(0), py(PT), `${inFrac(PT / IN_TO_MM)}″`);
  dimV(p, cx1, py(PT), py(topPlateBottom), `${nums.stud_len}″ stud`);
  dimV(p, cx1, py(topPlateBottom), py(H), `${inFrac(topPlateStackH / IN_TO_MM)}″ top stack`);
  witnessH(p, py(0), cx2, cx1); witnessH(p, py(H), cx2, cx1);
  dimV(p, cx2, py(0), py(H), ftInLabel(H / IN_TO_MM));

  // stud-length callout: short leader off the panel, text right-anchored to the
  // column edge so it never crosses the divider into the right column.
  const calloutEnd = 470, cy = (py(PT) + py(topPlateBottom)) / 2;
  const lead0 = px(W) + (isInt ? 3 : 13);
  p.push(`<line x1="${f2(lead0)}" y1="${f2(cy)}" x2="${f2(lead0 + 14)}" y2="${f2(cy)}" stroke="#b5651d" stroke-width=".7"/>`);
  p.push(`<text x="${calloutEnd}" y="${f2(cy - 3)}" class="tpl bsmono" font-size="9" text-anchor="end">stud ${esc(nums.stud_len)}″</text>`);
  p.push(`<text x="${calloutEnd}" y="${f2(cy + 9)}" class="tpl bsmono" font-size="8" text-anchor="end">= ${esc(nums.height)} − ${esc(nums.plate_count)}×${inFrac(PT / IN_TO_MM)} (plates)</text>`);

  // ---- BOTTOM BAY DIMS (clear gap per bay, witness on stud faces) ----
  const bays = bayFaces(members);
  const bayY = drawBot + 30;
  for (const b of bays) {
    const xL = px(b.l), xR = px(b.r);
    witnessV(p, xL, drawBot + 2, bayY + 3);
    witnessV(p, xR, drawBot + 2, bayY + 3);
    dimH(p, bayY, xL, xR, `${inFrac(b.gap / IN_TO_MM)}″`);
  }
  // overall width
  const widthY = drawBot + 58;
  witnessV(p, px(0), drawBot + 2, widthY + 3);
  witnessV(p, px(W), drawBot + 2, widthY + 3);
  dimH(p, widthY, px(0), px(W), ftInLabel(W / IN_TO_MM));

  // legend
  p.push(`<rect x="40" y="${f2(widthY + 24)}" width="14" height="9" ${lumberStyle(studNom)}/>`);
  p.push(`<text x="60" y="${f2(widthY + 32)}" class="sub" font-size="9.5">${studNom} framing (studs + plates)</text>`);
  if (!isInt) {
    p.push(`<rect x="250" y="${f2(widthY + 24)}" width="14" height="9" fill="url(#bs-sheath)" stroke="#c2b594" stroke-width=".6"/>`);
    p.push(`<text x="270" y="${f2(widthY + 32)}" class="sub" font-size="9.5">7/16″ OSB sheathing (ext face)</text>`);
  }

  // ---- INTERCONNECT DRILL DETAIL (authored, fenced) ----
  let ly = widthY + 54;
  if (tpl.hole_pattern) {
    const hp = tpl.hole_pattern;
    const boxY = ly, boxH = 150;
    p.push(`<rect x="40" y="${f2(boxY)}" width="425" height="${boxH}" fill="#fcf8f2" stroke="#e3c9a6" stroke-width="1"/>`);
    p.push(`<text x="52" y="${f2(boxY + 20)}" class="sec" fill="#b5651d">${esc(hp.label || 'INTERCONNECT DRILL')}</text>`);
    if (hp.fence) {
      p.push(`<rect x="300" y="${f2(boxY + 9)}" width="158" height="15" fill="#f1e2cd"/>`);
      p.push(`<text x="379" y="${f2(boxY + 20)}" class="tpl bsmono" font-size="8" text-anchor="middle">${esc(hp.fence)}</text>`);
    }
    // a height-independent stud strip with end + center holes (callouts not to scale)
    const stripX = 60, stripW = 375, stripY = boxY + 68;
    p.push(`<rect x="${stripX}" y="${f2(stripY)}" width="${stripW}" height="22" ${lumberStyle(studNom)}/>`);
    p.push(`<text x="${stripX}" y="${f2(stripY - 6)}" class="sub bsmono" font-size="8">TOP END</text>`);
    p.push(`<text x="${stripX + stripW}" y="${f2(stripY - 6)}" class="sub bsmono" font-size="8" text-anchor="end">BOTTOM END</text>`);
    const hy = stripY + 11;
    const holes = [
      { x: stripX + 56, label: `${hp.ends_in || 24}″` },
      { x: stripX + stripW / 2, label: 'CTR', pin: true },
      { x: stripX + stripW - 56, label: `${hp.ends_in || 24}″` },
    ];
    for (const h of holes) {
      p.push(`<circle cx="${f2(h.x)}" cy="${f2(hy)}" r="4" fill="#fff" stroke="#14110c" stroke-width="1.3"/>`);
      p.push(`<line x1="${f2(h.x)}" y1="${f2(stripY - 2)}" x2="${f2(h.x)}" y2="${f2(stripY - 22)}" class="dl"/>`);
      p.push(`<text x="${f2(h.x)}" y="${f2(stripY - 26)}" class="dim bsmono" font-size="8" text-anchor="middle">${esc(h.label)}</text>`);
      if (h.pin) p.push(`<circle cx="${f2(h.x - 12)}" cy="${f2(hy)}" r="2.3" fill="#b5651d"/>`);
    }
    let ny = stripY + 44;
    for (const note of (hp.notes || [])) {
      p.push(`<text x="52" y="${f2(ny)}" class="sub bsmono" font-size="9">${esc(note)}</text>`); ny += 16;
    }
    ly = boxY + boxH + 26;
  }

  // ---- NOTES (salient) ----
  if (tpl.salient && tpl.salient.length) {
    p.push(`<text x="40" y="${f2(ly)}" class="sec">NOTES</text>`);
    p.push(`<line x1="40" y1="${f2(ly + 8)}" x2="465" y2="${f2(ly + 8)}" stroke="#d8d2c6" stroke-width=".8"/>`);
    let ny = ly + 28;
    for (const s of tpl.salient) {
      const lines = wrap(fill(s, nums), 64);
      lines.forEach((ln, i) => {
        p.push(`<text x="${i ? 52 : 40}" y="${f2(ny)}" class="${i ? 'sub' : 'ink'}" font-size="10.5">${i ? '' : '• '}${esc(ln)}</text>`);
        ny += 16;
      });
      ny += 4;
    }
  }

  // divider
  p.push(`<line x1="478" y1="88" x2="478" y2="1000" stroke="#e6e0d4" stroke-width="1"/>`);

  // ===================== RIGHT COLUMN =====================
  const RX = 500, RXE = 810;
  const secHead = (y, label, derived) => {
    p.push(`<text x="${RX}" y="${f2(y)}" class="sec">${esc(label)}${derived ? ` <tspan class="faint" font-size="8" letter-spacing="0"> — derived from model</tspan>` : ''}</text>`);
    p.push(`<line x1="${RX}" y1="${f2(y + 8)}" x2="${RXE}" y2="${f2(y + 8)}" stroke="#d8d2c6" stroke-width=".8"/>`);
  };
  let ry = 96;

  // CUT LIST (derived)
  secHead(ry, 'CUT LIST', true); ry += 28;
  p.push(`<text x="${RX}" y="${f2(ry)}" class="faint bsmono" font-size="9">QTY</text>`);
  p.push(`<text x="${RX + 40}" y="${f2(ry)}" class="faint bsmono" font-size="9">PART</text>`);
  p.push(`<text x="730" y="${f2(ry)}" class="faint bsmono" font-size="9">MAT</text>`);
  p.push(`<text x="${RXE}" y="${f2(ry)}" class="faint bsmono" font-size="9" text-anchor="end">LENGTH</text>`);
  ry += 6;
  p.push(`<line x1="${RX}" y1="${f2(ry)}" x2="${RXE}" y2="${f2(ry)}" stroke="#ece7db" stroke-width="1"/>`);
  ry += 18;
  for (const row of cutListGrouped([entity])) {
    p.push(`<text x="${RX}" y="${f2(ry)}" class="ink bsmono" font-size="11">${row.qty}</text>`);
    p.push(`<text x="${RX + 40}" y="${f2(ry)}" class="ink" font-size="11">${esc(row.part)}</text>`);
    p.push(`<text x="730" y="${f2(ry)}" class="sub bsmono" font-size="11">${esc(row.nominal === 'OSB' ? '7/16' : row.nominal)}</text>`);
    p.push(`<text x="${RXE}" y="${f2(ry)}" class="ink bsmono" font-size="11" text-anchor="end">${esc(row.lengthLabel)}</text>`);
    ry += 22;
  }
  ry += 14;

  // MATERIALS · PICK LIST (authored, non-lumber)
  if (tpl.materials_nonlumber && tpl.materials_nonlumber.length) {
    secHead(ry, 'MATERIALS · PICK LIST', false); ry += 24;
    for (const it of tpl.materials_nonlumber) {
      p.push(`<text x="${RX}" y="${f2(ry)}" class="ink bsmono" font-size="11">${esc(fill(it.qty, nums))}</text>`);
      p.push(`<text x="${RX + 24}" y="${f2(ry)}" class="ink" font-size="11">${esc(fill(it.text, nums))}</text>`);
      ry += 20;
    }
    p.push(`<text x="${RX}" y="${f2(ry)}" class="faint" font-size="9">Non-lumber items from the OSE ${esc(archetypeOf(mod))} panel template.</text>`);
    ry += 28;
  }

  // TOOLS (authored)
  if (tpl.tools && tpl.tools.length) {
    secHead(ry, 'TOOLS', false); ry += 22;
    for (const ln of wrap(tpl.tools.join(' · '), 56)) {
      p.push(`<text x="${RX}" y="${f2(ry)}" class="ink" font-size="11">${esc(ln)}</text>`); ry += 18;
    }
    p.push(`<text x="${RX}" y="${f2(ry)}" class="faint" font-size="9">(pending: icons from OSE Master Tool / Fastener Lists)</text>`);
    ry += 26;
  }

  // BUILD PROCEDURE (authored, numbered)
  if (tpl.procedure && tpl.procedure.length) {
    secHead(ry, 'BUILD PROCEDURE', false); ry += 22;
    tpl.procedure.forEach((step, i) => {
      const text = fill(step.text || step, nums);
      p.push(`<text x="${RX}" y="${f2(ry)}" class="dim bsmono">${i + 1}.</text>`);
      p.push(`<text x="${RX + 24}" y="${f2(ry)}" class="ink" font-size="11">${esc(text)}</text>`);
      ry += 16;
      if (step.note) {
        p.push(`<text x="${RX + 24}" y="${f2(ry)}" class="tpl bsmono" font-size="8">${esc(fill(step.note, nums))}</text>`);
        ry += 16;
      }
      ry += 6;
    });
    ry += 6;
  }

  // QC strip (authored)
  if (tpl.qc && tpl.qc.length) {
    const boxY = ry, boxH = 44;
    p.push(`<rect x="${RX}" y="${f2(boxY)}" width="310" height="${boxH}" fill="#faf8f4" stroke="#e6e0d4" stroke-width="1"/>`);
    p.push(`<text x="${RX + 12}" y="${f2(boxY + 18)}" class="sec" font-size="9">QC CHECK</text>`);
    p.push(`<text x="${RX + 12}" y="${f2(boxY + 36)}" class="sub" font-size="10">${tpl.qc.map(q => '□ ' + esc(fill(q, nums))).join('  ')}</text>`);
    ry = boxY + boxH + 12;
  }

  // ---- footer ----
  p.push(`<text x="${SVW / 2}" y="${SVH - 14}" font-size="9" fill="#a59f93" text-anchor="middle">Iconic CAD / Open Source Ecology · CC BY-SA 4.0 · generated ${new Date().toISOString().slice(0, 10)}</text>`);

  p.push('</svg>');
  return p.join('\n');
}

// =====================================================
// BUILD-BOOK COMPOSER + EXPORT
// =====================================================
// A sheet is { label, title?, sections:[{type,svg}], fullpage? }. Generalised
// so both the fab book and the build-summary packet feed the same composer.
// banner (optional): { label, warn } — a scope label (e.g. "FRAMING-ONLY PACK")
// and an optional warning line shown at the top of the book and in print, so an
// incomplete export is never presented as a finished house. (CAD-AUD-008)
export function buildBookHTML(sheets, docTitle = 'Iconic CAD — Fab Drawings', banner = null) {
  const bannerHTML = banner ? `
  <div class="export-banner">
    <strong>${esc(banner.label)}</strong>${banner.warn ? ` — ${esc(banner.warn)}` : ''}
  </div>` : '';
  const sheetHTML = sheets.map(sh => `
    <div class="panel-sheet${sh.fullpage ? ' fullpage' : ''}">
      ${sh.title === null ? '' : `<h2>${esc(sh.title || sh.label)}</h2>`}
      ${sh.sections.map(sec => `<div class="section section-${sec.type}">${sec.svg}</div>`).join('\n')}
    </div>`).join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(docTitle)}</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; margin: 24px; color: #222; }
  h1 { font-size: 18px; }
  h2 { font-size: 13px; color: #444; margin: 0 0 8px; }
  .panel-sheet { margin-bottom: 32px; }
  .section svg { max-width: 100%; height: auto; }
  .export-banner { border: 2px solid #c1440e; background: #fff3ec; color: #7a2d0a;
    padding: 8px 12px; margin: 0 0 18px; font-size: 12px; border-radius: 4px; }
  @media print {
    body { margin: 0; }
    h1 { display: none; }
    .export-banner { display: block; }
    .panel-sheet { page-break-after: always; margin: 0; padding: 12px; }
  }
</style></head>
<body>
  <h1>${esc(docTitle)}</h1>
  ${bannerHTML}
  ${sheetHTML}
</body></html>`;
}

export function downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function openPrintWindow(html) {
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
}

function buildSheets(panels, templates) {
  return panels.map((entity, i) => {
    const label = `P-${String(i + 1).padStart(2, '0')}`;
    return {
      label,
      title: `${label} — ${entity.mod.id}`,
      entity,
      sections: [{ type: 'card', svg: cardSVG(entity, { label, templates }) }],
    };
  });
}

// Zero-arg, reads `doc` itself. async because the authored card half loads from
// the template JSON.
export async function exportFabDrawings(filename) {
  const panels = doc.entities.filter(e => e.kind === 'wall' || e.kind === 'iwall');
  if (panels.length === 0) { alert('Place modules first.'); return; }

  const templates = await loadCardTemplates();
  const sheets = buildSheets(panels, templates);

  // Fab drawings are always a framing-only pack; warn if the shell isn't closed.
  const banner = framingPackBanner();

  if (panels.length === 1) {
    downloadText(sheets[0].sections[0].svg, `fab-${sheets[0].label}.svg`, 'image/svg+xml');
  } else {
    downloadText(buildBookHTML(sheets, 'Iconic CAD — Fab Drawings', banner), filename || 'fab-drawings.html', 'text/html');
  }
  openPrintWindow(buildBookHTML(sheets, 'Iconic CAD — Fab Drawings', banner));
}

// The framing-only scope label shared by fab drawings and the build summary.
export function framingPackBanner() {
  return {
    label: 'FRAMING-ONLY PACK',
    warn: shellEnclosed() ? '' : 'shell is not yet a closed silhouette — review before building.',
  };
}
