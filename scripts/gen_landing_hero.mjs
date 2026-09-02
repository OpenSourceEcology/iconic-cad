#!/usr/bin/env node
// Generate the landing-page hero from one active editor module and the shared
// member enumerator. Run without arguments to update landing/index.html, or
// with --verify to fail when the committed generated block has drifted.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { ALL_MODULES, IN_TO_MM } from '../web/js/constants.js';
import { enumerateMembers } from '../web/js/members.js';

export const MODULE_ID = 'window_4x8_2x6_36x48';
export const GENERATED_START = '<!-- generated: gen_landing_hero -->';
export const GENERATED_END = '<!-- /generated -->';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANDING_PATH = path.join(REPO_ROOT, 'landing', 'index.html');
const ENTRY_META_PATH = path.join(REPO_ROOT, 'library', 'modules', MODULE_ID, 'meta.yaml');

const SCALE = 4 / IN_TO_MM; // preserve the existing hero's four-pixels-per-inch scale
const VIEW_W = 452;
const VIEW_H = 436;
const PANEL_CENTRE_X = 208;
const PANEL_BOTTOM_Y = 400;

function fmt(value, digits = 3) {
  const rounded = Number(value.toFixed(digits));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function inches(mm) {
  return mm / IN_TO_MM;
}

function feet(mm) {
  return inches(mm) / 12;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function activeModule() {
  const meta = readFileSync(ENTRY_META_PATH, 'utf8');
  const entryId = meta.match(/^id:\s*(\S+)\s*$/m)?.[1];
  const status = meta.match(/^status:\s*(\S+)\s*$/m)?.[1];
  if (entryId !== MODULE_ID || status !== 'active') {
    throw new Error(`${path.relative(REPO_ROOT, ENTRY_META_PATH)} must identify ${MODULE_ID} as active`);
  }

  const matches = ALL_MODULES.filter(mod => mod.id === MODULE_ID);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one active runtime module record for ${MODULE_ID}, found ${matches.length}`);
  }
  return matches[0];
}

function svgRect(member, panelX) {
  const x = panelX + member.x_mm * SCALE;
  const y = PANEL_BOTTOM_Y - (member.z_mm + member.h_mm) * SCALE;
  const width = member.w_mm * SCALE;
  const height = member.h_mm * SCALE;
  return `  <rect class="m" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}"/> <!-- ${escapeHtml(member.role)} -->`;
}

export function buildHeroBlock() {
  const mod = activeModule();
  if (!mod.aperture || mod.aperture.type !== 'window') {
    throw new Error(`${MODULE_ID} must be a window aperture module`);
  }

  const members = enumerateMembers(mod);
  const framing = members.filter(member => member.role !== 'sheathing');
  const sheathing = members.filter(member => member.role === 'sheathing');
  const header = members.find(member => member.role === 'header');
  const stud = members.find(member => member.role === 'king' || member.role === 'stud');
  const topPlates = members.filter(member => member.role === 'top_plate');
  if (!header || !stud || !topPlates.length) {
    throw new Error(`${MODULE_ID} did not enumerate the framing roles needed by the hero`);
  }
  if (topPlates.length !== mod.top_plate_count) {
    throw new Error(`${MODULE_ID} runtime top_plate_count does not match enumerateMembers()`);
  }
  if (header.nominal !== mod.aperture.header_nominal || header.plies !== mod.aperture.header_plies) {
    throw new Error(`${MODULE_ID} runtime header data does not match enumerateMembers()`);
  }

  const widthIn = inches(mod.width_mm);
  const heightIn = inches(mod.height_mm);
  const widthFt = feet(mod.width_mm);
  const heightFt = feet(mod.height_mm);
  const spacingIn = inches(mod.stud_spacing_mm);
  const aperture = mod.aperture;
  const panelWidth = mod.width_mm * SCALE;
  const panelHeight = mod.height_mm * SCALE;
  const panelX = PANEL_CENTRE_X - panelWidth / 2;
  const panelTop = PANEL_BOTTOM_Y - panelHeight;
  const panelRight = panelX + panelWidth;
  const roX = panelX + (widthIn - aperture.ro_w_in) * SCALE * IN_TO_MM / 2;
  const roY = PANEL_BOTTOM_Y - (aperture.sill_in + aperture.ro_h_in) * SCALE * IN_TO_MM;
  const roWidth = aperture.ro_w_in * SCALE * IN_TO_MM;
  const roHeight = aperture.ro_h_in * SCALE * IN_TO_MM;
  const headerX = panelX + header.x_mm * SCALE;
  const headerY = PANEL_BOTTOM_Y - (header.z_mm + header.h_mm) * SCALE;
  const headerWidth = header.w_mm * SCALE;
  const headerHeight = header.h_mm * SCALE;
  const dimensionX = 416;

  const headerPlyLines = Array.from({ length: Math.max(0, header.plies - 1) }, (_, i) => {
    const y = headerY + headerHeight * (i + 1) / header.plies;
    return `<line x1="${fmt(headerX)}" y1="${fmt(y)}" x2="${fmt(headerX + headerWidth)}" y2="${fmt(y)}" stroke="#a08c53" stroke-width="1"/>`;
  }).join('\n');

  const block = `${GENERATED_START}
<div class="compile">
<div class="yaml"><span class="k">- id:</span> <span class="v">${escapeHtml(mod.id)}</span>
<span class="k">  family:</span> <span class="v">aperture_wall_panel</span>
<span class="k">  parameters:</span>
<span class="k">    nominal_width_ft:</span> <span class="v">${fmt(widthFt)}</span>
<span class="k">    nominal_height_ft:</span> <span class="v">${fmt(heightFt)}</span>
<span class="k">    stud_lumber_nominal:</span> <span class="v">${escapeHtml(stud.nominal)}</span>
<span class="k">    stud_spacing_oc_in:</span> <span class="v">${fmt(spacingIn)}</span>
<span class="k">    top_plate_count:</span> <span class="v">${fmt(topPlates.length)}</span>
<span class="k">    aperture:</span>
<span class="k">      type:</span> <span class="v">${escapeHtml(aperture.type)}</span>
<span class="k">      rough_opening_in:</span> <span class="v">[${fmt(aperture.ro_w_in)}, ${fmt(aperture.ro_h_in)}]</span>
<span class="k">      sill_height_in:</span> <span class="v">${fmt(aperture.sill_in)}</span>
<span class="k">      header:</span> <span class="v">{nominal: ${escapeHtml(header.nominal)}, plies: ${fmt(header.plies)}}</span></div>

<div class="arrow">──compiles──▶</div>

<div class="panel">
<svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" role="img" aria-label="Framing elevation of a ${fmt(widthFt)}-by-${fmt(heightFt)}-foot wall panel with a ${fmt(aperture.ro_w_in)}-by-${fmt(aperture.ro_h_in)}-inch window opening, ${fmt(aperture.sill_in)}-inch sill, ${fmt(topPlates.length)} top plates, and a ${fmt(header.plies)}-ply ${escapeHtml(header.nominal)} header, with dimension lines">
<!-- framing members: enumerateMembers() order; sheathing omitted for clarity -->
<g stroke="#21201c" stroke-width="1" fill="#e9d8a6">
${framing.map(member => svgRect(member, panelX)).join('\n')}
</g>
<!-- header ply lines -->
${headerPlyLines}
<!-- rough opening -->
<rect x="${fmt(roX)}" y="${fmt(roY)}" width="${fmt(roWidth)}" height="${fmt(roHeight)}" fill="none" stroke="#8a8578" stroke-width="1" stroke-dasharray="5 4"/>
<text x="${fmt(PANEL_CENTRE_X)}" y="${fmt(roY + roHeight / 2 - 4)}" font-family="IBM Plex Mono,monospace" font-size="11" fill="#8a8578" text-anchor="middle">R.O.</text>
<text x="${fmt(PANEL_CENTRE_X)}" y="${fmt(roY + roHeight / 2 + 12)}" font-family="IBM Plex Mono,monospace" font-size="11" fill="#8a8578" text-anchor="middle">${fmt(aperture.ro_w_in)} × ${fmt(aperture.ro_h_in)}</text>
<!-- dimension: overall width -->
<g stroke="#21201c" stroke-width="0.75">
  <line x1="${fmt(panelX)}" y1="414" x2="${fmt(panelRight)}" y2="414"/>
  <line x1="${fmt(panelX)}" y1="409" x2="${fmt(panelX)}" y2="419"/>
  <line x1="${fmt(panelRight)}" y1="409" x2="${fmt(panelRight)}" y2="419"/>
</g>
<text x="${fmt(PANEL_CENTRE_X)}" y="430" font-family="IBM Plex Mono,monospace" font-size="11" fill="#21201c" text-anchor="middle">${fmt(widthIn)}</text>
<!-- dimension: height -->
<g stroke="#21201c" stroke-width="0.75">
  <line x1="${dimensionX}" y1="${fmt(panelTop)}" x2="${dimensionX}" y2="${fmt(PANEL_BOTTOM_Y)}"/>
  <line x1="${dimensionX - 5}" y1="${fmt(panelTop)}" x2="${dimensionX + 5}" y2="${fmt(panelTop)}"/>
  <line x1="${dimensionX - 5}" y1="${fmt(PANEL_BOTTOM_Y)}" x2="${dimensionX + 5}" y2="${fmt(PANEL_BOTTOM_Y)}"/>
</g>
<text x="432" y="${fmt(panelTop + panelHeight / 2)}" font-family="IBM Plex Mono,monospace" font-size="11" fill="#21201c" text-anchor="middle" transform="rotate(90 432 ${fmt(panelTop + panelHeight / 2)})">${fmt(heightIn)}</text>
<!-- labels -->
<text x="${fmt(panelX - 8)}" y="12" font-family="IBM Plex Mono,monospace" font-size="10" fill="#8a8578">${fmt(topPlates.length)} TOP PLATES</text>
<text x="${fmt(panelRight + 8)}" y="${fmt(headerY + headerHeight / 2 + 4)}" font-family="IBM Plex Mono,monospace" font-size="10" fill="#8a8578">HEADER ${escapeHtml(header.nominal.replace('x', '×'))} ×${fmt(header.plies)}</text>
</svg>
</div>
</div>
<p class="cap">One active library entry and the panel it compiles to.
Dimensions in inches. All ${fmt(members.length)} member records come from the same enumerator
that prices the cut list; this elevation shows its ${fmt(framing.length)} lumber rectangles
(${fmt(sheathing.length)} sheathing pieces omitted for clarity).</p>
${GENERATED_END}`;

  return block;
}

export function replaceGeneratedBlock(document, generatedBlock = buildHeroBlock()) {
  const start = document.indexOf(GENERATED_START);
  const end = document.indexOf(GENERATED_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`landing/index.html must contain one ${GENERATED_START} … ${GENERATED_END} block`);
  }
  if (document.indexOf(GENERATED_START, start + GENERATED_START.length) !== -1 ||
      document.indexOf(GENERATED_END, end + GENERATED_END.length) !== -1) {
    throw new Error('landing/index.html contains more than one generated hero block');
  }
  return document.slice(0, start) + generatedBlock + document.slice(end + GENERATED_END.length);
}

export function generatedBlockIsFresh(document) {
  return document === replaceGeneratedBlock(document);
}

function main() {
  const unknown = process.argv.slice(2).filter(arg => arg !== '--verify');
  if (unknown.length) {
    console.error(`ERROR: unknown argument(s): ${unknown.join(', ')}`);
    process.exit(2);
  }

  const verify = process.argv.includes('--verify');
  const current = readFileSync(LANDING_PATH, 'utf8');
  let fresh;
  try {
    fresh = replaceGeneratedBlock(current);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }

  if (verify) {
    if (current !== fresh) {
      console.error('ERROR: landing/index.html hero is stale — run node scripts/gen_landing_hero.mjs');
      process.exit(1);
    }
    console.log(`OK: landing/index.html hero matches ${MODULE_ID} and enumerateMembers()`);
    return;
  }

  writeFileSync(LANDING_PATH, fresh);
  console.log(`Wrote landing/index.html hero from ${MODULE_ID} and enumerateMembers()`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
