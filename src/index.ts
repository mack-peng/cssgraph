import * as path from 'path';
import * as fsp from 'fs/promises';
import {
  Node, Edge, FileRecord, Subgraph, TraversalOptions,
  SearchOptions, SearchResult, GraphStats, IndexProgress, IndexResult, SyncResult,
  UnusedResult, CascadeResult, PropertySearchOptions, PropertySearchResult, RuleAnalysisResult, RuleMatch,
} from './types';
import { DatabaseConnection, getDatabasePath } from './db';
import { QueryBuilder } from './db/queries';
import { isInitialized, createDirectory, removeDirectory, validateDirectory, getCodeGraphDir } from './directory';
import { initGrammars, detectLanguage, isLanguageSupported, isJSXFile, isViewFile } from './extraction/grammars';
import { GraphTraverser, GraphQueryManager, SelectorImpactResult } from './graph';
export { normalizeSelector } from './graph';
export type { SelectorImpactResult } from './graph';
import { extractFromSource } from './extraction/postcss-extractor';
import { extractCSSInJS } from './extraction/css-in-js-extractor';
import { extractClassNameUsage } from './extraction/jsx-classname-extractor';
import { extractTemplateClassNameUsage } from './extraction/template-classname-extractor';
import { findCSSModuleImports, extractCSSModuleUsage, resolveCSSModulePath } from './extraction/css-modules-resolver';
import { createContextBuilder, ContextBuilder } from './context';
import { Mutex, FileLock } from './utils';
import { FileWatcher, WatchOptions, PendingFile, LockUnavailableError } from './sync';
import { getDefaultExcludes, loadProjectConfig } from './config';
import { getGitVisibleFiles } from './extraction/git-scanner';
import { ParseWorkerPool, resolveParsePoolSize } from './extraction/parse-pool';
import { loadCSSModuleHashMap } from './extraction/css-modules-resolver';
import { deriveProjectNameTokens } from './search/query-utils';

export * from './types';
export { getDatabasePath, DatabaseConnection } from './db';
export { QueryBuilder } from './db/queries';
export { getCodeGraphDir, isInitialized, findNearestCodeGraphRoot, CODEGRAPH_DIR } from './directory';
export { IndexResult, SyncResult, IndexProgress } from './types';
export { detectLanguage, isLanguageSupported, initGrammars, isViewFile } from './extraction/grammars';
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
  private graphQueries: GraphQueryManager;
  private contextBuilder: ContextBuilder;
  private indexMutex = new Mutex();
  private fileLock: FileLock;
  private watcher: FileWatcher | null = null;
  private moduleHashMap = new Map<string, string>();

  private constructor(db: DatabaseConnection, queries: QueryBuilder, projectRoot: string) {
    this.db = db;
    this.queries = queries;
    this.projectRoot = projectRoot;
    this.fileLock = new FileLock(path.join(getCodeGraphDir(projectRoot), 'cssgraph.lock'));

    try {
      this.queries.setProjectNameTokens(deriveProjectNameTokens(this.projectRoot));
    } catch { /* best-effort */ }

    this.traverser = new GraphTraverser(queries);
    this.graphQueries = new GraphQueryManager(queries);
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
        this.db.setIndexMode();
        const result = await this.scanAndIndex(options);
        result.durationMs = Date.now() - startTime;
        return result;
      } finally {
        this.db.restoreNormalMode();
        this.fileLock.release();
      }
    });
  }

  private async scanAndIndex(options: IndexOptions, fileFilter?: string[]): Promise<IndexResult> {
    const projectConfig = loadProjectConfig(this.projectRoot);

    // Collect files into buckets — git ls-files first, filesystem walk fallback.
    const styleFiles: string[] = [];
    const viewFiles: string[] = [];
    const jsxFiles: string[] = [];
    let fileCount = 0;

    if (fileFilter) {
      // Incremental mode: use pre-computed file list (already in correct order).
      for (const relativePath of fileFilter) {
        if (isViewFile(relativePath)) {
          viewFiles.push(relativePath);
        } else if (isJSXFile(relativePath)) {
          jsxFiles.push(relativePath);
        } else {
          styleFiles.push(relativePath);
        }
      }
    } else {
    const gitFiles = getGitVisibleFiles(this.projectRoot);
    if (gitFiles) {
      for (const relativePath of gitFiles) {
        const lang = detectLanguage(relativePath);
        if (!isLanguageSupported(lang)) continue;
        if (isViewFile(relativePath)) {
          viewFiles.push(relativePath);
        } else if (isJSXFile(relativePath)) {
          jsxFiles.push(relativePath);
        } else {
          styleFiles.push(relativePath);
        }
        // Yield every 200 files so the event loop stays responsive.
        if (++fileCount % 200 === 0) {
          await new Promise<void>(r => setImmediate(r));
        }
      }
    } else {
      // Filesystem walk fallback (non-git project).
      const { default: ignore } = await import('ignore');
      const ig = ignore();
      const gitignorePath = path.join(this.projectRoot, '.gitignore');
      if (require('fs').existsSync(gitignorePath)) {
        ig.add(require('fs').readFileSync(gitignorePath, 'utf-8'));
      }
      ig.add(['node_modules', 'dist', 'build', '.git', '.next', '.cssgraph', '.codegraph']);
      ig.add(getDefaultExcludes());
      if (projectConfig.exclude?.length) {
        ig.add(projectConfig.exclude);
      }

      const scanFiles = async (rootDir: string): Promise<void> => {
        const stack: string[] = [rootDir];
        while (stack.length > 0) {
          const dir = stack.pop()!;
          const entries = require('fs').readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.relative(this.projectRoot, fullPath).replace(/\\/g, '/');
            if (ig.ignores(relativePath)) continue;
            if (entry.isDirectory()) {
              stack.push(fullPath);
            } else if (entry.isFile()) {
              const lang = detectLanguage(relativePath);
              if (!isLanguageSupported(lang)) continue;
              if (isViewFile(relativePath)) {
                viewFiles.push(relativePath);
              } else if (isJSXFile(relativePath)) {
                jsxFiles.push(relativePath);
              } else {
                styleFiles.push(relativePath);
              }
              // Yield every 200 files so the event loop stays responsive.
              if (++fileCount % 200 === 0) {
                await new Promise<void>(r => setImmediate(r));
              }
            }
          }
        }
      };

      scanFiles(this.projectRoot);
    }
    }

    // Style files must be indexed before JSX files so class selectors exist for references.
    const orderedFiles = [...styleFiles, ...viewFiles, ...jsxFiles];

    if (options.onProgress) {
      options.onProgress({ phase: 'scanning', current: orderedFiles.length, total: orderedFiles.length });
      // Yield to the event loop so the progress bar renders before the blocking
      // parse+insert loop starts (the shimmer library writes escape codes to
      // stdout, which need a tick to flush).
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    let filesIndexed = 0;
    let filesSkipped = 0;
    let filesErrored = 0;
    let totalNodes = 0;
    let totalEdges = 0;
    const allErrors: import('./types').ExtractionError[] = [];

    // Incrementally built as style files are processed; no full-DB query needed.
    const classSelectorMap: Map<string, string[]> = new Map();
    // Cache CSS module class maps to avoid repeated DB queries.
    const moduleClassMapCache = new Map<string, Map<string, string[]>>();

    // Fast-skip heuristic: skip JSX extraction for files with no CSS-related markers.
    const hasJSXMarkers = (source: string): boolean => {
      return source.indexOf('className') !== -1 ||
        source.indexOf('classNames(') !== -1 ||
        source.indexOf('cx(') !== -1 ||
        source.indexOf('clsx(') !== -1 ||
        source.indexOf('.module.') !== -1 ||
        source.indexOf('styled') !== -1;
    };

    // Parallel dispatch: runs all parses across workers in one Promise.all.
    type ParseBatchItem = {
      filePath: string; source: string; isJsx: boolean; isView: boolean;
    };
    type ParseBatchResult = ParseBatchItem & {
      result: import('./types').ExtractionResult;
      jsxRefs?: Array<{ className: string; filePath: string; line: number }>;
      refs?: Array<{ className: string; filePath: string; line: number }>;
    };
    const dispatchParseBatch = async (
      items: ParseBatchItem[],
      pool_: ParseWorkerPool | null,
    ): Promise<ParseBatchResult[]> => {
      return Promise.all(items.map(async (item): Promise<ParseBatchResult> => {
        let result: import('./types').ExtractionResult;
        let jsxRefs: ParseBatchResult['jsxRefs'];
        let refs: ParseBatchResult['refs'];

        if (item.isView) {
          result = { nodes: [], edges: [], errors: [], durationMs: 0 };
          refs = extractTemplateClassNameUsage(item.source, item.filePath);
        } else if (item.isJsx) {
          if (pool_) {
            const pr = await pool_.requestParse({ type: 'jsx', filePath: item.filePath, content: item.source });
            result = pr.result;
            jsxRefs = pr.jsxRefs;
          } else {
            result = extractCSSInJS(item.filePath, item.source);
            refs = hasJSXMarkers(item.source) ? extractClassNameUsage(item.source, item.filePath) : undefined;
          }
        } else {
          if (pool_) {
            const pr = await pool_.requestParse({ type: 'style', filePath: item.filePath, content: item.source });
            result = pr.result;
          } else {
            result = extractFromSource(item.filePath, item.source);
          }
        }

        return { ...item, result, jsxRefs, refs };
      }));
    };

    const SAVEPOINT_BATCH_SIZE = 100;
    const FILE_IO_BATCH_SIZE = 10;
    const MAX_FILE_SIZE = 1_000_000; // 1 MB

    const parseWorkerPath = require('path').join(__dirname, 'extraction', 'parse-worker.js');
    const resolvedSize = resolveParsePoolSize(process.env.CSSGRAPH_PARSE_WORKERS);
    let pool: ParseWorkerPool | null = null;
    if (require('fs').existsSync(parseWorkerPath)) {
      pool = new ParseWorkerPool({ size: resolvedSize, workerScriptPath: parseWorkerPath });
      console.error(`[cssgraph] parse pool: ${resolvedSize} workers (path=${parseWorkerPath})`);
    } else {
      console.error(`[cssgraph] parse pool DISABLED — file not found: ${parseWorkerPath} (__dirname=${__dirname})`);
    }

    this.db.getDb().exec('BEGIN');

    // Disable FTS5 triggers during bulk load — rebuilt from scratch after indexing.
    this.db.getDb().exec('DROP TRIGGER IF EXISTS nodes_ai; DROP TRIGGER IF EXISTS nodes_ad; DROP TRIGGER IF EXISTS nodes_au;');

    // Incremental mode: delete old nodes before re-indexing changed files.
    // Edges cascade-delete via FK on nodes.id.
    if (fileFilter) {
      // Only delete nodes for style files (non-JSX, non-view), since JSX and view
      // file nodes carry the file node ID as a stable hash — they're idempotent by REPLACE.
      for (const fp of fileFilter) {
        if (!isJSXFile(fp) && !isViewFile(fp)) {
          this.queries.deleteNodesByFile(fp);
        }
      }
    }

    let fileCountInBatch = 0;
    let globalIdx = 0;
    let nextSeq = 0;
    const storeCursor = { current: 0 };
    interface StoreItem { filePath: string; source: string; contentHash: string; result: import('./types').ExtractionResult; }
    const completed = new Map<number, StoreItem>();

    for (let bi = 0; bi < orderedFiles.length; bi += FILE_IO_BATCH_SIZE) {
      if (options.signal?.aborted) break;

      const batch = orderedFiles.slice(bi, bi + FILE_IO_BATCH_SIZE);
      const fileContents = await Promise.all(batch.map(async (fp) => {
        const fullPath = path.join(this.projectRoot, fp);
        try {
          const content = await fsp.readFile(fullPath, 'utf-8');
          return { filePath: fp, source: content, error: null as Error | null };
        } catch (err) {
          return { filePath: fp, source: null as string | null, error: err as Error };
        }
      }));

      // ═══ Phase 1: Collect — error checks, content-hash skip, gather files ═══
      const toProcess: Array<{filePath: string; source: string; isJsx: boolean; isView: boolean}> = [];
      const contentHashMap = new Map<string, string>();

      for (const { filePath, source, error } of fileContents) {
        if (options.signal?.aborted) break;

        if (options.onProgress) {
          options.onProgress({ phase: 'parsing', current: globalIdx, total: orderedFiles.length, currentFile: filePath });
        }

        if (error || source === null) {
          filesErrored++;
          allErrors.push({ message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`, filePath, severity: 'error', code: 'read_error' });
          globalIdx++;
          continue;
        }

        if (source.length > MAX_FILE_SIZE) {
          filesSkipped++;
          globalIdx++;
          continue;
        }

        try {
          const contentHash = require('crypto').createHash('sha256').update(source).digest('hex');

        const isJsx = isJSXFile(filePath);
        const isView = isViewFile(filePath);
        const skipHash = isJsx || isView;
        const existingFile = skipHash ? null : this.queries.getFileByPath(filePath);
        if (existingFile && existingFile.contentHash === contentHash) {
          if (!isJsx) {
            const classNodes = this.queries.getNodesByFile(filePath, ['class_selector'] as import('./types').NodeKind[]);
            for (const node of classNodes) {
              if (node.name.startsWith('#')) continue;
              const list = classSelectorMap.get(node.name) || [];
              list.push(node.id);
              classSelectorMap.set(node.name, list);
            }
          }
          fileCountInBatch++;
          if (fileCountInBatch >= SAVEPOINT_BATCH_SIZE) {
            this.db.getDb().exec('COMMIT');
            this.db.getDb().exec('BEGIN');
            fileCountInBatch = 0;
          }
          filesSkipped++;
          globalIdx++;
          continue;
        }

        toProcess.push({ filePath, source, isJsx, isView });
        contentHashMap.set(filePath, contentHash);
        } catch (err) {
          filesErrored++;
          globalIdx++;
          allErrors.push({
            message: err instanceof Error ? err.message : String(err),
            filePath,
            severity: 'error',
            code: 'parse_error',
          });
        }
      }

      // ═══ Phase 2+3: Parallel parse dispatch → sequential ref resolution + flush ═══
      if (toProcess.length > 0) {
        const parsed = await dispatchParseBatch(toProcess, pool);

        for (const req of parsed) {
          if (options.signal?.aborted) break;

          const { filePath, source, isJsx, isView, result, jsxRefs, refs } = req;
          const contentHash = contentHashMap.get(filePath)!;
          let fileNodeId: string | undefined;

          try {
            if (isJsx) {
              fileNodeId = result.nodes.find(n => n.kind === 'file')?.id;
              const edgeRefs = jsxRefs ?? refs;
              if (edgeRefs && fileNodeId) {
                for (const ref of edgeRefs) {
                  const targetIds = classSelectorMap.get(ref.className);
                  if (!targetIds || targetIds.length === 0) continue;
                  for (const targetId of targetIds) {
                    result.edges.push({ source: fileNodeId, target: targetId, kind: 'references', provenance: 'heuristic', line: ref.line });
                  }
                }
              }

              if (fileNodeId) {
                const cssModuleImports = findCSSModuleImports(source);
                for (const imp of cssModuleImports) {
                  const cssModulePath = resolveCSSModulePath(this.projectRoot, path.join(this.projectRoot, filePath), imp.importPath);
                  const cssFileNodeId = require('crypto').createHash('sha256').update(`file:${cssModulePath}`).digest('hex').slice(0, 16);
                  result.edges.push({
                    source: fileNodeId, target: cssFileNodeId,
                    kind: 'imports', provenance: 'heuristic', line: imp.line,
                  });

                  if (imp.bindingName) {
                    let moduleClassMap = moduleClassMapCache.get(cssModulePath);
                    if (!moduleClassMap) {
                      moduleClassMap = new Map<string, string[]>();
                      const moduleSelectors = this.queries.getNodesByFile(cssModulePath)
                        .filter(n => n.kind === 'class_selector');
                      for (const node of moduleSelectors) {
                        const list = moduleClassMap.get(node.name) || [];
                        list.push(node.id);
                        moduleClassMap.set(node.name, list);
                      }
                      moduleClassMapCache.set(cssModulePath, moduleClassMap);
                    }
                    const usages = extractCSSModuleUsage(source, imp.bindingName);
                    for (const usage of usages) {
                      const targetIds = moduleClassMap.get(usage.className);
                      if (!targetIds || targetIds.length === 0) continue;
                      for (const targetId of targetIds) {
                        result.edges.push({
                          source: fileNodeId, target: targetId,
                          kind: 'references', provenance: 'heuristic', line: usage.line,
                        });
                      }
                    }
                  }
                }
              }
            } else if (isView) {
              const viewFileId = result.nodes.find(n => n.kind === 'file')?.id ||
                require('crypto').createHash('sha256').update(`file:${filePath}`).digest('hex').slice(0, 16);
              if (!result.nodes.some(n => n.id === viewFileId)) {
                result.nodes.push({ id: viewFileId, name: filePath, qualifiedName: filePath, kind: 'file', filePath, language: detectLanguage(filePath), startLine: 0, endLine: 0, startColumn: 0, endColumn: 0, updatedAt: Date.now() });
              }
              fileNodeId = viewFileId;
              if (refs) {
                for (const ref of refs) {
                  const targetIds = classSelectorMap.get(ref.className);
                  if (!targetIds || targetIds.length === 0) continue;
                  for (const targetId of targetIds) {
                    result.edges.push({ source: viewFileId, target: targetId, kind: 'references', provenance: 'heuristic', line: ref.line });
                  }
                }
              }
            } else {
              fileNodeId = result.nodes.find(n => n.kind === 'file')?.id;
            }

            if (result.errors.length > 0 && result.nodes.length === 0) {
              filesErrored++;
              allErrors.push(...result.errors);
              globalIdx++;
              continue;
            }

            const seq = nextSeq++;
            completed.set(seq, { filePath, source, contentHash, result });
            CodeGraph.flushOrdered(completed, storeCursor, (item) => {
              this.db.getDb().exec('SAVEPOINT sp');

              this.queries.insertNodesBatch(item.result.nodes);
              totalNodes += item.result.nodes.length;
              for (const node of item.result.nodes) {
                if (node.kind === 'class_selector' && !node.name.startsWith('#')) {
                  const list = classSelectorMap.get(node.name) || [];
                  list.push(node.id);
                  classSelectorMap.set(node.name, list);
                }
              }

              this.queries.insertEdgesBatch(item.result.edges);
              totalEdges += item.result.edges.length;

              this.queries.insertFile({
                path: item.filePath, contentHash: item.contentHash,
                language: detectLanguage(item.filePath), size: item.source.length,
                modifiedAt: Date.now(), indexedAt: Date.now(),
                nodeCount: item.result.nodes.length,
                errors: item.result.errors.length > 0 ? item.result.errors : undefined,
              });

              this.db.getDb().exec('RELEASE sp');

              filesIndexed++;
              if (item.result.errors.length > 0) allErrors.push(...item.result.errors);
              globalIdx++;

              fileCountInBatch++;
              if (fileCountInBatch >= SAVEPOINT_BATCH_SIZE) {
                this.db.getDb().exec('COMMIT');
                this.db.getDb().exec('BEGIN');
                fileCountInBatch = 0;
              }
            });
          } catch (err) {
            filesErrored++;
            globalIdx++;
            allErrors.push({
              message: err instanceof Error ? err.message : String(err),
              filePath, severity: 'error', code: 'parse_error',
            });
          }
        }
      }
    }

    if (fileCountInBatch > 0) {
      this.db.getDb().exec('COMMIT');
    }

    // Rebuild FTS5 in one pass then recreate triggers.
    this.db.getDb().exec(`INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')`);
    this.db.getDb().exec(`
      CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
        INSERT INTO nodes_fts(rowid, id, name, qualified_name, selector, value)
        VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.selector, NEW.value);
      END;
      CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, selector, value)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.selector, OLD.value);
      END;
      CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, id, name, qualified_name, selector, value)
        VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.qualified_name, OLD.selector, OLD.value);
        INSERT INTO nodes_fts(rowid, id, name, qualified_name, selector, value)
        VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.selector, NEW.value);
      END;
    `);

    if (pool) await pool.shutdown();

    // Build CSS Modules hash→original map from source maps of .module.css files.
    for (const filePath of styleFiles) {
      if (filePath.includes('.module.')) {
        const fullPath = path.join(this.projectRoot, filePath);
        const hashMap = loadCSSModuleHashMap(fullPath);
        if (hashMap) {
          for (const [hashed, original] of hashMap) {
            this.moduleHashMap.set(hashed, original);
          }
        }
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

        // Incremental: detect changed files, skip unchanged.
        const gitFiles = getGitVisibleFiles(this.projectRoot);
        if (!gitFiles) {
          // Non-git project — fall back to full rebuild.
          this.db.setIndexMode();
          const result = await this.scanAndIndex(options);
          return {
            filesChecked: result.filesIndexed + result.filesSkipped + result.filesErrored,
            filesAdded: result.filesIndexed,
            filesModified: 0,
            filesRemoved: 0,
            nodesUpdated: result.nodesCreated,
            durationMs: Date.now() - startTime,
          };
        }

        const dbFiles = this.queries.getAllFiles();
        const dbFilePaths = new Set(dbFiles.map(f => f.path));
        const dbFileHashes = new Map(dbFiles.map(f => [f.path, f.contentHash]));
        const gitFileSet = new Set(gitFiles);

        // Removed files — delete nodes (edges cascade via FK).
        const removed = dbFiles.filter(f => !gitFileSet.has(f.path));
        for (const r of removed) {
          this.queries.deleteNodesByFile(r.path);
        }
        for (const r of removed) this.queries.deleteFile(r.path);

        // Added + potentially modified files.
        const added: string[] = [];
        const modified: string[] = [];
        let filesChecked = removed.length;

        const fs = require('fs') as typeof import('fs');
        for (const fp of gitFiles) {
          const lang = detectLanguage(fp);
          if (lang === 'unknown' || !isLanguageSupported(lang)) continue;
          if (lang !== 'less' && lang !== 'scss' && lang !== 'css' && lang !== 'sass' && lang !== 'pcss') {
            if (!isJSXFile(fp) && !isViewFile(fp)) continue;
          }

          if (!dbFilePaths.has(fp)) {
            added.push(fp);
          } else {
            // Check content hash (lightweight: stat + read only if mtime differs).
            try {
              const fullPath = require('path').join(this.projectRoot, fp);
              const content = fs.readFileSync(fullPath, 'utf-8');
              const contentHash = require('crypto').createHash('sha256').update(content).digest('hex');
              if (contentHash !== dbFileHashes.get(fp)) {
                modified.push(fp);
              }
            } catch { /* skip unreadable files */ }
          }
          filesChecked++;
        }

        if (removed.length === 0 && added.length === 0 && modified.length === 0) {
          return { filesChecked, filesAdded: 0, filesModified: 0, filesRemoved: 0, nodesUpdated: 0, durationMs: Date.now() - startTime };
        }

        // Re-index changed files: style files first, then view, then JSX.
        const changedStyle = [...added, ...modified].filter(f => !isJSXFile(f) && !isViewFile(f));
        const changedView = [...added, ...modified].filter(f => isViewFile(f));
        const changedJSX = [...added, ...modified].filter(f => isJSXFile(f));
        const changedFiles = [...changedStyle, ...changedView, ...changedJSX];

        this.db.setIndexMode();
        const result = await this.scanAndIndex({}, changedFiles);

        return {
          filesChecked,
          filesAdded: added.length,
          filesModified: modified.length,
          filesRemoved: removed.length,
          nodesUpdated: result.nodesCreated,
          durationMs: Date.now() - startTime,
        };
      } finally {
        this.db.restoreNormalMode();
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

  findUnusedClassSelectors(): UnusedResult[] {
    return this.graphQueries.findUnusedClassSelectors();
  }

  getCascade(className: string): CascadeResult {
    return this.graphQueries.getCascade(className);
  }

  searchByPropertyValue(options: PropertySearchOptions): PropertySearchResult[] {
    return this.graphQueries.searchByPropertyValue(options);
  }

  analyzeRule(selector: string): RuleAnalysisResult {
    return this.graphQueries.analyzeRule(selector, this.moduleHashMap);
  }

  selectorDetails(selector: string): RuleMatch[] {
    return this.graphQueries.getSelectorDetails(selector, this.moduleHashMap);
  }

  selectorImpact(selector: string): SelectorImpactResult {
    return this.graphQueries.selectorImpact(selector, this.moduleHashMap);
  }

  // ===========================================================================
  // Explore
  // ===========================================================================

  explore(query: string, maxFiles?: number): string {
    return this.contextBuilder.explore(query, maxFiles);
  }

  // ===========================================================================
  // Store helpers (for Worker-pool decoupling)
  // ===========================================================================

  /** Commit completed items in file-order using a sequence-number buffer.
   *  Today parse is serial so flushOrdered always drains in one call; the
   *  Map buffer exists so the Worker pool can deliver results out-of-order
   *  while store stays sequential. */
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

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /** Close, delete the DB, and rebuild from scratch. Much faster than DELETE. */
  reinit(): void {
    this.close();
    const dbPath = getDatabasePath(this.projectRoot);
    this.db = DatabaseConnection.reinitialize(dbPath);
    this.queries = new QueryBuilder(this.db.getDb());
    this.traverser = new GraphTraverser(this.queries);
    this.graphQueries = new GraphQueryManager(this.queries);
    this.contextBuilder = createContextBuilder(this.projectRoot, this.queries, this.traverser);
  }

  uninitialize(): void {
    this.close();
    removeDirectory(this.projectRoot);
  }
}

export default CodeGraph;
