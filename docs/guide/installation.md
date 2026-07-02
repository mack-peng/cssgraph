# Installation

## Requirements

- **Node.js >= 22.5.0** — cssgraph uses Node's built-in `node:sqlite` module. Check your version with `node --version`.

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

### opencode

Add to `opencode.jsonc` (or `opencode.json`):

```jsonc
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

### Claude Code

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

Optionally add auto-allow permissions in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__cssgraph__*"
    ]
  }
}
```

### Cursor

Add to Cursor's MCP config (`.cursor/mcp.json` or Cursor Settings > MCP):

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

### Other MCP-compatible agents

Any agent that supports the MCP protocol can connect to cssgraph. Use the same server config block above, adjusting the config path for your agent.

### Auto-install (coming soon)

```bash
cssgraph install
```

Will auto-detect and configure supported agents. Currently in development.

## 3. Restart your agent

Restart your agent for the MCP server to load. Once restarted, the agent will see `cssgraph_explore`, `cssgraph_search`, `cssgraph_callers`, `cssgraph_impact`, `cssgraph_files`, and `cssgraph_status` as available tools.

## 4. Initialize each project

```bash
cd your-project
cssgraph init
```

`cssgraph init` creates the local `.cssgraph/` directory and builds the full style graph in one step. It scans all `.css`, `.scss`, and `.less` files (excluding `node_modules`, `dist`, `build`, `.git`, and `.gitignore`d paths), parses them with PostCSS, and stores the result in a SQLite + FTS5 database.

A single global install covers every project; you run `cssgraph init` once per project.

### What gets indexed

| Element | NodeKind | Example |
|---------|----------|---------|
| Class selector | `class_selector` | `.btn-primary`, `.card .title` |
| CSS property | `css_property` | `display: flex`, `color: #333` |
| CSS variable | `css_variable` | `--primary-color: #2563eb` |
| At-rule | `at_rule` | `@media (max-width: 768px)`, `@keyframes fadeIn` |
| Style file | `file` | `styles/main.scss` |

### Indexing a large project

On a project with ~50 style files, `cssgraph init` completes in under 15 seconds and produces ~16,000 nodes. The `.cssgraph/cssgraph.db` is typically a few MB.

## 5. Auto-sync

After initialization, the MCP server watches your project using native OS file events (FSEvents on macOS, inotify on Linux, ReadDirectoryChangesW on Windows). File changes are debounced (2-second quiet window by default) and incrementally synced — **the index stays current as you code.**

Tune the debounce window with the `CSSGRAPH_WATCH_DEBOUNCE_MS` environment variable (in milliseconds, clamped to `[100, 60000]`).

## Upgrading

```bash
npm i -g cssgraph@latest
```

After upgrading, re-index each project to pick up any new extraction capabilities:

```bash
cd your-project
cssgraph index
```

## Uninstall

Remove the CLI:

```bash
npm uninstall -g cssgraph
```

Remove per-project data:

```bash
cd your-project
rm -rf .cssgraph
```

Remove MCP config from your agent's config file (the `cssgraph` server entry).

## Troubleshooting

**"cssgraph not initialized"** — Run `cssgraph init` in your project directory first.

**SCSS parsing fails** — Ensure `postcss-scss` is installed. It ships as a dependency of cssgraph; reinstall if needed: `npm i -g cssgraph@latest`.

**MCP server not connecting** — Your agent starts the server itself. Make sure the project is initialized (`cssgraph status`) and the path in your MCP config is correct.

**Indexing is slow** — Check that `node_modules` and other large directories are excluded. Add custom excludes to `.cssgraph.json` if needed.

**Less files not being parsed** — V1 has experimental Less support. Report issues on GitHub.
