import { DatabaseSync, StatementSync } from 'node:sqlite';
import { Node, Edge, FileRecord, SearchResult, SearchOptions, NodeKind, EdgeKind, Language, GraphStats, PropertySearchOptions, PropertySearchResult, UnusedResult } from '../types';
import * as crypto from 'crypto';

function hashId(qualifiedName: string): string {
  return crypto.createHash('sha256').update(qualifiedName).digest('hex').slice(0, 16);
}

export class QueryBuilder {
  private db: DatabaseSync;
  private projectNameTokens: Set<string> = new Set();
  private insertNodeStmt: StatementSync;
  private insertEdgeStmt: StatementSync;
  private insertFileStmt: StatementSync;
  private classSelectorsWithoutRefsStmt: StatementSync;
  private classSelectorsByNameStmt: StatementSync;
  private classSelectorsBySelectorStmt: StatementSync;
  private propertiesByValueStmt: StatementSync;
  private propertiesByPropertyValueStmt: StatementSync;
  private propertiesExactStmt: StatementSync;
  private propertiesByPropExactStmt: StatementSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.insertNodeStmt = db.prepare(`
      INSERT OR REPLACE INTO nodes (id, kind, name, qualified_name, file_path, language,
        start_line, end_line, start_column, end_column, signature, specificity,
        properties, selector, params, value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertEdgeStmt = db.prepare(`
      INSERT OR IGNORE INTO edges (source, target, kind, metadata, line, col, provenance)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertFileStmt = db.prepare(`
      INSERT OR REPLACE INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count, errors)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.classSelectorsWithoutRefsStmt = db.prepare(`
      SELECT n.* FROM nodes n
      WHERE n.kind = 'class_selector'
        AND NOT EXISTS (
          SELECT 1 FROM edges e
          WHERE e.target = n.id AND e.kind = 'references'
        )
      ORDER BY n.file_path, n.start_line
    `);
    this.classSelectorsByNameStmt = db.prepare(`
      SELECT * FROM nodes
      WHERE kind = 'class_selector' AND lower(name) = lower(?)
      ORDER BY file_path, start_line
    `);
    this.classSelectorsBySelectorStmt = db.prepare(`
      SELECT * FROM nodes
      WHERE kind = 'class_selector' AND selector = ?
      ORDER BY file_path, start_line
    `);
    this.propertiesByValueStmt = db.prepare(`
      SELECT n.* FROM nodes n
      JOIN nodes_fts fts ON n.rowid = fts.rowid
      WHERE n.kind = 'css_property' AND nodes_fts MATCH ?
      ORDER BY n.file_path, n.start_line
      LIMIT ?
    `);
    this.propertiesByPropertyValueStmt = db.prepare(`
      SELECT n.* FROM nodes n
      JOIN nodes_fts fts ON n.rowid = fts.rowid
      WHERE n.kind = 'css_property' AND lower(n.name) = lower(?) AND nodes_fts MATCH ?
      ORDER BY n.file_path, n.start_line
      LIMIT ?
    `);
    this.propertiesExactStmt = db.prepare(`
      SELECT n.* FROM nodes n
      WHERE n.kind = 'css_property' AND n.value = ?
      ORDER BY n.file_path, n.start_line
      LIMIT ?
    `);
    this.propertiesByPropExactStmt = db.prepare(`
      SELECT n.* FROM nodes n
      WHERE n.kind = 'css_property' AND lower(n.name) = lower(?) AND n.value = ?
      ORDER BY n.file_path, n.start_line
      LIMIT ?
    `);
  }

  setProjectNameTokens(tokens: Set<string>): void {
    this.projectNameTokens = tokens;
  }

  getProjectNameTokens(): Set<string> {
    return this.projectNameTokens;
  }

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  insertNode(node: Node): void {
    this.insertNodeStmt.run(
      node.id ?? hashId(node.qualifiedName),
      node.kind,
      node.name,
      node.qualifiedName,
      node.filePath,
      node.language,
      node.startLine,
      node.endLine,
      node.startColumn,
      node.endColumn,
      node.signature ?? null,
      node.specificity ? JSON.stringify(node.specificity) : null,
      node.properties ? JSON.stringify(node.properties) : null,
      node.selector ?? null,
      node.params ?? null,
      node.value ?? null,
      node.updatedAt,
    );
  }

  insertEdge(edge: Edge): void {
    this.insertEdgeStmt.run(
      edge.source,
      edge.target,
      edge.kind,
      edge.metadata ? JSON.stringify(edge.metadata) : null,
      edge.line ?? null,
      edge.column ?? null,
      edge.provenance ?? null,
    );
  }

  insertEdgesBatch(edges: Edge[]): void {
    if (edges.length === 0) return;
    const BATCH = 100;
    for (let i = 0; i < edges.length; i += BATCH) {
      const chunk = edges.slice(i, i + BATCH);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
      const sql = `INSERT OR IGNORE INTO edges (source, target, kind, metadata, line, col, provenance) VALUES ${placeholders}`;
      const params: (string | number | null)[] = [];
      for (const edge of chunk) {
        params.push(
          edge.source,
          edge.target,
          edge.kind,
          edge.metadata ? JSON.stringify(edge.metadata) : null,
          edge.line ?? null,
          edge.column ?? null,
          edge.provenance ?? null,
        );
      }
      this.db.prepare(sql).run(...params);
    }
  }

  insertNodesBatch(nodes: Node[]): void {
    if (nodes.length === 0) return;
    const BATCH = 50;
    for (let i = 0; i < nodes.length; i += BATCH) {
      const chunk = nodes.slice(i, i + BATCH);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const sql = `INSERT OR REPLACE INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, start_column, end_column, signature, specificity, properties, selector, params, value, updated_at) VALUES ${placeholders}`;
      const params: (string | number | null)[] = [];
      for (const node of chunk) {
        params.push(
          node.id ?? hashId(node.qualifiedName),
          node.kind,
          node.name,
          node.qualifiedName,
          node.filePath,
          node.language,
          node.startLine,
          node.endLine,
          node.startColumn,
          node.endColumn,
          node.signature ?? null,
          node.specificity ? JSON.stringify(node.specificity) : null,
          node.properties ? JSON.stringify(node.properties) : null,
          node.selector ?? null,
          node.params ?? null,
          node.value ?? null,
          node.updatedAt,
        );
      }
      this.db.prepare(sql).run(...params);
    }
  }

  getNodeById(id: string): Node | null {
    const row = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToNode(row) : null;
  }

  getNodesByFile(filePath: string, kinds?: NodeKind[]): Node[] {
    if (kinds && kinds.length > 0) {
      const placeholders = kinds.map(() => '?').join(',');
      const sql = `SELECT * FROM nodes WHERE file_path = ? AND kind IN (${placeholders}) ORDER BY start_line`;
      const rows = this.db.prepare(sql).all(filePath, ...kinds) as Record<string, unknown>[];
      return rows.map(r => this.rowToNode(r));
    }
    const rows = this.db.prepare('SELECT * FROM nodes WHERE file_path = ? ORDER BY start_line').all(filePath) as Record<string, unknown>[];
    return rows.map(r => this.rowToNode(r));
  }

  getNodesByKind(kind: NodeKind): Node[] {
    const rows = this.db.prepare('SELECT * FROM nodes WHERE kind = ?').all(kind) as Record<string, unknown>[];
    return rows.map(r => this.rowToNode(r));
  }

  getNodesByName(name: string): Node[] {
    const rows = this.db.prepare('SELECT * FROM nodes WHERE lower(name) = lower(?)').all(name) as Record<string, unknown>[];
    return rows.map(r => this.rowToNode(r));
  }

  searchNodes(query: string, options?: SearchOptions): SearchResult[] {
    const limit = options?.limit ?? 10;
    const kinds = options?.kinds;
    const languages = options?.languages;
    const offset = options?.offset ?? 0;

    let sql = `
      SELECT n.*, nodes_fts.rank AS score
      FROM nodes_fts
      JOIN nodes n ON nodes_fts.rowid = n.rowid
      WHERE nodes_fts MATCH ?
      ORDER BY rank
      LIMIT ? OFFSET ?
    `;

    const searchTerm = query.split(/\s+/).map(t => `"${t}"`).join(' OR ');
    const rows = this.db.prepare(sql).all(searchTerm, limit, offset) as Array<Record<string, unknown>>;

    let results = rows.map(r => ({
      node: this.rowToNode(r as Record<string, unknown>),
      score: (r['score'] as number) ?? 0,
    }));

    if (kinds && kinds.length > 0) {
      results = results.filter(r => kinds.includes(r.node.kind));
    }
    if (languages && languages.length > 0) {
      results = results.filter(r => languages.includes(r.node.language));
    }

    return results;
  }

  deleteNodesByFile(filePath: string): number {
    const result = this.db.prepare('DELETE FROM nodes WHERE file_path = ?').run(filePath);
    return result.changes;
  }

  getClassSelectorsWithoutReferenceEdges(): UnusedResult[] {
    const rows = this.classSelectorsWithoutRefsStmt.all() as Record<string, unknown>[];
    return rows.map(r => ({
      node: this.rowToNode(r),
      referencedBy: 0,
    }));
  }

  getClassSelectorsByName(name: string): Node[] {
    const rows = this.classSelectorsByNameStmt.all(name) as Record<string, unknown>[];
    return rows.map(r => this.rowToNode(r));
  }

  getClassSelectorsBySelector(selector: string): Node[] {
    const rows = this.classSelectorsBySelectorStmt.all(selector) as Record<string, unknown>[];
    return rows.map(r => this.rowToNode(r));
  }

  getClassSelectorsContainingClasses(classes: string[]): Node[] {
    if (classes.length === 0) return [];
    const conditions = classes.map(() => "(selector LIKE ? OR name = ?)").join(" AND ");
    const params: string[] = [];
    for (const cls of classes) {
      params.push(`%.${cls}%`, cls);
    }
    const sql = `SELECT * FROM nodes WHERE kind = 'class_selector' AND ${conditions} ORDER BY file_path, start_line`;
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(r => this.rowToNode(r));
  }

  searchNodesByPropertyValue(options: PropertySearchOptions): PropertySearchResult[] {
    const limit = options.limit ?? 50;

    let rows: Record<string, unknown>[];
    if (options.exact) {
      if (options.property) {
        rows = this.propertiesByPropExactStmt.all(options.property, options.value, limit) as Record<string, unknown>[];
      } else {
        rows = this.propertiesExactStmt.all(options.value, limit) as Record<string, unknown>[];
      }
    } else {
      // FTS5 prefix search: "8*" matches tokens "8px", "8rem", "8%", etc.
      const ftsQuery = options.value + '*';
      if (options.property) {
        rows = this.propertiesByPropertyValueStmt.all(options.property, ftsQuery, limit) as Record<string, unknown>[];
      } else {
        rows = this.propertiesByValueStmt.all(ftsQuery, limit) as Record<string, unknown>[];
      }
    }

    return rows.map(r => ({
      node: this.rowToNode(r),
    }));
  }

  // ===========================================================================
  // Edge Operations
  // ===========================================================================

  getOutgoingEdges(nodeId: string): Edge[] {
    const rows = this.db.prepare('SELECT * FROM edges WHERE source = ?').all(nodeId) as Record<string, unknown>[];
    return rows.map(r => this.rowToEdge(r));
  }

  getIncomingEdges(nodeId: string): Edge[] {
    const rows = this.db.prepare('SELECT * FROM edges WHERE target = ?').all(nodeId) as Record<string, unknown>[];
    return rows.map(r => this.rowToEdge(r));
  }

  getEdgesBetween(source: string, target: string): Edge[] {
    const rows = this.db.prepare('SELECT * FROM edges WHERE source = ? AND target = ?').all(source, target) as Record<string, unknown>[];
    return rows.map(r => this.rowToEdge(r));
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  insertFile(file: FileRecord): void {
    this.insertFileStmt.run(
      file.path,
      file.contentHash,
      file.language,
      file.size,
      file.modifiedAt,
      file.indexedAt,
      file.nodeCount,
      file.errors ? JSON.stringify(file.errors) : null,
    );
  }

  getFileByPath(filePath: string): FileRecord | null {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(filePath) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToFile(row);
  }

  getAllFiles(): FileRecord[] {
    const rows = this.db.prepare('SELECT * FROM files ORDER BY path').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToFile(r));
  }

  deleteFile(filePath: string): void {
    this.db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
  }

  getFileDependencies(filePath: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT n2.file_path
      FROM nodes n1
      JOIN edges e ON e.source = n1.id
      JOIN nodes n2 ON e.target = n2.id
      WHERE n1.file_path = ? AND e.kind = 'imports' AND n2.file_path != ?
    `).all(filePath, filePath) as Array<Record<string, string>>;
    return rows.map(r => r['file_path']!);
  }

  getFileDependents(filePath: string): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT n1.file_path
      FROM nodes n1
      JOIN edges e ON e.source = n1.id
      JOIN nodes n2 ON e.target = n2.id
      WHERE n2.file_path = ? AND e.kind = 'imports' AND n1.file_path != ?
    `).all(filePath, filePath) as Array<Record<string, string>>;
    return rows.map(r => r['file_path']!);
  }

  // ===========================================================================
  // Unresolved References
  // ===========================================================================

  getUnresolvedReferencesCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM unresolved_refs').get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  getUnresolvedReferencesByFiles(filePaths: string[]): Array<Record<string, unknown>> {
    if (filePaths.length === 0) return [];
    const placeholders = filePaths.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM unresolved_refs WHERE file_path IN (${placeholders})`).all(...filePaths) as Array<Record<string, unknown>>;
  }

  // ===========================================================================
  // Statistics
  // ===========================================================================

  getStats(): GraphStats {
    const nodeCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM nodes').get() as { cnt: number })?.cnt ?? 0;
    const edgeCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM edges').get() as { cnt: number })?.cnt ?? 0;
    const fileCount = (this.db.prepare('SELECT COUNT(*) as cnt FROM files').get() as { cnt: number })?.cnt ?? 0;

    const nodeKinds = this.db.prepare('SELECT kind, COUNT(*) as cnt FROM nodes GROUP BY kind').all() as Array<{ kind: string; cnt: number }>;
    const edgeKinds = this.db.prepare('SELECT kind, COUNT(*) as cnt FROM edges GROUP BY kind').all() as Array<{ kind: string; cnt: number }>;
    const fileLangs = this.db.prepare('SELECT language, COUNT(*) as cnt FROM files GROUP BY language').all() as Array<{ language: string; cnt: number }>;

    const nodesByKind: Record<string, number> = {};
    for (const { kind, cnt } of nodeKinds) nodesByKind[kind] = cnt;

    const edgesByKind: Record<string, number> = {};
    for (const { kind, cnt } of edgeKinds) edgesByKind[kind] = cnt;

    const filesByLanguage: Record<string, number> = {};
    for (const { language, cnt } of fileLangs) filesByLanguage[language] = cnt;

    const lastUpdatedRow = this.db.prepare('SELECT MAX(updated_at) as max FROM nodes').get() as { max: number | null } | undefined;

    return {
      nodeCount,
      edgeCount,
      fileCount,
      nodesByKind,
      edgesByKind,
      filesByLanguage,
      dbSizeBytes: 0,
      lastUpdated: lastUpdatedRow?.max ?? 0,
    };
  }

  getNodeAndEdgeCount(): { nodes: number; edges: number } {
    const nodes = (this.db.prepare('SELECT COUNT(*) as cnt FROM nodes').get() as { cnt: number })?.cnt ?? 0;
    const edges = (this.db.prepare('SELECT COUNT(*) as cnt FROM edges').get() as { cnt: number })?.cnt ?? 0;
    return { nodes, edges };
  }

  getLastIndexedAt(): number | null {
    const row = this.db.prepare('SELECT MAX(indexed_at) as max FROM files').get() as { max: number | null } | undefined;
    return row?.max ?? null;
  }

  // ===========================================================================
  // Metadata
  // ===========================================================================

  setMetadata(key: string, value: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO project_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(key, value, Date.now());
  }

  getMetadata(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM project_metadata WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private rowToNode(row: Record<string, unknown>): Node {
    return {
      id: row['id'] as string,
      kind: row['kind'] as NodeKind,
      name: row['name'] as string,
      qualifiedName: row['qualified_name'] as string,
      filePath: row['file_path'] as string,
      language: row['language'] as Language,
      startLine: row['start_line'] as number,
      endLine: row['end_line'] as number,
      startColumn: row['start_column'] as number,
      endColumn: row['end_column'] as number,
      signature: row['signature'] as string | undefined,
      specificity: row['specificity'] ? JSON.parse(row['specificity'] as string) : undefined,
      properties: row['properties'] ? JSON.parse(row['properties'] as string) : undefined,
      selector: row['selector'] as string | undefined,
      params: row['params'] as string | undefined,
      value: row['value'] as string | undefined,
      updatedAt: row['updated_at'] as number,
    };
  }

  private rowToEdge(row: Record<string, unknown>): Edge {
    return {
      id: row['id'] as number,
      source: row['source'] as string,
      target: row['target'] as string,
      kind: row['kind'] as EdgeKind,
      metadata: row['metadata'] ? JSON.parse(row['metadata'] as string) : undefined,
      line: row['line'] as number | undefined,
      column: row['col'] as number | undefined,
      provenance: row['provenance'] as 'postcss' | 'heuristic' | undefined,
    };
  }

  private rowToFile(row: Record<string, unknown>): FileRecord {
    return {
      path: row['path'] as string,
      contentHash: row['content_hash'] as string,
      language: row['language'] as Language,
      size: row['size'] as number,
      modifiedAt: row['modified_at'] as number,
      indexedAt: row['indexed_at'] as number,
      nodeCount: row['node_count'] as number,
      errors: row['errors'] ? JSON.parse(row['errors'] as string) : undefined,
    };
  }
}
