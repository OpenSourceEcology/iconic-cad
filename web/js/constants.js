// =====================================================
// CONSTANTS + MODULE DEFINITIONS
// Shared, dependency-free. Imported by every other module.
// =====================================================
export const IN_TO_MM = 25.4;
export const WALL_DEPTH = (5.5 + 0.4375) * IN_TO_MM; // 150.8125mm (2x6 + OSB)
export const IWALL_DEPTH = 3.5 * IN_TO_MM;            // 88.9mm — 2x4 stud, no OSB

export const MODULES = [
  { id: 'wall_4x8_2x6_16oc', label: '4x8 16OC', width_mm: 4 * 12 * IN_TO_MM, depth_mm: WALL_DEPTH },
  { id: 'wall_4x8_2x6_24oc', label: '4x8 24OC', width_mm: 4 * 12 * IN_TO_MM, depth_mm: WALL_DEPTH },
  { id: 'wall_3x8.5_2x6_16oc', label: '3x8.5 16OC', width_mm: 3 * 12 * IN_TO_MM, depth_mm: WALL_DEPTH },
];

export const INTERIOR_MODULES = [
  { id: 'iwall_4x8_2x4_16oc', label: '4x8 16OC', width_mm: 4 * 12 * IN_TO_MM, depth_mm: IWALL_DEPTH, interior: true },
  { id: 'iwall_4x8_2x4_24oc', label: '4x8 24OC', width_mm: 4 * 12 * IN_TO_MM, depth_mm: IWALL_DEPTH, interior: true },
  { id: 'iwall_3x8.5_2x4_single', label: '3x8.5 1S', width_mm: 3 * 12 * IN_TO_MM, depth_mm: IWALL_DEPTH, interior: true },
];

// Aperture modules (windows + doors). A door is a window taken to the floor:
// the `aperture` block (inches) drives the plan silhouette, 3D framing, and BOM.
// Sill_in = 0 means the opening runs to the floor (door). These snap exactly
// like a plain 48" wall panel. See docs/aperture_framing_reference.md.
export const APERTURE_MODULES = [
  { id: 'window_4x8_2x6_36x48', label: 'Window 36x48 (8\')', width_mm: 4 * 12 * IN_TO_MM, depth_mm: WALL_DEPTH,
    aperture: { type: 'window', ro_w_in: 36, ro_h_in: 48, sill_in: 24, oc: 16, header_nominal: '2x8', header_plies: 2 } },
  { id: 'window_4x9_2x6_36x48', label: 'Window 36x48 (9\')', width_mm: 4 * 12 * IN_TO_MM, depth_mm: WALL_DEPTH,
    aperture: { type: 'window', ro_w_in: 36, ro_h_in: 48, sill_in: 24, oc: 16, header_nominal: '2x8', header_plies: 2, height_ft: 9 } },
  { id: 'window_4x10_2x6_36x48', label: 'Window 36x48 (10\')', width_mm: 4 * 12 * IN_TO_MM, depth_mm: WALL_DEPTH,
    aperture: { type: 'window', ro_w_in: 36, ro_h_in: 48, sill_in: 24, oc: 16, header_nominal: '2x8', header_plies: 2, height_ft: 10 } },
  { id: 'door_4x8_2x6_38x83', label: 'Door (in)', width_mm: 4 * 12 * IN_TO_MM, depth_mm: WALL_DEPTH,
    aperture: { type: 'door', ro_w_in: 38, ro_h_in: 83, sill_in: 0, oc: 16, header_nominal: '2x8', header_plies: 2, swing: 'in' } },
  { id: 'door_out_4x8_2x6_38x83', label: 'Door (out)', width_mm: 4 * 12 * IN_TO_MM, depth_mm: WALL_DEPTH,
    aperture: { type: 'door', ro_w_in: 38, ro_h_in: 83, sill_in: 0, oc: 16, header_nominal: '2x8', header_plies: 2, swing: 'out' } },
  { id: 'double_door_8x8_2x6_72x83', label: 'Double Door', width_mm: 8 * 12 * IN_TO_MM, depth_mm: WALL_DEPTH,
    aperture: { type: 'double_door', ro_w_in: 72, ro_h_in: 83, sill_in: 0, oc: 16, header_nominal: '2x12', header_plies: 2, swing: 'in' } },
  { id: 'sliding_8x8_2x6_72x80', label: 'Sliding Door', width_mm: 8 * 12 * IN_TO_MM, depth_mm: WALL_DEPTH,
    aperture: { type: 'sliding', ro_w_in: 72, ro_h_in: 80, sill_in: 0, oc: 16, header_nominal: '2x12', header_plies: 2 } },
  { id: 'garage_9x8_2x6_96x84', label: 'Garage Door', width_mm: 9 * 12 * IN_TO_MM, depth_mm: WALL_DEPTH,
    aperture: { type: 'garage', ro_w_in: 96, ro_h_in: 84, sill_in: 0, oc: 16, header_nominal: '2x12', header_plies: 2 } },
];

export const INT_APERTURE_MODULES = [
  { id: 'idoor_4x8_2x4_38x83', label: 'Int Door 38x83', width_mm: 4 * 12 * IN_TO_MM, depth_mm: IWALL_DEPTH, interior: true,
    aperture: { type: 'door', ro_w_in: 38, ro_h_in: 83, sill_in: 0, oc: 16, header_nominal: '2x4', header_plies: 1 } },
];

export const ALL_MODULES = [...MODULES, ...INTERIOR_MODULES, ...APERTURE_MODULES, ...INT_APERTURE_MODULES];

export const DIRECTIONS = ['north', 'south', 'east', 'west'];
export const ROTATE_CW = { north: 'east', east: 'south', south: 'west', west: 'north' };

// NESW selector colours (N red, E yellow, S green, W blue)
export const DIR_COLORS = { north: '#e53935', east: '#fdd835', south: '#43a047', west: '#4fc3f7' };

// Zoom (PX_PER_MM)
export const ZOOM_DEFAULT = 0.15; // 4ft wall ≈ 183px
export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 0.5;
export const ZOOM_STEP = 1.1;

// Snap
export const SNAP_DIST_PX = 25;

// Interior-wall placement keep-outs
export const MIN_IWALL_SPACING_MM = 12 * IN_TO_MM;          // min cross-axis gap between parallel interior walls
export const CORNER_KEEPOUT_MM = 6 * IN_TO_MM;              // keep interior-wall contacts ~6" off a building corner (framing to bolt to)
export const MIN_IWALL_TO_EXT_PARALLEL_MM = 12 * IN_TO_MM;  // interior wall parallel-to-exterior keep-out

// Plan-symbol colours
export const APERTURE_GAP = '#0d1322'; // "floor" shown through an opening

// 3D lumber dimensions
export const STUD_THICK = 1.5 * IN_TO_MM;
export const STUD_DEPTH = 5.5 * IN_TO_MM;
export const OSB_THICK = 0.4375 * IN_TO_MM;
export const LUMBER_DEPTH = {
  '2x4': 3.5 * IN_TO_MM, '2x6': 5.5 * IN_TO_MM, '2x8': 7.25 * IN_TO_MM,
  '2x10': 9.25 * IN_TO_MM, '2x12': 11.25 * IN_TO_MM,
};
