import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

export type SqliteBackend = 'node-sqlite';

export function getDatabasePath(projectRoot: string): string {
  return path.join(projectRoot, '.cssgraph', 'cssgraph.db');
}

export function removeDatabaseFiles(dbPath: string): void {
  const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const f of files) {
    try { fs.unlinkSync(f); } catch { /* file may not exist */ }
  }
}

export class DatabaseConnection {
  private db: DatabaseSync;
  private dbPath: string;

  private constructor(db: DatabaseSync, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
    this.enableWAL();
  }

  static initialize(dbPath: string): DatabaseConnection {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA foreign_keys=ON');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSql);
    this.ensureRuntimeIndexes(db);

    return new DatabaseConnection(db, dbPath);
  }

  static open(dbPath: string): DatabaseConnection {
    const db = new DatabaseSync(dbPath);
    this.ensureRuntimeIndexes(db);
    return new DatabaseConnection(db, dbPath);
  }

  private static ensureRuntimeIndexes(db: DatabaseSync): void {
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_value ON nodes(value)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_selector ON nodes(selector)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_kind_name ON nodes(kind, name)`);
    } catch { /* best effort */ }
  }

  private enableWAL(): void {
    try {
      this.db.exec('PRAGMA journal_mode=WAL');
      this.db.exec('PRAGMA foreign_keys=ON');
    } catch { /* best effort */ }
  }

  getDb(): DatabaseSync {
    return this.db;
  }

  setIndexMode(): void {
    try {
      this.db.exec('PRAGMA journal_mode=WAL');
      this.db.exec('PRAGMA synchronous=OFF');
      this.db.exec('PRAGMA cache_size=-500000');
    } catch { /* best effort */ }
  }

  restoreNormalMode(): void {
    try {
      this.db.exec('PRAGMA synchronous=NORMAL');
    } catch { /* best effort */ }
  }

  getPath(): string {
    return this.dbPath;
  }

  getBackend(): SqliteBackend {
    return 'node-sqlite';
  }

  getJournalMode(): string {
    try {
      const row = this.db.prepare('PRAGMA journal_mode').get() as { journal_mode: string } | undefined;
      return row?.journal_mode ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  getSize(): number {
    try {
      return fs.statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }

  close(): void {
    try { this.db.close(); } catch { /* already closed */ }
  }

  isReplacedOnDisk(): boolean {
    return false;
  }

  runMaintenance(): void {
    try {
      this.db.exec('PRAGMA optimize');
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch { /* best effort */ }
  }

  optimize(): void {
    try {
      this.db.exec('VACUUM');
      this.db.exec('ANALYZE');
    } catch { /* best effort */ }
  }
}
