// =====================================================
// RENDER 2D — the plan canvas. draw2d() is the hot path (runs on every
// mousemove) so it does ONLY 2D work: no 3D rebuild, no BOM string build.
// Those are driven by model changes in app.js instead.
// =====================================================
import { doc, ui, view } from './state.js';
import { mmToPx } from './view.js';
import { isHorizontal, getModuleBBox, getPortPositions } from './geometry.js';
import { IN_TO_MM, APERTURE_GAP } from './constants.js';
import { regionForLevel } from './region.js';
import { moduleGridMM } from './systems.js';

const canvas = document.getElementById('design-canvas');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');

export function resizeCanvas() {
  // While #canvas-wrap is hidden (Foundation/3D trades set display:none) its
  // clientWidth/Height are 0. A window-resize firing then would zero the canvas
  // and blank the Framing review on return — so skip. switchTab('2d') re-runs
  // this once the wrapper is visible again. Returns whether a resize happened.
  if (!wrap.clientWidth || !wrap.clientHeight) return false;
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  draw2d();
  return true;
}

// =====================================================
// APERTURE PLAN SILHOUETTE (top-down floor-plan symbol)
// =====================================================
function drawAperturePlan(p, px, py, pw, ph) {
  const a = p.mod.aperture;
  const horiz = isHorizontal(p.dir);
  const roW = mmToPx(a.ro_w_in * IN_TO_MM);
  const runLen = horiz ? pw : ph;
  const crossLen = horiz ? ph : pw;
  const a0 = (runLen - roW) / 2;
  const a1 = a0 + roW;

  const T = (along, cross) => horiz
    ? { x: px + along, y: py + cross }
    : { x: px + cross, y: py + along };

  const extAtZero =
    p.dir === 'north' ? true  :
    p.dir === 'west'  ? true  :
    false;
  const intCross = extAtZero ? crossLen : 0;
  const extCross = extAtZero ? 0 : crossLen;

  const swingCross = (a.swing === 'out') ? intCross : extCross;
  const leafColor = p.mod.interior ? '#bb86fc' : '#4fc3f7';

  ctx.save();
  ctx.lineWidth = 1.5;

  const clearOpening = () => {
    const c0 = T(a0, 0), c1 = T(a1, crossLen);
    ctx.fillStyle = APERTURE_GAP;
    ctx.fillRect(Math.min(c0.x, c1.x), Math.min(c0.y, c1.y),
                 Math.abs(c1.x - c0.x), Math.abs(c1.y - c0.y));
  };
  const jambTicks = () => {
    ctx.strokeStyle = '#4fc3f7';
    for (const j of [a0, a1]) {
      const t0 = T(j, 0), t1 = T(j, crossLen);
      ctx.beginPath(); ctx.moveTo(t0.x, t0.y); ctx.lineTo(t1.x, t1.y); ctx.stroke();
    }
  };
  const drawLeaf = (hingeAlong, openAlong, radius) => {
    const sign = swingCross === 0 ? 1 : -1;
    const hinge = T(hingeAlong, swingCross);
    const leafEnd = T(hingeAlong, swingCross + sign * radius);
    const open = T(openAlong, swingCross);
    ctx.strokeStyle = leafColor;
    ctx.beginPath(); ctx.moveTo(hinge.x, hinge.y); ctx.lineTo(leafEnd.x, leafEnd.y); ctx.stroke();
    const aS = Math.atan2(leafEnd.y - hinge.y, leafEnd.x - hinge.x);
    const aO = Math.atan2(open.y - hinge.y, open.x - hinge.x);
    ctx.strokeStyle = 'rgba(120,160,200,0.5)';
    ctx.beginPath(); ctx.arc(hinge.x, hinge.y, radius, aS, aO, leafSweepCCW(aS, aO)); ctx.stroke();
  };

  if (a.type === 'door') {
    clearOpening();
    drawLeaf(a0, a1, roW);
  } else if (a.type === 'double_door') {
    clearOpening();
    const mid = (a0 + a1) / 2;
    drawLeaf(a0, mid, roW / 2);
    drawLeaf(a1, mid, roW / 2);
  } else if (a.type === 'sliding') {
    clearOpening();
    const mid = (a0 + a1) / 2;
    const near = crossLen * 0.35, far = crossLen * 0.65;
    ctx.strokeStyle = leafColor; ctx.lineWidth = 2.5;
    let s = T(a0, near), e = T(mid + roW * 0.05, near);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    s = T(mid - roW * 0.05, far); e = T(a1, far);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    ctx.lineWidth = 1.5;
  } else if (a.type === 'garage') {
    clearOpening();
    ctx.strokeStyle = leafColor;
    const n = 4;
    for (let i = 1; i < n; i++) {
      const c = crossLen * (i / n);
      const s = T(a0, c), e = T(a1, c);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    }
    jambTicks();
  } else {
    const gInset = crossLen * 0.34;
    const g1a = T(a0, gInset), g1b = T(a1, gInset);
    const g2a = T(a0, crossLen - gInset), g2b = T(a1, crossLen - gInset);
    ctx.strokeStyle = '#9fd8ff';
    ctx.beginPath(); ctx.moveTo(g1a.x, g1a.y); ctx.lineTo(g1b.x, g1b.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(g2a.x, g2a.y); ctx.lineTo(g2b.x, g2b.y); ctx.stroke();
    jambTicks();
  }
  ctx.restore();
}

// Pick the short arc direction between two angles for the door swing.
function leafSweepCCW(a0, a1) {
  let d = a1 - a0;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d < 0;
}

// Faint, non-interactive footprint of an L1 wall, shown under the L2 plan as a
// ghost (not selectable / not eraseable while on L2 — §4).
function drawGhost(p) {
  const bb = getModuleBBox(p.mod, p.dir);
  const px = view.offsetX + mmToPx(p.x_mm);
  const py = view.offsetY + mmToPx(p.y_mm);
  const pw = mmToPx(bb.w), ph = mmToPx(bb.h);
  ctx.save();
  ctx.fillStyle = 'rgba(120,140,170,0.10)';
  ctx.strokeStyle = 'rgba(120,150,190,0.35)';
  ctx.lineWidth = 1;
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeRect(px, py, pw, ph);
  ctx.restore();
}

export function draw2d() {
  const placed = doc.entities;
  const onL2 = doc.activeLevel === 'L2';
  // Only the active level's entities are drawn solid + interactive; other levels
  // appear (if at all) as ghosts. New placements land on doc.activeLevel.
  // Foundation entities are derived 3D-only objects with no module / 2D symbol —
  // never drawn on the build grid.
  const activeEnts = placed.filter(p => p.level === doc.activeLevel && p.kind !== 'foundation');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background grid
  ctx.strokeStyle = '#252540';
  ctx.lineWidth = 1;
  const gridPx = mmToPx(moduleGridMM());
  for (let x = view.offsetX % gridPx; x < canvas.width; x += gridPx) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = view.offsetY % gridPx; y < canvas.height; y += gridPx) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }

  // On L2: the L1 build region (gray filled standin) under faint L1 ghosts.
  if (onL2) {
    const region = regionForLevel('L1');
    ctx.fillStyle = 'rgba(150,156,172,0.18)';
    for (const r of region.rects) {
      ctx.fillRect(view.offsetX + mmToPx(r.x_mm), view.offsetY + mmToPx(r.y_mm),
                   mmToPx(r.w_mm), mmToPx(r.h_mm));
    }
    for (const p of placed) if (p.level === 'L1' && p.kind !== 'foundation') drawGhost(p);
  }

  // Draw active-level modules
  activeEnts.forEach((p) => {
    const bb = getModuleBBox(p.mod, p.dir);
    const px = view.offsetX + mmToPx(p.x_mm);
    const py = view.offsetY + mmToPx(p.y_mm);
    const pw = mmToPx(bb.w);
    const ph = mmToPx(bb.h);

    const isInt = p.mod.interior;
    ctx.fillStyle = isInt ? '#3a2a4c' : '#2a3a5c';
    ctx.strokeStyle = isInt ? '#bb86fc' : '#4fc3f7';
    ctx.lineWidth = 1.5;
    ctx.fillRect(px, py, pw, ph);
    if (isInt) ctx.setLineDash([4, 3]);
    ctx.strokeRect(px, py, pw, ph);
    ctx.setLineDash([]);

    // Direction indicator (darkened side = OSB/exterior) — skip for interior walls
    if (!isInt) {
      ctx.fillStyle = 'rgba(79, 195, 247, 0.3)';
      const d = mmToPx(p.mod.depth_mm) * 0.3;
      if (p.dir === 'north') ctx.fillRect(px, py, pw, d);
      else if (p.dir === 'south') ctx.fillRect(px, py + ph - d, pw, d);
      else if (p.dir === 'west') ctx.fillRect(px, py, d, ph);
      else if (p.dir === 'east') ctx.fillRect(px + pw - d, py, d, ph);
    }

    // Aperture plan symbol (window / door)
    if (p.mod.aperture) drawAperturePlan(p, px, py, pw, ph);

    // Direction label
    ctx.fillStyle = isInt ? '#bb86fc' : '#cfe8ff';
    if (p.mod.aperture) {
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(p.dir[0].toUpperCase(), px + 3, py + 3);
      ctx.textBaseline = 'alphabetic';
    } else {
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isInt ? 'I' : p.dir[0].toUpperCase(), px + pw/2, py + ph/2 + 4);
    }

    // Blocking markers for interior wall connections
    if (p.connections) {
      for (const conn of p.connections) {
        let mx = view.offsetX + mmToPx(conn.contact_x_mm);
        let my = view.offsetY + mmToPx(conn.contact_y_mm);
        const target = placed.find(q => q.id === conn.target_id);
        if (target) {
          const tbb = getModuleBBox(target.mod, target.dir);
          const pad = 14;
          if (target.dir === 'north') my -= mmToPx(tbb.h) + pad;
          else if (target.dir === 'south') my += mmToPx(tbb.h) + pad;
          else if (target.dir === 'east') mx += mmToPx(tbb.w) + pad;
          else if (target.dir === 'west') mx -= mmToPx(tbb.w) + pad;
        }
        ctx.fillStyle = conn.blocking === 'T' ? '#f57c00' : (conn.blocking === 'C2' ? '#1976d2' : '#1565c0');
        ctx.beginPath();
        ctx.arc(mx, my, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(conn.blocking, mx, my + 3);
      }
    }

    // Draw ports
    const ports = getPortPositions(p.mod, p.dir);
    ports.forEach(port => {
      const ppx = px + mmToPx(port.x);
      const ppy = py + mmToPx(port.y);
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath();
      ctx.arc(ppx, ppy, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // Draw snap indicator
  if (ui.snapTarget && ui.dragState) {
    const sx = view.offsetX + mmToPx(ui.snapTarget.x_mm);
    const sy = view.offsetY + mmToPx(ui.snapTarget.y_mm);
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 8, 0, Math.PI * 2);
    ctx.stroke();

    const bb = getModuleBBox(ui.dragState.mod, ui.dragState.dir);
    const pw = mmToPx(bb.w);
    const ph = mmToPx(bb.h);
    ctx.fillStyle = 'rgba(79, 195, 247, 0.15)';
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.5)';
    ctx.lineWidth = 1;
    ctx.fillRect(sx, sy, pw, ph);
    ctx.strokeRect(sx, sy, pw, ph);
  }

  // Draw drag preview at cursor
  if (ui.dragState && !ui.snapTarget) {
    const bb = getModuleBBox(ui.dragState.mod, ui.dragState.dir);
    const pw = mmToPx(bb.w);
    const ph = mmToPx(bb.h);
    ctx.fillStyle = 'rgba(79, 195, 247, 0.1)';
    ctx.strokeStyle = 'rgba(79, 195, 247, 0.3)';
    ctx.lineWidth = 1;
    ctx.fillRect(ui.mouseCanvasX - pw/2, ui.mouseCanvasY - ph/2, pw, ph);
    ctx.strokeRect(ui.mouseCanvasX - pw/2, ui.mouseCanvasY - ph/2, pw, ph);
  }

  // Red-flag rejection feedback (e.g. an off-region L2 drop — §5). Transient;
  // ui.rejectFlash is cleared on a timer by the caller that set it.
  if (ui.rejectFlash) {
    const { x, y } = ui.rejectFlash;
    ctx.save();
    ctx.strokeStyle = '#e53935';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 9, y - 9); ctx.lineTo(x + 9, y + 9);
    ctx.moveTo(x + 9, y - 9); ctx.lineTo(x - 9, y + 9);
    ctx.stroke();
    ctx.restore();
  }

  // Status
  const status = document.getElementById('status');
  if (ui.dragState) {
    status.textContent = ui.snapTarget
      ? `Snap: (${ui.snapTarget.x_mm.toFixed(0)}, ${ui.snapTarget.y_mm.toFixed(0)}) mm`
      : `Dragging ${ui.dragState.mod.label} ${ui.dragState.dir}`;
  } else {
    status.textContent = `${placed.length} modules placed`;
  }

  // Show/hide rotate button
  document.getElementById('btn-rotate').style.display = ui.dragState ? '' : 'none';

  // Blocking mode label follows cursor when dragging interior wall
  if (ui.dragState && ui.dragState.mod.interior) {
    const labelX = ui.mouseCanvasX + 16;
    const labelY = ui.mouseCanvasY - 20;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = ui.blockingMode === 'C' ? '#4fc3f7' : '#555';
    ctx.fillText('C - Continuous', labelX, labelY);
    ctx.fillStyle = ui.blockingMode === 'T' ? '#4fc3f7' : '#555';
    ctx.fillText('T - Transverse', labelX, labelY + 14);
  }
}
