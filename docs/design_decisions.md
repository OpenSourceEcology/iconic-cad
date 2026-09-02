# Design decisions

The architectural decisions behind Iconic CAD, with the reason and the cost of
each. Recorded so a future contributor (human or agent) understands *why* the
tool is shaped this way and what they'd give up by undoing it.

This doc records **decisions** (constraints that are true about the design).
Framing, philosophy, and the target scenarios live on the design-decisions slide,
not here. Plans for unbuilt features live in their scoping docs; only the settled
decisions they produce graduate into this file.

These decisions serve two target scenarios (see the slide): a campus swarm build
(many people assembling one house in a weekend) and a remote single-house order
(fabricated on-site, off-grid, from the generated files). They are cited as
rationale below rather than restated as their own section.

---

## 1. No backend — the tool is fully static

The browser does everything, including the FreeCAD `.FCStd` export, with no
server.

**Why.** Distribution becomes trivial: host it anywhere, run it offline, run it on
an air-gapped build site with no connectivity (the remote-order scenario). No ops
burden, no hosting cost, no service to keep alive. It fits OSE's distributed-
production ethos — anyone can fork the repo and run their own copy.

**Cost.** The browser has no geometry kernel. It cannot *create* geometry; it can
only pack pre-baked solids (`fcstd.js` injects translations into pre-generated
BREPs). New shapes must be generated offline via FreeCAD (`build_lib.py`). Anything
that needs server-side state — e.g. live build-status tracking on a traveller —
breaks this constraint and is a real decision to revisit, not a free addition.

## 2. A door is a window taken to the floor — apertures are one parametric family

Windows and doors are a single `aperture_wall_panel` family driven by an `aperture`
block, not two separate code paths.

**Why.** They share the same king/jack/header/cripple framing logic. One path means
one place to fix a framing bug and no drift between "window framing" and "door
framing."

**Cost.** The single family carries the union of cases (sill present or absent,
swing geometry and conflict-checking for doors), so conditional complexity is
concentrated in one family rather than spread across two simpler ones.

## 3. Geometry over heuristics

Where there's a choice between computing real geometry and applying a rule of
thumb, compute the geometry. The door swing-conflict guard checks actual sector
overlap from the drawn arcs; snapping uses real port and seam positions; the part
library is built from computed member positions, never estimated.

**Why.** The geometry is ground truth, so it doesn't accumulate the edge-case
failures that heuristics do (the rejected run-based and grid compilers below are the
evidence). Correctness is structural rather than patched.

**Cost.** More math up front, and slower to write than a shortcut would be.

## 4. Orthogonal document model — levels, layers, entities

An entity carries `level`, `layer`, and side as independent attributes, rather than
the model being a flat list of walls.

**Why.** It is the slot for two planned capabilities that don't exist yet:
multi-story (levels) and trades such as electrical/plumbing/HVAC (layers). With the
orthogonal model, those slot in without a model rewrite. (See decision 5b for the
intent this slot exists to serve.)

**Cost.** More abstraction than today's single-story, structural-only tool strictly
needs — a deliberate bet on future generality that is currently unpaid (the
multi-story UI isn't built yet).

## 5. Text and AI-friendly formats throughout

YAML is the single source of truth; layouts are JSON; logs are plain text; every
generated artifact comes from a deterministic generator.

**Why.** These formats are diffable, version-controllable, reproducible, and legible
to both humans and AI agents — an agent can read and edit a spec directly. This
makes distributed and AI-assisted contribution practical.

**Cost.** Not the most compact representation; accepts some redundancy in exchange
for transparency.

## 5b. Framing is the backbone — trades derive from it, and the tool flows

*(Directional decision — committed in principle, not yet built. Recorded because
it's the intent the layer model exists to serve, and the decision most easily
violated by someone who doesn't know it.)*

The structural framing is the authored source of truth. The other tabs (electrical,
plumbing, HVAC) are primarily **auto-generated from the framing** via best-practice
rules — reviewable, and eventually supporting manual entry as overrides. The
intended UX is a true sequence — first tab to last to export — not a set of
independent tabs you switch between.

**Why.** Every trade is spatially constrained by the framing (an outlet lives in a
stud bay, a wire follows a channel). Deriving trades from the framing is both less
work for the user and more correct than drawing each trade independently. A user
override is treated as a logged deviation from the default, which carries a cost —
so deviations are explicit, not silent.

**Cost.** Auto-generated trades are **best-practice defaults, not engineered MEP**.
They must be presented as "starting layout, review required," never as a finished
electrical/plumbing plan. The override mechanism (a user edit as a recorded
exception on the entity) is real work that must exist before manual entry is safe.

`docs/layers_seed.md` is a sourced seed (OSE wiki "30 Master Layers") for the
still-unpopulated `layers` array this decision anticipates — not enforced by
code.

## 6. Derived artifacts are generated, not hand-maintained — and kept honest by tests

`wall_instances.yaml` is authored; everything else (`specs.json`, the per-direction
BREPs, `volumes.json`, thumbnails, the `.FCStd` library) is generated from it by
`build_lib.py` — one command, reproducible. The browser export and the Python
compiler are held to identical blocking geometry by `tests/parity.mjs` in CI.

**Why.** A derived artifact can't drift from its source by hand, and the
browser-vs-compiler agreement is verified mechanically rather than discovered in the
field — which is what lets "the browser export equals the compiler" be a true claim
rather than an aspiration.

**Cost.** A contributor can't hand-edit a derived file; they change the source and
regenerate, which needs FreeCAD for the geometry step. (The operational *how* of this
contract lives in `AGENTS.md`; this entry records the *why*.)

**Single-enumerator refactor — landed for framing lumber, 2026-08.**
`enumerateMembers()` (`web/js/members.js`) is now the one place stud, plate,
king, jack, header, cripple, sill, and blocking positions are computed.
`scripts/export_members.mjs` bakes its output to the committed
`web/assets/lib/members.json`; `seh_lib/wall_builder.py` (shared by both
`generate_wall_library.py` and every `library/modules/<id>/compiler.py`) reads
that file and turns it into FreeCAD box shapes — it no longer re-derives stud
or cripple positions itself. `build_lib.py` bakes members.json before the
freecadcmd geometry step, and `--verify` checks it's current; CI's fast lane
(`node scripts/export_members.mjs --verify`) and the geometry-verify job both
gate on it. `tests/enumerate_parity.mjs` (JS) and `tests/test_members_boxes.py`
(Python, no FreeCAD) now assert each *consumer* faithfully renders the single
source, rather than asserting two independent implementations happen to agree.

**Still NOT single-sourced: OSB sheathing.** The JS/3D side models exterior
OSB as several rectangular strips split around a rough opening
(`enumerateMembers`'s `sheathing` role entries); the Python/FreeCAD side still
cuts a single full sheet with a rectangular hole. This is a real, pre-existing
geometry difference between the two implementations — tracked as CAD-AUD-005
and recorded as a `known_issue` on every aperture module's `meta.yaml` — and
the single-enumerator refactor deliberately did not resolve it: `sheathing`
members are exported in members.json (so JS consumers are unaffected) but
skipped on the Python side rather than silently picking one behavior over the
other. Consolidating OSB generation is separate follow-up work.

A related known gap, also untouched here: `pricing.json`'s member counts are
still hand-authored, not derived from geometry.

---

## Rejected alternatives — the compiler genealogy

Recorded because they are the evidence behind decision 3 and the current
placement model. All are preserved on the [`legacy`](https://gitlab.com/collindesantis/iconic-cad/-/tree/legacy)
branch.

- **Run-clustering (Marcin's original).** Clustered icons into N/S/E/W runs and
  walked them sequentially. Handled rectangular buildings only.
- **Port-based BFS.** Graph traversal using port markers in the CAD files. Had a
  corner-alignment bug at perpendicular connections.
- **Grid placement.** Placed modules on a uniform grid. Failed because non-square
  modules don't fit a grid.
- **Run-based (SVG auto-detect).** Auto-detected wall runs from SVG and connected
  them with dimension math. Complex and fragile at inner corners.

**The current approach** — explicit entity placements with user-controlled port
snapping — won because it handles non-rectangular, non-grid, arbitrary-corner
layouts, and it puts the user in control of which corners connect rather than trying
to infer intent from geometry.
