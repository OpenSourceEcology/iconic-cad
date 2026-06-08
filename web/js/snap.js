// =====================================================
// SNAP LOGIC — port snapping, interior-wall T-junctions, blocking type,
// and geometric door-swing collision. Behaviour preserved verbatim from the
// pre-modularisation single file; only `placed` -> doc.entities and
// `blockingMode` -> ui.blockingMode were rewired.
// =====================================================
import { doc, ui } from './state.js';
import { mmToPx } from './view.js';
import { isHorizontal, getModuleBBox, getPortPositions } from './geometry.js';
import {
  IN_TO_MM, WALL_DEPTH, SNAP_DIST_PX,
  MIN_IWALL_SPACING_MM, CORNER_KEEPOUT_MM, MIN_IWALL_TO_EXT_PARALLEL_MM,
} from './constants.js';

const placed = doc.entities; // live alias — doc.entities is mutated in place, never reassigned

export function findSnap(cursorX_mm, cursorY_mm, mod, dir) {
  const bb = getModuleBBox(mod, dir);
  const dragPorts = getPortPositions(mod, dir);

  let bestDist = Infinity;
  let bestSnap = null;

  // If no modules placed, snap to cursor position (free placement)
  if (placed.length === 0) {
    return { x_mm: cursorX_mm - bb.w / 2, y_mm: cursorY_mm - bb.h / 2 };
  }

  // Check each placed module's ports against drag module's ports
  for (const p of placed) {
    if (p.kind === 'foundation') continue; // derived 3D-only object — no module/ports
    if (p.level !== doc.activeLevel) continue; // never snap across levels (L2↔L1)
    // Interior walls attach to exterior walls only via T-junction (which makes a
    // real connection + blocking) — never by corner port-snap, which would place
    // them flush-but-off-centre with no bolting framing.
    // Interior DOORS (apertures) never port-snap at all: a port-snap to another
    // interior module lets them stack across an exterior wall onto the outside,
    // floating with no host wall. They place only via T-junction seam.
    if (mod.interior && (!p.mod.interior || mod.aperture)) continue;
    const pPorts = getPortPositions(p.mod, p.dir);
    for (const pp of pPorts) {
      const ppAbs = { x: p.x_mm + pp.x, y: p.y_mm + pp.y };

      for (const dp of dragPorts) {
        // If drag port snaps to placed port, compute module origin
        const snapOrigin = {
          x_mm: ppAbs.x - dp.x,
          y_mm: ppAbs.y - dp.y,
        };
        // Distance from cursor to where module center would be
        const cx = snapOrigin.x_mm + bb.w / 2;
        const cy = snapOrigin.y_mm + bb.h / 2;
        const dist = Math.hypot(mmToPx(cx - cursorX_mm), mmToPx(cy - cursorY_mm));

        if (dist < SNAP_DIST_PX * 3 && dist < bestDist) {
          // Check no overlap with existing modules
          if (!wouldOverlap(snapOrigin.x_mm, snapOrigin.y_mm, bb, mod, dir)) {
            // For interior walls, reject port snaps too close to existing interior
            // walls, or running parallel and very close to an exterior wall.
            if (mod.interior &&
                (iwallTooCloseToExisting(snapOrigin.x_mm, snapOrigin.y_mm, mod, dir) ||
                 iwallTooCloseToExteriorParallel(snapOrigin.x_mm, snapOrigin.y_mm, mod, dir))) {
              continue;
            }
            bestDist = dist;
            bestSnap = snapOrigin;
          }
        }
      }
    }
  }

  // Also check T-junction snaps for interior walls
  if (mod.interior) {
    const tjSnap = findTJunctionSnap(cursorX_mm, cursorY_mm, mod, dir);
    if (tjSnap) {
      const tjBb = getModuleBBox(mod, dir);
      const tjCx = tjSnap.x_mm + tjBb.w / 2;
      const tjCy = tjSnap.y_mm + tjBb.h / 2;
      const tjDist = Math.hypot(mmToPx(tjCx - cursorX_mm), mmToPx(tjCy - cursorY_mm));
      if (tjDist < bestDist || !bestSnap) {
        return tjSnap;
      }
    }
  }

  // STACK SNAP: an exterior wall on an upper level snaps directly on top of the
  // Story-1 exterior wall beneath the cursor (same origin = exactly above it), so
  // stacking one wall over another is easy. Competes with same-level port snaps
  // by cursor distance; the region gate still rejects any overhang on drop.
  if (doc.activeLevel !== 'L1' && !mod.interior) {
    let bestStack = null, bestStackD = Infinity;
    for (const p of placed) {
      if (p.kind === 'foundation') continue; // derived 3D-only object — no module/ports
      if (p.level === doc.activeLevel) continue; // a wall on the level BELOW
      if (p.kind !== 'wall') continue;           // exterior only
      const pbb = getModuleBBox(p.mod, p.dir);
      const cx = p.x_mm + pbb.w / 2, cy = p.y_mm + pbb.h / 2;
      const d = Math.hypot(mmToPx(cx - cursorX_mm), mmToPx(cy - cursorY_mm));
      if (d < bestStackD) { bestStackD = d; bestStack = { x_mm: p.x_mm, y_mm: p.y_mm }; }
    }
    if (bestStack && bestStackD < SNAP_DIST_PX * 6 && (!bestSnap || bestStackD < bestDist)) {
      return bestStack;
    }
  }

  return bestSnap;
}

export function wouldOverlap(x, y, bb, mod, dir) {
  // Allow small corner-zone overlaps (perpendicular walls share a D×D zone)
  // but reject large overlaps (module stacking on top of each other)
  const maxAllowed = WALL_DEPTH * WALL_DEPTH * 1.5; // ~D² with some tolerance
  for (const p of placed) {
    if (p.kind === 'foundation') continue; // derived 3D-only object — no module/ports
    if (p.level !== doc.activeLevel) continue; // L2 stacks over L1 — only same-level overlap counts
    const pbb = getModuleBBox(p.mod, p.dir);
    const overlapW = Math.min(x + bb.w, p.x_mm + pbb.w) - Math.max(x, p.x_mm);
    const overlapH = Math.min(y + bb.h, p.y_mm + pbb.h) - Math.max(y, p.y_mm);
    if (overlapW > 0 && overlapH > 0) {
      const overlapArea = overlapW * overlapH;
      // An interior wall butts against an exterior FACE — it must never bury into
      // the exterior band. The generous D×D corner tolerance is for two
      // perpendicular EXTERIOR walls only; reject any real interior↔exterior
      // overlap (> a tiny FP-touch epsilon).
      if (mod.interior && !p.mod.interior) {
        if (overlapArea > 4) return true; // mm²
      } else if (overlapArea > maxAllowed) {
        return true;
      }
    }
  }
  return false;
}

// =====================================================
// T-JUNCTION SNAP (interior walls)
// =====================================================
function getInteriorFace(p) {
  const bb = getModuleBBox(p.mod, p.dir);
  if (isHorizontal(p.dir)) {
    if (p.dir === 'north') {
      return { x1: p.x_mm, y1: p.y_mm + bb.h, x2: p.x_mm + bb.w, y2: p.y_mm + bb.h, axis: 'x' };
    } else {
      return { x1: p.x_mm, y1: p.y_mm, x2: p.x_mm + bb.w, y2: p.y_mm, axis: 'x' };
    }
  } else {
    if (p.dir === 'east') {
      return { x1: p.x_mm, y1: p.y_mm, x2: p.x_mm, y2: p.y_mm + bb.h, axis: 'y' };
    } else {
      return { x1: p.x_mm + bb.w, y1: p.y_mm, x2: p.x_mm + bb.w, y2: p.y_mm + bb.h, axis: 'y' };
    }
  }
}

// Get stud center positions along a wall's run in global coords
function getStudPositionsGlobal(p) {
  const oc = p.mod.id.includes('16oc') ? 16 : p.mod.id.includes('24oc') ? 24 : 18;
  const W_in = p.mod.width_mm / IN_TO_MM;
  const st_in = 1.5; // stud thickness
  const positions = [0];
  let cur = oc;
  while (cur + st_in <= W_in - st_in) { positions.push(cur); cur += oc; }
  positions.push(W_in - st_in);
  // Convert to mm and map to global coords along the wall's run
  const face = getInteriorFace(p);
  const isH = isHorizontal(p.dir);
  return positions.map(s_in => {
    const s_mm = s_in * IN_TO_MM;
    const center_mm = s_mm + st_in * IN_TO_MM / 2;
    if (isH) {
      return { along: p.x_mm + center_mm, cross: face.y1 };
    } else {
      return { along: p.y_mm + center_mm, cross: face.x1 };
    }
  });
}

// Get midpoints between adjacent studs (for T mode snapping)
function getStudMidpointsGlobal(p) {
  const studs = getStudPositionsGlobal(p);
  const midpoints = [];
  for (let i = 0; i < studs.length - 1; i++) {
    midpoints.push({
      along: (studs[i].along + studs[i + 1].along) / 2,
      cross: studs[i].cross,
    });
  }
  return midpoints;
}

// Determine C1 vs C2 by checking if flanking C2 studs would collide with existing studs
function getBlockingTypeC(contactAlong, p) {
  const studs = getStudPositionsGlobal(p);
  const iwallHalf = 1.5 * IN_TO_MM / 2; // interior wall end stud half-width
  const bd = 3.5 * IN_TO_MM;             // blocking stud width (3.5")
  const stHalf = 1.5 * IN_TO_MM / 2;     // existing stud half-width

  // Where C2 left and right studs would go
  const leftMin = contactAlong - iwallHalf - bd;
  const leftMax = contactAlong - iwallHalf;
  const rightMin = contactAlong + iwallHalf;
  const rightMax = contactAlong + iwallHalf + bd;

  let leftBlocked = false, rightBlocked = false;
  for (const s of studs) {
    const sMin = s.along - stHalf;
    const sMax = s.along + stHalf;
    if (leftMin < sMax && leftMax > sMin) leftBlocked = true;
    if (rightMin < sMax && rightMax > sMin) rightBlocked = true;
  }

  return (leftBlocked || rightBlocked) ? 'C1' : 'C2';
}

// A "corner" is where a perpendicular exterior wall meets this run (a building
// corner). Interior walls must keep one module clear of it. Returns true if the
// contact (along-axis global position) is within the keep-out of any corner.
function nearACorner(p, contactAlong) {
  const pIsH = isHorizontal(p.dir);
  const pbb = getModuleBBox(p.mod, p.dir);
  for (const q of placed) {
    if (q.kind === 'foundation') continue; // derived 3D-only object — no module/ports
    if (q === p || q.mod.interior) continue;
    if (isHorizontal(q.dir) === pIsH) continue; // perpendicular walls only
    const qbb = getModuleBBox(q.mod, q.dir);
    if (pIsH) {
      if (q.y_mm > p.y_mm + pbb.h + 5 || q.y_mm + qbb.h < p.y_mm - 5) continue; // q must reach p's line
      if (Math.abs(contactAlong - (q.x_mm + qbb.w / 2)) < CORNER_KEEPOUT_MM) return true;
    } else {
      if (q.x_mm > p.x_mm + pbb.w + 5 || q.x_mm + qbb.w < p.x_mm - 5) continue;
      if (Math.abs(contactAlong - (q.y_mm + qbb.h / 2)) < CORNER_KEEPOUT_MM) return true;
    }
  }
  return false;
}

// Reject a proposed interior-wall contact that is within one module of an
// existing interior wall's contact on the same exterior run. Global (across all
// targets) and symmetric (both sides), measured along the run.
function interiorContactTooClose(contactX, contactY, faceAxis) {
  for (const q of placed) {
    if (q.kind === 'foundation') continue; // derived 3D-only object — no module/ports
    if (!q.mod.interior || !q.connections) continue;
    for (const c of q.connections) {
      if (faceAxis === 'x') {                                  // horizontal run: same Y line, space along X
        if (Math.abs(c.contact_y_mm - contactY) < WALL_DEPTH &&
            Math.abs(c.contact_x_mm - contactX) < MIN_IWALL_SPACING_MM) return true;
      } else {                                                 // vertical run: same X line, space along Y
        if (Math.abs(c.contact_x_mm - contactX) < WALL_DEPTH &&
            Math.abs(c.contact_y_mm - contactY) < MIN_IWALL_SPACING_MM) return true;
      }
    }
  }
  return false;
}

// ---- Door swing collision (geometric, not heuristic) -------------------------
// Reconstructs each door leaf's swept quarter-disc in GLOBAL mm using the exact
// same geometry drawAperturePlan() renders, then tests for sector overlap — so
// the block decision always matches what the user sees on the canvas.

// Swept leaf(s) of an aperture as circular sectors {cx, cy, r, a0, a1} in mm.
// door → 1 leaf, double_door → 2; window/sliding/garage → [] (no swing).
function doorSwingSectors(mod, dir, x_mm, y_mm) {
  const a = mod.aperture;
  if (!a || (a.type !== 'door' && a.type !== 'double_door')) return [];
  const horiz = isHorizontal(dir);
  const bb = getModuleBBox(mod, dir);
  const roW = a.ro_w_in * IN_TO_MM;
  const runLen = horiz ? bb.w : bb.h;
  const crossLen = horiz ? bb.h : bb.w;
  const a0 = (runLen - roW) / 2, a1 = a0 + roW;
  const T = (along, cross) => horiz
    ? { x: x_mm + along, y: y_mm + cross }
    : { x: x_mm + cross, y: y_mm + along };
  const extAtZero = (dir === 'north' || dir === 'west');
  const intCross = extAtZero ? crossLen : 0;
  const extCross = extAtZero ? 0 : crossLen;
  const swingCross = (a.swing === 'out') ? intCross : extCross;
  const sign = swingCross === 0 ? 1 : -1;
  const sector = (hingeAlong, openAlong, radius) => {
    const hinge = T(hingeAlong, swingCross);
    const leafEnd = T(hingeAlong, swingCross + sign * radius);
    const open = T(openAlong, swingCross);
    return {
      cx: hinge.x, cy: hinge.y, r: radius,
      a0: Math.atan2(leafEnd.y - hinge.y, leafEnd.x - hinge.x),
      a1: Math.atan2(open.y - hinge.y, open.x - hinge.x),
    };
  };
  if (a.type === 'double_door') {
    const mid = (a0 + a1) / 2;
    return [sector(a0, mid, roW / 2), sector(a1, mid, roW / 2)];
  }
  return [sector(a0, a1, roW)];
}

// Point inside sector? within radius AND within the short (<=180°) sweep a0→a1.
function pointInSector(px, py, s) {
  const dx = px - s.cx, dy = py - s.cy;
  if (dx * dx + dy * dy > s.r * s.r) return false;
  let span = s.a1 - s.a0;
  while (span <= -Math.PI) span += 2 * Math.PI;
  while (span > Math.PI) span -= 2 * Math.PI;     // signed short sweep
  let t = Math.atan2(dy, dx) - s.a0;
  while (t <= -Math.PI) t += 2 * Math.PI;
  while (t > Math.PI) t -= 2 * Math.PI;
  return span >= 0 ? (t >= 0 && t <= span) : (t <= 0 && t >= span);
}

// Do two swept sectors overlap? Sample a fan of points across each filled
// sector and test membership in the other (catches partial overlap + containment).
function sectorsOverlap(s1, s2) {
  const RS = [0.2, 0.4, 0.6, 0.8, 1.0], NA = 8;
  const hits = (a, b) => {
    let span = a.a1 - a.a0;
    while (span <= -Math.PI) span += 2 * Math.PI;
    while (span > Math.PI) span -= 2 * Math.PI;
    for (const rf of RS)
      for (let i = 0; i <= NA; i++) {
        const ang = a.a0 + span * (i / NA);
        if (pointInSector(a.cx + a.r * rf * Math.cos(ang),
                          a.cy + a.r * rf * Math.sin(ang), b)) return true;
      }
    return false;
  };
  return hits(s1, s2) || hits(s2, s1);
}

// Would the dragging aperture at (x_mm,y_mm) swing into any placed door's swing?
function apertureSwingConflicts(mod, dir, x_mm, y_mm) {
  const mine = doorSwingSectors(mod, dir, x_mm, y_mm);
  if (!mine.length) return false;
  for (const q of placed) {
    if (q.kind === 'foundation') continue; // derived 3D-only object — no module/ports
    const theirs = doorSwingSectors(q.mod, q.dir, q.x_mm, q.y_mm);
    for (const s1 of mine)
      for (const s2 of theirs)
        if (sectorsOverlap(s1, s2)) return true;
  }
  return false;
}

// Reject a proposed interior wall only when a PARALLEL interior wall is within
// the spacing on the CROSS axis AND their runs overlap on the ALONG axis. Two
// colinear end-to-end walls share a line (cross gap ~0) but have ~zero along
// overlap → allowed. (Mirrors iwallTooCloseToExteriorParallel; the old version
// measured the along axis, wrongly rejecting end-to-end joins.)
function iwallTooCloseToExisting(x_mm, y_mm, mod, dir) {
  const isH = isHorizontal(dir);
  const bb = getModuleBBox(mod, dir);
  const aStart = isH ? x_mm : y_mm, aEnd = aStart + (isH ? bb.w : bb.h);
  for (const q of placed) {
    if (q.kind === 'foundation') continue; // derived 3D-only object — no module/ports
    if (!q.mod.interior) continue;
    if (isHorizontal(q.dir) !== isH) continue; // only check parallel interior walls
    const gap = isH ? Math.abs(y_mm - q.y_mm) : Math.abs(x_mm - q.x_mm); // cross-axis gap
    if (gap >= MIN_IWALL_SPACING_MM) continue;
    const qbb = getModuleBBox(q.mod, q.dir);
    const qStart = isH ? q.x_mm : q.y_mm, qEnd = qStart + (isH ? qbb.w : qbb.h);
    if (Math.min(aEnd, qEnd) - Math.max(aStart, qStart) > 0) return true; // along-axis spans overlap
  }
  return false;
}

// Interior walls may not run parallel to and very close to an exterior wall.
function iwallTooCloseToExteriorParallel(x_mm, y_mm, mod, dir) {
  const isH = isHorizontal(dir);
  const bb = getModuleBBox(mod, dir);
  const aStart = isH ? x_mm : y_mm, aEnd = aStart + (isH ? bb.w : bb.h);
  for (const q of placed) {
    if (q.kind === 'foundation') continue; // derived 3D-only object — no module/ports
    if (q.mod.interior) continue;               // exterior walls only
    if (isHorizontal(q.dir) !== isH) continue;  // parallel runs only
    const qbb = getModuleBBox(q.mod, q.dir);
    const dist = isH ? Math.abs(y_mm - q.y_mm) : Math.abs(x_mm - q.x_mm);
    if (dist >= MIN_IWALL_TO_EXT_PARALLEL_MM) continue;
    const qStart = isH ? q.x_mm : q.y_mm, qEnd = qStart + (isH ? qbb.w : qbb.h);
    if (Math.min(aEnd, qEnd) - Math.max(aStart, qStart) > 0) return true; // spans overlap
  }
  return false;
}

// Valid bolt points on an exterior aperture (window/door) module: only the
// panel edges shared with an adjacent exterior module — the seam between two
// modules, where double king studs give a real bolting surface. Never the
// opening. Returns along-axis positions (global) of valid seams.
function apertureSeamContacts(p) {
  if (!p.mod.aperture) return [];
  const isH = isHorizontal(p.dir);
  const W = p.mod.width_mm;
  const edges = isH ? [p.x_mm, p.x_mm + W] : [p.y_mm, p.y_mm + W];
  const faceLine = isH ? p.y_mm : p.x_mm;
  const TOL = 2;
  const valid = [];
  for (const edge of edges) {
    for (const q of placed) {
      if (q.kind === 'foundation') continue; // derived 3D-only object — no module/ports
      if (q === p || q.mod.interior) continue;
      if (isHorizontal(q.dir) !== isH) continue;           // same run orientation
      const qLine = isH ? q.y_mm : q.x_mm;
      if (Math.abs(qLine - faceLine) > p.mod.depth_mm) continue; // same wall line
      const qStart = isH ? q.x_mm : q.y_mm, qEnd = qStart + q.mod.width_mm;
      if (Math.abs(qStart - edge) < TOL || Math.abs(qEnd - edge) < TOL) {
        valid.push(edge);
        break;
      }
    }
  }
  return valid;
}

function nearestApertureSeam(p, cursorAlong) {
  let best = null, bd = Infinity;
  for (const s of apertureSeamContacts(p)) {
    const d = Math.abs(cursorAlong - s);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function findTJunctionSnap(cursorX_mm, cursorY_mm, mod, dir) {
  if (placed.length === 0) return null;
  const dragIsH = isHorizontal(dir);
  const bb = getModuleBBox(mod, dir);
  // Selection metric is the EFFECTIVE cursor→contact-point distance (px): an
  // interior target gets TIE_PX shaved off so that when an interior and an
  // exterior target are both in reach and within TIE_PX of each other, the
  // interior wall wins. The raw contact distance still gates the capture range.
  const TIE_PX = SNAP_DIST_PX;
  let bestDist = Infinity;
  let bestSnap = null;

  for (const p of placed) {
    if (p.kind === 'foundation') continue; // derived 3D-only object — no module/ports
    if (p.level !== doc.activeLevel) continue; // never T-junction across levels
    const pIsH = isHorizontal(p.dir);
    if (dragIsH === pIsH) continue;

    const face = getInteriorFace(p);

    if (face.axis === 'x') {
      // Target runs horizontal, drag runs vertical
      const faceY = face.y1;
      let contactX;

      if (p.mod.aperture) {
        // Aperture: only the seam between two modules; no opening, no T mode.
        contactX = nearestApertureSeam(p, cursorX_mm);
        if (contactX === null) continue;
      } else if (ui.blockingMode === 'T') {
        // Snap to midpoint between studs
        const midpoints = getStudMidpointsGlobal(p);
        let bestMid = null, bestMidDist = Infinity;
        for (const mp of midpoints) {
          const d = Math.abs(cursorX_mm - mp.along);
          if (d < bestMidDist) { bestMidDist = d; bestMid = mp; }
        }
        if (!bestMid) continue;
        contactX = bestMid.along;
      } else {
        // C mode: free placement, clamp to face
        contactX = Math.max(face.x1, Math.min(face.x2, cursorX_mm));
      }

      if (contactX < face.x1 || contactX > face.x2) continue;
      if (nearACorner(p, contactX)) continue;                       // keep clear of corners
      if (interiorContactTooClose(contactX, faceY, 'x')) continue;  // 48" between interior walls

      const snapX = contactX - bb.w / 2;
      const snapY = (p.dir === 'north') ? faceY : faceY - bb.h;
      if (apertureSwingConflicts(mod, dir, snapX, snapY)) continue; // door swing would hit a placed door

      // Distance from the cursor to the CONTACT POINT on the target's face — so
      // hovering near a wall snaps to the wall you're hovering near.
      const contactDist = Math.hypot(mmToPx(contactX - cursorX_mm), mmToPx(faceY - cursorY_mm));
      const eff = contactDist - (p.mod.interior ? TIE_PX : 0);
      if (contactDist < SNAP_DIST_PX * 4 && eff < bestDist && !wouldOverlap(snapX, snapY, bb, mod, dir)) {
        bestDist = eff;
        let blocking;
        if (ui.blockingMode === 'T' && !p.mod.aperture) {
          blocking = 'T';
        } else {
          blocking = getBlockingTypeC(contactX, p);
        }
        bestSnap = { x_mm: snapX, y_mm: snapY, connection: {
          target_id: p.id, blocking, contact_x_mm: contactX, contact_y_mm: faceY
        }};
      }
    } else {
      // Target runs vertical, drag runs horizontal
      const faceX = face.x1;
      let contactY;

      if (p.mod.aperture) {
        contactY = nearestApertureSeam(p, cursorY_mm);
        if (contactY === null) continue;
      } else if (ui.blockingMode === 'T') {
        const midpoints = getStudMidpointsGlobal(p);
        let bestMid = null, bestMidDist = Infinity;
        for (const mp of midpoints) {
          const d = Math.abs(cursorY_mm - mp.along);
          if (d < bestMidDist) { bestMidDist = d; bestMid = mp; }
        }
        if (!bestMid) continue;
        contactY = bestMid.along;
      } else {
        contactY = Math.max(face.y1, Math.min(face.y2, cursorY_mm));
      }

      if (contactY < face.y1 || contactY > face.y2) continue;
      if (nearACorner(p, contactY)) continue;                       // keep clear of corners
      if (interiorContactTooClose(faceX, contactY, 'y')) continue;  // 48" between interior walls

      const snapY = contactY - bb.h / 2;
      const snapX = (p.dir === 'east') ? faceX - bb.w : faceX;
      if (apertureSwingConflicts(mod, dir, snapX, snapY)) continue; // door swing would hit a placed door

      // Distance from the cursor to the CONTACT POINT on the target's face.
      const contactDist = Math.hypot(mmToPx(faceX - cursorX_mm), mmToPx(contactY - cursorY_mm));
      const eff = contactDist - (p.mod.interior ? TIE_PX : 0);
      if (contactDist < SNAP_DIST_PX * 4 && eff < bestDist && !wouldOverlap(snapX, snapY, bb, mod, dir)) {
        bestDist = eff;
        let blocking;
        if (ui.blockingMode === 'T' && !p.mod.aperture) {
          blocking = 'T';
        } else {
          blocking = getBlockingTypeC(contactY, p);
        }
        bestSnap = { x_mm: snapX, y_mm: snapY, connection: {
          target_id: p.id, blocking, contact_x_mm: faceX, contact_y_mm: contactY
        }};
      }
    }
  }
  return bestSnap;
}
