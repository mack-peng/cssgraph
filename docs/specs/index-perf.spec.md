# Index Performance Rebuild Spec

## Problem

`cssgraph index --jsx` on a production monorepo (9,400+ files) initially took **9 minutes**.
Every re-index was a **full rebuild** — all files re-parsed and re-inserted,
even when nothing changed. The bottleneck chain was:

1. **Filesystem walk** scanning every directory entry (30s+).
2. **Per-file `BEGIN/COMMIT`** — 9,414 transactions, each triggering disk fsync.
3. **PostCSS parsing** 1,486 style files + JSX/className scanning 7,928 JS files.
4. **No caching** of project config (`.cssgraph.json` read on every scan).
5. **No size guard** — minified bundles parsed unnecessarily.

## Solution

Three optimisation tiers (P0 → P1 → P2), each building on the last.

### P0 — Index-time elimination (source: codegraph patterns)

| #   | Change                             | Effect                           |
| --- | ---------------------------------- | -------------------------------- |
| P0.1 | `git ls-files` replaces filesystem walk | Scan from ~30s → <1s            |
| P0.2 | Content-hash skip for unchanged style files | Second index skips parse+insert |
| P0.3 | mtime-cached `.cssgraph.json` load | Zero I/O on repeat calls         |

### P1 — I/O pipeline

| #   | Change                             | Effect                          |
| --- | ---------------------------------- | ------------------------------- |
| P1.1 | Batch I/O reads (10 at a time)     | Overlaps disk wait across files |
| P1.2 | `setImmediate` yield during scan   | Progress bar stays responsive   |
| P1.3 | Skip files >1 MB                   | Avoids parsing generated code   |

### P2 — Worker pool preparation

| #   | Change                             | Effect                          |
| --- | ---------------------------------- | ------------------------------- |
| P2.1 | `storeStyleFile()` extractor       | Decouples parse from store      |
| P2.2 | `flushOrdered()` cursor-based commit | Enables out-of-order parse commit |

## Requirements

| # | Requirement | Acceptance criteria |
|---|-------------|---------------------|
| R1 | Git-first file discovery | scan < 5s; fallback to walk on non-git |
| R2 | Unchanged files skip parse | Second `index --jsx` processes only changed files |
| R3 | mtime-cached config | Repeated `loadProjectConfig` hits cache |
| R4 | Batch I/O reads | Parallel `readFile` batches of 10 |
| R5 | Scan yields to event loop | Progress bar updates every ≤200 files |
| R6 | Max file size guard | Files > 1MB skipped |
| R7 | Store extraction decoupled | `storeStyleFile` independent of parse |
| R8 | Ordered commit buffer | `flushOrdered` accepts out-of-order results |
| R9 | No regression | All existing queries (details, rule, explore) unchanged |

## Sign-off

- [x] production monorepo `index --jsx` initial: **3m 36s** (P0 applied, was 5m08s before any perf work, 9m04s at baseline)
- [x] production monorepo `index --jsx` repeat (no changes): 3m 05s parsing phase
- [x] `cssgraph details ".container .sixteen.columns"` — correct
- [x] `cssgraph rule ".s-dash-content .s-dash-content-header" --strict` — correct
- [x] Non-git fallback: filesystem walk untouched
