# Installation

## Requirements

- **Node.js >= 22.5.0** — cssgraph uses Node's built-in `node:sqlite` module. Check your version with `node --version`.
- **git** (recommended) — cssgraph uses `git ls-files` for fast file discovery. Falls back to filesystem walk for non-git projects.

## 1. Install the CLI

```bash
npm i -g cssgraph
```

Verify the install:

```bash
cssgraph version
```

## 2. Wire up your agent (MCP)

cssgraph exposes itself as an MCP server. Add it to your agent's MCP config so the agent can query the style graph directly.

### Auto-install

```bash
cssgraph install
```

Auto-detects and configures opencode, Claude Code, Cursor, Codex CLI, Gemini CLI, and Kiro.

### Manual: opencode

Add to `opencode.jsonc` (or `opencode.json`):

```jsonc
{
  "mcpServers": {
    "cssgraph": {
      "type": "local",
      "command": ["cssgraph", "serve", "--mcp"],
      "enabled": true
    }
  }
}
```

### Manual: Claude Code

Add to `~/.claude.json`:

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

### Manual: Cursor / other MCP agents

Add to your MCP config file:

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

## 3. Restart your agent

Restart your agent for the MCP server to load. Once restarted, the agent will see 12 MCP tools: `cssgraph_explore`, `cssgraph_search`, `cssgraph_callers`, `cssgraph_impact`, `cssgraph_rule`, `cssgraph_impact_selector`, `cssgraph_details`, `cssgraph_unused`, `cssgraph_cascade`, `cssgraph_property`, `cssgraph_files`, and `cssgraph_status`.

## 4. Initialize each project

```bash
cd your-project
cssgraph init
```

`cssgraph init` creates the local `.cssgraph/` directory and builds the full style graph in one step.

### What gets indexed

| Element | NodeKind | Example |
|---------|----------|---------|
| Class selector | `class_selector` | `.btn-primary`, `.card .title` |
| CSS property | `css_property` | `display: flex`, `color: #333` |
| CSS variable | `css_variable` | `--primary-color: #2563eb` |
| At-rule | `at_rule` | `@media (max-width: 768px)`, `@keyframes fadeIn` |
| Style file | `file` | `styles/main.scss` |

By default, `cssgraph` indexes CSS, SCSS, Less, and Sass files. Excluded by default: `node_modules`, `dist`, `build`, `.git`, `.next`, test files (`*.test.*`, `*.stories.*`, `*.spec.*`), `__tests__/`, and `generated/`.

### Indexing with JSX/TSX support

To also scan `.jsx`, `.tsx`, `.js`, `.ts`, and `.es6` files for className references and CSS modules:

```bash
cssgraph index --jsx
```

This enables the `cssgraph_rule` / `cssgraph_callers` tools to report which component files reference each className. Style files are always indexed first so references can be matched.

### Indexing scale

| Project | Style files | --jsx files | First index | Repeat index |
|---------|-----------|-------------|-------------|-------------|
| ~50 style files | 50 | — | ~15s | <1s |
| Production monorepo | 1,500 | +7,900 | ~2m30s | <4m |

## 5. Auto-sync

After initialization, the MCP server watches your project using native OS file events (FSEvents on macOS, inotify on Linux, ReadDirectoryChangesW on Windows). File changes are debounced (2-second quiet window by default) and incrementally synced — **the index stays current as you code.**

Tune the debounce window with the `CSSGRAPH_WATCH_DEBOUNCE_MS` environment variable (in milliseconds, clamped to `[100, 60000]`).

## Project Configuration (`.cssgraph.json`)

Optional file at your project root:

```json
{
  "exclude": ["static/vendor/", "**/legacy/**", "**/*.generated.*"],
  "extensions": {
    ".pcss": "css"
  }
}
```

- **`exclude`** — gitignore-style patterns for paths to keep out of the index, even when git-tracked.
- **`extensions`** — map custom file extensions to supported languages.

Built-in default excludes (always applied, even without `.cssgraph.json`):
```
**/*.test.*  **/*.stories.*  **/*.spec.*  **/__tests__/**  **/generated/**
```

## Upgrading

```bash
npm i -g cssgraph@latest
```

After upgrading, re-index each project:

```bash
cd your-project
cssgraph index       # style only (fast)
cssgraph index --jsx # include JSX references (if needed)
```

## Uninstall

```bash
npm uninstall -g cssgraph
```

Remove per-project data and MCP config:

```bash
cd your-project && rm -rf .cssgraph
```

## Troubleshooting

**"cssgraph not initialized"** — Run `cssgraph init` in your project directory first.

**SCSS/Less parsing fails** — Ensure `postcss-scss` and `postcss-less` are installed. They ship as dependencies of cssgraph; reinstall if needed: `npm i -g cssgraph@latest`.

**MCP server not connecting** — Make sure the project is initialized (`cssgraph status`) and the path in your MCP config is correct. Try restarting your agent.

**Indexing is slow on a large project** — The initial index scans all files. For JSX scanning (`--jsx`), the first run parses every file; subsequent runs use content-hash skipping for unchanged files. Add custom excludes to `.cssgraph.json` for vendor/theme directories you don't need indexed.

**Index stalls at "Cleaning existing data"** — This happens on sparse filesystems (e.g. Docker for Mac). The re-init phase deletes the old DB file and creates a fresh one; give it ~5s.

**Sass (indented syntax) support** — `.sass` files require the `sass` package (`npm i -g sass`). Without it, `.sass` files are skipped.
