# Iconic CAD

A pipeline for designing houses by arranging wall modules visually, then compiling into full 3D FreeCAD models with real framing details (studs, plates, OSB sheathing).

Developed as part of [Open Source Ecology](http://opensourceecology.org). See the [wiki page](https://wiki.opensourceecology.org/wiki/Iconic_CAD_Workflow_Example) for full project context.

## Status

**Active development.** The recommended workflow is on the [`web-ui-poc`](https://github.com/collindesantis/iconic-cad/tree/web-ui-poc) branch — a browser-based drag-and-snap layout tool that exports directly to FreeCAD. See that branch's README for setup and usage instructions.

The `main` branch contains the original SVG/Inkscape-based compiler (`compile_house.py`), which works for straight wall runs but has a known corner alignment bug ([issue #3](https://github.com/collindesantis/iconic-cad/issues/3)). The web UI approach bypasses this entirely by letting the user visually place walls with snap-to-port, eliminating the need for the compiler to infer corner geometry.

### Branches

| Branch | Description | Status |
|--------|-------------|--------|
| [`web-ui-poc`](https://github.com/collindesantis/iconic-cad/tree/web-ui-poc) | Browser-based wall layout + JSON-to-FreeCAD compiler | **Working** — rectangles and L-shapes |
| [`run-based-compiler`](https://github.com/collindesantis/iconic-cad/tree/run-based-compiler) | SVG compiler using run detection instead of ports | Working for rectangles and L-shapes |
| `main` | Original port-based SVG compiler | Corner bug at perpendicular connections |
| [`grid-placement`](https://github.com/collindesantis/iconic-cad/tree/grid-placement) | Experimental grid-based compiler | Archived — non-square modules don't fit a grid |

## Dependencies

```
sudo pacman -S freecad python-yaml   # Arch Linux
```

## Project structure

```
compile_house.py         # Port-based SVG compiler (main branch)
generate_wall_library.py # Generate FreeCAD wall modules from YAML
wall_instances.yaml      # Wall module specifications (3 types)
icons/                   # 12 directional SVG icons (3 types × 4 directions)
examples/                # Example SVG layouts
docs/                    # Protocol documentation
legacy/                  # Marcin's original rectangular compiler
```

## Key concepts

- **Directional icons**: each icon's darkened border shows which way the wall faces (N/S/E/W = OSB exterior side)
- **Primary/secondary walls**: at corners, one wall runs through (primary) and the other fits between (secondary). This eliminates corner gaps. Per OSE spec, N/S walls are primary (they bear the roof).
- **Snap-to-port**: in the web UI, modules snap to connection points at the corners of existing walls, giving the user direct control over corner geometry

## License

Open source — see [OSE licensing](https://www.opensourceecology.org/open-source-hardware-license/).
