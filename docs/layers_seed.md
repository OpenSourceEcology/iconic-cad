# Layers seed — 30 Master Layers (OSE wiki)

**Status: seed document, not enforced by code.** The layout schema's `layers`
array (`docs/layout_schema.md`: "Trade layers. Each has `id`, `name`, `color`,
`visible`.") is reserved but unpopulated — decision 5b in
`design_decisions.md` names framing as the authored source of truth with
other trades meant to derive from it, but the taxonomy of *which* trades
those are was never enumerated in this repo. The table below is the OSE wiki's
own answer to that question, transcribed as a starting point for whoever
populates `layers` for real. Nothing here changes behavior; it is reference
only.

**Source.** OSE wiki page *"Iconic CAD Housing Library"*
(`page-extracts/Iconic_CAD_Housing_Library.txt` in the wiki-scan archive,
§"30 Master Layers"). The wiki's own framing: "The 21 layers [elsewhere on
the page] reflect more of build order... the 30 layers here... reflect layers
more like the layers of an onion — the systems as opposed [to] their build
order. Thus [it] is useful for part accounting more than build process."
Order below matches the wiki's numbered list exactly.

**Mapping column key.** What each layer maps to in Iconic CAD *today*:
- **existing module family** — a placeable entity kind or member role already
  in the code.
- **`level`** — the schema's reserved `levels` array (story boundaries), not
  a trade layer at all; listed where a wiki layer is really a level concept.
- **`layer` (reserved)** — the schema's reserved, unpopulated `layers` array.
- **not modelled** — no hook in the schema or code today.

| # | Layer | What it covers (per the wiki page) | Maps to today |
|---|---|---|---|
| 1 | Utility Hookups | Big three (electric/water/sewer) + internet | not modelled |
| 2 | Landscape | Hardscape, waterscape, permeable pavement, plantings, drains, swales, dry wells, detention/infiltration, mailbox | not modelled |
| 3 | Foundation | Forms and concrete; includes earthwork (clearing, excavation, grading, fill, compaction) and foundation waterproofing/drainage (membranes, footing drains, capillary breaks) | **existing module family** (partial) — the `foundation` entity kind (`web/js/foundation.js`, `web/js/foundation_geom.js`, priced via `pricing.json.foundation`) covers slab/grade-beam/EPS-skirt forms-and-concrete only; earthwork and waterproofing/drainage are not modelled |
| 4 | Framing | (title only on this page — framing is covered in depth elsewhere on the wiki) | **existing module family** — `framed_wall_panel` / `aperture_wall_panel` (`wall`/`iwall` entities), the tool's core |
| 5 | Floor Platforms | — | **`level`** (reserved) — a floor platform is structurally a story boundary; the schema's `levels` array is the closest existing hook, but no geometry exists for it |
| 6 | Decks and Canopies | — | not modelled |
| 7 | Plumbing | — | **`layer`** (reserved) — named explicitly as a trade example in decision 5b ("electrical, plumbing, HVAC") |
| 8 | Electrical | — | **`layer`** (reserved) — named explicitly in decision 5b |
| 9 | Water | — | **`layer`** (reserved) — grouped with Plumbing under decision 5b's trade concept |
| 10 | Power Center | — | not modelled (wiki describes it as its own module) |
| 11 | Heat Pump | Indoor and outdoor units, framing, insulation, siding, wiring, plumbing — "a self-contained module" | not modelled (candidate future module family per wiki-candidates.md #1) |
| 12 | Exterior Flashing | Windows, doors, roof-to-wall, decks, penetrations | not modelled |
| 13 | Exterior Trim | Decorative, after flashing | not modelled |
| 14 | Exterior Siding | From exterior material to Air/Water/Weather Barrier — WRB, housewrap, tapes, membranes | not modelled |
| 15 | Interior Sheathing | Drywall or beadboard | not modelled |
| 16 | Interior trim | Decorative trim + hardware — hinges, locks, pulls, closers, door & cabinet hardware, railing | not modelled |
| 17 | Stairs | — | **`level`** (reserved) — a stair is inherently a multi-story connector; no geometry exists for it |
| 18 | Kitchen Cabinets | — | not modelled |
| 19 | Bathroom Cabinets | — | not modelled |
| 20 | Appliances and Fixtures | Fridge, heaters, toilets, fans, smoke alarms, etc.; can include heat pump; bath/kitchen exhaust, dryer vent; security, cameras, doorbell | not modelled |
| 21 | Fasteners and connectors | Screws, nails, hangers, straps, anchors, brackets | **existing module family** (partial) — `pricing.json.hardware` (nails, screws) and the per-module `nails_edge`/`nails_center`/`corner_screws` counts in `pricing.json.module_specs`; hand-authored quantities, not placeable geometry |
| 22 | PV Panels | — | not modelled |
| 23 | Roofing | — | not modelled (the single biggest gap per wiki-candidates.md — see the `Truss` page) |
| 24 | Gutters | — | not modelled |
| 25 | Flooring | — | not modelled |
| 26 | Doors and Windows | — | **existing module family** — `aperture_wall_panel` (`APERTURE_MODULES` / `INT_APERTURE_MODULES` in `web/js/constants.js`); the one layer already fully covered by code |
| 27 | Closets and Shelves | — | not modelled |
| 28 | Insulation | Walls, roof, floors, slab perimeter | **existing module family** (partial) — exterior wall OSB sheathing (`sheathing` member role, `web/js/members.js`) is adjacent but is structural sheathing, not thermal insulation; the EPS frost skirt (`pricing.json.foundation.eps_skirt_sf`) is the one true insulation line item modelled today, scoped to the foundation perimeter only. Wall-cavity, roof, and floor insulation are not modelled |
| 29 | Sealants | Caulking, mastic, fire sealant, mouseproofing — exterior and interior joints | not modelled |
| 30 | Tile | Shower | not modelled |

## Notes

- The wiki page also lists a separate, deprecated "Initial 30 Layers" (linked
  as `[[Initial 30 Layers]]`, not fetched in this scan) that the page says
  "misses embedded information regarding steps" — the list above is the
  current, non-deprecated version.
- This is a first-cut framework per the wiki page's own caveat ("This
  inventory should be treated as a first-cut framework rather than a
  complete specification"). Treat entries marked "not modelled" as candidate
  future `layer` entries, not as a commitment to build them.
