# Aperture Framing Reference (windows + doors)

Measured directly from OSE Seed-Home FreeCAD source files with `freecadcmd`,
cross-referenced against the wiki window-framing diagram. This is the ground
truth the generator encodes — recorded here so the numbers are versioned and
nobody has to re-measure.

## Design key

A door is a window taken to the floor. Same header / king-stud / jack-stud
logic; the window just adds a **sill** and **lower cripples** below the opening.
The wiki lists 5 wall types — wall, window, door, double door, sliding door —
all 48"-wide wall panels that snap exactly like a plain wall module. So an
aperture is one parametric object, not two.

### Authoritative framing checklist (Marcin / OSE, wiki Windows slide — updated)

Additional spec items added in the latest revision:
- **Module heights 8', 9', 10'** — all three are valid window module heights. 36×48 RO in all.
- **Precut studs** are 3/8" shorter than full-length (e.g., 92-5/8" for an 8' wall). The generator
  currently uses theoretical dimensions (full-length equivalent). A `use_precut: bool` param can be
  added later if exact stud lists are needed.
- **Subheader** — a horizontal 2x nailer at the bottom of the lower cripple zone (just above the
  sole plate), provides a required fastening surface for sheathing/trim.
- **Horizontal blocking every 24"** from the subheader upward through the lower cripple zone.
  If the zone is <24" tall (standard 8' window with 24" sill = 21" lower zone), only the subheader
  appears — correct, no room for intermediate blocks.
- **Single vs double jack studs** — determined by header span table. Single is fine for ≤30" span;
  our 36" RO uses double jacks (already in the generator). See Header Span Table for larger spans.

### Authoritative framing checklist (Marcin / OSE, wiki Windows slide)

1. Use 4'-wide modules whenever possible.
2. Window has a **header directly above the rough opening** (on the jack studs).
3. **Cripples are above the header** (header → double top plate).
4. Use a **double top plate**.
5. **Ignore advanced framing** (OVE / minimized headers) — it requires extra
   explanation to code officials. Use conventional platform framing.

Load path (why): top plate → top cripples → header → jack studs → king studs →
bottom plate → foundation. The header is a span-replacing beam at the opening,
NOT a top-plate support — so it sits at the RO top, cripples fill above it.

Sources:
- `Seh2 8ft interior door.fcstd` — clean, named members (interior 2x4 door).
- `Doorwindow.fcstd` — "Door and window module for adjustment" (2x6 master,
  window + door variants; geometry overlaps, used for pattern not exact dims).
- Wiki "Windows" page framing diagram + Iconic CAD Protocol PDF p28.

## Verified hard numbers

| Quantity | Value | Source |
|---|---|---|
| Module width (standard) | 48" | PDF p22/p28 |
| Interior door rough opening | **38" W × 83" H** | measured `Seh2 8ft interior door` |
| Window sill height (top of sill) | **≥ 24"** from floor | wiki Windows page |
| Example window size | 36" × 48" | wiki Windows page |
| Exterior stud lumber | 2x6 (5.5" deep) + 7/16" OSB | repo wall spec |
| Interior stud lumber | 2x4 (3.5" deep), no OSB | repo wall spec |

## Interior 2x4 door — exact measured layout

48" wide panel, 95.62" tall. Coordinates: X across width, Z vertical.

| Member | Size (W×D×H, in) | X origin | Z origin | Role |
|---|---|---|---|---|
| Bottom_Plate | 5.00 × 3.5 × 1.5 | 0.00 | 0.00 | bottom plate stub (left) |
| Bottom_Plate001 | 5.00 × 3.5 × 1.5 | 43.00 | 0.00 | bottom plate stub (right) |
| Left_Stud (king) | 1.5 × 3.5 × 92.62 | 0.00 | 1.50 | end stud |
| Stud_2 | 1.5 × 3.5 × 92.63 | 3.55 | 1.50 | inner full-height stud (opening side) |
| Stud_005 | 1.5 × 3.5 × 92.63 | 43.00 | 1.50 | inner full-height stud (opening side) |
| Right_Stud (king) | 1.5 × 3.5 × 92.63 | 46.50 | 1.50 | end stud |
| Top_Plate001 (header) | 38.00 × 3.5 × 1.5 | 5.00 | 83.00 | flat 2x4 header over opening |
| Stud_004 (cripple) | 1.5 × 3.5 × 9.62 | 15.50 | 84.50 | cripple header→top plate |
| Stud_3 (cripple) | 1.5 × 3.5 × 9.62 | 31.00 | 84.50 | cripple header→top plate |
| Top_Plate | 48.00 × 3.5 × 1.5 | 0.00 | 94.13 | single top plate |

Notes:
- Bottom plate is **cut out** across the door opening (x = 5 → 43 = 38" open).
- Rough opening = **38 W × 83 H** (floor to header underside at z=83).
- Interior (non-bearing): header is a single flat 2x4, no separate jack studs —
  the inner full-height studs frame the opening, header nailed across, 2 cripples
  above. Single top plate (interior wall).

## Exterior 2x6 window/door — framing pattern (from `Doorwindow.fcstd` + wiki)

Structural opening. Members present in the 2x6 master, matching the wiki
window-framing diagram (top plate, top cripples, header, king stud, jack stud,
rough opening, sill, bottom cripples, sole plate):

- **King studs**: full-height each side of the opening.
- **Jack (trimmer) studs**: inside the kings, run from bottom plate to the
  header underside; they carry the header. (Master: ~42" tall around the
  opening for the measured instance.)
- **Header**: built-up horizontal over the opening, spanning king-to-king.
  Master uses a doubled 2x12 (11.25" tall, 2 plies). Header size scales with
  span; expose as a parameter.
- **Cripples above header**: short studs header→double-top-plate, at OC spacing.
- **Sill (window only)**: horizontal at the rough-opening bottom (master shows a
  doubled flat member). Door has no sill.
- **Lower cripples (window only)**: short studs sill→bottom-plate, at OC spacing.
- **Plates**: double top plate, single bottom plate (exterior). OSB 7/16 over
  the whole panel face (not cut for the opening in CAD — opening cut on install).

## Parametric model the generator encodes

One builder, driven by an `aperture` block on a wall instance:

```
aperture:
  type: window | door
  rough_opening_width_in:  <RO width>
  rough_opening_height_in: <RO height>
  sill_height_in:          <top-of-sill height; 0 / omitted for door>
  header_lumber_nominal:   "2x6" | "2x8" | "2x12" ...
  header_plies:            1 | 2
```

Derived geometry:
- Opening centered in the 48" panel (overridable later).
- King studs at panel-relative opening edges; jack studs inside, height =
  RO bottom → header underside (door: floor → header underside).
- Header sits directly on the jacks; top of RO = bottom of header.
- Cripples above header and (window) below sill at the wall's OC spacing,
  skipping any that collide with king/jack studs.
- Bottom plate cut out across a door opening; continuous under a window.
