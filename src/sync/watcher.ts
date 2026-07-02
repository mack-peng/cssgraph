import * as fs from 'fs';
import { WatchOptions, PendingFile } from './index';

export class LockUnavailableError extends Error {
  constructor() {
    super('File lock unavailable');
    this.name = 'LockUnavailableError';
  }
}

export class FileWatcher {
  private projectRoot: string;
  private syncFn: () => Promise<{ filesChanged: number; durationMs: number }>;
  private options: WatchOptions;
  private active = false;
  private degraded = false;
  private degradedReason: string | null = null;
  private pendingFiles: PendingFile[] = [];
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;

  constructor(
    projectRoot: string,
    syncFn: () => Promise<{ filesChanged: number; durationMs: number }>,
    options: WatchOptions = {},
  ) {
    this.projectRoot = projectRoot;
    this.syncFn = syncFn;
    this.options = options;
  }

  start(): boolean {
    if (this.active) return true;

    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });

    try {
      const debounceMs = this.options.debounceMs ?? 2000;
      this.watcher = fs.watch(this.projectRoot, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const filePath = filename;

        this.pendingFiles.push({
          path: filePath,
          firstSeenMs: Date.now(),
          lastSeenMs: Date.now(),
          indexing: false,
        });

        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(async () => {
          this.pendingFiles.forEach(f => f.indexing = true);
          try {
            await this.syncFn();
            this.pendingFiles = [];
          } catch (err) {
            if (err instanceof LockUnavailableError) {
              this.pendingFiles.forEach(f => f.indexing = false);
            } else {
              this.pendingFiles = [];
            }
          }
        }, debounceMs);
      });

      this.watcher.on('error', (err) => {
        this.degraded = true;
        this.degradedReason = err.message;
        this.options.onError?.(err);
      });

      this.active = true;
      this.readyResolve?.();
      return true;
    } catch (err) {
      this.degraded = true;
      this.degradedReason = err instanceof Error ? err.message : String(err);
      this.readyResolve?.();
      return false;
    }
  }

  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  getDegradedReason(): string | null {
    return this.degradedReason;
  }

  getPendingFiles(): PendingFile[] {
    return this.pendingFiles;
  }

  waitUntilReady(timeoutMs?: number): Promise<void> {
    if (!this.readyPromise) return Promise.resolve();
    if (!timeoutMs) return this.readyPromise;

    return Promise.race([
      this.readyPromise,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
}
