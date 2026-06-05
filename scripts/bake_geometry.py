#!/usr/bin/env python3
"""
Geometry baker — runs UNDER freecadcmd. Driven by build_lib.py; not meant to be
called by hand.

From wall_instances.yaml it produces, for every instance:
  - cad_library/<id>.FCStd          the Python-compiler library part (gitignored)
  - <libdir>/<id>__<dir>.brp        the browser solid, one per N/S/E/W direction
  - <libdir>/volumes.json           canonical solid volume per module (mm^3, int)

Invocation (build_lib.py builds this command line):
    freecadcmd scripts/bake_geometry.py <mode> <libdir> <cadlibdir>
      mode = "write"   -> write the artifacts into <libdir> / <cadlibdir>
      mode = "verify"  -> write into the (temp) <libdir> / <cadlibdir>, then
                          geometrically compare every .brp and volume against the
                          committed web/assets/lib/ assets and exit non-zero on
                          any mismatch.

The .brp convention is taken verbatim from compile_from_json.prepare_shape so
that web/js/fcstd.js's Locations-injection reproduces the Python compiler exactly:
each direction's solid is the canonical south-facing pose, rotated about Z by
DIRECTION_TO_ROT[dir], then translated so its bounding-box min corner sits at the
origin, exported as a BREP. fcstd.js then injects only the per-placement
translation. No new convention is invented here.
"""
import json
import math
import os
import sys

import yaml
import FreeCAD as App
import Part  # noqa: F401  (required for shape ops under freecadcmd)

# Make the repo root importable so we can reuse the existing generator's
# build functions instead of duplicating any geometry construction.
REPO_ROOT = os.getcwd()
sys.path.insert(0, REPO_ROOT)
from generate_wall_library import build_wall, build_aperture_panel  # noqa: E402

YAML_PATH = "wall_instances.yaml"
COMMITTED_LIB = os.path.join("web", "assets", "lib")

# Same mapping the Python compiler uses (compile_from_json.DIRECTION_TO_ROT).
DIRECTION_TO_ROT = {"south": 180.0, "east": 90.0, "north": 0.0, "west": 270.0}

# Geometric-equivalence tolerances for --verify (serialisation may differ between
# FreeCAD builds even when the geometry is identical, so we compare geometry).
VOL_RTOL = 1e-6
BB_ATOL = 1e-4  # mm


def build_doc(inst):
    """Build the canonical (south-pose) FreeCAD document for an instance.

    Reuses generate_wall_library's build functions verbatim, so the saved
    cad_library/<id>.FCStd is byte-for-byte what generate.sh produces.
    """
    if "aperture" in inst["parameters"]:
        return build_aperture_panel(inst)
    return build_wall(inst)


def module_shape(doc):
    """Return a copy of the load-bearing solid (the 'wall_module' object).

    Mirrors compile_from_json.load_shape: the single Volume>0, non-port shape.
    """
    for obj in doc.Objects:
        if obj.Name == "wall_module":
            return obj.Shape.copy()
    # Fallback: same selection rule the compiler uses.
    for obj in doc.Objects:
        if hasattr(obj, "Shape") and obj.Shape.Volume > 0 and "port" not in obj.Name.lower():
            return obj.Shape.copy()
    raise RuntimeError("no wall_module shape in document " + doc.Name)


def baked_for_direction(base_shape, rot_deg):
    """Replicate compile_from_json.prepare_shape: rotate about Z, drop to origin."""
    s = base_shape.copy()
    s.rotate(App.Vector(0, 0, 0), App.Vector(0, 0, 1), rot_deg)
    bb = s.BoundBox
    s.translate(App.Vector(-bb.XMin, -bb.YMin, -bb.ZMin))
    return s


def write_artifacts(libdir, cadlibdir):
    os.makedirs(libdir, exist_ok=True)
    os.makedirs(cadlibdir, exist_ok=True)
    data = yaml.safe_load(open(YAML_PATH))

    volumes = {}
    for inst in data["instances"]:
        iid = inst["id"]
        doc = build_doc(inst)
        # cad_library part (ports included) — identical to generate_wall_library.
        doc.saveAs(os.path.join(cadlibdir, iid + ".FCStd"))

        base = module_shape(doc)
        volumes[iid] = int(round(base.Volume))
        for direction, rot in DIRECTION_TO_ROT.items():
            solid = baked_for_direction(base, rot)
            # Browser places solids by plain translation only. Bake the global
            # Y-mirror (the web UI authors Y screen-DOWN; the export world is
            # Y-up) in HERE via Part.Shape.mirror, so fcstd.js never injects a
            # runtime det-(-1) mirror Location. That hack produced a reversed
            # top-shape flag which FreeCAD's GUI refuses to render (invisible).
            # mirror() yields clean, forward, proper-normal geometry matching
            # compile_from_json.mirror_y. Mirror about Y=0 (no re-drop): the
            # solid now sits at Y in [-extent, 0], so the browser just translates
            # by (x-minx, -(y-miny), 0). See web/js/fcstd.js exportFcstd.
            solid = solid.mirror(App.Vector(0, 0, 0), App.Vector(0, 1, 0))
            solid.exportBrep(os.path.join(libdir, "%s__%s.brp" % (iid, direction)))
        App.closeDocument(doc.Name)
        print("  baked %s (vol=%d, 4 brp)" % (iid, volumes[iid]))

    # volumes.json: default separators (", " / ": "), no trailing newline —
    # matches the committed file's style.
    with open(os.path.join(libdir, "volumes.json"), "w") as f:
        json.dump(volumes, f)
    print("  wrote volumes.json (%d modules)" % len(volumes))
    return volumes


def _load_brep(path):
    s = Part.Shape()
    s.importBrep(path)
    return s


def _bb_tuple(shape):
    bb = shape.BoundBox
    return (bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax)


def verify(libdir, volumes):
    """Compare freshly-baked artifacts in libdir against committed web/assets/lib.

    Writes a machine-readable report to <libdir>/verify_report.json because
    freecadcmd does not reliably flush this process's stdout.
    """
    ok = True
    report = {"brp": [], "volumes": [], "max_dvol": 0.0, "max_dbb": 0.0}
    data = yaml.safe_load(open(YAML_PATH))
    for inst in data["instances"]:
        iid = inst["id"]
        for direction in DIRECTION_TO_ROT:
            name = "%s__%s.brp" % (iid, direction)
            fresh = os.path.join(libdir, name)
            committed = os.path.join(COMMITTED_LIB, name)
            if not os.path.exists(committed):
                report["brp"].append({"name": name, "status": "ADDED"})
                continue
            fs, cs = _load_brep(fresh), _load_brep(committed)
            dvol = abs(fs.Volume - cs.Volume)
            dbb = max(abs(a - b) for a, b in zip(_bb_tuple(fs), _bb_tuple(cs)))
            vol_ok = dvol <= VOL_RTOL * max(cs.Volume, 1.0)
            bb_ok = dbb <= BB_ATOL
            report["max_dvol"] = max(report["max_dvol"], dvol)
            report["max_dbb"] = max(report["max_dbb"], dbb)
            if not (vol_ok and bb_ok):
                ok = False
                report["brp"].append({"name": name, "status": "MISMATCH",
                                      "dvol": dvol, "dbb": dbb})
            else:
                report["brp"].append({"name": name, "status": "OK",
                                      "dvol": dvol, "dbb": dbb})

    committed_vols_path = os.path.join(COMMITTED_LIB, "volumes.json")
    if os.path.exists(committed_vols_path):
        cv = json.load(open(committed_vols_path))
        for iid, v in volumes.items():
            if iid in cv:
                d = abs(v - cv[iid])
                if d > max(1, int(VOL_RTOL * cv[iid])):
                    ok = False
                    report["volumes"].append({"id": iid, "fresh": v,
                                              "committed": cv[iid], "diff": d})

    report["ok"] = ok
    report["n_brp"] = len([b for b in report["brp"] if b["status"] != "ADDED"])
    with open(os.path.join(libdir, "verify_report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print("  geometry verify: %s (max dVol=%.6g, max dBB=%.6g mm)"
          % ("PASS" if ok else "FAIL", report["max_dvol"], report["max_dbb"]))
    return ok


def main():
    # argv: ['freecadcmd', '<script>', mode, libdir, cadlibdir]
    mode = sys.argv[2]
    libdir = sys.argv[3]
    cadlibdir = sys.argv[4]
    print("[bake_geometry] mode=%s libdir=%s cadlibdir=%s" % (mode, libdir, cadlibdir))
    volumes = write_artifacts(libdir, cadlibdir)
    if mode == "verify":
        ok = verify(libdir, volumes)
        sys.exit(0 if ok else 1)


main()
