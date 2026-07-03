/**
 * Parse Worker
 *
 * Runs PostCSS parsing in a separate thread. The main thread dispatches
 * file paths + contents; the worker returns parsed nodes, edges, and errors.
 * No DB access — the worker is a pure function from (filePath, source, language) → ExtractionResult.
 */

import { parentPort } from 'worker_threads';
import { extractFromSource } from './postcss-extractor';
import { extractCSSInJS } from './css-in-js-extractor';
import { extractClassNameUsage } from './jsx-classname-extractor';
import type { ExtractionResult } from '../types';

// Signal the main thread that this worker is ready to receive jobs.
parentPort!.postMessage({ type: 'ready' });

interface ParseRequest {
  id: number;
  type: 'style' | 'jsx';
  filePath: string;
  content: string;
}

type ParseResponse =
  | { id: number; ok: true; result: ExtractionResult; jsxRefs?: Array<{ className: string; filePath: string; line: number }> }
  | { id: number; ok: false; error: string };

parentPort!.on('message', (msg: ParseRequest) => {
  try {
    if (msg.type === 'style') {
      const result = extractFromSource(msg.filePath, msg.content);
      parentPort!.postMessage({ id: msg.id, ok: true, result } satisfies ParseResponse);
    } else if (msg.type === 'jsx') {
      const result = extractCSSInJS(msg.filePath, msg.content);
      const refs = extractClassNameUsage(msg.content, msg.filePath);
      parentPort!.postMessage({
        id: msg.id,
        ok: true,
        result,
        jsxRefs: refs,
      } satisfies ParseResponse);
    } else {
      parentPort!.postMessage({ id: msg.id, ok: false, error: `Unknown parse type: ${(msg as any).type}` } satisfies ParseResponse);
    }
  } catch (err) {
    parentPort!.postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies ParseResponse);
  }
});
