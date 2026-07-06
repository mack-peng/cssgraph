import * as readline from 'readline';
import { SERVER_INSTRUCTIONS } from './server-instructions';
import { MCPServer as ToolHandler, getToolDefinitions } from './tools';

export class MCPServer {
  private rl: readline.Interface | null = null;
  private handler = new ToolHandler();

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
              version: '0.2.4',
            },
            instructions: SERVER_INSTRUCTIONS,
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
            tools: getToolDefinitions(),
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

    // Each tool handler internally handles recoverable conditions
    // (not initialized, not found) and returns success-shaped guidance.
    // The try/catch here is only for unexpected errors (genuine malfunctions),
    // which are marked isError — per spec R32.
    try {
      const result = await this.executeTool(toolName, args);
      this.send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: result }] } });
    } catch (err) {
      this.send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `cssgraph internal error: ${err instanceof Error ? err.message : String(err)}\n\nThis is an unexpected error — please report it.` }],
          isError: true,
        },
      });
    }
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case 'cssgraph_explore':          return this.handler.explore(args);
      case 'cssgraph_search':           return this.handler.search(args);
      case 'cssgraph_callers':          return this.handler.callers(args);
      case 'cssgraph_impact':           return this.handler.impact(args);
      case 'cssgraph_rule':             return this.handler.rule(args);
      case 'cssgraph_details':          return this.handler.details(args);
      case 'cssgraph_impact_selector':  return this.handler.impactSelector(args);
      case 'cssgraph_files':            return this.handler.files(args);
      case 'cssgraph_status':           return this.handler.status(args);
      case 'cssgraph_unused':           return this.handler.unused(args);
      case 'cssgraph_cascade':          return this.handler.cascade(args);
      case 'cssgraph_property':         return this.handler.property(args);
      default:                          return `Unknown tool: ${name}`;
    }
  }

  private send(message: Record<string, unknown>): void {
    process.stdout.write(JSON.stringify(message) + '\n');
  }
}
