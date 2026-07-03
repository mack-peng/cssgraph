# V2: impact-selector command — Code Design

## Problem

Given a CSS selector, find which **code files** (JS/TS/JSX/TSX/ES6) are affected
by modifying it.

Example: "I'm changing `.s-dash-content .s-dash-content-header` — which component
files will be impacted?"

## Current state

The data is already in the DB. `cssgraph index --jsx` builds `references` edges
from JSX/TSX `file` nodes to `class_selector` nodes. The existing
`analyzeRule()` produces `classUsage` and `classToFiles` sets that contain
exactly the answer.

What's missing is a **CLI command** and **MCP tool** that surfaces only the
affected code files (filtered to `.js/.jsx/.ts/.tsx/.es6`), without the full
selector-matching noise.

## Design

### New method: `CodeGraph.selectorImpact()`

```typescript
impact(selector: string, filter?: Language[]): {
  selector: string;
  classes: string[];
  definition: Array<{ filePath: string; line: number }>;
  strict: string[];   // files using ALL classes
  loose: string[];    // files using ANY class
}
```

Reuses `analyzeRule()` internally, filters loose/strict files to code
extensions only.

### CLI: `cssgraph impact-selector <selector>`

```
cssgraph impact-selector ".s-dash-content .s-dash-content-header"

  Definition:
    app/assets/stylesheets/dashboard-common.less:55
    app/assets/stylesheets/dashboard-reseller.less:25

  Affected code files (strict — uses all classes): 6
    fe/nextgen/app/scenes/resellerDashboard/ClientTab.tsx
    fe/nextgen/app/scenes/resellerDashboard/PartnerTab.tsx
    fe/nextgen/app/scenes/resellerDashboard/SXLPartnerTab.tsx
    fe/nextgen/app/scenes/resellerDashboard/billing/BillingTab.tsx
    fe/nextgen/app/scenes/salesDashboard/ResellerTab.tsx
    fe/nextgen/app/scenes/salesDashboard/StatsTab.tsx

  Affected code files (loose — uses any class): 9
    ... (+3 more)
```

Options:
- `--loose` — show loose instead of strict (default: strict)
- `--json` — machine-readable output
- `-p, --path <path>` — project root

### MCP tool: `cssgraph_impact_selector`

```
Input: { selector: string }
Output: Definition locations + affected code files (strict + loose)
```

### Implementation

| Task | File | Lines |
|------|------|-------|
| `selectorImpact()` method | `src/graph/index.ts` | ~15 |
| Expose on `CodeGraph` | `src/index.ts` | ~5 |
| CLI command | `src/bin/cssgraph.ts` | ~40 |
| MCP tool + handler | `src/mcp/index.ts` | ~20 |
| MCP instructions | `src/mcp/server-instructions.ts` | 1 |

**Total**: ~80 lines, no new files.

### Algorithm

```
selectorImpact(rawSelector):
  1. result = analyzeRule(rawSelector)
  2. codeExts = [js, jsx, ts, tsx, es6]
  3. filter looseFiles + strictFiles to only codeExts-suffix files
  4. definitionFiles = exactMatches.map(m => { filePath, line })
  5. return { selector, classes, definition, strict, loose }
```

Zero new DB queries — `analyzeRule` already produces all the data.

---

# V2: Worker thread pool — Code Design

## Problem

PostCSS parsing is CPU-bound. On a multi-core machine, a single-threaded
`cssgraph index --jsx` parses ~9,400 files sequentially, leaving N-1 cores idle.

## Design (mirrors codegraph's `parse-pool.ts`)

### Architecture

```
Main Thread                    Worker Pool (N threads)
───────────                    ───────────────────────
scan files
  ↓
detect languages
  ↓
spawn N workers
  ↓
for file batch of 10:
  read 10 files parallel
  dispatch to pool ←────────   Worker 1: parse file A
                                Worker 2: parse file B
                                Worker 3: parse file C (completed → buffer)
  on parse complete:       ←─  postMessage(result)
    completed.set(seq, result)
    flushOrdered()           →  store in DB (file order)
  backpressure: wait if
    windowSize full
  ↓
drain remaining
  ↓
commit final batch
```

### Files

| File | Purpose |
|------|---------|
| `src/extraction/parse-pool.ts` | `ParseWorkerPool` — idle-list dispatch, lazy growth, crash recovery, recycle |
| `src/extraction/parse-worker.ts` | Worker thread entry: `postcss` parse + `extractFromSource` |
| `src/index.ts` | Replace serial `extractFromSource` call with `pool.requestParse()` |

### ParseWorkerPool

```typescript
class ParseWorkerPool {
  constructor(opts: {
    size: number;            // N threads (default: cpuCores - 1, capped 8)
    workerScriptPath: string;
    recycleInterval: number; // 250 parses → restart worker (reclaim WASM/postcss heap)
    parseTimeoutMs: number;  // 10s timeout per parse
  })
  requestParse(task: ParseTask): Promise<ExtractionResult>;
  shutdown(): Promise<void>;
}
```

**Key behaviors**:
- **Idle-list dispatch**: workers sit in an idle list; new tasks are handed to idle workers; busy workers queue.
- **Lazy growth**: spawn workers on demand (cold-start is heavy — module + grammar load).
- **Recycle after N parses**: `node:worker_threads` heap grows but never shrinks. Restarting the worker thread reclaims memory.
- **Crash recovery**: worker crash → the parse Promise rejects; main thread records the error and continues. The pool auto-spawns a replacement.
- **Backpressure**: `completed` Map size bounded by `windowSize` (pool.size * 2). Main thread awaits `Promise.race(inFlight)` when window is full.

### Integration with existing P2 infra

The `flushOrdered` + `completed: Map<seq, StoreItem>` + `storeCursor` pattern
from P2 is already in the main loop. Switching from serial to pooled parse is:

```
// Before (serial)
for (const { filePath, source } of fileContents) {
  result = extractFromSource(filePath, source);
  const seq = nextSeq++;
  completed.set(seq, { ...result });
  flushOrdered();
}

// After (pooled)
const dispatch = async (filePath, source) => {
  const seq = nextSeq++;
  try {
    const result = await pool.requestParse({ filePath, source, language });
    completed.set(seq, { ...result });
  } catch (err) {
    completed.set(seq, { error: err });
  }
  flushOrdered();
};
```

No changes to `storeStyleFile`, `flushOrdered`, or the batch commit logic.

### Two-phase index for classSelectorMap

Style files must be parsed BEFORE JSX files (classSelectorMap must be populated).
Two-phase approach:

```
Phase 1: pool.dispatchAll(styleFiles)  → classSelectorMap populated
         (uses ordered flush, cursor stays sequential)
Phase 2: pool.dispatchAll(jsxFiles)    → references edges matched
```

Same pool, same workers, just dispatched in two sequential groups.

### Expected performance

| Scenario | Serial | 4 workers | 8 workers |
|----------|--------|-----------|-----------|
| production monorepo --jsx (9,400 files) | ~2m30s | ~1m15s | ~50s |
| production monorepo style-only (1,500) | ~45s | ~25s | ~18s |

Diminishing returns beyond 4 workers due to SQLite write serialization
(still single-threaded) and file I/O bandwidth.

### Rollback

Set `CSSGRAPH_PARSE_WORKERS=1` to force the old single-worker path. Size-1
pool is architecturally equivalent to serial parse.
