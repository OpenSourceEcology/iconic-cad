# Iconic CAD — Web UI

Browser-based drag-and-snap wall layout tool that compiles directly to 3D FreeCAD models. Designed for [Open Source Ecology](http://opensourceecology.org).

## Quick start

### 1. Clone the repo

```bash
git clone https://github.com/collindesantis/iconic-cad.git
# or: git clone https://gitlab.com/collindesantis/iconic-cad.git
# or: git clone https://codeberg.org/collindesantis/iconic-cad.git
cd iconic-cad
```

### 2. Generate the wall module library (one time)

```bash
freecadcmd -c "import sys; sys.argv=['generate_wall_library.py','wall_instances.yaml']; exec(open('generate_wall_library.py').read())"
```

This creates `cad_library/` with FreeCAD .FCStd files for each wall module type.

### 3. Start the web server

```bash
python3 -m http.server 8080
```

### 4. Design your layout

Open http://localhost:8080/web/ in your browser.

- Click a directional wall icon in the sidebar to pick it up
- Click on the canvas to place the first module (free placement)
- Subsequent modules snap to corner ports on existing walls (blue dots)
- The darkened border on each icon shows the exterior (OSB) side
- Right-click or Escape to cancel a placement
- Click **Export JSON** when done

### 5. Compile to 3D

```bash
freecadcmd -c "import sys; sys.argv=['compile_from_json.py','layout.json']; exec(open('compile_from_json.py').read())"
```

Replace `layout.json` with whatever your exported file is named (e.g. `layout(2).json`). The output `.FCStd` file will have the same name.

### 6. View the result

Open the resulting `.FCStd` file in FreeCAD.

## Dependencies

```bash
sudo pacman -S freecad python-yaml   # Arch Linux
```

## How it works

1. **Web UI** (`web/index.html`) — drag wall modules onto a canvas. Modules snap to ports at the corners of existing walls, giving direct control over corner geometry.
2. **Export** — the layout is saved as JSON with exact mm positions for each module.
3. **JSON compiler** (`compile_from_json.py`) — loads FreeCAD wall shapes, rotates by direction, and places at the positions from the JSON. No run detection or corner math needed — the web UI already handled placement.

## Wall modules

| Module | Width | Height | Studs | Spacing |
|--------|-------|--------|-------|---------|
| wall_4x8_2x6_16oc | 48" (4') | 96" (8') | 2x6 | 16" OC |
| wall_4x8_2x6_24oc | 48" (4') | 96" (8') | 2x6 | 24" OC |
| wall_3x8.5_2x6_16oc | 36" (3') | 102" (8.5') | 2x6 | 16" OC |

All modules: 5.5" stud depth + 7/16" OSB = ~6" total wall depth.

## Key concepts

- **Directional icons**: darkened border = exterior (OSB) side. N/S/E/W indicates wall facing direction.
- **Snap-to-port**: modules connect at corner ports. The user controls which corners connect, determining the wall relationship at each joint.
- **Primary/secondary walls**: at corners, one wall runs through (primary) and the other fits between (secondary). Per OSE spec, N/S walls are primary (roof-bearing).

## Project structure

```
web/index.html           # Browser-based layout tool
compile_from_json.py     # JSON → FreeCAD compiler
generate_wall_library.py # Generate wall modules from YAML
wall_instances.yaml      # Wall module specifications
icons/                   # 12 directional SVG icons
```

## Legacy workflows

Previous compiler approaches are archived on the [`legacy`](https://github.com/collindesantis/iconic-cad/tree/legacy) branch:

| Compiler | Approach | Limitation |
|----------|----------|------------|
| `legacy/compile_house_loop.py` | Marcin's original — clusters icons into N/S/E/W runs, walks sequentially | Rectangular buildings only |
| `compile_house.py` | Port-based BFS — graph traversal with port markers in CAD files | Corner alignment bug at perpendicular connections |
| `legacy/grid-placement/compile_house_grid.py` | Grid-based placement on uniform grid | Non-square modules don't fit a grid |
| `legacy/run-based-compiler/compile_house_runs.py` | Auto-detects wall runs from SVG, connects with dimension math | Complex, fragile at inner corners |

All used the Inkscape/SVG workflow: place icons in Inkscape → parse SVG → assemble in FreeCAD. The web UI approach on `main` replaces this by letting the user control placement directly.

## License

Open source — see [OSE licensing](https://www.opensourceecology.org/open-source-hardware-license/).
