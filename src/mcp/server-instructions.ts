export const SERVER_INSTRUCTIONS = `
## cssgraph — CSS intelligence for AI agents

cssgraph is a SQLite knowledge graph of every className, property, and style
dependency in the workspace. It lets you answer CSS questions with ONE tool call
instead of grep/Read loops.

### Primary tool

**cssgraph_explore** — the ONLY tool you need for most CSS questions.
"what styles affect .btn-primary", "where is .container defined", or surveying
an area — one call returns the className's full properties, overrides,
specificity, and callers grouped by file.

### Other tools (use only when explore isn't enough)

- **cssgraph_search** — quick className name search
- **cssgraph_callers** — find JSX components using a className
- **cssgraph_impact** — blast radius of changing a className or property
- **cssgraph_unused** — find CSS class selectors with no incoming references
- **cssgraph_cascade** — visualize the cascade path for a className
- **cssgraph_property** — search selectors by CSS property value
- **cssgraph_files** — indexed style file tree
- **cssgraph_status** — index health check

### Anti-patterns

- Don't grep for classNames — cssgraph IS the index
- Don't re-verify cssgraph results with Read
- After editing CSS files, check the staleness banner in responses
`;
