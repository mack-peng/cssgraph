import { QueryBuilder } from '../db/queries';
import { GraphTraverser } from '../graph/traversal';
import { Subgraph, Node, Edge, FindRelevantContextOptions } from '../types';
import * as fs from 'fs';
import * as path from 'path';

export interface ContextBuilder {
  getCode(nodeId: string): Promise<string | null>;
  findRelevantContext(query: string, options?: FindRelevantContextOptions): Promise<Subgraph>;
  explore(query: string, maxFiles?: number): string;
}

const EXPLORE_BUDGET_MAX_FILES = 20;
const EXPLORE_BUDGET_PER_FILE = 20;

function readSourceContext(node: Node, projectRoot: string): string | null {
  try {
    const filePath = path.join(projectRoot, node.filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const start = Math.max(0, node.startLine - 3);
    const end = Math.min(lines.length, node.endLine + 2);
    return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
  } catch {
    return null;
  }
}

function compareSpecificityDesc(a: Node, b: Node): number {
  const sa = a.specificity ?? [0, 0, 0, 0];
  const sb = b.specificity ?? [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    if ((sb[i] ?? 0) !== (sa[i] ?? 0)) return (sb[i] ?? 0) - (sa[i] ?? 0);
  }
  return 0;
}

export function createContextBuilder(
  projectRoot: string,
  queries: QueryBuilder,
  traverser: GraphTraverser,
): ContextBuilder {
  return {
    async getCode(nodeId: string): Promise<string | null> {
      const node = queries.getNodeById(nodeId);
      if (!node) return null;

      try {
        const filePath = path.join(projectRoot, node.filePath);
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        return lines.slice(node.startLine - 1, node.endLine).join('\n');
      } catch {
        return null;
      }
    },

    async findRelevantContext(query: string, options?: FindRelevantContextOptions): Promise<Subgraph> {
      const searchLimit = options?.searchLimit ?? 5;
      const traversalDepth = options?.traversalDepth ?? 2;

      const results = queries.searchNodes(query, { limit: searchLimit });
      const nodes = new Map<string, Node>();
      const edges: Edge[] = [];
      const roots: string[] = [];

      for (const result of results) {
        roots.push(result.node.id);
        nodes.set(result.node.id, result.node);

        const subgraph = traverser.traverseBFS(result.node.id, {
          maxDepth: traversalDepth,
          direction: 'both',
          limit: 50,
        });

        for (const [id, node] of subgraph.nodes) {
          if (!nodes.has(id)) nodes.set(id, node);
        }
        edges.push(...subgraph.edges);
      }

      return { nodes, edges, roots };
    },

    explore(query: string, maxFiles: number = 12): string {
      const searchLimit = Math.max(20, maxFiles * EXPLORE_BUDGET_PER_FILE);
      const results = queries.searchNodes(query, { limit: searchLimit });

      if (results.length === 0) {
        return `No results found for "${query}".`;
      }

      const resultsByFile = new Map<string, Node[]>();
      for (const r of results) {
        const list = resultsByFile.get(r.node.filePath) || [];
        list.push(r.node);
        resultsByFile.set(r.node.filePath, list);
      }

      let output = `## cssgraph_explore: "${query}"\n\n`;

      let fileCount = 0;
      const sortedFiles = [...resultsByFile.entries()].slice(0, Math.min(maxFiles, EXPLORE_BUDGET_MAX_FILES));

      // Summary section
      const totalFiles = resultsByFile.size;
      output += `${results.length} match${results.length !== 1 ? 'es' : ''} across ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`;
      if (totalFiles > maxFiles) {
        output += ` (showing ${maxFiles} of ${totalFiles} files)`;
      }
      output += ':\n';

      for (const [filePath] of sortedFiles) {
        const nodesInFile = resultsByFile.get(filePath)!;
        if (nodesInFile.length === 0) continue;
        const fmt = nodesInFile[0]!.language || 'css';
        output += `- \`${filePath}\` (${fmt}, ${nodesInFile.length} node${nodesInFile.length !== 1 ? 's' : ''})\n`;
      }
      output += '\n';

      // Per-file detail
      for (const [filePath, fileNodes] of sortedFiles) {
        fileCount++;
        output += `### ${fileCount}. ${filePath}\n\n`;

        // Sort by specificity descending within file
        const sorted = [...fileNodes].sort(compareSpecificityDesc);

        for (const node of sorted) {
          output += `#### ${node.kind}: \`.${node.name}\` (line ${node.startLine})\n\n`;

          if (node.selector) {
            output += `**Selector:** \`${node.selector}\`\n\n`;
          }
          if (node.specificity) {
            const [a, b, c, d] = node.specificity as [number, number, number, number];
            const parts: string[] = [];
            if (a > 0) parts.push(`inline=${a}`);
            if (b > 0) parts.push(`id=${b}`);
            if (c > 0) parts.push(`class=${c}`);
            if (d > 0) parts.push(`element=${d}`);
            const specDesc = parts.join(', ');
            output += `**Specificity:** [${node.specificity.join(', ')}]${specDesc ? ` (${specDesc})` : ''}\n\n`;
          }

          if (node.properties && node.properties.length > 0) {
            output += '```css\n';
            for (const p of node.properties) {
              output += `${p.property}: ${p.value};\n`;
            }
            output += '```\n\n';
          }

          if (node.params) {
            output += `**Params:** \`${node.params}\`\n\n`;
          }

          // Source context snippet
          const sourceCtx = readSourceContext(node, projectRoot);
          if (sourceCtx) {
            output += '<details>\n<summary>Source context</summary>\n\n```' + (node.language || 'css') + '\n' + sourceCtx + '\n```\n\n</details>\n\n';
          }

          // Overrides (stronger declarations of same className)
          const overrides = queries.getOutgoingEdges(node.id).filter(e => e.kind === 'overrides');
          if (overrides.length > 0) {
            output += '**Overrides (this declaration overrides):**\n';
            const overrideDetails: Array<{ node: Node; edge: Edge }> = [];
            for (const e of overrides) {
              const target = queries.getNodeById(e.target);
              if (target) overrideDetails.push({ node: target, edge: e });
            }
            overrideDetails.sort((a, b) => compareSpecificityDesc(a.node, b.node));
            for (const od of overrideDetails) {
              output += `- \`${od.node.selector ?? od.node.name}\` in ${od.node.filePath}:${od.node.startLine} (specificity: [${od.node.specificity?.join(', ')}])\n`;
            }
            output += '\n';
          }

          // Overridden by (weaker declarations with same className)
          const incomingOverrides = queries.getIncomingEdges(node.id).filter(e => e.kind === 'overrides');
          if (incomingOverrides.length > 0) {
            output += '**Overridden by:**\n';
            for (const e of incomingOverrides) {
              const source = queries.getNodeById(e.source);
              if (source) {
                output += `- \`${source.selector ?? source.name}\` in ${source.filePath}:${source.startLine} (specificity: [${source.specificity?.join(', ')}])\n`;
              }
            }
            output += '\n';
          }

          // Callers (JSX components that reference this className)
          const callers = traverser.getCallers(node.id, 2);
          if (callers.length > 0) {
            output += '**Referenced by:**\n';
            for (const c of callers) {
              output += `- \`${c.node.name}\` (${c.node.kind}) in ${c.node.filePath}:${c.node.startLine}\n`;
            }
            output += '\n';
          }
        }
      }

      return output;
    },
  };
}
