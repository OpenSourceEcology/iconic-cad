# FreeCAD verification of the Sol audit's UNVERIFIED items (nimo-blk-ose, 2026-09-02)

Sol could not run anything needing `freecadcmd`. Colby ruled (D3) that FreeCAD goes on the OSE
box in KC. FreeCAD 1.1.3 (AppImage, extracted to `/opt/freecad`, `freecadcmd` wrapper in
`/usr/local/bin`) is now on nimo-blk-ose, with a clone of iconic-cad at `~/code/iconic-cad`
(main @ ea037e4), a venv with `libtools` from OpenSourceEcology/vcs-library, and node v22.

## `python build_lib.py --verify` — PASS

```
  wall YAML   : PASS
  specs.json  : PASS
  members.json: PASS
  geometry    : PASS      (all 15 library modules baked and checked under FreeCAD 1.1.3)
  thumbnails  : skipped
```

Node suite: 0 failures (all tests/*.mjs). `ifcopenshell==0.8.5` installed without error.

What this does and does not say: the FreeCAD bake reproduces the committed geometry from the
current members.json, i.e. the pipeline is internally consistent under FreeCAD too. It does
**not** contradict any Sol finding — SOL-01/02/03/04/12/13 are cases where the consistently
produced geometry disagrees with the framing spec, and the validator passes them because the
overlaps are allowlisted. So Sol's "UNVERIFIED under FreeCAD" caveats can be read as "confirmed
the bake will carry the same defects", which is what Sol predicted.

## `generate.sh` (legacy cad_library generator) — FAILS on this host

```
ModuleNotFoundError: No module named 'seh_lib'
```

The AppImage's bundled Python does not pick up `PYTHONPATH` or the cwd, so the
`freecadcmd -c "...exec(open('generate_wall_library.py').read())"` invocation cannot import
`seh_lib`. `build_lib.py` (the maintained path) does not have this problem. Small fix for the
repo: insert the repo dir into `sys.path` inside the `-c` string, or drop generate.sh now that
build_lib.py exists. Related to SOL-20 (the `-c` string interpolation).

Logs: nimo `~/qwen38-staging/logs/cad-verify.log`, `cad-verify2.log`.
