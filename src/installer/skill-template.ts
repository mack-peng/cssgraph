/**
 * cssgraph Agent Skill templates.
 *
 * Installed into each agent's skill directory during `cssgraph install`.
 * The SKILL.md teaches agents WHEN and HOW to use cssgraph's 12 MCP
 * tools effectively, encoding the decision tree, workflow patterns,
 * and per-tool pitfalls discovered from the codebase.
 *
 * Standalone units so each target can write its own copy without
 * a shared mutable dependency.
 */

/** YAML frontmatter separator. */
const FRONTMATTER_DELIM = '---';

export function buildSkillMd(): string {
  return `${FRONTMATTER_DELIM}
name: cssgraph
description: >
  CSS intelligence for AI coding agents. Use cssgraph BEFORE grep/Read for
  any CSS question: finding where a class is defined, checking cascade
  conflicts, assessing CSS change impact, identifying dead CSS, or searching
  selectors by property value. Only active when a .cssgraph/ directory exists
  at the project root.
metadata:
  requires:
    bins: ["cssgraph"]
${FRONTMATTER_DELIM}

# cssgraph — CSS Intelligence Skill

Use this skill whenever you need to understand, modify, refactor, or clean up
CSS in an indexed project. cssgraph is a pre-built knowledge graph of every
className, property, and style dependency — one tool call replaces grep + Read
loops.

## Prerequisite Check

Before using any cssgraph tool, verify a \`.cssgraph/\` directory exists at the
project root. If missing, skip cssgraph entirely — indexing is the user's
decision. Notify them: "This project isn't indexed. Run \`cssgraph init\` to
enable CSS intelligence."

## Tool Selection Guide

Use the decision tree below. **cssgraph_explore is the primary tool** — it
answers most CSS questions in a single call. Only reach for other tools when
explore isn't sufficient.

### Primary: cssgraph_explore

Use FIRST for:
- "What is .btn-primary? Show me all its styles."
- "What overrides .header and what does .header override?"
- "Which JSX files reference .card?"

Returns: className definitions grouped by file, sorted by specificity
(descending), with full properties, overrides chain, caller list, and source
context snippets.

⚠️ **Not suitable for:** composite selectors (\`.a.b\`, \`.a > .b\`). Use
**cssgraph_rule** for those.

### When explore isn't enough

| Your question | Use |
|---|---|
| "What files would break if I rename .btn?" | **cssgraph_impact** ⚠️ Only tracks the first FTS5-ranked match — if the class appears in multiple files, the radius may be incomplete |
| "What's the full impact of \`.sidebar .nav a.active\`?" | **cssgraph_rule** — handles composite selectors with loose/strict file impact |
| "Which JSX components reference .btn?" | **cssgraph_callers** ⚠️ Same single-match limitation as impact |
| "Show me the cascade chain for .title" | **cssgraph_cascade** — lists all definitions ordered by specificity, with overrides ⚠️ Override edges are intra-file only |
| "Are there class selectors nobody references?" | **cssgraph_unused** ⚠️ May report false positives: HTML/ERB/Haml references might not be indexed |
| "Which selectors use display:flex?" | **cssgraph_property** — prefix search by default; use exact mode for literal match |
| "Where exactly is \`.btn-primary\` defined?" | **cssgraph_details** — O(1) exact match. No results? Fall back to **cssgraph_search** |
| "Is there a class named something like btn-*?" | **cssgraph_search** — fuzzy name search |
| "Which code files use ALL classes in \`.foo.bar\`?" | **cssgraph_impact_selector** — strict (all classes) and loose (any class) impact |
| "What style files exist in this project?" | **cssgraph_files** |
| "Is the index healthy and up to date?" | **cssgraph_status** |

### Lightweight fallback (no MCP / task-tool subagents)

When cssgraph MCP tools are unavailable, use the CLI:

\`\`\`bash
cssgraph explore "<class-name>"    # same output as cssgraph_explore
cssgraph rule ".a .b"              # same as cssgraph_rule
cssgraph details ".btn"            # same as cssgraph_details
cssgraph status                    # same as cssgraph_status
\`\`\`

### projectPath parameter

All MCP tools accept an optional \`projectPath\` — use it to query a different
indexed project. Omit to auto-detect from the current working directory.

## Three Core Workflows

### 1. Understand a class

\`\`\`
cssgraph_explore(query=".btn-primary")
  → shows: definition, properties, specificity, overrides chain, callers
  → follow-up: cssgraph_cascade(className="btn-primary") for full cascade path
\`\`\`

### 2. Safe CSS refactoring

\`\`\`
1. cssgraph_explore(query=".btn") to understand the current rule
2. cssgraph_impact(className="btn") to see affected files
3. cssgraph_rule(selector=".btn") for composite impact
4. cssgraph_callers(className="btn") to see JSX references
5. cssgraph_impact_selector(selector=".btn") for code-file-only impact
\`\`\`

### 3. Dead CSS cleanup

\`\`\`
1. cssgraph_unused(limit=50) to find potentially unused classes
2. For each candidate: cssgraph_explore(query=".unused-class") to double-check
3. cssgraph_rule(selector=".unused-class") to confirm zero impact
\`\`\`

⚠️ **The unused tool can produce false positives.** A class may be used in
HTML/ERB/Haml templates, dynamically generated, or referenced by unindexed
files. Always verify with explore before deleting.

## Cross-tool Patterns

- **Composite selectors always use rule.** \`.a.b\`, \`.a > .b\`, \`.a + .b\`
  are NOT single classNames. explore and impact won't handle them correctly.
- **Verify with explore after rule.** rule tells you which files are affected;
  explore tells you what the class actually looks like.
- **Check status after editing CSS.** cssgraph auto-syncs changes, but the
  staleness banner in tool responses tells you which files are pending
  re-index. Use cssgraph_status to confirm.
- **CSS modules hashed names** are resolved automatically by rule and details.
  If a hashed name isn't resolving, the source map may be missing.
- **Node IDs survive property edits** (based on sha256 of filePath:selector:className,
  not line numbers), so references edges persist across minor style tweaks.

## Anti-patterns

- Don't grep for classNames — cssgraph IS the index
- Don't re-verify cssgraph results with Read
- Don't use explore for composite selectors
- Don't trust unused results without verification
- Don't assume impact covers all instances of a multi-file className
`;
}

export function buildPitfallsMd(): string {
  return `# cssgraph Tool Pitfalls & Boundaries

This reference documents the known edge cases and limitations of each cssgraph
tool. Read it when a result seems surprising or incomplete.

## cssgraph_explore

- **Composite selectors:** Returns incorrect results for \`.a.b\`, \`.a > .b\`,
  etc. Use cssgraph_rule instead.
- **Max 20 files:** Hard cap at 20 files regardless of maxFiles argument.
- **Source context reads from disk:** May fail silently if a file was deleted
  after indexing — source snippets will be omitted without warning.
- **Properties from \`contains\` edges:** If a class_selector node has no
  outgoing contains edges to css_property nodes (rare, happens with empty
  rule-sets), properties will show as empty.
- **Overrides are intra-file only:** The overrides/overridden-by sections only
  reflect relationships within the SAME file. Cross-file cascade priority is
  shown only via specificity ordering.

## cssgraph_impact

- **Single-first-result bias:** Uses FTS5 search with limit=1. If a className
  appears in multiple files, only the TOP-ranked match is analyzed. The impact
  radius may miss other definitions entirely.
- **BFS depth 3:** Traversal is capped at depth 3, both directions, all edge
  kinds. Some transitive dependencies may be omitted.
- **1000 node cap:** Default limit in GraphTraverser. Large codebases may hit
  this ceiling.

## cssgraph_callers

- **Same single-first-result bias as impact:** Only shows callers for the top
  FTS5-ranked className match.
- **Depth 2 traversal:** Only follows incoming references and contains edges
  up to depth 2. Deeply nested component hierarchies may be truncated.
- **JSX/TSX only:** Callers are identified via references edges, which come
  from JSX className extraction, view template extraction, and CSS Module
  resolution. Dynamic className usage (string concatenation, computed
  expressions) may not be tracked.

## cssgraph_cascade

- **Correctly finds ALL selectors:** Unlike impact and callers, cascade uses
  getClassSelectorsByName (case-insensitive) to find every matching selector.
- **Overrides are intra-file only:** The overrides and overriddenBy lists only
  reflect edges within the same file. Cross-file specificity conflicts are NOT
  represented as edges — the cascade ordering by specificity is still correct,
  but the "why" (which rule overrides which) may be incomplete for cross-file.
- **Properties from contains edges:** Same limitation as explore.

## cssgraph_rule

- **Contains match uses LIKE:** The "Related selectors" section uses SQL
  \`LIKE '%classname%'\` which may match substrings. Searching for \`.btn\`
  will also match \`.btn-primary\`, \`.btn-danger\`, etc.
- **CSS Module hashed names:** Resolved automatically via moduleHashMap built
  at index time. If the source map is missing, hashed names won't resolve.
- **Strict files capped at 20:** More results truncated with "...and N more".
  Use --json output for the full list.
- **Deduplication by filePath:line:selector key:** Prevents duplicate display
  but may hide legitimate cases where the same selector appears identically in
  the same file (duplicate rule-sets).

## cssgraph_impact_selector

- **Delegates to analyzeRule:** Same limitations as cssgraph_rule.
- **Code files only:** Filters results to .js/.jsx/.ts/.tsx/.es6 extensions.
  View templates (.erb/.haml/.html) are excluded, even if indexed.

## cssgraph_unused

- **FALSE POSITIVES:** A class selector is marked "unused" only when NO
  incoming references edge points to it. This means:
  - Classes used in HTML/ERB/Haml templates that weren't indexed
  - Classes used dynamically (document.createElement, innerHTML)
  - Classes in external systems (CMS, API responses)
  - All will show as unused even though they may be actively used.
- **Limit clamped:** Default 50, max 200. Results beyond the limit are not
  shown.
- **ALWAYS verify with explore before deleting.** Run cssgraph_explore on each
  candidate and check the "Referenced by" section.

## cssgraph_property

- **Prefix search (default):** Non-exact mode uses FTS5 prefix matching.
  Searching for "8" will match "8px", "8rem", "8%", "80%", etc.
- **Exact mode:** Use \`exact: true\` for literal value matching. This bypasses
  FTS5 entirely and uses direct index lookup on nodes.value.
- **Property filter:** When \`property\` is provided, adds a
  \`lower(name) = lower(property)\` constraint. Case-insensitive.
- **Parent resolution:** Each result resolves the parent class_selector via
  incoming contains edges. Only the first match is returned.

## cssgraph_details

- **Exact match only:** Uses \`WHERE selector = ?\` — no fuzzy matching.
  "No exact match" means the selector doesn't exist as-is. Fall back to
  cssgraph_search for fuzzy discovery.
- **CSS Module resolution:** Hashed names are resolved before matching.
- **Properties from node JSON or contains edges:** Prefers embedded JSON,
  falls back to edge traversal.

## cssgraph_search

- **FTS5 OR query:** Splits input on spaces and joins with OR. "btn primary"
  becomes \`"btn" OR "primary"\` — matches either term.
- **Hard limit 10:** Results are capped at 10. No pagination.
- **Returns locations only:** No properties, edges, or callers. Use explore
  for full context after identifying a candidate.

## Indexing Limitations

- **Parse errors are silent:** Style files that fail PostCSS parsing are
  skipped with a sentinel empty result. They appear in the files table but
  have zero class_selector or css_property nodes. The error log is at
  \`.cssgraph/errors.log\`.
- **Overrides are intra-file only:** Computed during per-file extraction.
  Cross-file specificity conflicts are NOT represented as override edges.
- **Node IDs survive property edits:** sha256(filePath:selector:className) is
  line-number independent. Changing property values keeps the same ID.
  Changing the selector string generates a new ID.
- **FTS5 triggers are deferred:** During bulk indexing, FTS5 triggers are
  dropped and rebuilt in one pass. Incremental syncs after the initial index
  use live triggers — SLOWER per-change but always accurate.
`;
}
