# SOL-02 implementation notes

## What changed

- Window subheaders are emitted on the sole plate before the lower cripples.
- Lower cripples now start at the subheader top face and end at the sill
  underside. Horizontal sill blocking is measured upward from the subheader top.
- The existing short-zone guard remains: a subheader is added only when the
  zone can hold it plus more than the existing 1 mm positive-extent margin;
  otherwise any positive lower cripples start on the sole plate and the shared
  `emit` guard drops non-positive members.
- The three generated window expectations no longer allow lower
  cripple/subheader overlap, and their obsolete Issue #12 metadata was removed.
- `members.json` and the generated landing-page window elevation were refreshed.
- JS/Python parity, cut-list/fabrication-card, BOM stock, and strict overlap
  regressions now pin the corrected geometry.

`seh_lib/wall_builder.py` was inspected and not changed: it does not derive
cripple geometry. It consumes `web/assets/lib/members.json` and transcribes each
record directly into a box, preserving member order and dimensions.

## Exact before/after geometry

All three stock window modules have the same 24 in sill elevation. For
`window_4x8_2x6_36x48` (dimensions in mm):

| Member/face | Before | After |
| --- | ---: | ---: |
| Sole plate top | Z = 38.1 | Z = 38.1 |
| Subheader | Z = 38.1, H = 38.1, top = 76.2 | unchanged |
| Each lower cripple | Z = 38.1, H = 533.4 (21 in) | Z = 76.2, H = 495.3 (19.5 in) |
| Sill underside | Z = 571.5 | Z = 571.5 |
| Sill | Z = 571.5, H = 38.1, top = 609.6 | unchanged |

Before, each lower cripple overlapped the subheader from Z = 38.1 through
76.2 mm. After, the subheader top and cripple bottom are both Z = 76.2 mm:
face contact only, with zero positive overlap.

## Verification output

Strict positive-volume overlap multiset and focused three-window contact/length
checks:

```text
$ node tests/member_overlaps.mjs
positive-volume framing overlaps: 7 before SOL-02 -> 1 after SOL-02

4 passed, 0 failed
```

The one remaining occurrence is
`garage_9x8_2x6_96x84:header+top_plate` (count 1), the out-of-scope SOL-03
case. The complete Node sweep passed all 23 `tests/*.mjs` files. Notable pinned
results were:

```text
tests/enumerate_parity.mjs: 9 passed, 0 failed
tests/plate_policy.mjs: 160 passed, 0 failed
tests/build_summary.mjs: 44 passed, 0 failed
tests/stock_pricing.mjs: 55 passed, 0 failed
```

Python and generated-artifact verification:

```text
$ /Users/cct/code/iconic-cad/.venv/bin/python -m pytest tests
collected 28 items
============================== 28 passed in 0.11s ==============================

$ /Users/cct/code/iconic-cad/.venv/bin/python scripts/gen_library_entries.py --verify
PASS
$ /Users/cct/code/iconic-cad/.venv/bin/python scripts/gen_wall_instances.py --verify
PASS
$ node scripts/export_members.mjs --verify
OK: web/assets/lib/members.json matches enumerateMembers() for 15 modules
```

## Differences from the brief's assumptions

- The Python member-to-box path does not independently derive cripple geometry;
  it consumes the exported JS member records.
- `wall_instances.yaml` and `web/assets/lib/specs.json` were regenerated but
  remained byte-identical because SOL-02 changes member geometry, not module
  parameters.
- Lower-cripple cut lengths changed, but member count and purchased BOM stock did
  not: both 19.5 in pieces still map to two `2x6_8ft` stock items per window.
- The window fabrication template currently has no authored procedure, and the
  card's height chain describes only the full-height stud/plate stack. The
  derived cut-list row on the card changed to two 19.5 in cripples; there was no
  window procedure or lower-cripple height-chain literal to update.
- `landing/index.html` is another owned generated member-geometry artifact; its
  window hero was regenerated after the all-Node test sweep detected drift.
