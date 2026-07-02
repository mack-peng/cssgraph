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

When an AI agent needs to understand CSS — where is `.btn-primary` defined, what properties does it have, which other selectors override it — it discovers style the slow way: grep, glob, and Read, one file at a time, reconstructing the cascade by hand.

**cssgraph hands the agent the exact style context it needs in one call.** It's a pre-built knowledge graph of every className, CSS property, variable, and at-rule in your stylesheets — so instead of crawling files, the agent asks one question and gets back the properties, overrides, specificity, and callers in full.

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

`cssgraph init` creates the local `.cssgraph/` directory and builds the full style graph in one step.

### 3. Add to your agent (MCP)

Add to your agent's MCP server config:

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

Or run `cssgraph install` to auto-detect and configure supported agents.

### 4. No more syncing

Auto-sync is enabled by default. cssgraph watches the project and updates the graph on every file change — while your agent edits code, or you add/modify/delete CSS files. **The index is never stale.**

---

## How It Works

```
┌──────────────────────────────────────────────────────┐
│                     AI Agent                          │
│                                                      │
│  "What styles affect .btn-primary?"                  │
│      calls cssgraph_explore — one tool call          │
│                            │                         │
└────────────────────────────┬────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────┐
│                 cssgraph MCP Server                   │
│                                                      │
│ explore · one call → properties + overrides +        │
│ specificity + callers grouped by file                │
│                            │                         │
│                            ▼                         │
│              SQLite knowledge graph                  │
│    classNames · properties · variables · at-rules    │
│           edges · FTS5 full-text search              │
└──────────────────────────────────────────────────────┘
```

1. **Extraction** — PostCSS parses CSS/SCSS/Less into ASTs. Walk rules to extract class selectors, properties, CSS variables, and at-rules.
2. **Storage** — Everything goes into a local SQLite database (`.cssgraph/cssgraph.db`) with FTS5 full-text search.
3. **Graph** — Edges connect related nodes: `contains` (selector→property), `nests` (parent→child selector), `overrides` (higher specificity selector overrides lower), `imports` (file→imported file), `references` (property→CSS variable).
4. **Auto-Sync** — The MCP server watches your project using native OS file events. Changes are debounced and incrementally synced.

---

## CLI Reference

```bash
cssgraph init [path]              # Initialize a project + build its graph
cssgraph index [path]             # Rebuild the full index from scratch
cssgraph query <className>        # Search for className selectors and properties
cssgraph explore <query...>       # One-shot: full style context for a className
cssgraph impact <className>       # Analyze what is affected by changing a className
cssgraph files [path]             # Show project style file structure
cssgraph status [path]            # Show index statistics
cssgraph sync [path]              # Incremental update
cssgraph serve --mcp              # Start the MCP server
```

---

## MCP Tools

| Tool | Purpose |
|------|---------|
| `cssgraph_explore` | **PRIMARY**: Get full style context for a className — properties, overrides, specificity, and callers in one call |
| `cssgraph_search` | Search for className selectors by name |
| `cssgraph_callers` | Find JSX components that reference a className |
| `cssgraph_impact` | Analyze the impact radius of changing a className |
| `cssgraph_files` | List project style files from the index |
| `cssgraph_status` | Show index statistics |

---

## Supported Languages

| Language | Extension | Status |
|----------|-----------|--------|
| CSS | `.css` | Full support |
| SCSS / Sass | `.scss` | Full support (nesting, `&` parent, variables, `@use`/`@forward`/`@import`) |
| Less | `.less` | Parse support (nesting, variables) |
| CSS Modules | `.module.css`, `.module.scss` | Source className extraction (hash reverse mapping in V2) |
| Tailwind | `tailwind.config.js` | Utility class → CSS property mapping table |

---

## Supported Agents

cssgraph works as an MCP server with any MCP-compatible agent:

- **opencode**
- **Claude Code**
- **Cursor**
- **Codex CLI**
- **Gemini CLI**
- **Kiro**

Run `cssgraph install` to auto-detect and configure supported agents.

---

## Configuration

Zero-config by default. cssgraph auto-detects style files and excludes `node_modules`, `dist`, `build`, `.git`, `.next`, `.cssgraph` and `.gitignore`d paths automatically.

To keep something else out, add it to `.gitignore`. To pull a default-excluded directory back in, add a negation — `!vendor/`.

### `.cssgraph.json`

Optional project-level config at your project root:

```json
{
  "exclude": ["static/vendor/", "**/legacy/**"],
  "extensions": {
    ".pcss": "css"
  }
}
```

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
