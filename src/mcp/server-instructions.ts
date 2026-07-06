export const SERVER_INSTRUCTIONS = `
## cssgraph — CSS intelligence for AI agents

cssgraph is a SQLite knowledge graph of every className, property, and style
dependency in the workspace. It lets you answer CSS questions with ONE tool call
instead of grep/Read loops.

### Primary tool

**cssgraph\_explore** — the ONLY tool you need for most CSS questions.
"what styles affect .btn-primary", "where is .container defined", or surveying
an area — one call returns the className's full properties, overrides,
specificity, source context, and callers grouped by file.

### Other tools (use only when explore isn't enough)

- **cssgraph\_search** — quick className name search
- **cssgraph\_callers** — find JSX components using a className
- **cssgraph\_impact** — blast radius of changing a className
- **cssgraph\_rule** — blast radius of a full CSS selector (exact, related, loose/strict impact)
- **cssgraph\_impact\_selector** — find code files (JS/TS/JSX/TSX) affected by a CSS selector
- **cssgraph\_details** — quick O(1) exact selector lookup, no edges/impact (lightweight)
- **cssgraph\_unused** — find CSS class selectors with no incoming references
- **cssgraph\_cascade** — visualize the cascade path for a className
- **cssgraph\_property** — search selectors by CSS property value
- **cssgraph\_files** — indexed style file tree
- **cssgraph\_status** — index health check

### projectPath

All tools accept an optional \`projectPath\` argument — pass it to query a
specific project's \`.cssgraph/\` index. When omitted, cssgraph walks up from
the current working directory to find the nearest initialized project.

### Anti-patterns

- Don't grep for classNames — cssgraph IS the index
- Don't re-verify cssgraph results with Read
- After editing CSS files, check the staleness banner in responses
`;
