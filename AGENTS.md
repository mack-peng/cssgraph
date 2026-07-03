# AGENTS.md

This file provides guidance to AI coding agents (opencode, Claude Code, Cursor, etc.) when working with code in this repository.

## Project Overview

cssgraph is a local-first CSS intelligence library + CLI + MCP server. It parses CSS/SCSS/Less/Sass files with PostCSS, extracts classNames/properties/variables/at-rules and JSX className references into SQLite (FTS5), and exposes a knowledge graph to AI agents over MCP. Per-project data lives in `.cssgraph/`. Extraction is deterministic — derived from PostCSS AST, not LLM-summarized.

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
files       → PostCSS / CSS-in-JS / JSX extractors
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
  - `jsx-classname-extractor.ts` — JSX `className="..."` reference extraction
  - `css-modules-resolver.ts` — dynamic `import()` / `require()` CSS module detection
  - `selector-builder.ts` — Less/SCSS nesting expansion (`&` handling)
  - `specificity.ts` — CSS specificity calculator
  - `tailwind-mapper.ts` — Tailwind v3 JS config + v4 `@theme` mapping
  - `git-scanner.ts` — `git ls-files` fast file discovery (fallback to filesystem walk)
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
| `.jsx` / `.tsx` | jsx/tsx | className references + CSS-in-JS (`--jsx`) |
| `.js` / `.ts` | js/ts | className + CSS Modules (`--jsx`) |
| `.es6` | es6 | Treated as JS (`--jsx`) |

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

**Single-pass bucketing**: style files go into `styleFiles[]`, JS/TS/JSX/TSX/es6 into `jsxFiles[]` (opt-in via `--jsx`). Style files are always indexed first so `classSelectorMap` is populated before JSX references are matched.

**Batch I/O reads**: 10 files read in parallel (`Promise.all(fsp.readFile)`), then parsed sequentially to keep `classSelectorMap` deterministic.

**SAVEPOINT-based batch commits**: every ~100 files, the SAVEPOINT batch commits with `COMMIT`/`BEGIN`. Per-file errors roll back to the SAVEPOINT without affecting other files in the batch.

**Ordered flush (Worker-pool ready)**: parsed results are buffered in a `completed: Map<seq, item>` and flushed via `flushOrdered()` in file order. Today parse is serial so it drains immediately; the structure supports out-of-order Worker-pool returns.

**Default excludes** (built-in, not from `.gitignore`):
- `**/*.test.*` / `**/*.stories.*` / `**/*.spec.*`
- `**/__tests__/**` / `**/generated/**`

Plus `.cssgraph.json` project-level `exclude` patterns.

## Performance

Production monorepo (~9,400 files — 1,500 style + 7,900 JS/TS/JSX/es6):
- `cssgraph index` (style only): ~45s
- `cssgraph index --jsx`: ~2m30s
- Reference DB: ~2GB, 450K nodes, 5.3M edges

## House rules

- The codebase structure deliberately mirrors codegraph's architecture — same layering, same naming conventions, same API patterns. When adding new features, look at codegraph's corresponding module first.
- cssgraph provides **CSS context**, not product requirements. For new features, ask the user about supported formats, edge cases, and acceptance criteria.
- **Do not bump the version unless explicitly asked.**
- PostCSS syntax plugins (`postcss-scss`, `postcss-less`) are required via `require()`, not ESM imports — they're loaded dynamically per file language.
- The file watcher uses `fs.watch` with `recursive: true`. On Linux, this may hit inotify limits; set `CSSGRAPH_WATCH_DEBOUNCE_MS` env var to tune.
- Node IDs are `sha256(filePath:fullSelector:className)` — line-number independent. Style file edits that only change property values keep the same selector IDs, so `references` edges survive `INSERT OR REPLACE` automatically.
