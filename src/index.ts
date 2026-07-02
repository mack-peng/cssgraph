import * as path from 'path';
import {
  Node, Edge, FileRecord, Subgraph, TraversalOptions,
  SearchOptions, SearchResult, GraphStats, IndexProgress, IndexResult, SyncResult,
} from './types';
import { DatabaseConnection, getDatabasePath } from './db';
import { QueryBuilder } from './db/queries';
import { isInitialized, createDirectory, removeDirectory, validateDirectory, getCodeGraphDir } from './directory';
import { initGrammars, detectLanguage, isLanguageSupported } from './extraction/grammars';
import { GraphTraverser } from './graph';
import { extractFromSource } from './extraction/postcss-extractor';
import { createContextBuilder, ContextBuilder } from './context';
import { Mutex, FileLock } from './utils';
import { FileWatcher, WatchOptions, PendingFile, LockUnavailableError } from './sync';
import { deriveProjectNameTokens } from './search/query-utils';

export * from './types';
export { getDatabasePath, DatabaseConnection } from './db';
export { QueryBuilder } from './db/queries';
export { getCodeGraphDir, isInitialized, findNearestCodeGraphRoot, CODEGRAPH_DIR } from './directory';
export { IndexResult, SyncResult, IndexProgress } from './types';
export { detectLanguage, isLanguageSupported, initGrammars } from './extraction/grammars';
export { CodeGraphError, FileError, ParseError, DatabaseError, ConfigError, setLogger, getLogger, silentLogger, defaultLogger } from './errors';
export { Mutex, FileLock } from './utils';
export { FileWatcher, WatchOptions, PendingFile, LockUnavailableError } from './sync';

export interface InitOptions {
  index?: boolean;
  onProgress?: (progress: IndexProgress) => void;
}

export interface OpenOptions {
  sync?: boolean;
  readOnly?: boolean;
}

export interface IndexOptions {
  onProgress?: (progress: IndexProgress) => void;
  signal?: AbortSignal;
  verbose?: boolean;
}

export class CodeGraph {
  private db: DatabaseConnection;
  private queries: QueryBuilder;
  private projectRoot: string;
  private traverser: GraphTraverser;
  private contextBuilder: ContextBuilder;
  private indexMutex = new Mutex();
  private fileLock: FileLock;
  private watcher: FileWatcher | null = null;

  private constructor(db: DatabaseConnection, queries: QueryBuilder, projectRoot: string) {
    this.db = db;
    this.queries = queries;
    this.projectRoot = projectRoot;
    this.fileLock = new FileLock(path.join(getCodeGraphDir(projectRoot), 'cssgraph.lock'));

    try {
      this.queries.setProjectNameTokens(deriveProjectNameTokens(this.projectRoot));
    } catch { /* best-effort */ }

    this.traverser = new GraphTraverser(queries);
    this.contextBuilder = createContextBuilder(this.projectRoot, this.queries, this.traverser);
  }

  static async init(projectRoot: string, options: InitOptions = {}): Promise<CodeGraph> {
    await initGrammars();
    const resolvedRoot = path.resolve(projectRoot);

    if (isInitialized(resolvedRoot)) {
      throw new Error(`cssgraph already initialized in ${resolvedRoot}`);
    }

    createDirectory(resolvedRoot);
    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.initialize(dbPath);
    const queries = new QueryBuilder(db.getDb());

    const instance = new CodeGraph(db, queries, resolvedRoot);

    if (options.index) {
      await instance.indexAll({ onProgress: options.onProgress });
    }

    return instance;
  }

  static initSync(projectRoot: string): CodeGraph {
    const resolvedRoot = path.resolve(projectRoot);

    if (isInitialized(resolvedRoot)) {
      throw new Error(`cssgraph already initialized in ${resolvedRoot}`);
    }

    createDirectory(resolvedRoot);
    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.initialize(dbPath);
    const queries = new QueryBuilder(db.getDb());

    return new CodeGraph(db, queries, resolvedRoot);
  }

  static async open(projectRoot: string, options: OpenOptions = {}): Promise<CodeGraph> {
    await initGrammars();
    const resolvedRoot = path.resolve(projectRoot);

    if (!isInitialized(resolvedRoot)) {
      throw new Error(`cssgraph not initialized in ${resolvedRoot}. Run init() first.`);
    }

    const validation = validateDirectory(resolvedRoot);
    if (!validation.valid) {
      throw new Error(`Invalid cssgraph directory: ${validation.errors.join(', ')}`);
    }

    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.open(dbPath);
    const queries = new QueryBuilder(db.getDb());

    const instance = new CodeGraph(db, queries, resolvedRoot);

    if (options.sync) {
      await instance.sync();
    }

    return instance;
  }

  static openSync(projectRoot: string): CodeGraph {
    const resolvedRoot = path.resolve(projectRoot);

    if (!isInitialized(resolvedRoot)) {
      throw new Error(`cssgraph not initialized in ${resolvedRoot}. Run init() first.`);
    }

    const dbPath = getDatabasePath(resolvedRoot);
    const db = DatabaseConnection.open(dbPath);
    const queries = new QueryBuilder(db.getDb());

    return new CodeGraph(db, queries, resolvedRoot);
  }

  static isInitialized(projectRoot: string): boolean {
    return isInitialized(path.resolve(projectRoot));
  }

  close(): void {
    this.unwatch();
    this.fileLock.release();
    this.db.close();
  }

  destroy(): void {
    this.close();
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  // ===========================================================================
  // Indexing
  // ===========================================================================

  async indexAll(options: IndexOptions = {}): Promise<IndexResult> {
    return this.indexMutex.withLock(async () => {
      try {
        this.fileLock.acquire();
      } catch {
        return { success: false, filesIndexed: 0, filesSkipped: 0, filesErrored: 0, nodesCreated: 0, edgesCreated: 0, errors: [{ message: 'Could not acquire file lock', severity: 'error' as const }], durationMs: 0 };
      }

      try {
        const startTime = Date.now();
        const result = await this.scanAndIndex(options);
        result.durationMs = Date.now() - startTime;
        return result;
      } finally {
        this.fileLock.release();
      }
    });
  }

  private async scanAndIndex(options: IndexOptions): Promise<IndexResult> {
    const { default: ignore } = await import('ignore');
    const ig = ignore();

    const gitignorePath = path.join(this.projectRoot, '.gitignore');
    if (require('fs').existsSync(gitignorePath)) {
      ig.add(require('fs').readFileSync(gitignorePath, 'utf-8'));
    }
    ig.add(['node_modules', 'dist', 'build', '.git', '.next', '.cssgraph', '.codegraph']);

    const scanFiles = (dir: string): string[] => {
      const entries = require('fs').readdirSync(dir, { withFileTypes: true });
      const results: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.projectRoot, fullPath).replace(/\\/g, '/');
        if (ig.ignores(relativePath)) continue;
        if (entry.isDirectory()) {
          results.push(...scanFiles(fullPath));
        } else if (entry.isFile()) {
          const lang = detectLanguage(relativePath);
          if (isLanguageSupported(lang)) {
            results.push(relativePath);
          }
        }
      }
      return results;
    };

    const styleFiles = scanFiles(this.projectRoot);

    if (options.onProgress) {
      options.onProgress({ phase: 'scanning', current: styleFiles.length, total: styleFiles.length });
    }

    let filesIndexed = 0;
    let filesSkipped = 0;
    let filesErrored = 0;
    let totalNodes = 0;
    let totalEdges = 0;
    const allErrors: import('./types').ExtractionError[] = [];

    for (let i = 0; i < styleFiles.length; i++) {
      const filePath = styleFiles[i]!;
      if (options.signal?.aborted) break;

      if (options.onProgress) {
        options.onProgress({ phase: 'parsing', current: i, total: styleFiles.length, currentFile: filePath });
      }

      try {
        const fullPath = path.join(this.projectRoot, filePath);
        const source = require('fs').readFileSync(fullPath, 'utf-8');
        const result = extractFromSource(filePath, source);

        if (result.errors.length > 0 && result.nodes.length === 0) {
          filesErrored++;
          allErrors.push(...result.errors);
          continue;
        }

        this.db.getDb().exec('BEGIN');

        for (const node of result.nodes) {
          this.queries.insertNode(node);
          totalNodes++;
        }
        for (const edge of result.edges) {
          this.queries.insertEdge(edge);
          totalEdges++;
        }

        const fileRecord: FileRecord = {
          path: filePath,
          contentHash: require('crypto').createHash('sha256').update(source).digest('hex'),
          language: detectLanguage(filePath),
          size: source.length,
          modifiedAt: Date.now(),
          indexedAt: Date.now(),
          nodeCount: result.nodes.length,
          errors: result.errors.length > 0 ? result.errors : undefined,
        };
        this.queries.insertFile(fileRecord);

        this.db.getDb().exec('COMMIT');

        filesIndexed++;
        if (result.errors.length > 0) allErrors.push(...result.errors);
      } catch (err) {
        filesErrored++;
        allErrors.push({
          message: err instanceof Error ? err.message : String(err),
          filePath,
          severity: 'error',
          code: 'parse_error',
        });
      }
    }

    return {
      success: filesErrored === 0,
      filesIndexed,
      filesSkipped,
      filesErrored,
      nodesCreated: totalNodes,
      edgesCreated: totalEdges,
      errors: allErrors,
      durationMs: 0,
    };
  }

  async sync(options: IndexOptions = {}): Promise<SyncResult> {
    return this.indexMutex.withLock(async () => {
      try {
        this.fileLock.acquire();
      } catch {
        return { filesChecked: 0, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: 0 };
      }

      try {
        const startTime = Date.now();
        const result = await this.scanAndIndex(options);
        return {
          filesChecked: result.filesIndexed + result.filesSkipped + result.filesErrored,
          filesAdded: result.filesIndexed,
          filesModified: 0,
          filesRemoved: 0,
          nodesUpdated: result.nodesCreated,
          durationMs: Date.now() - startTime,
        };
      } finally {
        this.fileLock.release();
      }
    });
  }

  // ===========================================================================
  // File Watching
  // ===========================================================================

  watch(options: WatchOptions = {}): boolean {
    if (this.watcher?.isActive()) return true;

    this.watcher = new FileWatcher(
      this.projectRoot,
      async () => {
        const result = await this.sync();
        if (result.filesChecked === 0 && result.durationMs === 0) {
          throw new LockUnavailableError();
        }
        return { filesChanged: result.filesAdded + result.filesModified + result.filesRemoved, durationMs: result.durationMs };
      },
      options,
    );

    return this.watcher.start();
  }

  unwatch(): void {
    if (this.watcher) {
      this.watcher.stop();
      this.watcher = null;
    }
  }

  isWatching(): boolean {
    return this.watcher?.isActive() ?? false;
  }

  getPendingFiles(): PendingFile[] {
    return this.watcher?.getPendingFiles() ?? [];
  }

  // ===========================================================================
  // Graph Statistics
  // ===========================================================================

  getStats(): GraphStats {
    const stats = this.queries.getStats();
    stats.dbSizeBytes = this.db.getSize();
    return stats;
  }

  getBackend(): import('./db').SqliteBackend {
    return this.db.getBackend();
  }

  getJournalMode(): string {
    return this.db.getJournalMode();
  }

  getLastIndexedAt(): number | null {
    return this.queries.getLastIndexedAt();
  }

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  getNode(id: string): Node | null {
    return this.queries.getNodeById(id);
  }

  getNodesInFile(filePath: string): Node[] {
    return this.queries.getNodesByFile(filePath);
  }

  getNodesByKind(kind: Node['kind']): Node[] {
    return this.queries.getNodesByKind(kind);
  }

  getNodesByName(name: string): Node[] {
    return this.queries.getNodesByName(name);
  }

  searchNodes(query: string, options?: SearchOptions): SearchResult[] {
    return this.queries.searchNodes(query, options);
  }

  getProjectNameTokens(): Set<string> {
    return this.queries.getProjectNameTokens();
  }

  // ===========================================================================
  // Edge Operations
  // ===========================================================================

  getOutgoingEdges(nodeId: string): Edge[] {
    return this.queries.getOutgoingEdges(nodeId);
  }

  getIncomingEdges(nodeId: string): Edge[] {
    return this.queries.getIncomingEdges(nodeId);
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  getFile(filePath: string): FileRecord | null {
    return this.queries.getFileByPath(filePath);
  }

  getFiles(): FileRecord[] {
    return this.queries.getAllFiles();
  }

  // ===========================================================================
  // Graph Query Methods
  // ===========================================================================

  traverse(startId: string, options?: TraversalOptions): Subgraph {
    return this.traverser.traverseBFS(startId, options);
  }

  getCallers(nodeId: string, maxDepth: number = 1): Array<{ node: Node; edge: Edge }> {
    return this.traverser.getCallers(nodeId, maxDepth);
  }

  getCallees(nodeId: string, maxDepth: number = 1): Array<{ node: Node; edge: Edge }> {
    return this.traverser.getCallees(nodeId, maxDepth);
  }

  getImpactRadius(nodeId: string, maxDepth: number = 3): Subgraph {
    return this.traverser.getImpactRadius(nodeId, maxDepth);
  }

  findPath(fromId: string, toId: string, edgeKinds?: Edge['kind'][]): Array<{ node: Node; edge: Edge | null }> | null {
    return this.traverser.findPath(fromId, toId, edgeKinds);
  }

  getAncestors(nodeId: string): Node[] {
    return this.traverser.getAncestors(nodeId);
  }

  getChildren(nodeId: string): Node[] {
    return this.traverser.getChildren(nodeId);
  }

  // ===========================================================================
  // Explore
  // ===========================================================================

  explore(query: string, maxFiles?: number): string {
    return this.contextBuilder.explore(query, maxFiles);
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  uninitialize(): void {
    this.close();
    removeDirectory(this.projectRoot);
  }
}

export default CodeGraph;
