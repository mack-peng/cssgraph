import { ExtractionResult, Edge } from '../types';
import postcss from 'postcss';
import * as crypto from 'crypto';

function hashId(qualifiedName: string): string {
  return crypto.createHash('sha256').update(qualifiedName).digest('hex').slice(0, 16);
}

export function resolveImports(
  filePath: string,
  source: string,
): ExtractionResult {
  const edges: Edge[] = [];
  const errors: Error[] = [];

  try {
    const root = postcss.parse(source, { from: filePath });

    root.walkAtRules(atRule => {
      const names = ['import', 'use', 'forward'];
      if (!names.includes(atRule.name)) return;

      let target = atRule.params.replace(/['"]/g, '').split(/\s+/)[0];
      if (!target) return;

      const sourceNodeId = hashId(`file:${filePath}`);
      const targetNodeId = hashId(`file:${target}`);

      edges.push({
        source: sourceNodeId,
        target: targetNodeId,
        kind: 'imports',
        provenance: 'postcss',
        line: atRule.source?.start?.line,
      });
    });
  } catch (err) {
    errors.push(err instanceof Error ? err : new Error(String(err)));
  }

  return {
    nodes: [],
    edges,
    errors: errors.map(e => ({
      message: e.message,
      filePath,
      severity: 'error' as const,
      code: 'import_resolve_error',
    })),
    durationMs: 0,
  };
}
