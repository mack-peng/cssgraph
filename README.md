<div align="center">

# cssgraph

### CSS Intelligence for AI Coding Agents

**Surgical style context · fewer tool calls · faster answers · 100% local**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.5.0-brightgreen.svg)](https://nodejs.org/)

[![macOS](https://img.shields.io/badge/macOS-supported-blue.svg)](#supported-platforms)
[![Linux](https://img.shields.io/badge/Linux-supported-blue.svg)](#supported-platforms)
[![Windows](https://img.shields.io/badge/Windows-supported-blue.svg)](#supported-platforms)

</div>

---

## Why cssgraph?

When an AI agent needs to understand CSS — where is `.btn-primary` defined, what properties does it have, which selectors cascade over it, which JSX components reference it — it discovers style the slow way: grep, glob, and Read, one file at a time, reconstructing the cascade by hand.

**cssgraph hands the agent the exact style context it needs in one call.** It's a pre-built knowledge graph of every className, CSS property, variable, and at-rule in your stylesheets — so instead of crawling files, the agent asks one question and gets back the properties, overrides, specificity, callers, and file-level impact in full.

## Get Started

### 1. Install

```bash
npm i -g cssgraph
```

Requires Node.js >= 22.5.0 (for built-in `node:sqlite`).

### 2. Initialize each project

```bash
cd your-project
cssgraph init
```

`cssgraph init` creates the local `.cssgraph/` directory and builds the full style graph in one step. Supports CSS, SCSS, Less, Sass (indented), and PostCSS custom syntaxes.

### 3. Add to your agent (MCP)

```bash
cssgraph install
```

Auto-detects and configures opencode, Claude Code, Cursor, Codex CLI, Gemini CLI, and Kiro.

Or add manually:

```json
{
  "mcpServers": {
    "cssgraph": {
      "type": "stdio",
      "command": "cssgraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```

### 4. No more syncing

Auto-sync is enabled by default. cssgraph watches the project and updates the graph on every file change — while your agent edits code, or you add/modify/delete CSS files. **The index is never stale.**

---

## How It Works

```
┌───────────────────────────────────────────────────────────┐
│                      AI Agent                              │
│                                                           │
│  "What code files use .btn-primary?"                      │
│      calls cssgraph_rule — one tool call                  │
│                             │                             │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│                  cssgraph MCP Server                       │
│                                                           │
│ rule · O(1) exact selector lookup · loose/strict impact   │
│ explore · properties + overrides + specificity + callers  │
│                             │                             │
│                             ▼                             │
│               SQLite knowledge graph                      │
│     classNames · properties · variables · at-rules        │
│            edges · FTS5 full-text search                  │
└───────────────────────────────────────────────────────────┘
```

1. **Extraction** — PostCSS parses CSS/SCSS/Less/Sass into ASTs. CSS-in-JS (`styled.div`) and JSX className references extracted from `.jsx`/`.tsx` files with `--jsx`.
2. **Storage** — Everything goes into a local SQLite database (`.cssgraph/cssgraph.db`) with FTS5 full-text search. WAL-mode + batch commits for write performance.
3. **Graph** — Edges connect related nodes: `contains` (selector→property), `nests` (parent→child selector), `overrides` (higher specificity selector overrides lower), `imports` (file→imported file), `references` (JSX file→className, property→CSS variable).
4. **Git-first scanning** — `git ls-files` for instant file discovery. Falls back to filesystem walk on non-git projects.
5. **Auto-Sync** — Native OS file events, debounced, incrementally synced.

---

## CLI Reference

```bash
cssgraph init [path]                 # Initialize + build graph
cssgraph index [path] [--jsx]        # Rebuild from scratch
cssgraph query <className>           # Search for className selectors
cssgraph explore <query...>          # Full style context for a className
cssgraph details <selector>          # O(1) exact selector → file:line lookup
cssgraph rule <selector> [--strict]  # Selector impact: exact + loose/strict files
cssgraph impact-selector <selector> # Code files affected by a selector
cssgraph impact <className>          # Blast radius of changing a className
cssgraph unused                      # Find unreferenced class selectors
cssgraph cascade <className>         # Visualize cascade path
cssgraph property <query...>         # Search by CSS property value
cssgraph files [path]                # Project style file tree
cssgraph status [path]               # Index statistics
cssgraph sync [path]                 # Incremental update
cssgraph serve --mcp                 # Start MCP server
cssgraph install                     # Auto-wire to your AI agent
```

### `--jsx` flag

Opt-in scanning of `.jsx`/`.tsx`/`.js`/`.ts`/`.es6` files for:
- **className references** — `className="btn primary"` → builds `references` edges from component files to className nodes
- **CSS-in-JS** — `styled.div\`...\`` and `css\`...\`` templates
- **CSS Modules** — `import styles from './X.module.css'` and dynamic `import()` / `require()`

Without `--jsx`, cssgraph indexes style files only (CSS, SCSS, Less, Sass). This is the fast path — 500 style files in ~45s on bobcat. With `--jsx`, 9,400 files total in ~2m30s.

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `cssgraph_explore` | **PRIMARY**: Full style context for a className — properties, overrides, specificity, callers |
| `cssgraph_search` | Search for className selectors by name |
| `cssgraph_callers` | Find JSX components referencing a className |
| `cssgraph_impact` | Blast radius of changing a className |
| `cssgraph_rule` | Blast radius of a full CSS selector (exact match + loose/strict file impact) |
| `cssgraph_impact_selector` | Find code files (JS/TS/JSX/TSX) affected by a CSS selector |
| `cssgraph_details` | O(1) exact selector lookup (no edges, lightweight) |
| `cssgraph_unused` | Find class selectors with no incoming references |
| `cssgraph_cascade` | Visualize the cascade path for a className |
| `cssgraph_property` | Search selectors by CSS property value |
| `cssgraph_files` | Indexed style file tree |
| `cssgraph_status` | Index health check |

---

## Supported Languages

| Language | Extension | Extraction |
|----------|-----------|------------|
| CSS | `.css` | PostCSS standard |
| SCSS | `.scss` | postcss-scss plugin |
| Less | `.less` | postcss-less plugin |
| Sass (indented) | `.sass` | Compile → PostCSS |
| PostCSS custom | `.pcss` | PostCSS standard |
| JSX / TSX | `.jsx` `.tsx` | className + CSS-in-JS (`--jsx`) |
| JavaScript / TypeScript | `.js` `.ts` `.es6` | className + CSS Modules (`--jsx`) |
| CSS Modules | `.module.css` `.module.scss` `.module.less` | Dynamic import resolution |
| Tailwind | `tailwind.config.js` + CSS `@theme` | v3 JS config + v4 CSS config |

---

## Production Scale

| Project | Style files | --jsx total | First index | Nodes | Edges |
|---------|-----------|-------------|-------------|-------|-------|
| Small | ~50 | — | ~15s | ~16K | ~50K |
| Bobcat (Strikingly) | 1,500 | 9,400 | ~2m30s | 450K | 5.3M |

---

## Project Configuration

Zero-config by default. Optional `.cssgraph.json` at your project root:

```json
{
  "exclude": ["static/vendor/", "**/legacy/**"],
  "extensions": {
    ".pcss": "css"
  }
}
```

Built-in default excludes (always applied): `*.test.*`, `*.stories.*`, `*.spec.*`, `__tests__/`, `generated/`.

---

## Supported Platforms

| Platform | Architectures | Install |
|----------|---------------|---------|
| macOS | x64, arm64 | npm |
| Linux | x64, arm64 | npm |
| Windows | x64, arm64 | npm |

---

## License

MIT
