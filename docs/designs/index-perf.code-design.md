# Index Performance Rebuild — Code Design

## Changes by tier

### P0 — Index-time elimination

**P0.1 — Git-first file discovery**

New file: `src/extraction/git-scanner.ts`

```typescript
export function getGitVisibleFiles(rootDir: string): string[] | null {
  // exec git ls-files -z --cached --others --exclude-standard
  // returns project-relative paths or null (git unavailable → fallback)
}
```

In `src/index.ts scanAndIndex()`:

```
gitFiles = getGitVisibleFiles(projectRoot)
if gitFiles:
  for each path: detectLanguage() → bucket into styleFiles / jsxFiles
else:
  existing explicit-stack filesystem walk
```

`git ls-files --exclude-standard` automatically respects `.gitignore`, so the
`ignore` library is not needed in the git path. Default excludes (`*.test.*`,
`*.stories.*`, `**/__tests__/**`, `**/generated/**`) are NOT applied in the git
path — they are built-in `.cssgraph` defaults that `.gitignore` may not cover.

**P0.2 — Content-hash skip**

In the main processing loop, before parse:

```typescript
const contentHash = sha256(source);
const existingFile = this.queries.getFileByPath(filePath);
if (existingFile && existingFile.contentHash === contentHash) {
  // Restore class_selector nodes to classSelectorMap for JSX reference matching.
  const classNodes = this.queries.getNodesByFile(filePath, ['class_selector']);
  for (const node of classNodes) {
    if (!node.name.startsWith('#')) {
      classSelectorMap.get(node.name).push(node.id);
    }
  }
  filesSkipped++;
  continue;
}
```

- Hash computed once, reused in `FileRecord.contentHash` (was computing twice).
- `getNodesByFile` extended with optional `kinds?: NodeKind[]` parameter for
  filtered DB queries.
- JSX files skip the content-hash check entirely (`isJsx ? null : ...`).

**P0.3 — mtime-cached config**

Refactored `src/config.ts`:

```typescript
const cache = new Map<string, { mtimeMs: number; config: ProjectConfig }>();
const EMPTY_CONFIG: ProjectConfig = Object.freeze({});

export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = path.join(projectRoot, '.cssgraph.json');
  const mtimeMs = fs.statSync(configPath).mtimeMs; // throws → cache.delete → EMPTY
  const entry = cache.get(projectRoot);
  if (entry && entry.mtimeMs === mtimeMs) return entry.config;
  // read + parse + freeze + cache
}
```

- Frozen `EMPTY_CONFIG` avoids allocation on the zero-config path.
- `clearProjectConfigCache()` exported for tests.

---

### P1 — I/O pipeline

**P1.1 — Batch I/O reads**

```typescript
const FILE_IO_BATCH_SIZE = 10;

for (let bi = 0; bi < orderedFiles.length; bi += FILE_IO_BATCH_SIZE) {
  const batch = orderedFiles.slice(bi, bi + FILE_IO_BATCH_SIZE);
  const fileContents = await Promise.all(batch.map(async (fp) => {
    const content = await fsp.readFile(fullPath, 'utf-8');
    const stat = await fsp.stat(fullPath);
    return { filePath: fp, source: content, stat, error: null };
  }));

  for (const { filePath, source, stat, error } of fileContents) {
    // sequential parse + insert (classSelectorMap must stay ordered)
  }
}
```

- Uses `fs/promises` (`import * as fsp from 'fs/promises'`).
- Parse remains sequential → classSelectorMap determinism preserved.
- `globalIdx` counter tracks accurate progress across batch + skip boundaries.

**P1.2 — Scan yield**

```typescript
// git path
for (const relativePath of gitFiles) {
  // ... filter + bucket ...
  if (++fileCount % 200 === 0) {
    await new Promise<void>(r => setImmediate(r));
  }
}

// filesystem walk
const scanFiles = async (rootDir: string): Promise<void> => {
  // ... walk ...
  if (++fileCount % 200 === 0) {
    await new Promise<void>(r => setImmediate(r));
  }
};
```

- 200-file interval matches codegraph's `SYNC_RECONCILE_YIELD_INTERVAL` pattern.
- Same `fileCount` counter shared between paths.

**P1.3 — MAX_FILE_SIZE**

```typescript
const MAX_FILE_SIZE = 1_000_000; // 1 MB

if (stat && stat.size > MAX_FILE_SIZE) {
  filesSkipped++;
  globalIdx++;
  continue;
}
```

- Checked after read (stat available) and before parse.
- No DB query needed (file is always skipped).

---

### P2 — Worker pool preparation

**P2.1 — storeStyleFile()**

Extract store logic from main loop into a dedicated method:

```typescript
private storeStyleFile(
  filePath: string, source: string, contentHash: string,
  result: ExtractionResult, classSelectorMap: Map<string, string[]>,
): void {
  this.db.getDb().exec('SAVEPOINT sp');
  for (const node of result.nodes) {
    this.queries.insertNode(node);
    if (node.kind === 'class_selector' && !node.name.startsWith('#')) {
      const list = classSelectorMap.get(node.name) || [];
      list.push(node.id);
      classSelectorMap.set(node.name, list);
    }
  }
  for (const edge of result.edges) this.queries.insertEdge(edge);
  this.queries.insertFile({ path: filePath, contentHash, ... });
  this.db.getDb().exec('RELEASE sp');
}
```

- Takes `classSelectorMap` (not `this`) so it can be called from Worker-pool context.
- SAVEPOINT/RELEASE stays inside store (per-file isolation).

**P2.2 — flushOrdered()**

```typescript
private static flushOrdered<T>(
  completed: Map<number, T>,
  cursor: { current: number },
  fn: (item: T) => void,
): number {
  let flushed = 0;
  while (completed.has(cursor.current)) {
    fn(completed.get(cursor.current)!);
    completed.delete(cursor.current);
    cursor.current++;
    flushed++;
  }
  return flushed;
}
```

- Generic: works for any result type.
- `cursor` is a `{ current: number }` object for reference-passing.
- Returns flushed count for batch-commit tracking.

**Main loop restructuring:**

```
windowSize = pool.size * 2  (currently: FILE_IO_BATCH_SIZE)
completed: Map<seq, {filePath, source, contentHash, result}>
cursor = { current: 0 }

for batch in files:
  read parallel
  for file in batch:
    seq = nextSeq++
    result = parse(file)                   // future: pool.requestParse(file)
    completed.set(seq, { filePath, ... , result })
    flushed = flushOrdered(completed, cursor, item => {
      storeStyleFile(item.filePath, ...)
      fileCountInBatch++
    })
    while (nextSeq - cursor.current >= windowSize) {
      await Promise.race(inFlight)
    }
```

- Today `flushOrdered` always commits immediately (sequential parse → `cursor` advances by 1 each time).
- Tomorrow, Worker pool may return results out-of-order → `flushOrdered` commits contiguous results and buffers the rest.
- `windowSize` backpressure prevents unbounded `completed` Map growth.
- Batch commit (`COMMIT`/`BEGIN` every `SAVEPOINT_BATCH_SIZE` stores) triggers inside `storeStyleFile` callback.

---

## Why skip cross-file edge recovery?

codegraph's `node.id = sha256(filePath:kind:name:line)` includes the **line
number** — any edit shifts every symbol's ID, breaking incoming edges.
cssgraph's `node.id = sha256(filePath:fullSelector:className)` does NOT include
the line number.  A Less edit that only changes property values leaves the
selector intact → `INSERT OR REPLACE` → same ID → references edges survive
automatically.
