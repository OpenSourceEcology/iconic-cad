// =====================================================
// RENDER FAB — per-panel fabrication drawings (parametric SVG elevation).
//
// A fab drawing is a THIRD consumer of the member list (after the 3D view and
// the BOM): it draws the interior-face elevation straight from
// enumerateMembers(entity.mod). Same source -> the drawing can never drift from
// the model. Browser-only: no server, no kernel — same posture as the FreeCAD
// browser export.
// =====================================================
import { enumerateMembers } from './members.js';
import { IN_TO_MM } from './constants.js';
import { doc } from './state.js';

// ---- styling -------------------------------------------------------------
const FILL = {
  bottom_plate: '#c9a06a', top_plate: '#c9a06a', sill: '#d4b483',
  subheader: '#d4b483', sill_block: '#d4b483',
  stud: '#e3c188', king: '#dca94f', jack: '#e8c98a',
  top_cripple: '#ecd6a4', lower_cripple: '#ecd6a4', header: '#b5793f',
};
const STROKE = '#5a4321';
const DIM = '#2e9e57';       // green dimension leaders
const ROLE_LABELS = { king: 'KING', jack: 'JACK', header: 'HEADER', sill: 'SILL', subheader: 'SUBHEADER' };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f2 = n => (Math.round(n * 100) / 100).toString();
const inOf = mm => f2(mm / IN_TO_MM);

function ocOf(mod) {
  if (mod.aperture) return mod.aperture.oc;
  return mod.id.includes('16oc') ? 16 : mod.id.includes('24oc') ? 24 : mod.id.includes('single') ? null : 18;
}

// One panel elevation as standalone SVG markup.
export function panelSVG(entity, opts = {}) {
  const mod = entity.mod;
  const members = enumerateMembers(mod);
  const isInt = !!mod.interior;
  const a = mod.aperture;

  const W = mod.width_mm;
  const H = members.reduce((mx, m) => Math.max(mx, m.z_mm + m.h_mm), 0);

  // layout (px)
  const PADL = 68, PADT = 40, PADR = 84, GAP_DIM_B = 56;
  const titleH = 104, footerH = 26;
  const scale = Math.min(380 / W, 470 / H);
  const dW = W * scale, dH = H * scale;
  const svgW = PADL + dW + PADR;
  const svgH = PADT + dH + GAP_DIM_B + titleH + footerH;

  const px = x => PADL + x * scale;
  const py = z => PADT + (H - z) * scale;          // flip: floor at bottom
  const drawTop = PADT, drawBot = PADT + dH;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f2(svgW)}" height="${f2(svgH)}" viewBox="0 0 ${f2(svgW)} ${f2(svgH)}" font-family="Helvetica,Arial,sans-serif">`);
  parts.push(`<rect x="0" y="0" width="${f2(svgW)}" height="${f2(svgH)}" fill="#ffffff"/>`);

  // panel outline
  parts.push(`<rect x="${f2(px(0))}" y="${f2(drawTop)}" width="${f2(dW)}" height="${f2(dH)}" fill="none" stroke="#999" stroke-width="0.75"/>`);

  // framing members (skip sheathing — shown as an EXT strip instead)
  for (const m of members) {
    if (m.role === 'sheathing') continue;
    const x = px(m.x_mm), y = py(m.z_mm + m.h_mm);
    const w = m.w_mm * scale, h = m.h_mm * scale;
    parts.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="${FILL[m.role] || '#e3c188'}" stroke="${STROKE}" stroke-width="0.6"/>`);
    const label = ROLE_LABELS[m.role];
    if (label && w > 6 && h > 6) {
      const cx = x + w / 2, cy = y + h / 2;
      const vertical = h > w * 1.4;
      const t = vertical
        ? `<text x="${f2(cx)}" y="${f2(cy)}" transform="rotate(-90 ${f2(cx)} ${f2(cy)})" font-size="8" fill="#3a2a14" text-anchor="middle" dominant-baseline="middle">${label}</text>`
        : `<text x="${f2(cx)}" y="${f2(cy)}" font-size="8" fill="#3a2a14" text-anchor="middle" dominant-baseline="middle">${label}</text>`;
      parts.push(t);
    }
  }

  // EXT / OSB face indicator (exterior panels only): hatched strip down the right
  if (!isInt) {
    const sx = px(W) + 10, sw = 14;
    parts.push(`<defs><pattern id="osbhatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#8fbc8f" stroke-width="2"/></pattern></defs>`);
    parts.push(`<rect x="${f2(sx)}" y="${f2(drawTop)}" width="${sw}" height="${f2(dH)}" fill="url(#osbhatch)" stroke="#5a7d5a" stroke-width="0.6"/>`);
    parts.push(`<text x="${f2(sx + sw / 2)}" y="${f2((drawTop + drawBot) / 2)}" transform="rotate(-90 ${f2(sx + sw / 2)} ${f2((drawTop + drawBot) / 2)})" font-size="8" fill="#3d5a3d" text-anchor="middle">EXT / OSB FACE</text>`);
  }

  // rough opening (apertures): dashed rectangle + label
  if (a) {
    const roW = a.ro_w_in * IN_TO_MM;
    const roX0 = (W - roW) / 2;
    const roZ0 = a.sill_in * IN_TO_MM;
    const roZ1 = roZ0 + a.ro_h_in * IN_TO_MM;
    const rx = px(roX0), ry = py(roZ1), rw = roW * scale, rh = (roZ1 - roZ0) * scale;
    parts.push(`<rect x="${f2(rx)}" y="${f2(ry)}" width="${f2(rw)}" height="${f2(rh)}" fill="none" stroke="#b5793f" stroke-width="1.2" stroke-dasharray="6 4"/>`);
    parts.push(`<text x="${f2(rx + rw / 2)}" y="${f2(ry + rh / 2)}" font-size="9" fill="#8a5a2a" text-anchor="middle" dominant-baseline="middle">ROUGH OPENING ${esc(a.ro_w_in)}×${esc(a.ro_h_in)}</text>`);

    // RO width dim (just under opening), RO height dim (right of opening), sill height
    dimH(parts, px(roX0), px(roX0 + roW), ry + rh + 14, `RO ${inOf(roW)}"`, DIM);
    dimV(parts, py(roZ0), py(roZ1), rx - 12, `${inOf(roZ1 - roZ0)}"`, DIM);
    if (roZ0 > 0) dimV(parts, drawBot, py(roZ0), px(roX0) + rw + 24, `SILL ${inOf(roZ0)}"`, DIM);
  }

  // overall dimensions: width along the bottom, height up the left
  dimH(parts, px(0), px(W), drawBot + 34, `${inOf(W)}" (${f2(W / IN_TO_MM / 12)}')`, DIM);
  dimV(parts, drawTop, drawBot, PADL - 40, `${inOf(H)}"`, DIM);

  // ---- title block ----
  const ty = PADT + dH + GAP_DIM_B;
  const hdr = members.find(m => m.role === 'header');
  const hdrStr = hdr ? `${hdr.nominal}, ${hdr.plies} ply` : '—';
  const oc = ocOf(mod);
  const sheathing = isInt ? 'none (interior)' : '7/16" OSB, exterior face';
  const label = opts.label || mod.id; // TODO: replace ordinal with a derived panel tag (N-03 style) once the tagging pass exists.
  parts.push(`<rect x="${f2(PADL - 40)}" y="${f2(ty)}" width="${f2(svgW - (PADL - 40) - 16)}" height="${titleH}" fill="none" stroke="#333" stroke-width="1"/>`);
  const tbX = PADL - 32;
  const row = (i, k, v) => `<text x="${f2(tbX)}" y="${f2(ty + 20 + i * 17)}" font-size="10" fill="#222"><tspan font-weight="bold">${esc(k)}:</tspan> ${esc(v)}</text>`;
  parts.push(`<text x="${f2(tbX)}" y="${f2(ty + 20)}" font-size="13" font-weight="bold" fill="#111">${esc(label)}</text>`);
  parts.push(row(1, 'Module', mod.id));
  parts.push(row(2, 'Panel', `${inOf(W)}" W × ${inOf(H)}" H`));
  parts.push(row(3, 'Stud spacing', oc ? `${oc}" OC` : 'single'));
  parts.push(row(4, 'Header', hdrStr));
  parts.push(row(5, 'Sheathing', sheathing));

  // ---- footer ----
  parts.push(`<text x="${f2(svgW / 2)}" y="${f2(svgH - 8)}" font-size="9" fill="#888" text-anchor="middle">Iconic CAD / Open Source Ecology · CC BY-SA 4.0 · generated ${new Date().toISOString().slice(0, 10)}</text>`);

  parts.push('</svg>');
  return parts.join('\n');
}

// horizontal dimension leader with end ticks + centered label
function dimH(parts, x1, x2, y, label, color) {
  parts.push(`<line x1="${f2(x1)}" y1="${f2(y)}" x2="${f2(x2)}" y2="${f2(y)}" stroke="${color}" stroke-width="0.8"/>`);
  parts.push(`<line x1="${f2(x1)}" y1="${f2(y - 4)}" x2="${f2(x1)}" y2="${f2(y + 4)}" stroke="${color}" stroke-width="0.8"/>`);
  parts.push(`<line x1="${f2(x2)}" y1="${f2(y - 4)}" x2="${f2(x2)}" y2="${f2(y + 4)}" stroke="${color}" stroke-width="0.8"/>`);
  parts.push(`<text x="${f2((x1 + x2) / 2)}" y="${f2(y - 4)}" font-size="9" fill="${color}" text-anchor="middle">${esc(label)}</text>`);
}

// vertical dimension leader with end ticks + rotated label
function dimV(parts, y1, y2, x, label, color) {
  parts.push(`<line x1="${f2(x)}" y1="${f2(y1)}" x2="${f2(x)}" y2="${f2(y2)}" stroke="${color}" stroke-width="0.8"/>`);
  parts.push(`<line x1="${f2(x - 4)}" y1="${f2(y1)}" x2="${f2(x + 4)}" y2="${f2(y1)}" stroke="${color}" stroke-width="0.8"/>`);
  parts.push(`<line x1="${f2(x - 4)}" y1="${f2(y2)}" x2="${f2(x + 4)}" y2="${f2(y2)}" stroke="${color}" stroke-width="0.8"/>`);
  const my = (y1 + y2) / 2;
  parts.push(`<text x="${f2(x - 4)}" y="${f2(my)}" transform="rotate(-90 ${f2(x - 4)} ${f2(my)})" font-size="9" fill="${color}" text-anchor="middle">${esc(label)}</text>`);
}

// ---- build-book composer + export ----------------------------------------
// A panel "sheet" is a list of sections (today: just the elevation). Adding a
// cut-list / assembly-steps / QC section later is appending to sheet.sections,
// not rewriting this composer.
function buildSheets(panels) {
  return panels.map((entity, i) => {
    const label = `P-${String(i + 1).padStart(2, '0')}`; // TODO: replace ordinal with a derived panel tag (N-03 style) once the tagging pass exists.
    return {
      label,
      entity,
      sections: [
        { type: 'elevation', svg: panelSVG(entity, { label }) },
      ],
    };
  });
}

function buildBookHTML(sheets) {
  const sheetHTML = sheets.map(sh => `
    <div class="panel-sheet">
      <h2>${esc(sh.label)} — ${esc(sh.entity.mod.id)}</h2>
      ${sh.sections.map(sec => `<div class="section section-${sec.type}">${sec.svg}</div>`).join('\n')}
    </div>`).join('\n');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Iconic CAD — Fab Drawings</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; margin: 24px; color: #222; }
  h1 { font-size: 18px; }
  h2 { font-size: 13px; color: #444; margin: 0 0 8px; }
  .panel-sheet { margin-bottom: 32px; }
  .section svg { max-width: 100%; height: auto; border: 1px solid #ddd; }
  @media print {
    body { margin: 0; }
    h1 { display: none; }
    .panel-sheet { page-break-after: always; margin: 0; padding: 12px; }
  }
</style></head>
<body>
  <h1>Iconic CAD — Fab Drawings (${sheets.length} panel${sheets.length === 1 ? '' : 's'})</h1>
  ${sheetHTML}
</body></html>`;
}

function downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Zero-arg, reads `doc` itself, so a future export menu can call it directly.
export function exportFabDrawings(filename) {
  // Filter to structural framing kinds; non-framing layers (foundation, etc.)
  // get their own drawing types later and must not appear or crash here.
  const panels = doc.entities.filter(e => e.kind === 'wall' || e.kind === 'iwall');
  if (panels.length === 0) { alert('Place modules first.'); return; }

  const sheets = buildSheets(panels);

  if (panels.length === 1) {
    downloadText(sheets[0].sections[0].svg, `fab-${sheets[0].label}.svg`, 'image/svg+xml');
  } else {
    downloadText(buildBookHTML(sheets), filename || 'fab-drawings.html', 'text/html');
  }

  // Also open a print-ready window so the user can print-to-PDF.
  const html = buildBookHTML(sheets);
  const w = window.open('', '_blank');
  if (w) {
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }
}
