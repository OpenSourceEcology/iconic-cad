# Reproduction scripts

Run the project-wide Node suite from anywhere:

```bash
bash run-node-suite.sh /Users/cct/code/iconic-cad
```

Run targeted JavaScript checks with Node and the IFC check with the repository's Python environment:

```bash
node check-top-plates.mjs
node check-member-overlaps.mjs
node check-header-depth.mjs
node check-skirt-depth.mjs
node check-second-story.mjs
node check-system-manifest-freeze.mjs
node check-enumerator-data-use.mjs
node check-stock-plates.mjs
node check-load-transaction.mjs
node check-props-save.mjs
node check-foundation-estimate-purity.mjs
/Users/cct/code/iconic-cad/.venv/bin/python check-ifc-foundation.py
```

The `.mjs` imports assume this audit output and `/Users/cct/code/iconic-cad` retain their current sibling locations. `check-member-overlaps.mjs` intentionally exits nonzero while its seven positive-volume overlaps are present. The other targeted scripts exit zero when they reproduce the audited behavior and throw/exit nonzero if their fixture no longer behaves as recorded. The IFC script stubs NumPy/IfcOpenShell only far enough to record the real exporter's dispatch calls; it does not validate a real IFC file.
