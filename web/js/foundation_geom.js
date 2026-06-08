// =====================================================
// FOUNDATION GEOM — PURE shared foundation derivation.
//
// No THREE, no DOM, no doc globals. The single source of truth for foundation
// geometry, consumed by BOTH the 3D preview (render3d.js) and the FreeCAD
// exporter (fcstd.js). The terminal compiler mirrors this exactly in Python
// (foundation_lib.py), kept honest by the golden parity test
// (tests/foundation_parity.mjs).
//
// foundationSolids(params, silhouette) -> [ piece, … ]
//   params     = { slab_thickness_mm, beam_w_mm, beam_d_mm,
//                  skirt_depth_mm, skirt_thickness_mm }
//   silhouette = { rects, walls, containsPoint, cell_mm? }
//     rects   — the L1 filled-silhouette per-ROW strips (region.rects). Greedy-
//               merged here into MAXIMAL rectangles → the monolithic slab.
//     walls   — L1 kind:'wall' entities { id, x_mm, y_mm, mod, dir }. Grouped
//               into RUNS (a run = one full exterior side); each run gets ONE
//               grade beam + ONE continuous frost skirt.
//     containsPoint(x,y) — region probe used to find each run's OUTSIDE face.
//
//   piece = { group:'foundation', kind:'slab'|'beam'|'skirt', label,
//             dims:{dx_mm,dy_mm,dz_mm}, center:{x_mm,y_mm,z_mm} }
//
// Pieces:
//   slab_NN   — monolithic poured slab. The silhouette covered by the minimal
//               set of maximal rectangles (rectangle house → 1; L → 2–3). NOT a
//               bbox, NOT per-row strips.
//   beam_<L>  — one grade beam per run <L> (run letter), spanning the run's full
//               length, beam_w across, beam_d deep, top at z=0.
//   skirt_<L> — one continuous frost skirt per run on its OUTSIDE face,
//               corner-extended so the FPSF loop is gapless (see SKIRT below).
//
// World plan mm; z-DOWN convention: the top of the slab is the ground datum
// z=0, so every piece extrudes downward and its center z is negative (matches
// render3d's scene). Consumers apply their own origin offset / Y-mirror.
// =====================================================
import { getModuleBBox, isHorizontal } from './geometry.js';

// 3" region cell, kept in sync with region.js REGION_CELL_MM. Only used as a
// fallback for the outside-face probe distance if the caller omits cell_mm.
const DEFAULT_CELL_MM = 3 * 25.4;

const MERGE_TOL = 1e-6; // mm — strip x/w/edge equality (both sides exact arithmetic)
const RUN_TOL = 2;      // mm — end-to-end contiguity gap along a run
const RUN_BAND = 60;    // mm — same-line cross-axis clustering (mirrors runs.js)

// SLAB — greedy-merge the per-row fill strips into MAXIMAL rectangles.
// region.rects are 1-cell-tall (~3") strips, sorted row-by-row (ascending y),
// within a row ascending x. Merge a strip into an open rect when they share
// x_mm + w_mm and the open rect's bottom edge meets the strip's top edge — i.e.
// stack vertically-adjacent equal-width strips into one taller box. A gap (or a
// width change) starts a fresh rect. Result: the minimal rectangle set covering
// the silhouette. Rectangle house → 1 box; L → 2–3.
function mergeSlabRects(rects) {
  const open = [];
  for (const s of rects) {
    let host = null;
    for (const o of open) {
      if (Math.abs(o.x_mm - s.x_mm) < MERGE_TOL &&
          Math.abs(o.w_mm - s.w_mm) < MERGE_TOL &&
          Math.abs((o.y_mm + o.h_mm) - s.y_mm) < MERGE_TOL) { host = o; break; }
    }
    if (host) host.h_mm += s.h_mm;
    else open.push({ x_mm: s.x_mm, y_mm: s.y_mm, w_mm: s.w_mm, h_mm: s.h_mm });
  }
  return open;
}

// RUNS — group the exterior walls into runs (one run = one full side), the same
// way runs.js detectRunsForLevel does but geometry-only (no design registry):
// cluster collinear walls (same orientation + cross band), split each cluster
// into end-to-end contiguous chains, then order top-to-bottom (near cross),
// ties left-to-right, and letter A,B,C… by that order. Foundation is single-
// level (L1), so the letters match computeRuns' L1 letters.
//
// Each run carries: horiz, letter, nearCross (the wall line's near edge), depth
// (perpendicular footprint dim), aMin/aMax (along-axis extent of the chain).
export function computeFoundationRuns(walls) {
  const feats = walls.map(w => {
    const bb = getModuleBBox(w.mod, w.dir);
    const horiz = isHorizontal(w.dir);
    const x0 = w.x_mm, y0 = w.y_mm, x1 = x0 + bb.w, y1 = y0 + bb.h;
    return {
      horiz,
      depth: horiz ? bb.h : bb.w,          // perpendicular footprint dim
      cross: horiz ? y0 : x0,              // near edge of the wall line
      a0: horiz ? x0 : y0,                 // start along the run axis
      a1: horiz ? x1 : y1,                 // end along the run axis
    };
  });

  // 1. cluster into collinear lines (same orientation + cross band)
  const lines = [];
  for (const ft of feats) {
    let line = lines.find(L => L.horiz === ft.horiz && Math.abs(L.cross - ft.cross) <= RUN_BAND);
    if (!line) { line = { horiz: ft.horiz, cross: ft.cross, items: [] }; lines.push(line); }
    line.items.push(ft);
  }

  // 2. within each line, sort along the axis and split into contiguous chains
  const runs = [];
  for (const L of lines) {
    L.items.sort((a, b) => a.a0 - b.a0);
    let chain = [], end = null;
    const flush = () => {
      if (!chain.length) return;
      runs.push({
        horiz: L.horiz,
        nearCross: Math.min(...chain.map(c => c.cross)),
        depth: chain[0].depth,
        aMin: Math.min(...chain.map(c => c.a0)),
        aMax: Math.max(...chain.map(c => c.a1)),
      });
      chain = [];
    };
    for (const ft of L.items) {
      if (chain.length && ft.a0 - end > RUN_TOL) flush();
      chain.push(ft);
      end = end === null ? ft.a1 : Math.max(end, ft.a1);
    }
    flush();
  }

  // 3. deterministic order: top-to-bottom (footprint minY), ties left-to-right
  //    (minX) — same key as runs.js — then letter A,B,C… by that order (matches
  //    computeRuns for L1). minX/minY = the chain's footprint corner.
  const minX = r => (r.horiz ? r.aMin : r.nearCross);
  const minY = r => (r.horiz ? r.nearCross : r.aMin);
  runs.sort((a, b) => minY(a) - minY(b) || minX(a) - minX(b));
  runs.forEach((r, i) => { r.letter = String.fromCharCode(65 + i); });
  return runs;
}

// Classify one end of run r: return (P.depth + skirtT) if SUBMISSIVE (a perpendicular
// run P butts r at that end), or 0 if DOMINANT (r reaches the building corner there).
// aEndVal: the along-axis coordinate of the end being tested (r.aMin or r.aMax).
//
// SUBMISSIVE: perp run P satisfies BOTH
//   (a) r's cross band [r.nearCross, r.nearCross+r.depth] ⊆ [P.aMin, P.aMax]
//       (P's wall line crosses r's line — P spans r's full depth)
//   (b) P's cross band [P.nearCross, P.nearCross+P.depth] contains aEndVal
//       (P's footprint sits at r's end — r terminates at P's inner face)
// DOMINANT: no such P → r reaches the building corner; the submissive perp skirt bridges it.
export function skirtEndExt(r, aEndVal, allRuns, skirtT) {
  for (const p of allRuns) {
    if (p.horiz === r.horiz) continue;
    if (p.aMin > r.nearCross + RUN_TOL) continue;
    if (r.nearCross + r.depth > p.aMax + RUN_TOL) continue;
    if (p.nearCross - RUN_TOL > aEndVal) continue;
    if (aEndVal > p.nearCross + p.depth + RUN_TOL) continue;
    return p.depth + skirtT;
  }
  return 0;
}

export function foundationSolids(params, silhouette) {
  const slabT  = params.slab_thickness_mm;
  const beamW  = params.beam_w_mm;
  const beamD  = params.beam_d_mm;
  const skirtD = params.skirt_depth_mm;
  const skirtT = params.skirt_thickness_mm;

  const rects = silhouette.rects || [];
  const walls = silhouette.walls || [];
  const containsPoint = silhouette.containsPoint;
  const cell = silhouette.cell_mm || DEFAULT_CELL_MM;
  // Probe 2 cells past the near face. The region grid marks WALL for any cell
  // that overlaps a wall footprint, which over-marks by up to 1 full cell beyond
  // the real outer face. A ¾-cell probe can land in that over-mark band and read
  // as "not exterior" — flipping the skirt to the wrong face. 2 cells reliably
  // clears the ≤1-cell over-mark with margin; the probe still lands correctly
  // in the interior for inner-edge runs (farther than 2 cells from any exterior).
  const probe = cell * 2;

  const pieces = [];

  // SLAB — monolithic: maximal rectangles covering the silhouette.
  mergeSlabRects(rects).forEach((r, i) => {
    pieces.push({
      group: 'foundation', kind: 'slab',
      label: `slab_${String(i).padStart(2, '0')}`,
      dims: { dx_mm: r.w_mm, dy_mm: r.h_mm, dz_mm: slabT },
      center: { x_mm: r.x_mm + r.w_mm / 2, y_mm: r.y_mm + r.h_mm / 2, z_mm: -slabT / 2 },
    });
  });

  const runs = computeFoundationRuns(walls);

  // GRADE BEAM — one per run, spanning the run's full length, centered on the
  // wall line, beam_w across, beam_d deep, top at z=0.
  for (const r of runs) {
    const len = r.aMax - r.aMin;
    const axisC = (r.aMin + r.aMax) / 2;
    const lineC = r.nearCross + r.depth / 2; // wall centerline (cross axis)
    pieces.push({
      group: 'foundation', kind: 'beam', label: `beam_${r.letter}`,
      dims: { dx_mm: r.horiz ? len : beamW, dy_mm: r.horiz ? beamW : len, dz_mm: beamD },
      center: r.horiz ? { x_mm: axisC, y_mm: lineC, z_mm: -beamD / 2 }
                      : { x_mm: lineC, y_mm: axisC, z_mm: -beamD / 2 },
    });
  }

  // FROST SKIRT — one CONTINUOUS panel per run on its OUTSIDE face (the side
  // whose just-past-the-face probe is NOT inside the silhouette), skirt_thickness
  // thick, skirt_depth deep, top at z=0.
  //
  // CORNER-EXTENSION RULE (per-end): each run end is classified independently:
  //   SUBMISSIVE end — a perpendicular run P butts r there (P's footprint crosses
  //     r's wall line AND P's cross band contains the end coordinate). Extend by
  //     (P.depth + skirtT) to bridge across P and overlap P's outer skirt.
  //   DOMINANT end — r reaches the building corner; no perpendicular run butts it.
  //     Extend by 0; the adjacent submissive run's skirt bridges the corner.
  // Result: gapless FPSF loop with NO stub past any convex corner.
  for (const r of runs) {
    const origAxisC = (r.aMin + r.aMax) / 2;  // probe along wall midpoint
    const extAtMin = skirtEndExt(r, r.aMin, runs, skirtT);
    const extAtMax = skirtEndExt(r, r.aMax, runs, skirtT);
    const newAMin = r.aMin - extAtMin;
    const newAMax = r.aMax + extAtMax;
    const grown = newAMax - newAMin;
    const skirtAxisC = (newAMin + newAMax) / 2;
    const farCross = r.nearCross + r.depth;
    if (r.horiz) {
      const nearOut = !containsPoint(origAxisC, r.nearCross - probe);
      const fy = nearOut ? r.nearCross - skirtT / 2 : farCross + skirtT / 2;
      pieces.push({
        group: 'foundation', kind: 'skirt', label: `skirt_${r.letter}`,
        dims: { dx_mm: grown, dy_mm: skirtT, dz_mm: skirtD },
        center: { x_mm: skirtAxisC, y_mm: fy, z_mm: -skirtD / 2 },
      });
    } else {
      const nearOut = !containsPoint(r.nearCross - probe, origAxisC);
      const fx = nearOut ? r.nearCross - skirtT / 2 : farCross + skirtT / 2;
      pieces.push({
        group: 'foundation', kind: 'skirt', label: `skirt_${r.letter}`,
        dims: { dx_mm: skirtT, dy_mm: grown, dz_mm: skirtD },
        center: { x_mm: fx, y_mm: skirtAxisC, z_mm: -skirtD / 2 },
      });
    }
  }

  return pieces;
}
