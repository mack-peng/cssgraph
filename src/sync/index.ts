export interface PendingFile {
  path: string;
  firstSeenMs: number;
  lastSeenMs: number;
  indexing: boolean;
}

export interface WatchOptions {
  debounceMs?: number;
  onSync?: () => Promise<{ filesChanged: number; durationMs: number }>;
  onError?: (err: Error) => void;
}

export { FileWatcher } from './watcher';
export { LockUnavailableError } from './watcher';
