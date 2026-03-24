# Iconic CAD

A pipeline for designing houses by arranging visual icons in Inkscape SVG layouts, which compile into full 3D FreeCAD models with real framing details (studs, plates, OSB sheathing).

Developed as part of [Open Source Ecology](http://opensourceecology.org). See the [wiki page](https://wiki.opensourceecology.org/wiki/Iconic_CAD_Workflow_Example) for full project context.

## Status

**Work in progress.** The compiler on `main` (`compile_house.py`) uses port-based BFS assembly. It handles straight wall runs correctly but has a known corner alignment bug ([issue #3](https://github.com/collindesantis/iconic-cad/issues/3)) — the port selection logic picks the wrong port at perpendicular connections because both ports share identical coordinates on the selection axis after rotation.

A **run-based compiler** on the `run-based-compiler` branch (`compile_house_runs.py`) solves this by eliminating ports entirely. It auto-detects wall runs from the SVG layout, places them as continuous lines, and connects them at corners using dimension-based intersection math. The key insight: at every corner, one wall is **primary** (runs through the corner) and the other is **secondary** (fits between primary walls). This rule makes corner geometry deterministic with zero gaps.

The run-based compiler works for rectangles and L-shapes but is not yet merged to main — it needs testing with more complex layouts and mixed module widths (48" + 36") before replacing the port-based compiler.

## How it works

1. **YAML schema** defines wall module specs (lumber size, stud spacing, OSB thickness)
2. **`generate_wall_library.py`** generates FreeCAD .FCStd wall modules from the YAML
3. User arranges directional icons on a 64px snap grid in Inkscape — each icon's darkened border indicates wall facing direction (N/S/E/W)
4. **`compile_house.py`** parses the SVG, reads direction from icon names, and assembles via graph-based BFS with port snapping

## Dependencies

```
sudo pacman -S freecad python-yaml   # Arch Linux
```

## Quick start

Generate the part library with port markers:
```bash
freecadcmd -c "import sys; sys.argv=['generate_wall_library.py','wall_instances.yaml']; exec(open('generate_wall_library.py').read())"
```

Generate SVG icons for Inkscape:
```bash
python generate_icons.py wall_instances.yaml
```

Compile a floor plan into a 3D house:
```bash
freecadcmd -c "import sys; sys.argv=['compile_house.py','examples/your_plan.svg']; exec(open('compile_house.py').read())"
```

Open the resulting `.FCStd` file in FreeCAD to view.

## Project structure

```
compile_house.py        # Port-based house compiler (graph/BFS assembly)
generate_wall_library.py # Generate FreeCAD wall modules with port markers
generate_icons.py       # Auto-generate SVG icons from YAML with metadata
wall_instances.yaml     # Wall module specifications
icons/                  # SVG icons + Inkscape snap template
examples/               # Hand-made floor plan layouts
docs/                   # Protocol slides, replication documentation
legacy/                 # Earlier compiler iterations
```

## Legacy

`legacy/compile_house_loop.py` is Marcin's original compiler which assembles walls by clustering icons into N/S/E/W runs and walking them sequentially. It works for rectangular buildings but cannot handle L-shapes, T-shapes, or other non-rectangular layouts. The current `compile_house.py` replaces this approach with port-based graph assembly.

## License

Open source — see [OSE licensing](https://www.opensourceecology.org/open-source-hardware-license/).
