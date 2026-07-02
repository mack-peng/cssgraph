import * as path from 'path';

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function validatePathWithinRoot(absPath: string, root: string): boolean {
  const normalized = path.resolve(absPath);
  const normalizedRoot = path.resolve(root);
  return normalized.startsWith(normalizedRoot + path.sep) || normalized === normalizedRoot;
}

export function validateProjectPath(inputPath: string, root: string): string | null {
  const absPath = path.resolve(root, inputPath);
  if (!validatePathWithinRoot(absPath, root)) return null;
  return normalizePath(path.relative(root, absPath));
}

export function isConfigLeafNode(_filePath: string): boolean {
  return false;
}

export const CONFIG_LEAF_LANGUAGES: string[] = [];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export class Mutex {
  private locked = false;
  private queue: Array<() => void> = [];

  isLocked(): boolean {
    return this.locked;
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

import * as fs from 'fs';

export class FileLock {
  private fd: number | null = null;
  private lockPath: string;

  constructor(lockPath: string) {
    this.lockPath = lockPath;
  }

  acquire(): void {
    if (this.fd !== null) return;
    try {
      const dir = path.dirname(this.lockPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.fd = fs.openSync(this.lockPath, 'w');
    } catch (err) {
      throw new Error(`Could not acquire file lock: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  release(): void {
    if (this.fd === null) return;
    try {
      fs.closeSync(this.fd);
      fs.unlinkSync(this.lockPath);
    } catch { /* lock file already gone */ }
    this.fd = null;
  }
}

export function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => R[]
): R[] {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    results.push(...processor(items.slice(i, i + batchSize)));
  }
  return results;
}

export function debounce<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: any[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  }) as T;
}

export function throttle<T extends (...args: any[]) => void>(fn: T, limit: number): T {
  let lastTime = 0;
  return ((...args: any[]) => {
    const now = Date.now();
    if (now - lastTime >= limit) {
      lastTime = now;
      fn(...args);
    }
  }) as T;
}
