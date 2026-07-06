/**
 * The marker-fenced agent-instructions block the installer writes into each
 * agent's instructions file (CLAUDE.md / AGENTS.md / GEMINI.md).
 *
 * History: pre-#529 the installer wrote a full usage playbook here, which
 * duplicated the MCP `initialize` instructions for the main agent — so it
 * was removed and `mcp/server-instructions.ts` became the single source of
 * truth. A much smaller block returned because the MCP
 * instructions cannot reach two audiences that the instructions FILE does
 * reach:
 *
 *  - **Task-tool subagents** — they receive the project instructions file
 *    in their context but NOT the MCP initialize instructions.
 *  - **Non-MCP harnesses** — agents with no MCP client at all can still
 *    run the `cssgraph explore` CLI, which prints the same output as the
 *    MCP tool.
 *
 * Keep this block SHORT. The main agent reads it every turn on top of the
 * server instructions.
 */

/** Markers used by the marker-based section write/removal. */
export const CSSGRAPH_SECTION_START = '<!-- CSSGRAPH_START -->';
export const CSSGRAPH_SECTION_END = '<!-- CSSGRAPH_END -->';

/**
 * The full block, markers included, exactly as written to disk.
 *
 * The wording is deliberately CONDITIONAL ("in projects indexed by…"):
 * a global install writes this into a user-scope file (~/.claude/CLAUDE.md,
 * ~/.codex/AGENTS.md, ~/.config/opencode/AGENTS.md) that applies to every
 * project the user opens — including unindexed ones, where an unconditional
 * "this project is indexed" claim would send subagents into failing cssgraph
 * calls.
 */
export const CSSGRAPH_INSTRUCTIONS_BLOCK = `${CSSGRAPH_SECTION_START}
## cssgraph

In projects indexed by cssgraph (a \`.cssgraph/\` directory exists at the project root), reach for it BEFORE grep/Read when you need to understand CSS:

- **MCP tool** (when available): \`cssgraph_explore\` answers most CSS questions in one call — the className's full properties, overrides, specificity, and callers grouped by file. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): \`cssgraph explore "<class-name>"\` prints the same output.

If there is no \`.cssgraph/\` directory, skip cssgraph entirely — indexing is the user's decision.
${CSSGRAPH_SECTION_END}`;
