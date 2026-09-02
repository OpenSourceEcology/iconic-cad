# OSB multi-sheet tiling policy — proposal, not a code change

**Status: proposal document.** This transcribes the OSE wiki's *"Wall Module
Specification"* page's OSB panelization rules and evaluates what adopting
them would mean for Iconic CAD's current sheathing code. It does not alter
`enumerateMembers()`, `seh_lib/wall_builder.py`, or any other enumerator.
Nothing here is wired up.

**Source.** OSE wiki page *"Wall Module Specification"*
(`page-extracts/Wall_Module_Specification.txt` in the wiki-scan archive,
`https://chatgpt.com/share/69707955-7ca4-8010-850a-ca6cef5201ee` per the
page's own header). The page states plainly: "This is a geometry compiler
spec, not a structural engineering standard" — it is an independent prototype
write-up, not a page describing this repo, and its constants (e.g. a flat
`2x12` header vs. this repo's variable header nominal per module) are known
to diverge from the actual `seh_lib` implementation. Treat as a design
reference to reconcile against, not a drop-in source (per
`wiki-candidates.md` #5).

## The wiki's panelization rules, transcribed

### Coordinate convention (for context)
`X` = module width (left→right), `Y` = wall thickness (Face A at `y=0`, the
sheathing face), `Z` = height (bottom at `z=0`). OSB is placed on Face A at
`y = -OSB_thickness..0`.

### Height sourcing policy (Step 5 of the page's compiler pipeline)

> - If `module.height_in <= 108"`: use a single 9' sheet (cut to height)
> - Else if `module.height_in <= 120"`: use a single 10' sheet (cut to height)
> - Else: use 8' sheet + remainder pieces to reach full height

i.e. sheet *height* is chosen per module, buying the shortest sheet that
covers the wall in one piece; only walls taller than 10' (120") need a
second, stacked piece.

### Width policy (v0)

> - If width <= 48": one panel (rip to width)
> - If width <= 96": two panels (48" + remainder)
> - If width > 96": tile in 48" increments + remainder

"The panelizer outputs a list of rectangles `{w,h,x,z}` which become OSB
solids."

### Deterministic part-naming scheme

Every generated part — framing and sheathing alike — gets a stable name for
downstream drawing/BOM automation. The page's examples: `TP_0`, `BP_0`,
`STUD_03`, `W1_JACK_L`, `D1_HEADER_2PLY_2X12`, `OSB_00`. The rule (from the
page's "Determinism Rules" section): "Stable naming conventions for every
generated part... Same spec input must produce identical part counts,
placements, and names." For OSB specifically this implies a per-module,
zero-padded sequential index (`OSB_00`, `OSB_01`, ...) assigned in a fixed
scan order (the page doesn't specify the order explicitly — left-to-right,
bottom-to-top is the natural reading of its `{w,h,x,z}` rectangle list).

## Fit against Iconic CAD

Iconic CAD has **three current sheathing states**, and CAD-AUD-005
(`design_decisions.md` §6, "Still NOT single-sourced: OSB sheathing") is the
divergence between two of them. This section states concretely how each
would change if the wiki's tiling policy were adopted.

### State 1 — plain wall, JS (`enumerateWall`, `web/js/members.js:96-100`)

Today: one `sheathing` member, a single rectangle spanning the full panel
(`member('sheathing', 'OSB', 0, 0, W, H)`), regardless of module size. Every
current plain-wall module (`wall_4x8_2x6_16oc`, `wall_4x8_2x6_24oc`,
`wall_3x8.5_2x6_16oc` — widths 36-48", heights 96-102" per
`web/data/systems/seh.json`) is narrow enough (≤48") that a real 4x8, 4x9, or
4x10 sheet already covers it in one piece, so the current single-rectangle
member happens to be dimensionally correct for every module that exists
today — but that is incidental (nothing checks it), not policy.

**If adopted:** `enumerateWall` would need to run the width/height rule
against `W`/`H` even for the no-opening case, and emit *one member per tile*
instead of always emitting exactly one. For today's modules the output count
would not change (all still resolve to 1 tile), but the code path would stop
being "always 1" and start being "1, computed" — the first place a future
wider plain-wall module (there is none today) would tile correctly instead
of silently emitting one oversized rectangle.

### State 2 — aperture wall, JS (`enumerateAperture`, `web/js/members.js:170-176`)

Today: sheathing is split into up to 4 rectangular strips around the rough
opening — left-of-opening, right-of-opening, above-header, below-sill (only
if `roZ0 > 0`, i.e. a window, not a door) — each strip spanning the module's
full height or the RO's width with **no further tiling to real sheet size**.
For the two 96"-wide aperture modules (`double_door_8x8_2x6_72x83`,
`sliding_8x8_2x6_72x80`) and the 108"-wide `garage_9x8_2x6_96x84`, the
left/right strips can themselves exceed 48" — e.g. `garage_9x8`'s RO is 96"
wide in a 108" module, so the two side strips are 6" each (fine), but a
narrower opening in a wide module would produce a strip wider than any real
sheet.

**If adopted:** each of the up to 4 regions would become a *tiling pass*
(apply the width/height rule to that region's own `w`/`h`) rather than one
member. Concretely this replaces the current up-to-4-strip output with a
variable-count list of tiles, e.g. a `double_door` module's left strip (12"
wide × 96" tall on a 72"-wide RO in a 96"-wide module, well under 48") would
still be 1 tile, but a hypothetical wide window in an even wider wall could
now correctly produce 2+ tiles for a single strip. This is strictly additive
complexity: today's per-opening-side single-rectangle strips become
per-opening-side tile *lists*.

### State 3 — Python/FreeCAD (`seh_lib/wall_builder.py:290-322`, aperture case)

Today: **one** full-size `Part.makeBox(W, osb, H)` — i.e. a solid the exact
width and height of the wall, which for any wall wider than 48" is not a
shape any real OSB sheet comes in — with the rough-opening hole boolean-cut
out of it (`osb_panel.cut(hole)`). The plain-wall case
(`wall_builder.py:271-272`) does the same single-box construction with no
cut. This is the documented CAD-AUD-005 divergence from State 2: JS already
splits sheathing around an opening into strips; Python still treats the
whole face as one (oversized, for wide walls) sheet with a hole.

**If adopted:** this is the change the wiki page is explicitly offered as "a
ready-made candidate resolution" for (`wiki-candidates.md` #5). Python would
tile the wall face the same way JS would (State 1/2's rule), then for each
resulting tile, boolean-intersect it against the RO rectangle and only cut a
hole from the tile(s) that actually overlap the opening — most tiles on a
wide module would need no cut at all. Adopting the policy on *both* sides
resolves CAD-AUD-005 by construction, because both implementations would be
driven by the same tiling function rather than one splitting by opening
geometry and the other subtracting a hole from an oversized single sheet.

## Schema fields this would need

None of these exist today; adopting the policy is new work, not a
reinterpretation of existing fields.

1. **A tiling-policy config** — the height tiers (`≤108"→9' sheet`,
   `≤120"→10' sheet`, `>120"→8'+remainder`) and the width rule (`≤48"→1`,
   `≤96"→2`, `>96"→48" increments+remainder`) need to live somewhere
   `enumerateMembers()` can read, analogous to `STOCK_LENGTHS` in
   `web/js/bom.js` today.
2. **New sheet SKUs in `pricing.json`.** The catalog only has
   `osb_7_16_4x8` (a 4'×8' sheet). Buying "the shortest sheet that covers
   the wall in one piece" per the wiki rule needs `osb_7_16_4x9` and
   `osb_7_16_4x10` entries too (today, taller walls are implicitly assumed
   to be built from 4x8 stock plus the hand-authored `osb_sheets` count in
   `pricing.json.module_specs` — see below).
3. **A `name`/label field on the member record.** `member()` in
   `web/js/members.js` (line ~44) currently has no naming field at all —
   `role`/`nominal`/coordinates only. The wiki's deterministic naming
   (`OSB_00`, `OSB_01`, ...) would need a new field, assigned in a fixed
   scan order, to support the fab-drawing/BOM automation the wiki page
   calls out as the point of naming parts at all.
4. **A reconciliation with the existing hand-authored `osb_sheets` count.**
   `bom.js`'s `lineItemsForEntity()` currently **skips** `sheathing` members
   entirely (`if (m.role === 'sheathing') continue;`) and instead prices OSB
   from `pricing.json.module_specs[mod.id].osb_sheets` — a hand-authored
   integer per module, flagged in `design_decisions.md` §6 as "a related
   known gap... `pricing.json`'s member counts are still hand-authored, not
   derived from geometry." Adopting real tiling would let the sheet count
   finally be *derived* (count of tiles per module) instead of hand-entered,
   which is a second, separate piece of follow-up work beyond the
   enumerator change itself.

## What this proposal does not do

It does not change `enumerateMembers()`, `wall_builder.py`, `bom.js`, or
`pricing.json`'s sheet SKUs. It does not pick which of State 1/2/3 to build
first. It is scoped to answering "what would adopting this wiki page's rule
concretely require," for whoever picks up CAD-AUD-005 next.
