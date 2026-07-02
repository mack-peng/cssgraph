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
      const results = queries.searchNodes(query, { limit: 20 });
      if (results.length === 0) {
        return `No results found for "${query}".`;
      }

      const files = new Map<string, Node[]>();
      for (const r of results) {
        const list = files.get(r.node.filePath) || [];
        list.push(r.node);
        files.set(r.node.filePath, list);
      }

      let output = '';
      let fileCount = 0;

      for (const [filePath, fileNodes] of files) {
        if (fileCount >= maxFiles) break;
        fileCount++;

        output += `\n## ${filePath}\n\n`;

        for (const node of fileNodes) {
          output += `### ${node.kind}: \`${node.name}\` (line ${node.startLine})\n\n`;

          if (node.selector) {
            output += `**Selector:** \`${node.selector}\`\n\n`;
          }
          if (node.specificity) {
            output += `**Specificity:** [${node.specificity.join(', ')}]\n\n`;
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

          const callers = traverser.getCallers(node.id, 1);
          if (callers.length > 0) {
            output += '**Referenced by:**\n';
            for (const c of callers) {
              output += `- \`${c.node.name}\` in ${c.node.filePath}:${c.node.startLine}\n`;
            }
            output += '\n';
          }

          const overrides = queries.getOutgoingEdges(node.id).filter(e => e.kind === 'overrides');
          if (overrides.length > 0) {
            output += '**Overrides:**\n';
            for (const e of overrides) {
              const target = queries.getNodeById(e.target);
              if (target) {
                output += `- \`${target.selector}\` in ${target.filePath}:${target.startLine} (specificity: [${target.specificity?.join(', ')}])\n`;
              }
            }
            output += '\n';
          }
        }
      }

      return output;
    },
  };
}
