#!/usr/bin/env python3
"""
Auto-generate Inkscape-ready SVG icons from wall_instances.yaml.

Each icon is a 64x64px SVG with:
  - A visual representation of the wall (studs, plates, OSB indicator)
  - data-module attribute baked into the root <g> element
  - A human-readable label showing the key specs

The user imports these into the Inkscape snap template, places them
on the 64px grid, and rotates for orientation. No manual XML editing.

Also generates an Inkscape template file with 64px snap grid.

Usage:
    python generate_icons.py wall_instances.yaml
"""

import sys
import yaml


def load_yaml(path):
    with open(path, "r") as f:
        return yaml.safe_load(f)


def nominal_stud_count(width_ft, spacing_oc_in, stud_thick_in=1.5):
    """Approximate stud count for visual representation."""
    width_in = width_ft * 12.0
    right_edge = width_in - stud_thick_in
    count = 1  # left stud
    cur = spacing_oc_in
    while cur + stud_thick_in <= right_edge:
        count += 1
        cur += spacing_oc_in
    count += 1  # right stud
    return count


def generate_icon_svg(instance):
    """Generate a standalone 64x64 SVG icon for one wall instance."""
    iid = instance["id"]
    p = instance["parameters"]

    width_ft = p["nominal_width_ft"]
    height_ft = p["nominal_height_ft"]
    spacing = p["stud_spacing_oc_in"]
    lumber = p["stud_lumber_nominal"]

    n_studs = nominal_stud_count(width_ft, spacing)

    # Short label
    w_str = f"{width_ft:.0f}" if width_ft == int(width_ft) else f"{width_ft}"
    h_str = f"{height_ft:.0f}" if height_ft == int(height_ft) else f"{height_ft}"
    label = f"{w_str}'x{h_str}'"
    sublabel = f"{lumber} {spacing}OC"

    # Build SVG
    lines = []
    lines.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">')

    # The root <g> carries the data-module attribute.
    # When the user imports this into Inkscape and places it, the <g> is what
    # gets a transform. The compiler reads data-module from this <g>.
    lines.append(f'  <g id="{iid}" data-module="{iid}">')

    # Background
    lines.append(f'    <rect x="1" y="1" width="62" height="62" rx="3" '
                 f'fill="#f8f6f0" stroke="#444" stroke-width="1.5"/>')

    # Plates (top and bottom bars)
    lines.append(f'    <rect x="6" y="8" width="52" height="3" fill="#b8860b"/>')
    lines.append(f'    <rect x="6" y="44" width="52" height="3" fill="#b8860b"/>')

    # Studs
    stud_margin = 6
    stud_area = 52  # px width for stud area
    if n_studs > 1:
        spacing_px = stud_area / (n_studs - 1)
    else:
        spacing_px = 0

    for i in range(n_studs):
        x = stud_margin + i * spacing_px
        lines.append(f'    <rect x="{x:.1f}" y="11" width="2" height="33" fill="#daa520"/>')

    # OSB indicator (south face = bottom edge tick)
    lines.append(f'    <line x1="28" y1="47" x2="36" y2="47" stroke="#228b22" stroke-width="2"/>')
    lines.append(f'    <polygon points="32,51 29,47 35,47" fill="#228b22"/>')

    # Labels
    lines.append(f'    <text x="32" y="58" text-anchor="middle" font-size="7" '
                 f'font-family="monospace" fill="#333">{label}</text>')
    lines.append(f'    <text x="32" y="7" text-anchor="middle" font-size="5" '
                 f'font-family="monospace" fill="#666">{sublabel}</text>')

    # Port indicators (tiny dots at left and right edges)
    lines.append(f'    <circle cx="2" cy="32" r="1.5" fill="#e00" opacity="0.6"/>')
    lines.append(f'    <circle cx="62" cy="32" r="1.5" fill="#00e" opacity="0.6"/>')

    lines.append(f'  </g>')
    lines.append(f'</svg>')

    return "\n".join(lines) + "\n"


def generate_template_svg(width_cells=16, height_cells=16):
    """Generate an Inkscape template with 64px snap grid."""
    w = width_cells * 64
    h = height_cells * 64

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
     width="{w}" height="{h}" viewBox="0 0 {w} {h}">
  <sodipodi:namedview
    inkscape:document-units="px"
    showgrid="true">
    <inkscape:grid type="xygrid"
      spacingx="64" spacingy="64"
      empspacing="4"
      visible="true"
      enabled="true"
      snapvisiblegridlinesonly="false"/>
  </sodipodi:namedview>
  <defs/>
  <g inkscape:label="layout" inkscape:groupmode="layer" id="layout_layer"/>
</svg>
"""


def main():
    if len(sys.argv) != 2:
        print("Usage: generate_icons.py wall_instances.yaml")
        sys.exit(1)

    data = load_yaml(sys.argv[1])

    # Generate individual icon SVGs
    for inst in data["instances"]:
        iid = inst["id"]
        svg = generate_icon_svg(inst)
        fname = f"icons/{iid}.svg"
        import os
        os.makedirs("icons", exist_ok=True)
        with open(fname, "w") as f:
            f.write(svg)
        print(f"Generated {fname}")

    # Generate Inkscape template
    template = generate_template_svg()
    with open("icons/snap_template.svg", "w") as f:
        f.write(template)
    print("Generated icons/snap_template.svg")

    print(f"\nCreated {len(data['instances'])} icon SVGs + template in icons/")
    print("Workflow: Open snap_template.svg in Inkscape, File > Import each icon,")
    print("place on grid, rotate for orientation (0=S, 90=E, 180=N, 270=W),")
    print("save as your floor plan SVG, then run the compiler.")


if __name__ == "__main__":
    main()
