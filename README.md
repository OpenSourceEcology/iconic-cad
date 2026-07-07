# Iconic CAD - Web UI

By Collin DeSantis. Developed in collaboration with [Open Source Ecology](http://opensourceecology.org).

> **This is Open Source Ecology's fork** of Collin DeSantis's Iconic CAD, continued
> under [OpenSourceEcology/iconic-cad](https://github.com/OpenSourceEcology/iconic-cad)
> with agent-assisted development. All of the design and original implementation are
> Collin's — see [AUTHORS.md](AUTHORS.md). Upstream original:
> [gitlab.com/collindesantis/iconic-cad](https://gitlab.com/collindesantis/iconic-cad).
> Changes here flow back upstream where useful.

Usage video: https://youtu.be/L8IsKB0XknQ

Browser-based drag-and-snap wall layout tool that compiles directly to 3D FreeCAD models.

**Status:** Exterior walls, interior walls with blocking (continuous/transverse), window and door aperture modules, live 3D preview, BOM estimator, save/load, in-browser FreeCAD (`.FCStd`) export, and the JSON-to-FreeCAD compiler are all working. An IFC4 export (one box `IfcWall` per module, no framing) is **experimental and in testing — not a fully supported feature**.

## Quick start

> **Just want the layout tool + FreeCAD export?** Do steps 1, 4, 5, 6 only. The
> in-browser **Export FreeCAD** button needs no Python deps and no library
> generation — those (steps 2–3) are only for the command-line compiler and IFC export.

### 1. Clone the repo

```bash
git clone https://github.com/OpenSourceEcology/iconic-cad.git
# upstream original: https://gitlab.com/collindesantis/iconic-cad.git
cd iconic-cad
```

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3. Generate the wall module library

```bash
./generate.sh
```

This creates `cad_library/` with FreeCAD .FCStd files for each wall module type
(exterior and interior) — the parts the **command-line** compiler
(`compile_from_json.py`) loads. `cad_library/` is gitignored, so generate it
once after cloning.

> **Note:** Re-run after pulling new changes — wall specs may have been added or
> updated since your last generation.

<details>
<summary>Raw freecadcmd command</summary>

```bash
freecadcmd -c "import sys; sys.argv=['generate_wall_library.py','wall_instances.yaml']; exec(open('generate_wall_library.py').read())"
```
</details>

> **Changing the module library?** If you *edit* `wall_instances.yaml` (add or
> change a module), `./generate.sh` is not enough — the committed browser-export
> assets (`web/assets/lib/*.brp`, `volumes.json`, `specs.json`, and
> `web/thumbs/*.png`) also need rebuilding. One command does all of it:
>
> ```bash
> python build_lib.py            # regenerate every derived artifact from the YAML
> python build_lib.py --verify   # rebuild to a temp dir and diff vs committed (clobbers nothing)
> ```
>
> This is **only** for people changing the library. Just designing a house and
> exporting (steps 1, 4, 5, 6) needs none of it — the committed assets suffice.
> See [docs/adding_modules.md](docs/adding_modules.md) for the full walkthrough.

### 4. Start the web server

From the repository root:

```bash
python3 -m http.server 8080 --directory web
```

The `--directory web` flag serves the `web/` folder at the root URL, so you can run the command from the base directory without `cd`-ing into `web/`.

### 5. Design your layout

Open http://localhost:8080/ in your browser.

- Click a directional wall icon in the sidebar to pick it up
- Click on the canvas to place the first module (free placement)
- Subsequent modules snap to corner ports on existing walls (blue dots)
- The darkened border on each icon shows the exterior (OSB) side
- Interior walls (dashed border) snap perpendicular to exterior walls
- Press **C** or **T** to switch blocking mode before placing interior walls
- Right-click or Escape to cancel a placement

### 6. Export to FreeCAD

When the layout is done, click **Export FreeCAD** to download a ready-to-open
`.FCStd` file built entirely in the browser — no terminal, FreeCAD install, or
the library-generation step (3) required. The geometry (walls, blocking, aperture
framing) matches the Python compiler exactly.

Open the downloaded `.FCStd` file in FreeCAD to view the result.

<details>
<summary>Prefer the command line? Export JSON and compile instead</summary>

Click **Export JSON** instead, then run:

```bash
./compile.sh layout.json
```

Replace `layout.json` with whatever your exported file is named (e.g. `layout(2).json`). The output `.FCStd` file will have the same name. This path needs FreeCAD and the generated `cad_library/` (step 3).

Raw `freecadcmd` equivalent:

```bash
freecadcmd -c "import sys; sys.argv=['compile_from_json.py','layout.json']; exec(open('compile_from_json.py').read())"
```

> **Experimental — not fully supported, in testing.** There is also an IFC4
> export — one box-shaped `IfcWall` per module (no stud/blocking/opening
> geometry), a placeholder for trade-software hand-off rather than a detailed
> model:
>
> ```bash
> python3 export_ifc.py layout.json
> ```
</details>

## Dependencies

- **FreeCAD** (with `freecadcmd` CLI) — generates the wall module library and compiles layouts to `.FCStd`
- **Python 3** with **PyYAML**, **numpy**, **ifcopenshell** — see `requirements.txt`
- **A web browser** — runs the layout tool (no internet required after initial load)

```bash
# Install Python deps (all platforms)
pip install -r requirements.txt

# FreeCAD — system package
# Arch Linux
sudo pacman -S freecad

# Debian / Ubuntu
sudo apt install freecad

# Fedora
sudo dnf install freecad

# openSUSE
sudo zypper install freecad
```

**Tested with:** FreeCAD 1.1.1, Python 3.14.5, ifcopenshell 0.8.5, on Arch Linux.

## How it works

1. **Web UI** (`web/index.html` + `web/js/`) — drag wall modules onto a canvas. Exterior walls snap to corner ports. Interior walls snap perpendicular to exterior walls with automatic blocking detection (C1/C2/T). Live 3D preview and BOM estimator update as you build.
2. **Export** — the layout is saved as JSON (`entities` schema) with exact mm positions, directions, and blocking connection data for each module.
3. **Three output paths:**
   - **Browser FreeCAD export** (`web/js/fcstd.js`) — builds a `.FCStd` directly in the browser using pre-baked BREPs from `web/assets/lib/` and the same blocking math as the Python compiler. No terminal needed.
   - **Python FreeCAD compiler** (`compile_from_json.py`) — loads wall shapes from `cad_library/`, rotates, places, and builds blocking geometry via FreeCAD. Run via `./compile.sh layout.json`.
   - **IFC export** (`export_ifc.py`) — **experimental, in testing, not fully supported.** Emits an IFC4 model with one box `IfcWall` per module (no framing geometry). Run via `python3 export_ifc.py layout.json`.

## Wall modules

### Exterior walls (2x6 + OSB)

| Module | Width | Height | Studs | Spacing |
|--------|-------|--------|-------|---------|
| wall_4x8_2x6_16oc | 48" (4') | 96" (8') | 2x6 | 16" OC |
| wall_4x8_2x6_24oc | 48" (4') | 96" (8') | 2x6 | 24" OC |
| wall_3x8.5_2x6_16oc | 36" (3') | 102" (8.5') | 2x6 | 16" OC |

Exterior wall depth: 5.5" stud + 7/16" OSB = ~6" total.

### Interior walls (2x4, no OSB)

| Module | Width | Height | Studs | Spacing |
|--------|-------|--------|-------|---------|
| iwall_4x8_2x4_16oc | 48" (4') | 96" (8') | 2x4 | 16" OC |
| iwall_4x8_2x4_24oc | 48" (4') | 96" (8') | 2x4 | 24" OC |
| iwall_3x8.5_2x4_single | 36" (3') | 102" (8.5') | 2x4 | 1 center stud |

Interior wall depth: 3.5" (stud only). Blocking at T-junctions:
- **C1** - 1 continuous 2x4 stud (when near an existing stud)
- **C2** - 2 continuous 2x4 studs flanking the interior wall (when in the open)
- **T** - horizontal ladder blocking between studs

### Window + door apertures

| Module | Type | Panel | Rough opening | Lumber |
|--------|------|-------|---------------|--------|
| window_4x8_2x6_36x48 | window | 4' × 8' | 36" × 48", sill 24" | 2x6 + OSB |
| window_4x9_2x6_36x48 | window | 4' × 9' | 36" × 48", sill 24" | 2x6 + OSB |
| window_4x10_2x6_36x48 | window | 4' × 10' | 36" × 48", sill 24" | 2x6 + OSB |
| door_4x8_2x6_38x83 | door (in-swing) | 4' × 8' | 38" × 83" to floor | 2x6 + OSB |
| door_out_4x8_2x6_38x83 | door (out-swing) | 4' × 8' | 38" × 83" to floor | 2x6 + OSB |
| double_door_8x8_2x6_72x83 | double door | 8' × 8' | 72" × 83" to floor | 2x6 + OSB |
| sliding_8x8_2x6_72x80 | sliding patio | 8' × 8' | 72" × 80" to floor | 2x6 + OSB |
| garage_9x8_2x6_96x84 | garage | 9' × 8' | 96" × 84" to floor | 2x6 + OSB |
| idoor_4x8_2x4_38x83 | interior door | 4' × 8' | 38" × 83" to floor | 2x4 (no OSB) |

A door is a window taken to the floor — one parametric `aperture_wall_panel`
(see `wall_instances.yaml`). Apertures snap like any wall panel; pick one from
the library and press **R** to rotate. The opening is cut out of the OSB, the
plan symbol shows the conventional architectural silhouette (window glazing,
door leaf + swing arc), and an N/S/E/W letter marks the facing. Windows frame
king/jack studs, a header, top cripples, a sill, lower cripples, a subheader
nailer, and horizontal blocking every 24" per the OSE window spec. Framing dims
are measured from OSE source CAD — see
[docs/aperture_framing_reference.md](docs/aperture_framing_reference.md). To add
more modules, follow [docs/adding_modules.md](docs/adding_modules.md).

**Door swing:** in-swing vs out-swing are separate library tiles; the swing arc
on the canvas shows which way the leaf opens. When you place an interior door at
a seam, the tool checks its swing arc against every placed door's arc (real
geometric overlap, computed from the drawn sectors) and refuses positions where
two leaves would collide — rotate (**R**) to flip the swing to a clear side.

Interior walls may only bolt onto an exterior window/door module at a **seam**
(a panel edge shared with the adjacent module, where double king studs give a
real bolting surface) — never across the opening, and only via a centered
T-junction connection. Corner port-snapping interior→exterior is disabled, and
interior doors place by T-junction only (so they can't float off another
interior module). Interior-wall placement keep-outs: ≥48" (one module) between
interior walls on the same wall, ≥48" from a building corner, and not parallel
within ~24" of an exterior wall. Plain exterior walls keep the normal mid-panel
C1/C2/T blocking.

## Key concepts

- **Directional icons**: darkened border = exterior (OSB) side. Dashed border = interior wall (no OSB). N/S/E/W indicates wall facing direction.
- **Snap-to-port**: exterior modules connect at corner ports. The user controls which corners connect, determining the wall relationship at each joint.
- **T-junction snap**: interior walls snap perpendicular to exterior wall faces. Press C/T to choose blocking mode. The system auto-detects C1 vs C2 based on stud proximity and enforces 16" minimum spacing between interior walls.
- **Primary/secondary walls**: at corners, one wall runs through (primary) and the other fits between (secondary). Per OSE spec, N/S walls are primary (roof-bearing).

## Project structure

```
web/index.html           # HTML shell — loads web/js/main.js
web/js/main.js           # Entry point — wires up all modules
web/js/state.js          # Document model (entities, levels, layers) + UI state
web/js/constants.js      # Module definitions (MODULES, APERTURE_MODULES, …)
web/js/app.js            # Model-change dispatcher, tab switching
web/js/render2d.js       # 2D plan canvas (hotpath)
web/js/render3d.js       # three.js 3D preview + experiment view
web/js/snap.js           # Port snap, T-junction snap, blocking-type detection
web/js/geometry.js       # Bounding box + port positions after rotation
web/js/io.js             # JSON export / save / load
web/js/fcstd.js          # Browser FreeCAD export (BREP injection, blocking)
web/js/bom.js            # Bill-of-materials estimator
web/js/ui.js             # Toolbar / library palette / sidebar rendering
web/js/view.js           # Coordinate transforms (mm ↔ px)
web/pricing.json         # Material specs and unit prices for BOM
web/assets/lib/specs.json  # Wall framing params (generated by scripts/gen_specs.py)
compile_from_json.py     # JSON → FreeCAD compiler (Python, with blocking geometry)
export_ifc.py            # JSON → IFC4 export (Python, requires ifcopenshell)
generate_wall_library.py # Generate wall module .FCStd files from YAML
build_lib.py             # One command: regenerate ALL derived artifacts from the YAML
scripts/bake_geometry.py # freecadcmd worker: bakes cad_library + per-direction .brp + volumes.json
wall_instances.yaml      # Module specifications (walls, interior walls, apertures)
scripts/gen_specs.py     # Generate web/assets/lib/specs.json from YAML (no FreeCAD)
generate.sh              # Wrapper: run generate_wall_library.py via freecadcmd (cad_library only)
compile.sh               # Wrapper: run compile_from_json.py via freecadcmd
tests/                   # Parity + unit tests (no FreeCAD required)
icons/                   # 24 directional SVG icons (exterior + interior walls)
cad_library/             # Generated .FCStd modules (run generate.sh)
docs/                    # Module-authoring guide, aperture framing reference, design decisions
```

## Legacy workflows

Previous compiler approaches are archived on the [`legacy`](https://github.com/OpenSourceEcology/iconic-cad/tree/legacy) branch:

| Compiler | Approach | Limitation |
|----------|----------|------------|
| `legacy/compile_house_loop.py` | Marcin's original - clusters icons into N/S/E/W runs, walks sequentially | Rectangular buildings only |
| `compile_house.py` | Port-based BFS - graph traversal with port markers in CAD files | Corner alignment bug at perpendicular connections |
| `legacy/grid-placement/compile_house_grid.py` | Grid-based placement on uniform grid | Non-square modules don't fit a grid |
| `legacy/run-based-compiler/compile_house_runs.py` | Auto-detects wall runs from SVG, connects with dimension math | Complex, fragile at inner corners |

All used the Inkscape/SVG workflow: place icons in Inkscape → parse SVG → assemble in FreeCAD. The web UI approach on `main` replaces this by letting the user control placement directly.

## Progress logs

Dated narrative entries — the design decisions, the why, and commit references
behind each milestone — live in [`docs/logs/`](docs/logs/). They are the
greppable companion to the slide decks. Start with the
[index](docs/logs/README.md) for the newest-first list.

## Design decisions

Why the tool is shaped the way it is — the no-backend constraint, framing-as-backbone, and the rejected compiler approaches — is documented in [`docs/design_decisions.md`](docs/design_decisions.md). Read it before proposing architectural changes.

## License

Licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0). See [LICENSE](LICENSE) for the full text.

In short: you may use, modify, and redistribute this software freely. If you run a modified version as a network service, you must make your modified source available to users of that service under the same license. See [AUTHORS.md](AUTHORS.md) for attribution.
