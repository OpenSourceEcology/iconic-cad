# Failed layout imports preserve the current design

Previously, importing a mixed-system layout reset the current design and undo history before throwing. A later invalid entity left an earlier entity from the rejected file in the editor. Unknown module IDs were silently omitted.

The loader now prepares a detached candidate before resetting the editing session. Mixed systems, unknown modules and malformed containers reject the whole import. Successful imports retain the existing reset behavior, legacy `modules` support, foundation records and default second-story level. This is not a full geometry/schema validator.

Validation:

- Eight new regression cases failed before the change; all pass after it. The existing load-reset suite now passes 19 checks, including unchanged object references and UI/undo/redo state after rejection.
- All 22 relevant JavaScript suites passed, including the existing main CI list plus system-loading/manifest checks.
- A real Chromium file-input check loaded a synthetic saved design, rejected a later mixed-system entity, confirmed unchanged document/UI/history and the error dialog, then successfully loaded another valid design. No browser errors occurred.
- Independent review reran 31 checks across load reset, system loading and project shape; no blocker found.

No geometry, library, deployment or public construction claim changed.
