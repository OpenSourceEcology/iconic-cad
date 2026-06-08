// =====================================================
// MEMBERS — the framing "member list", the atom of the system.
//
// enumerateMembers(mod) is the source of truth for a wall panel's framing in the
// WEB outputs: the 3D view (render3d.js), the BOM/cut list (bom.js), the fab
// drawing (render_fab.js), and the build summary (render_summary.js). It is a
// pure, deterministic, dependency-light function: imports constants only — no
// DOM, no three.js.
//
// NOTE — it is NOT the source of the browser FreeCAD wall solids. fcstd.js does
// NOT build geometry from this list; it translates PRE-BAKED BREP assets
// (web/assets/lib/<module>__<dir>.brp), generated offline by
// generate_wall_library.py via scripts/bake_geometry.py, and imports
// enumerateMembers() only for panel HEIGHT. The BREP generator and this member
// list are kept in sync by `build_lib.py --verify --no-thumbs`, enforced in CI
// (see CAD-AUD-009); a framing change here that skips a BREP regenerate would
// otherwise diverge silently from FreeCAD export.
//
// This is a FAITHFUL PORT of the geometry render3d.js builds today. Same
// members, same panel-local positions, same sizes. It is a transcription, not a
// redesign. If the port and the existing 3D view ever disagree, the port is
// wrong — fix the port.
//
// Member = {
//   role:     'bottom_plate'|'top_plate'|'stud'|'king'|'jack'|'header'|
//             'top_cripple'|'lower_cripple'|'sill'|'subheader'|'sill_block'|'sheathing',
//   nominal:  '2x4'|'2x6'|'2x8'|'2x12'|'OSB',
//   x_mm, z_mm, w_mm, h_mm,   // panel-local interior-face elevation:
//                             //   x_mm = distance from panel's left edge (across width)
//                             //   z_mm = distance from the floor (vertical)
//                             //   w_mm = horizontal extent, h_mm = vertical extent
//   length_mm,                // the cut length: long axis of the piece
//   plies,                    // 1 by default; header carries its spec header_plies
// }
//
// dir is NOT a parameter: the member list is the panel "as built flat".
// Orientation (which way it faces, which side the OSB is on) is a consumer
// concern handled by render3d when it maps members into the 3D scene.
// =====================================================
import { IN_TO_MM, STUD_THICK, STUD_DEPTH, OSB_THICK, LUMBER_DEPTH } from './constants.js';

function member(role, nominal, x_mm, z_mm, w_mm, h_mm, plies = 1) {
  return {
    role, nominal, x_mm, z_mm, w_mm, h_mm,
    length_mm: Math.max(w_mm, h_mm), // long axis: h for studs, w for plates
    plies,
  };
}

export function enumerateMembers(mod) {
  return mod.aperture ? enumerateAperture(mod) : enumerateWall(mod);
}

// ---- Plain wall (ported from render3d.buildWall3D) ------------------------
function enumerateWall(mod) {
  const isInt = mod.interior;
  const out = [];

  const W = mod.width_mm;
  const H = (mod.id.includes('8.5') ? 8.5 : 8) * 12 * IN_TO_MM;
  const O = isInt ? 0 : OSB_THICK;
  const PT = STUD_THICK;
  const ST = STUD_THICK;
  const studNom = isInt ? '2x4' : '2x6';

  const oc = mod.id.includes('16oc') ? 16 : mod.id.includes('24oc') ? 24 : 18;
  const studPos = [0];
  let cur = oc * IN_TO_MM;
  while (cur + ST <= W - ST) { studPos.push(cur); cur += oc * IN_TO_MM; }
  studPos.push(W - ST);
  const studH = H - 2 * PT;

  out.push(member('bottom_plate', studNom, 0, 0, W, PT));
  // NOTE: spec says double top plate; render3d models single. Faithful port — do not change here.
  out.push(member('top_plate', studNom, 0, H - PT, W, PT));
  for (const sx of studPos) out.push(member('stud', studNom, sx, PT, ST, studH));
  if (O > 0) out.push(member('sheathing', 'OSB', 0, 0, W, H));

  return out;
}

// ---- Window/door aperture (ported from render3d.buildAperture3D) ----------
function enumerateAperture(mod) {
  const isInt = mod.interior;
  const a = mod.aperture;
  const out = [];

  const W = mod.width_mm;
  const H = (a.height_ft || (mod.id.includes('4x9') ? 9 : mod.id.includes('4x10') ? 10 : 8)) * 12 * IN_TO_MM;
  const O = isInt ? 0 : OSB_THICK;
  const PT = STUD_THICK, ST = STUD_THICK;
  const studNom = isInt ? '2x4' : '2x6';
  const hdrNom = a.header_nominal;

  const roW = a.ro_w_in * IN_TO_MM;
  const roX0 = (W - roW) / 2, roX1 = roX0 + roW;
  const roZ0 = a.sill_in * IN_TO_MM;
  const roZ1 = roZ0 + a.ro_h_in * IN_TO_MM;
  const isWin = a.type === 'window' && roZ0 > 0;
  const hdrDep = LUMBER_DEPTH[a.header_nominal] || 7.25 * IN_TO_MM;
  const zStudTop = H - PT, zStudBot = PT;

  const cripX = [];
  let g = a.oc * IN_TO_MM;
  while (g + ST < roX1) { if (g > roX0) cripX.push(g); g += a.oc * IN_TO_MM; }
  if (!cripX.length) cripX.push((roX0 + roX1) / 2 - ST / 2);

  // helper: emit a member only if it has positive extent (mirrors render3d's guard)
  function emit(role, nominal, runStart, runLen, z0, zLen, plies = 1) {
    if (runLen <= 0 || zLen <= 0) return;
    out.push(member(role, nominal, runStart, z0, runLen, zLen, plies));
  }

  // Bottom plate: continuous under a window, cut out across a door opening.
  if (isWin) emit('bottom_plate', studNom, 0, W, 0, PT);
  else { emit('bottom_plate', studNom, 0, roX0, 0, PT); emit('bottom_plate', studNom, roX1, W - roX1, 0, PT); }
  // NOTE: spec says double top plate; render3d models single. Faithful port — do not change here.
  emit('top_plate', studNom, 0, W, zStudTop, PT);

  // King studs (full height each side), jack studs (carry the header).
  emit('king', studNom, 0, ST, zStudBot, zStudTop - zStudBot);
  emit('king', studNom, W - ST, ST, zStudBot, zStudTop - zStudBot);
  emit('jack', studNom, roX0 - ST, ST, zStudBot, roZ1 - zStudBot);
  emit('jack', studNom, roX1, ST, zStudBot, roZ1 - zStudBot);

  // NOTE: render3d draws the header as ONE solid box of full nominal depth, not
  // header_plies separate plies. Keep it one member; carry plies as metadata so a
  // later cut list / fab label can expand it. Faithful port — do not split here.
  emit('header', hdrNom, roX0 - ST, roW + 2 * ST, roZ1, hdrDep, a.header_plies || 1);

  const zAbove = roZ1 + hdrDep;
  for (const cx of cripX) emit('top_cripple', studNom, cx, ST, zAbove, zStudTop - zAbove);

  if (isWin) {
    const zSillBot = roZ0 - PT;
    emit('sill', studNom, roX0, roW, zSillBot, PT);
    const zCripBot = zStudBot;
    for (const cx of cripX) emit('lower_cripple', studNom, cx, ST, zCripBot, zSillBot - zCripBot);
    if (zSillBot - zCripBot > PT + 1) {
      emit('subheader', studNom, roX0, roW, zCripBot, PT);
      const blockSpacing = 24 * IN_TO_MM;
      for (let zb = zCripBot + blockSpacing; zb + PT < zSillBot - 1; zb += blockSpacing) {
        emit('sill_block', studNom, roX0, roW, zb, PT);
      }
    }
  }

  // OSB sheathing (exterior only) — full-panel layout, split around the opening,
  // matching render3d so the 3D OSB and the fab-drawing OSB come from one source.
  if (O > 0) {
    emit('sheathing', 'OSB', 0, roX0, 0, H);
    emit('sheathing', 'OSB', roX1, W - roX1, 0, H);
    emit('sheathing', 'OSB', roX0, roW, roZ1, H - roZ1);
    if (roZ0 > 0) emit('sheathing', 'OSB', roX0, roW, 0, roZ0);
  }

  return out;
}
