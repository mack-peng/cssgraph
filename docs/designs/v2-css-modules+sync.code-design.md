# V2-next: CSS Modules hash reverse mapping + Incremental index

## 1. CSS Modules Hash Reverse Mapping

### Problem

CSS Modules hash class names at build time (e.g. `.foo` → `._abc123`). Chrome
shows the hashed name. cssgraph stores the ORIGINAL name from source. Exact
selector matching fails for CSS Modules files.

**Current state**: `src/extraction/css-modules-resolver.ts` has
`loadCSSModuleSourceMapMapping()` utility that reads source maps to build
`hashedName → originalName` reverse mapping. It is **not** integrated into the
indexing or query pipeline.

### Solution

**Index time**: When a CSS Module file is parsed, check for its source map.
If found, build `hashedName → originalName` mapping. For each hashed class,
create an **alias edge** from a virtual `class_selector` node (with the hashed
name) to the original `class_selector` node.

**Query time**: When `normalizeSelector` encounters a selector with no exact
match, attempt hash-reverse lookup for each class in the selector, then retry
exact match with the original names.

```
Input:  "._abc123 ._def456"  (Chrome selector)
        ↓ reverse lookup
        "._abc123" → hashMap.get → ".foo"
        "._def456" → hashMap.get → ".bar"
        ↓
        query for ".foo .bar" (original selector in DB)
```

### Implementation

**New NodeKind**: `class_alias` — virtual node pointing to original
class_selector via an `alias` edge.

**New EdgeKind**: `alias` — `class_alias → class_selector`.

**Index integration** (`src/index.ts`, JSX processing section):

```typescript
// After CSS Module file is parsed, detect source map and build aliases.
if (source.indexOf('.module.css') !== -1 || source.indexOf('.module.scss') !== -1) {
  const hashMap = loadCSSModuleSourceMapMapping(fullPath);
  if (hashMap) {
    for (const [hashedName, originalName] of hashMap) {
      const aliasNodeId = hashId(`${filePath}:alias:${hashedName}`);
      const originalId = classSelectorMap.get(originalName)?.[0]; // first match
      if (originalId) {
        result.nodes.push({ id: aliasNodeId, kind: 'class_alias', name: hashedName, ... });
        result.edges.push({ source: aliasNodeId, target: originalId, kind: 'alias' });
        // Also add to classSelectorMap so JSX references to hashed names are matched.
        classSelectorMap.get(hashedName)?.push(aliasNodeId);
      }
    }
  }
}
```

**Query integration** (`src/graph/index.ts`, `selectorImpact` + `getSelectorDetails`):

```typescript
// In normalizeSelector / getSelectorDetails: if exact match returns empty,
// attempt hash reverse lookup.
if (matches.length === 0) {
  const classes = parseSelector(selector).classes;
  for (const cls of classes) {
    const aliasNode = queries.getNodesByKind('class_alias').find(n => n.name === cls);
    if (aliasNode) {
      // Replace hashed name with original in the selector string.
    }
  }
}
```

Simpler approach: just build a `Map<hashedName, originalName>` at query time
and do the string substitution before calling `getClassSelectorsBySelector`.

### Files

| File | Change | Lines |
|------|--------|-------|
| `src/extraction/css-modules-resolver.ts` | Fix `loadCSSModuleSourceMapMapping()` — currently returns identity mapping (bug) | ~20 |
| `src/index.ts` | Add `class_alias` node creation during CSS Module index | ~20 |
| `src/graph/index.ts` | Hash reverse + retry in exact match methods | ~15 |
| `src/types.ts` | Add `class_alias` NodeKind, `alias` EdgeKind | ~4 |

**Total**: ~60 lines, no new files.

---

## 2. Incremental Index (Sync Correctness)

### Problem

`cssgraph sync` currently calls `scanAndIndex()` — a **full rebuild**. For a
9,400-file project, this takes 2 minutes. The user changes ONE Less file — why
rebuild everything?

The blocker: when a single style file is re-parsed and re-inserted (INSERT OR
REPLACE), its class_selector nodes' IDs stay the same (hash of
`filePath:fullSelector:className`). So incoming `references` edges from JSX
files survive automatically.

But two things break:
1. **Deleted classes**: if a class is removed from a Less file, the old
   `class_selector` node must be deleted and its incoming `references` edges
   must be removed.
2. **classSelectorMap staleness**: the in-memory map built during index holds
   ALL class_selector → ID mappings. When a file is re-indexed, nodes from
   the old parse must be purged and the new ones added.

### Solution

**Three-step incremental pipeline**:

```
1. Scan for changed files:
   - git ls-files → get current file list
   - Compare with files table in DB (path, content_hash)
   - added:    files in git but not in DB
   - modified: files in DB but hash differs
   - removed:  files in DB but not in git
   - unchanged: skip

2. Process changed files in order (style files first, then JSX):
   - For modified/removed:     DELETE from nodes WHERE file_path = ?
                              (cascades to edges via FK)
   - For modified/added:       parse → INSERT nodes + edges
   - Update FileRecord         (new content_hash)

3. Rebuild classSelectorMap from scratch:
   - SELECT name, id FROM nodes WHERE kind = 'class_selector'
     AND name NOT LIKE '#%'
   - Same as current ensureClassSelectorMap (now removed), but only for
     incremental path, not full rebuild
```

**Key insight**: cssgraph node IDs are `sha256(filePath:fullSelector:className)` —
line number independent. So when a Less file is re-parsed and its selectors
haven't changed (only property values changed), the nodes get the SAME IDs.
`INSERT OR REPLACE` reuses the same rows, and incoming `references` edges
survive. No cross-file edge recovery needed.

### Implementation

**New method**: `CodeGraph.sync()` rewrites from full-scan to incremental:

```typescript
async sync(options: IndexOptions = {}): Promise<SyncResult> {
  const files = getGitVisibleFiles(this.projectRoot);
  const styleFiles = files.filter(f => !isJSXFile(f) && isLanguageSupported(detectLanguage(f)));
  const jsxFiles = options.jsx ? files.filter(isJSXFile) : [];

  const dbFiles = this.queries.getAllFiles();
  const dbFilePaths = new Set(dbFiles.map(f => f.path));
  const dbFileHashes = new Map(dbFiles.map(f => [f.path, f.contentHash]));

  const removed = dbFiles.filter(f => !files.includes(f.path));
  const added = styleFiles.filter(f => !dbFilePaths.has(f));
  const modified: string[] = [];

  // Check content hashes for existing files (lazy: only stat when needed).
  for (const f of styleFiles) {
    if (dbFileHashes.has(f)) {
      const content = readFileSync(f, 'utf-8');
      const hash = sha256(content);
      if (hash !== dbFileHashes.get(f)) modified.push(f);
    }
  }

  // Phase 1: Remove deleted files (cascade removes nodes + edges).
  for (const r of removed) this.queries.deleteFile(r.path);

  // Phase 2: Re-parse added + modified style files.
  const toReindex = [...added, ...modified];
  // ... batch I/O + pool parse + store (reuse scanAndIndex inner loop logic) ...

  // Phase 3: Rebuild classSelectorMap.
  // ... build map from nodes table ...

  // Phase 4: Re-parse added + modified JSX files (if --jsx).
  // ... same as Phase 2 but for JSX path ...

  return { filesChecked: ..., filesAdded: ..., filesModified: ..., filesRemoved: ... };
}
```

### Refactoring need

The current `scanAndIndex` is ~200 lines of monolithic code. To share the
inner loop (batch read + pool parse + store) between full index and sync,
extract a helper:

```typescript
private async processFiles(
  files: string[],
  options: IndexOptions,
  classSelectorMap: Map<string, string[]>,
  pool: ParseWorkerPool | null,
): Promise<{ filesIndexed: number; filesSkipped: number; filesErrored: number; nodesCreated: number; edgesCreated: number; errors: ExtractionError[] }>
```

Both `indexAll` (full rebuild) and `sync` (incremental) call this helper.

### Files

| File | Change | Lines |
|------|--------|-------|
| `src/index.ts` | Extract `processFiles()` helper; rewrite `sync()` | ~120 |
| `src/db/queries.ts` | `deleteFile(filePath)` already exists | 0 |

**Total**: ~120 lines, 1 file.

---

## Implementation Order

| # | Feature | Effort | Impact |
|---|---------|--------|--------|
| 1 | Hash reverse mapping | ~60 lines | Fix 20% of Chrome selector misses |
| 2 | Incremental index | ~120 lines | `sync` from 2m → <5s for single-file changes |
