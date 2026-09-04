/**
 * Enumerator parity test: enumerateMembers(mod) must reproduce exactly the
 * geometry render3d.js builds, and must encode the corrected (geometric) member
 * counts that killed the pricing.json stud-count bug.
 *
 * Run from repo root: node tests/enumerate_parity.mjs   (no FreeCAD needed)
 *
 * Two halves:
 *   1. 3D parity — the boxes render3d produces (pre-refactor math, transcribed
 *      below as the golden) must equal the boxes derived from enumerateMembers,
 *      for a representative module set across all four directions.
 *   2. Acceptance numbers — the literal §7 spec (4 studs not 5, window member
 *      heights / header plies / cripple counts).
 */
import { enumerateMembers } from '../web/js/members.js';
import { ALL_MODULES, IN_TO_MM, STUD_THICK, STUD_DEPTH, OSB_THICK, LUMBER_DEPTH } from '../web/js/constants.js';

const TOL = 1e-6;
let passed = 0, failed = 0;
const mod = id => ALL_MODULES.find(m => m.id === id);

function fail(msg) { console.error(`  FAIL ${msg}`); failed++; }
function ok(msg) { passed++; if (process.env.VERBOSE) console.log(`  ok ${msg}`); }

// ---- golden: independent framing-policy box math ------------------------
// Returns [sx,sy,sz,px,py,pz,tag] per box. This is the geometry the 3D view
// expected from authored height, spacing, and top-plate policy fields.
function goldenBoxes(m, dir) {
  if (m.aperture) return goldenAperture(m, dir);
  const b = [];
  const add = (sx, sy, sz, px, py, pz, t) => b.push([sx, sy, sz, px, py, pz, t]);
  const isInt = m.interior;
  const W = m.width_mm;
  const H = m.height_mm;
  const D = isInt ? (3.5 * IN_TO_MM) : STUD_DEPTH;
  const O = isInt ? 0 : OSB_THICK;
  const PT = STUD_THICK, ST = STUD_THICK;
  const sp = [0];
  let cur = m.stud_spacing_mm;
  while (cur + ST <= W - ST) { sp.push(cur); cur += m.stud_spacing_mm; }
  sp.push(W - ST);
  const zT = H - m.top_plate_count * PT;
  const studH = zT - PT;
  if (dir === 'north' || dir === 'south') {
    const oy = dir === 'south' ? -O / 2 : D + O / 2;
    add(W, D, PT, W / 2, D / 2, PT / 2, 'L');
    for (let i = 0; i < m.top_plate_count; i++) add(W, D, PT, W / 2, D / 2, zT + i * PT + PT / 2, 'L');
    for (const sx of sp) add(ST, D, studH, sx + ST / 2, D / 2, PT + studH / 2, 'L');
    if (O > 0) add(W, O, H, W / 2, oy, H / 2, 'O');
  } else {
    const ox = dir === 'west' ? -O / 2 : D + O / 2;
    add(D, W, PT, D / 2, -W / 2, PT / 2, 'L');
    for (let i = 0; i < m.top_plate_count; i++) add(D, W, PT, D / 2, -W / 2, zT + i * PT + PT / 2, 'L');
    for (const sy of sp) add(D, ST, studH, D / 2, -(sy + ST / 2), PT + studH / 2, 'L');
    if (O > 0) add(O, W, H, ox, -W / 2, H / 2, 'O');
  }
  return b;
}

function goldenAperture(m, dir) {
  const b = [];
  const isInt = m.interior, a = m.aperture, W = m.width_mm;
  const H = m.height_mm;
  const D = isInt ? (3.5 * IN_TO_MM) : STUD_DEPTH;
  const O = isInt ? 0 : OSB_THICK;
  const PT = STUD_THICK, ST = STUD_THICK;
  const roW = a.ro_w_in * IN_TO_MM, roX0 = (W - roW) / 2, roX1 = roX0 + roW;
  const roZ0 = a.sill_in * IN_TO_MM, roZ1 = roZ0 + a.ro_h_in * IN_TO_MM;
  const isWin = a.type === 'window' && roZ0 > 0;
  const hdrDep = LUMBER_DEPTH[a.header_nominal] || 7.25 * IN_TO_MM;
  const zT = H - m.top_plate_count * PT, zB = PT;
  const cripX = [];
  let g = m.stud_spacing_mm;
  while (g + ST < roX1) { if (g > roX0) cripX.push(g); g += m.stud_spacing_mm; }
  if (!cripX.length) cripX.push((roX0 + roX1) / 2 - ST / 2);
  const horiz = (dir === 'north' || dir === 'south');
  const osbAt = horiz ? (dir === 'south' ? -O / 2 : D + O / 2) : (dir === 'west' ? -O / 2 : D + O / 2);
  const mem = (rs, rl, z0, zl) => {
    if (rl <= 0 || zl <= 0) return;
    if (horiz) b.push([rl, D, zl, rs + rl / 2, D / 2, z0 + zl / 2, 'L']);
    else b.push([D, rl, zl, D / 2, -(rs + rl / 2), z0 + zl / 2, 'L']);
  };
  const osb = (rs, rl, z0, zl) => {
    if (rl <= 0 || zl <= 0 || O <= 0) return;
    if (horiz) b.push([rl, O, zl, rs + rl / 2, osbAt, z0 + zl / 2, 'O']);
    else b.push([O, rl, zl, osbAt, -(rs + rl / 2), z0 + zl / 2, 'O']);
  };
  if (isWin) mem(0, W, 0, PT); else { mem(0, roX0, 0, PT); mem(roX1, W - roX1, 0, PT); }
  for (let i = 0; i < m.top_plate_count; i++) mem(0, W, zT + i * PT, PT);
  mem(0, ST, zB, zT - zB); mem(W - ST, ST, zB, zT - zB);
  mem(roX0 - ST, ST, zB, roZ1 - zB); mem(roX1, ST, zB, roZ1 - zB);
  mem(roX0 - ST, roW + 2 * ST, roZ1, hdrDep);
  const zA = roZ1 + hdrDep;
  for (const cx of cripX) mem(cx, ST, zA, zT - zA);
  if (isWin) {
    const zS = roZ0 - PT; mem(roX0, roW, zS, PT);
    const hasSubheader = zS - zB > PT + 1;
    if (hasSubheader) mem(roX0, roW, zB, PT);
    const zC = zB + (hasSubheader ? PT : 0);
    for (const cx of cripX) mem(cx, ST, zC, zS - zC);
    if (hasSubheader) {
      const bs = 24 * IN_TO_MM;
      for (let zb = zC + bs; zb + PT < zS - 1; zb += bs) mem(roX0, roW, zb, PT);
    }
  }
  osb(0, roX0, 0, H); osb(roX1, W - roX1, 0, H);
  osb(roX0, roW, roZ1, H - roZ1); if (roZ0 > 0) osb(roX0, roW, 0, roZ0);
  return b;
}

// ---- member -> box mapping (the transform render3d now applies) ----------
function memberBoxes(m, dir) {
  const isInt = m.interior;
  const D = isInt ? (3.5 * IN_TO_MM) : STUD_DEPTH;
  const O = isInt ? 0 : OSB_THICK;
  const horiz = (dir === 'north' || dir === 'south');
  const osbAt = (dir === 'south' || dir === 'west') ? -O / 2 : D + O / 2;
  const b = [];
  for (const mm of enumerateMembers(m)) {
    const cx = mm.x_mm + mm.w_mm / 2, cz = mm.z_mm + mm.h_mm / 2;
    if (mm.role === 'sheathing') {
      if (O <= 0) continue;
      if (horiz) b.push([mm.w_mm, O, mm.h_mm, cx, osbAt, cz, 'O']);
      else b.push([O, mm.w_mm, mm.h_mm, osbAt, -cx, cz, 'O']);
    } else {
      if (horiz) b.push([mm.w_mm, D, mm.h_mm, cx, D / 2, cz, 'L']);
      else b.push([D, mm.w_mm, mm.h_mm, D / 2, -cx, cz, 'L']);
    }
  }
  return b;
}

const norm = arr => arr.map(x => x.slice(0, 6).map(v => v.toFixed(6)).join(',') + '|' + x[6]).sort();

// ---- 1. 3D parity --------------------------------------------------------
const PARITY_MODULES = [
  'wall_4x8_2x6_16oc', 'wall_4x8_2x6_24oc', 'wall_3x8.5_2x6_16oc',
  'iwall_4x8_2x4_16oc', 'window_4x8_2x6_36x48', 'door_4x8_2x6_38x83',
];
for (const id of PARITY_MODULES) {
  const m = mod(id);
  let same = true;
  for (const dir of ['north', 'south', 'east', 'west']) {
    const a = JSON.stringify(norm(goldenBoxes(m, dir)));
    const c = JSON.stringify(norm(memberBoxes(m, dir)));
    if (a !== c) { same = false; fail(`3D parity ${id}/${dir}: member boxes != render3d golden`); }
  }
  if (same) ok(`3D parity ${id} (all dirs)`);
}

// ---- 2. acceptance numbers ----------------------------------------------
function near(a, b, label) {
  if (Math.abs(a - b) > 1e-3) { fail(`${label}: got ${a}, expected ${b}`); return false; }
  return true;
}
const roleOf = (ms, r) => ms.filter(x => x.role === r);

// wall_4x8_2x6_16oc -> exactly 4 studs at 0, 406.4, 812.8, 1181.1 mm
{
  const ms = enumerateMembers(mod('wall_4x8_2x6_16oc'));
  const studs = roleOf(ms, 'stud');
  if (studs.length !== 4) fail(`wall_4x8_2x6_16oc studs: got ${studs.length}, expected 4`);
  else {
    const xs = studs.map(s => s.x_mm).sort((p, q) => p - q);
    const exp = [0, 406.4, 812.8, 1181.1];
    let good = true;
    for (let i = 0; i < 4; i++) good = near(xs[i], exp[i], `stud x[${i}]`) && good;
    if (good) ok('wall_4x8_2x6_16oc: 4 studs at 0/16/32/46.5 in');
  }
}

// window_4x8_2x6_36x48 acceptance spec
{
  const ms = enumerateMembers(mod('window_4x8_2x6_36x48'));
  const kings = roleOf(ms, 'king'), jacks = roleOf(ms, 'jack');
  const hdr = roleOf(ms, 'header'), tc = roleOf(ms, 'top_cripple');
  const sill = roleOf(ms, 'sill'), lc = roleOf(ms, 'lower_cripple');
  const sub = roleOf(ms, 'subheader'), blk = roleOf(ms, 'sill_block');
  let good = true;
  if (kings.length !== 2) { fail(`window kings: ${kings.length} != 2`); good = false; }
  else good = near(kings[0].h_mm, 2324.1, 'king h') && good;
  if (jacks.length !== 2) { fail(`window jacks: ${jacks.length} != 2`); good = false; }
  else good = near(jacks[0].h_mm, 1790.7, 'jack h') && good;
  if (hdr.length !== 1) { fail(`window header: ${hdr.length} != 1`); good = false; }
  else { good = near(hdr[0].w_mm, 990.6, 'header w') && good; if (hdr[0].plies !== 2) { fail(`header plies: ${hdr[0].plies} != 2`); good = false; } }
  if (tc.length !== 2) { fail(`window top cripples: ${tc.length} != 2`); good = false; }
  else good = near(tc[0].h_mm, 349.25, 'top cripple h') && good;
  if (sill.length !== 1) { fail(`window sill: ${sill.length} != 1`); good = false; }
  else good = near(sill[0].w_mm, 914.4, 'sill w') && good;
  if (lc.length !== 2) { fail(`window lower cripples: ${lc.length} != 2`); good = false; }
  else {
    good = near(lc[0].z_mm, 76.2, 'lower cripple z') && good;
    good = near(lc[0].h_mm, 495.3, 'lower cripple h') && good;
  }
  if (sub.length !== 1) { fail(`window subheader: ${sub.length} != 1`); good = false; }
  if (blk.length !== 0) { fail(`window sill_block: ${blk.length} != 0 (21" zone < 24")`); good = false; }
  if (good) ok('window_4x8_2x6_36x48: full §7 acceptance spec');
}

// determinism
{
  const a = JSON.stringify(enumerateMembers(mod('window_4x8_2x6_36x48')));
  const b = JSON.stringify(enumerateMembers(mod('window_4x8_2x6_36x48')));
  if (a !== b) fail('enumerateMembers not deterministic'); else ok('deterministic');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
