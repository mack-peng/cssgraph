# AGENTS.md

This file provides guidance to AI coding agents (opencode, Claude Code, Cursor, etc.) when working with code in this repository.

## Project Overview

cssgraph is a local-first CSS intelligence library + CLI + MCP server. It parses CSS/SCSS/Less/Sass files with PostCSS, extracts classNames/properties/variables/at-rules, JSX className references, and view template class attributes into SQLite (FTS5), and exposes a knowledge graph to AI agents over MCP. Per-project data lives in `.cssgraph/`. Extraction is deterministic — derived from PostCSS AST, not LLM-summarized.

Distributed as `cssgraph` on npm; same binary serves as indexer and MCP server.

## Build, Test, Run

```bash
npm run build           # tsc + copy schema.sql into dist/; chmods dist/bin/cssgraph.js
npm run dev             # tsc --watch
npm run clean           # rm -rf dist

npm test                # vitest run (all)
npm run test:watch

npm run cli             # build then run the local dist binary
```

`copy-assets` (called from `build`) copies `src/db/schema.sql` into `dist/`. **Any new SQL must be copied or it won't ship.**

Node engines: `>=22.5.0 <25.0.0` (`node:sqlite` is required).

## Architecture

```
files       → PostCSS / CSS-in-JS / JSX extractors / template extractor
               ↓
                 DB (nodes/edges/files)
               ↓
                 GraphTraverser (BFS/DFS, callers, callees, impact)
               ↓
                 ContextBuilder (markdown output for AI consumption)
```

### Module layout

- `src/index.ts` — `CodeGraph` class: `init`/`open`/`close`, `indexAll`, `sync`, `reinit`, `searchNodes`, `selectorDetails`, `analyzeRule`, `explore`, `watch`/`unwatch`.
- `src/db/` — `DatabaseConnection`, `QueryBuilder` (prepared statements), `schema.sql`. Backed by Node's built-in **`node:sqlite`** (`DatabaseSync`) — real SQLite with WAL + FTS5. Index-mode pragmas (`synchronous=OFF`, 500MB cache) applied during indexing only.
- `src/extraction/` — Extractors:
  - `postcss-extractor.ts` — PostCSS parsing core (css/scss/less/sass/pcss)
  - `css-in-js-extractor.ts` — styled-components / emotion `css` templates
  - `jsx-classname-extractor.ts` — JSX `className="..."` reference extraction (O(n) line lookup via pre-computed offset table)
  - `template-classname-extractor.ts` — ERB/Haml/HTML `class="..."` and Haml `.classname` extraction
  - `css-modules-resolver.ts` — dynamic `import()` / `require()` CSS module detection
  - `selector-builder.ts` — Less/SCSS nesting expansion (`&` handling)
  - `specificity.ts` — CSS specificity calculator
  - `tailwind-mapper.ts` — Tailwind v3 JS config + v4 `@theme` mapping
  - `git-scanner.ts` — `git ls-files` fast file discovery (fallback to filesystem walk)
  - `parse-pool.ts` — Worker thread pool for parallel PostCSS parsing
- `src/graph/` — `GraphTraverser` (BFS/DFS, impact radius, path finding) and `GraphQueryManager` (high-level queries: `analyzeRule`, `getCascade`, `getSelectorDetails`).
- `src/context/` — `ContextBuilder` for markdown output.
- `src/sync/` — `FileWatcher` (native FS events) with debounce + filter.
- `src/mcp/` — MCP server with 12 tools (see below). Server instructions in `src/mcp/server-instructions.ts`.
- `src/bin/cssgraph.ts` — CLI (commander). Subcommands: `init`, `index`, `query`, `explore`, `impact`, `impact-selector`, `rule`, `details`, `unused`, `cascade`, `property`, `files`, `status`, `sync`, `serve --mcp`, `install`, `uninstall`.
- `src/config.ts` — mtime-cached `.cssgraph.json` project config loader.

### NodeKind / EdgeKind

- **NodeKind**: `file`, `class_selector`, `css_property`, `css_variable`, `at_rule`, `styled_component`, `jsx_component`.
- **EdgeKind**: `contains`, `nests`, `overrides`, `imports`, `references`, `exports`.

### Language support

| Extension | Language | Extraction |
|-----------|----------|------------|
| `.css` | css | PostCSS standard |
| `.scss` | scss | postcss-scss plugin |
| `.less` | less | postcss-less plugin |
| `.sass` | sass | Compile via `sass` package, then PostCSS |
| `.pcss` | pcss | PostCSS standard |
| `.jsx` / `.tsx` | jsx/tsx | className references + CSS-in-JS |
| `.js` / `.ts` | js/ts | className + CSS Modules |
| `.es6` | es6 | Treated as JS |
| `.erb` | erb | `class="..."` attribute extraction |
| `.haml` | haml | `.classname` shorthand + `{:class =>}` hash |
| `.html` | html | `class="..."` attribute extraction |

## MCP Tools

| Tool | Purpose |
|------|---------|
| `cssgraph_explore` | **PRIMARY**: Full style context for a className — properties, overrides, specificity, callers |
| `cssgraph_search` | Search for className selectors by name |
| `cssgraph_callers` | Find JSX components referencing a className |
| `cssgraph_impact` | Blast radius of changing a className |
| `cssgraph_rule` | Blast radius of a full CSS selector (exact + loose/strict impact) |
| `cssgraph_impact_selector` | Find code files (JS/TS/JSX/TSX) affected by a CSS selector |
| `cssgraph_details` | Quick O(1) exact selector lookup (no edges query) |
| `cssgraph_unused` | Find class selectors with no incoming references |
| `cssgraph_cascade` | Visualize the cascade path for a className |
| `cssgraph_property` | Search selectors by CSS property value |
| `cssgraph_files` | Indexed style file tree |
| `cssgraph_status` | Index health check |

## Indexing pipeline

**Git-first file discovery**: `git ls-files` lists all tracked + untracked-not-ignored files (auto-respects `.gitignore`; no `ignore` library needed). Falls back to explicit-stack filesystem walk for non-git projects.

**Single-pass bucketing**: style files go into `styleFiles[]`, ERB/Haml/HTML into `viewFiles[]`, JS/TS/JSX/TSX/es6 into `jsxFiles[]`. Style files are always indexed first so `classSelectorMap` is populated before JSX/view references are matched.

**Rolling-window pipeline**: files are dispatched continuously to worker threads via `feed()`. Results are buffered out-of-order in a `completed: Map<seq, item>` and drained sequentially by `drainOrdered()` → `flushOne()`. **Ref resolution happens in `flushOne()` (ordered), not `feed()` (concurrent)** — so `classSelectorMap` is always complete when JSX/view references are matched. Backpressure bound = `pool.size * 2`. Worker pool size defaults to `cpuCores - 1` (cap 8), controlled by `--workers <n>` or `CSSGRAPH_PARSE_WORKERS`.

**Batch I/O reads**: 10 files read in parallel (`Promise.all(fsp.readFile)`), no unnecessary `fsp.stat` calls.

**Batch DB inserts with periodic COMMIT**: nodes are inserted in 50-row batches, edges in 100-row batches (pre-compiled prepared statements). A `COMMIT`/`BEGIN` cycle runs every ~100 files. Per-file errors are caught at the `feed()` level; the errored file gets a sentinel empty result and is flushed with zero nodes/edges.

**DB bulk-load optimization**: FTS5 triggers and `idx_edges_identity` are dropped before bulk indexing. Edges are inserted with plain `INSERT INTO` (no unique-index B-tree probe). FTS5 is rebuilt in one `INSERT INTO nodes_fts ... VALUES('rebuild')` after all data is committed. The edge identity index is recreated via `CREATE UNIQUE INDEX`; if duplicates somehow exist, a catch block runs a one-time dedup (`DELETE ... WHERE id NOT IN (SELECT MIN(id) GROUP BY ...)`) then retries the index creation. Stats are cached in `project_metadata` at index end for fast `cssgraph status` retrieval.

**Default excludes** (built-in, not from `.gitignore`):
- `**/*.test.*` / `**/*.stories.*` / `**/*.spec.*` / `**/*.min.*`
- `**/__tests__/**` / `**/__snapshots__/**` / `**/__mocks__/**`
- `**/generated/**` / `**/spec/**` / `**/vendor/**`

Plus `.cssgraph.json` project-level `exclude` patterns.

## Usage flow

First-time setup:
```bash
cssgraph init --workers 8  # index all files with 8 worker threads (~3-5m)
cssgraph serve --mcp        # start MCP server (auto-syncs changes)
```

After checkout or edits:
```bash
cssgraph sync               # incremental update (~2s)
cssgraph index --workers 8  # full re-index (if index corrupt or version bump)
```

## Performance

Production monorepo (~11K files — 1,500 style + 1,800 view templates + 7,900 JS/TS/JSX/es6):
- `cssgraph index --workers 8`: ~3-5m
- Reference DB: ~3GB, 780K nodes, ~22M edges
- Repeat index (content-hash skip): <4m
- Incremental sync: ~2s

## House rules

- The codebase structure deliberately mirrors codegraph's architecture — same layering, same naming conventions, same API patterns. When adding new features, look at codegraph's corresponding module first.
- cssgraph provides **CSS context**, not product requirements. For new features, ask the user about supported formats, edge cases, and acceptance criteria.
- **Do not bump the version unless explicitly asked.**
- PostCSS syntax plugins (`postcss-scss`, `postcss-less`) are required via `require()`, not ESM imports — they're loaded dynamically per file language.
- The file watcher uses `fs.watch` with `recursive: true`. On Linux, this may hit inotify limits; set `CSSGRAPH_WATCH_DEBOUNCE_MS` env var to tune.
- Node IDs are `sha256(filePath:fullSelector:className)` — line-number independent. Style file edits that only change property values keep the same selector IDs, so `references` edges survive `INSERT OR REPLACE` automatically.
