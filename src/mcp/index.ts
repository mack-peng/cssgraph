import * as readline from 'readline';
import { SERVER_INSTRUCTIONS } from './server-instructions';

export class MCPServer {
  private rl: readline.Interface | null = null;

  async run(): Promise<void> {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    process.stderr.write('cssgraph MCP server started\n');

    this.rl.on('line', async (line: string) => {
      try {
        const message = JSON.parse(line);
        await this.handleMessage(message);
      } catch {
        // ignore parse errors
      }
    });

    this.rl.on('close', () => {
      process.exit(0);
    });

    process.on('SIGTERM', () => process.exit(0));
    process.on('SIGINT', () => process.exit(0));
  }

  private async handleMessage(message: Record<string, unknown>): Promise<void> {
    const method = message['method'] as string;
    const id = message['id'] as number | string | undefined;

    switch (method) {
      case 'initialize':
        this.send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'cssgraph',
              version: '0.1.0',
            },
            instructions: this.getInstructions(),
          },
        });
        break;
      case 'notifications/initialized':
        break;
      case 'tools/list':
        this.send({
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.getToolDefinitions(),
          },
        });
        break;
      case 'tools/call':
        await this.handleToolCall(message, id);
        break;
      default:
        this.send({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
  }

  private async handleToolCall(message: Record<string, unknown>, id: number | string | undefined): Promise<void> {
    const params = message['params'] as Record<string, unknown> | undefined;
    const toolName = params?.['name'] as string;
    const args = params?.['arguments'] as Record<string, unknown> ?? {};

    try {
      const result = await this.executeTool(toolName, args);
      this.send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result }] } });
    } catch (err) {
      this.send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `cssgraph error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        },
      });
    }
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    const cwd = process.env.CSSGRAPH_PROJECT_PATH || process.cwd();

    switch (name) {
      case 'cssgraph_explore': {
        const query = args['query'] as string || '';
        const { default: CodeGraph } = await import('../index');
        const root = CodeGraph.isInitialized(cwd) ? cwd : (await this.findRoot(cwd));
        if (!root) return 'cssgraph is not initialized in this project. Run "cssgraph init" first.';
        const cg = await CodeGraph.open(root);
        try {
          return cg.explore(query, (args['maxFiles'] as number) ?? 12);
        } finally {
          cg.destroy();
        }
      }
      case 'cssgraph_search': {
        const query = args['query'] as string || '';
        const { default: CodeGraph } = await import('../index');
        const root = CodeGraph.isInitialized(cwd) ? cwd : (await this.findRoot(cwd));
        if (!root) return 'cssgraph is not initialized. Run "cssgraph init" first.';
        const cg = await CodeGraph.open(root);
        try {
          const results = cg.searchNodes(query, { limit: 10 });
          if (results.length === 0) return 'No results found.';
          return results.map(r => `${r.node.kind}: ${r.node.name} (${r.node.filePath}:${r.node.startLine})`).join('\n');
        } finally {
          cg.destroy();
        }
      }
      case 'cssgraph_callers': {
        const className = args['className'] as string || '';
        const { default: CodeGraph } = await import('../index');
        const root = CodeGraph.isInitialized(cwd) ? cwd : (await this.findRoot(cwd));
        if (!root) return 'cssgraph is not initialized.';
        const cg = await CodeGraph.open(root);
        try {
          const results = cg.searchNodes(className, { limit: 1 });
          if (results.length === 0) return 'No results found.';
          const callers = cg.getCallers(results[0]!.node.id, 2);
          if (callers.length === 0) return 'No callers found.';
          return callers.map(c => `${c.node.kind}: ${c.node.name} (${c.node.filePath}:${c.node.startLine})`).join('\n');
        } finally {
          cg.destroy();
        }
      }
      case 'cssgraph_impact': {
        const className = args['className'] as string || '';
        const { default: CodeGraph } = await import('../index');
        const root = CodeGraph.isInitialized(cwd) ? cwd : (await this.findRoot(cwd));
        if (!root) return 'cssgraph is not initialized.';
        const cg = await CodeGraph.open(root);
        try {
          const results = cg.searchNodes(className, { limit: 1 });
          if (results.length === 0) return 'No results found.';
          const subgraph = cg.getImpactRadius(results[0]!.node.id, 3);
          const lines: string[] = [];
          for (const [, node] of subgraph.nodes) {
            lines.push(`${node.kind}: ${node.name} (${node.filePath}:${node.startLine})`);
          }
          return lines.join('\n') || 'No impact found.';
        } finally {
          cg.destroy();
        }
      }
      case 'cssgraph_files': {
        const { default: CodeGraph } = await import('../index');
        const root = CodeGraph.isInitialized(cwd) ? cwd : (await this.findRoot(cwd));
        if (!root) return 'cssgraph is not initialized.';
        const cg = await CodeGraph.open(root);
        try {
          const files = cg.getFiles();
          if (files.length === 0) return 'No style files indexed.';
          return files.map(f => `${f.language.padEnd(6)} ${f.path} (${f.nodeCount} nodes)`).join('\n');
        } finally {
          cg.destroy();
        }
      }
      case 'cssgraph_status': {
        const { default: CodeGraph } = await import('../index');
        const root = CodeGraph.isInitialized(cwd) ? cwd : (await this.findRoot(cwd));
        if (!root) return 'cssgraph is not initialized.';
        const cg = await CodeGraph.open(root);
        try {
          const stats = cg.getStats();
          return `Nodes: ${stats.nodeCount} | Edges: ${stats.edgeCount} | Files: ${stats.fileCount}`;
        } finally {
          cg.destroy();
        }
      }
      case 'cssgraph_unused': {
        const { default: CodeGraph } = await import('../index');
        const root = CodeGraph.isInitialized(cwd) ? cwd : (await this.findRoot(cwd));
        if (!root) return 'cssgraph is not initialized.';
        const cg = await CodeGraph.open(root);
        try {
          const limit = Math.min((args['limit'] as number) ?? 50, 200);
          const results = cg.findUnusedClassSelectors().slice(0, limit);
          if (results.length === 0) return 'No unused class selectors found.';
          return results.map(r => `${r.node.name} (${r.node.filePath}:${r.node.startLine})`).join('\n');
        } finally {
          cg.destroy();
        }
      }
      case 'cssgraph_cascade': {
        const className = args['className'] as string || '';
        const { default: CodeGraph } = await import('../index');
        const root = CodeGraph.isInitialized(cwd) ? cwd : (await this.findRoot(cwd));
        if (!root) return 'cssgraph is not initialized.';
        const cg = await CodeGraph.open(root);
        try {
          const result = cg.getCascade(className);
          if (result.steps.length === 0) return `No cascade data found for "${className}".`;
          const lines: string[] = [`Cascade path for "${className}":`];
          for (let i = 0; i < result.steps.length; i++) {
            const s = result.steps[i]!;
            const spec = s.specificity ? `[${s.specificity.join(', ')}]` : '';
            lines.push(`${i + 1}. ${s.node.selector ?? s.node.name} ${spec} (${s.node.filePath}:${s.node.startLine})`);
            if (s.properties.length > 0) {
              lines.push(`   ${s.properties.map(p => `${p.property}: ${p.value}`).join('; ')}`);
            }
          }
          return lines.join('\n');
        } finally {
          cg.destroy();
        }
      }
      case 'cssgraph_property': {
        const property = args['property'] as string | undefined;
        const value = args['value'] as string || '';
        const { default: CodeGraph } = await import('../index');
        const root = CodeGraph.isInitialized(cwd) ? cwd : (await this.findRoot(cwd));
        if (!root) return 'cssgraph is not initialized.';
        const cg = await CodeGraph.open(root);
        try {
          const limit = Math.min((args['limit'] as number) ?? 50, 200);
          const exact = (args['exact'] as boolean) ?? false;
          const results = cg.searchByPropertyValue({ property, value, exact, limit });
          if (results.length === 0) return `No results found for property value "${value}".`;
          return results.map(r => {
            const selector = r.selectorNode?.selector ?? r.selectorNode?.name ?? '—';
            return `${selector} — ${r.node.name}: ${r.node.value} (${r.node.filePath}:${r.node.startLine})`;
          }).join('\n');
        } finally {
          cg.destroy();
        }
      }
      default:
        return `Unknown tool: ${name}`;
    }
  }

  private async findRoot(cwd: string): Promise<string | null> {
    const { findNearestCodeGraphRoot } = await import('../directory');
    return findNearestCodeGraphRoot(cwd);
  }

  private send(message: Record<string, unknown>): void {
    process.stdout.write(JSON.stringify(message) + '\n');
  }

  private getInstructions(): string {
    return SERVER_INSTRUCTIONS;
  }

  private getToolDefinitions() {
    return [
      {
        name: 'cssgraph_explore',
        description: 'PRIMARY TOOL: Get the full style context for a className — properties, overrides, specificity, and callers in one call.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Class name or natural language query' },
            maxFiles: { type: 'number', description: 'Maximum files to include (default: 12)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'cssgraph_search',
        description: 'Search for className selectors by name.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Class name to search for' },
          },
          required: ['query'],
        },
      },
      {
        name: 'cssgraph_callers',
        description: 'Find JSX components that reference a className.',
        inputSchema: {
          type: 'object',
          properties: {
            className: { type: 'string', description: 'Class name' },
          },
          required: ['className'],
        },
      },
      {
        name: 'cssgraph_impact',
        description: 'Analyze the impact radius of changing a className.',
        inputSchema: {
          type: 'object',
          properties: {
            className: { type: 'string', description: 'Class name' },
          },
          required: ['className'],
        },
      },
      {
        name: 'cssgraph_files',
        description: 'List project style files from the index.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'cssgraph_status',
        description: 'Show index statistics.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'cssgraph_unused',
        description: 'Find CSS class selectors that have no incoming references.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum results (default: 50, max: 200)' },
          },
        },
      },
      {
        name: 'cssgraph_cascade',
        description: 'Visualize the cascade path for a className, ordered by specificity.',
        inputSchema: {
          type: 'object',
          properties: {
            className: { type: 'string', description: 'Class name to analyze' },
          },
          required: ['className'],
        },
      },
      {
        name: 'cssgraph_property',
        description: 'Search selectors by CSS property value (e.g. property="display", value="flex").',
        inputSchema: {
          type: 'object',
          properties: {
            property: { type: 'string', description: 'CSS property name (optional)' },
            value: { type: 'string', description: 'Property value to search for' },
            exact: { type: 'boolean', description: 'Exact value match' },
            limit: { type: 'number', description: 'Maximum results (default: 50, max: 200)' },
          },
          required: ['value'],
        },
      },
    ];
  }
}
