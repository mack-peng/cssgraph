# AGENTS.md

This file provides guidance to AI coding agents (opencode, Claude Code, Cursor, etc.) when working with code in this repository.

## Project Overview

cssgraph is a local-first CSS intelligence library + CLI + MCP server. It parses CSS/SCSS/Less files with PostCSS, stores classNames/properties/variables/at-rules as nodes and edges in SQLite (FTS5), and exposes a knowledge graph to AI agents over MCP. Per-project data lives in `.cssgraph/`. Extraction is deterministic — derived from PostCSS AST, not LLM-summarized.

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
files → PostCSS Extractor → DB (nodes/edges/files)
              ↓
        Import Resolver (SCSS @use/@forward)
              ↓
        GraphTraverser (BFS/DFS, callers, callees, impact)
              ↓
        ContextBuilder (markdown output for AI consumption)
```

### Module layout

- `src/index.ts` — `CodeGraph` class: `init`/`open`/`close`, `indexAll`, `sync`, `searchNodes`, `getCallers`/`getCallees`, `getImpactRadius`, `explore`, `watch`/`unwatch`.
- `src/db/` — `DatabaseConnection`, `QueryBuilder` (prepared statements), `schema.sql`. Backed by Node's built-in **`node:sqlite`** (`DatabaseSync`) — real SQLite with WAL + FTS5.
- `src/extraction/` — `postcss-extractor.ts` (PostCSS parsing core), `selector-builder.ts` (SCSS nesting expansion), `specificity.ts` (CSS specificity calculator), `css-modules-resolver.ts`, `import-resolver.ts`, `tailwind-mapper.ts`.
- `src/graph/` — `GraphTraverser` (BFS/DFS, impact radius, path finding) and `GraphQueryManager` (high-level queries).
- `src/context/` — `ContextBuilder` for markdown output.
- `src/sync/` — `FileWatcher` (native FS events) with debounce + filter.
- `src/mcp/` — MCP server (`MCPServer` with 6 tools: `cssgraph_explore`, `cssgraph_search`, `cssgraph_callers`, `cssgraph_impact`, `cssgraph_files`, `cssgraph_status`).
- `src/bin/cssgraph.ts` — CLI (commander). Subcommands: `init`, `index`, `query`, `explore`, `impact`, `files`, `status`, `sync`, `serve --mcp`.

### NodeKind / EdgeKind

- **NodeKind**: `file`, `class_selector`, `css_property`, `css_variable`, `at_rule`.
- **EdgeKind**: `contains`, `nests`, `overrides`, `imports`, `references`, `exports`.

## MCP Tool Design

- **`cssgraph_explore`** is the PRIMARY tool — one call returns the className's full properties, overrides, specificity, and callers grouped by file. Modeled on codegraph's `codegraph_explore`.
- Other tools (`search`, `callers`, `impact`, `files`, `status`) stay functional for when the agent needs narrower queries.
- Server instructions are the single source of truth for agent-facing tool guidance (`src/mcp/server-instructions.ts`).

## House rules

- The codebase structure deliberately mirrors codegraph's architecture — same layering, same naming conventions, same API patterns. When adding new features, look at codegraph's corresponding module first.
- cssgraph provides **CSS context**, not product requirements. For new features, ask the user about supported formats, edge cases, and acceptance criteria.
- **Do not bump the version unless explicitly asked.**
- PostCSS syntax plugins (`postcss-scss`) are required via `require()`, not ESM imports — they're loaded dynamically per file language.
- The file watcher uses `fs.watch` with `recursive: true`. On Linux, this may hit inotify limits; set `CSSGRAPH_WATCH_DEBOUNCE_MS` env var to tune.
