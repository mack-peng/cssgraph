/**
 * Parse worker pool — runs PostCSS parsing across N worker threads.
 *
 * CSSGRAPH_PARSE_WORKERS env var sets pool size (default: cpuCores - 1, capped 8).
 * Set to 1 to force single-worker mode (conservative rollback).
 */

import { Worker } from 'worker_threads';
import * as os from 'os';
import type { ExtractionResult } from '../types';

const DEFAULT_POOL_CAP = 8;
const MAX_POOL_SIZE = 16;

export function resolveParsePoolSize(envVal: string | undefined): number {
  if (envVal !== undefined && envVal !== '') {
    const n = Number(envVal);
    if (Number.isFinite(n) && n >= 0) {
      return Math.max(1, Math.min(Math.floor(n), MAX_POOL_SIZE));
    }
  }
  return Math.max(1, Math.min(os.cpus().length - 1, DEFAULT_POOL_CAP));
}

export interface ParseTask {
  type: 'style' | 'jsx';
  filePath: string;
  content: string;
}

export interface ParseResult {
  result: ExtractionResult;
  jsxRefs?: Array<{ className: string; filePath: string; line: number }>;
}

interface PendingJob {
  id: number;
  task: ParseTask;
  resolve: (r: ParseResult) => void;
  reject: (e: Error) => void;
}

interface IdleWorker {
  worker: Worker;
  jobId: number | null;
}

export class ParseWorkerPool {
  private scriptPath: string;
  readonly size: number;
  private idle: IdleWorker[] = [];
  private pending = new Map<number, PendingJob>();
  private queue: PendingJob[] = [];
  private nextId = 0;
  private spawnCount = 0;
  private running = true;

  constructor(opts: { size: number; workerScriptPath: string }) {
    this.scriptPath = opts.workerScriptPath;
    this.size = opts.size;
  }

  requestParse(task: ParseTask): Promise<ParseResult> {
    return new Promise((resolve, reject) => {
      const job: PendingJob = { id: this.nextId++, task, resolve, reject };
      this.queue.push(job);
      this.flush();
    });
  }

  async shutdown(): Promise<void> {
    this.running = false;
    const err = new Error('Parse pool shut down');
    for (const j of this.queue) j.reject(err);
    for (const j of this.pending.values()) j.reject(err);
    this.queue = [];
    this.pending.clear();
    for (const w of this.idle) await w.worker.terminate();
    this.idle = [];
  }

  private flush(): void {
    while (this.queue.length > 0 && this.idle.length > 0) {
      const job = this.queue.shift()!;
      const w = this.idle.pop()!;
      this.pending.set(job.id, job);
      this.dispatch(job, w);
    }
    if (this.spawnCount < this.size && this.queue.length > this.idle.length) {
      this.spawnOne();
    }
  }

  private spawnOne(): void {
    if (this.spawnCount >= this.size || !this.running) return;
    this.spawnCount++;

    try {
      const worker = new Worker(this.scriptPath);
      const w: IdleWorker = { worker, jobId: null };

      worker.on('message', (msg: { type?: string; id: number; ok: boolean; result?: ExtractionResult; jsxRefs?: ParseResult['jsxRefs']; error?: string }) => {
        if (msg.type === 'ready') {
          this.idle.push(w);
          this.flush();
          return;
        }

        w.jobId = null;
        const job = this.pending.get(msg.id);
        if (!job) {
          if (!this.running) { worker.terminate().catch(() => {}); return; }
          this.idle.push(w);
          return;
        }
        this.pending.delete(msg.id);

        if (!msg.ok || !msg.result) {
          job.reject(new Error(msg.error ?? 'Parse failed'));
        } else {
          job.resolve({ result: msg.result, jsxRefs: msg.jsxRefs });
        }
        this.idle.push(w);
        this.flush();
      });

      worker.on('error', () => {
        this.spawnCount--;
        // Reject the pending job this worker was handling (if any).
        if (w.jobId !== null) {
          const job = this.pending.get(w.jobId);
          if (job) { this.pending.delete(w.jobId); job.reject(new Error('Worker crashed')); }
        }
        worker.terminate().catch(() => {});
        this.flush();
      });
    } catch {
      this.spawnCount--;
    }
  }

  private dispatch(job: PendingJob, w: IdleWorker): void {
    w.jobId = job.id;
    w.worker.postMessage({
      id: job.id,
      type: job.task.type,
      filePath: job.task.filePath,
      content: job.task.content,
    });
  }
}
