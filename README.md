# Iconic CAD

A pipeline for designing houses by arranging visual icons in Inkscape SVG layouts, which compile into full 3D FreeCAD models with real framing details (studs, plates, OSB sheathing).

Developed as part of [Open Source Ecology](http://opensourceecology.org). See the [wiki page](https://wiki.opensourceecology.org/wiki/Iconic_CAD_Workflow_Example) for full project context.

## How it works

1. **YAML schema** defines wall module specs (lumber size, stud spacing, OSB thickness)
2. **`generate_icons.py`** produces SVG icons with metadata baked in from the YAML
3. User arranges icons on a 64px snap grid in Inkscape, rotates for orientation (0°=S, 90°=E, 180°=N, 270°=W)
4. **`compile_house.py`** parses the SVG, reads port markers from the CAD library, and assembles via graph-based BFS — works for any building shape (rectangles, L-shapes, T-shapes, etc.)

## Dependencies

```
sudo pacman -S freecad python-yaml   # Arch Linux
```

## Quick start

Generate the part library (requires FreeCAD separately — see wiki):
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
generate_icons.py       # Auto-generate SVG icons from YAML with metadata
wall_instances.yaml     # Wall module specifications
icons/                  # SVG icons + Inkscape snap template
examples/               # Hand-made floor plan layouts
docs/                   # Protocol slides, replication documentation
```

## License

Open source — see [OSE licensing](https://www.opensourceecology.org/open-source-hardware-license/).
