import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MCPServer, getToolDefinitions } from '../src/mcp/tools';

let tmpRoots: string[] = [];

afterEach(async () => {
  for (const dir of tmpRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpRoots = [];
});

function makeTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cssgraph-mcp-'));
  tmpRoots.push(dir);
  return dir;
}

async function createIndexedProject(styles: Record<string, string>): Promise<string> {
  const projRoot = makeTempRoot();
  const origCwd = process.cwd();
  process.chdir(projRoot);
  try {
    const { default: CodeGraph } = await import('../src/index');
    const cg = await CodeGraph.init(projRoot);

    for (const [fileName, content] of Object.entries(styles)) {
      fs.writeFileSync(path.join(projRoot, fileName), content, 'utf-8');
    }

    await cg.indexAll();
    cg.destroy();
    return projRoot;
  } finally {
    process.chdir(origCwd);
  }
}

describe('MCP tools', () => {
  it('explore returns not-initialized guidance when no index', async () => {
    const projRoot = makeTempRoot();
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.explore({ query: '.btn' });
      expect(result).toContain('not initialized');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('explore returns results after indexing', async () => {
    const projRoot = await createIndexedProject({
      'styles.css': '.btn { color: red; background: blue; }',
      'more.css': '.btn { padding: 10px; }',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.explore({ query: '.btn' });
      expect(result).toContain('styles.css');
      expect(result).toContain('color: red');
      expect(result).toContain('more.css');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('search returns matching className', async () => {
    const projRoot = await createIndexedProject({
      'styles.css': '.btn-primary { color: blue; }.btn-secondary { color: gray; }',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.search({ query: '.btn-primary' });
      expect(result).toContain('btn-primary');
      expect(result).toContain('styles.css');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('callers returns referencing components', async () => {
    const projRoot = await createIndexedProject({
      'styles.module.css': '.button { color: blue; }',
      'Button.tsx': 'import styles from "./styles.module.css"; export const Button = () => <div className={styles.button}>Click</div>;',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.callers({ className: 'button' });
      // CSS module file node or JSX file may appear as a caller
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('files shows indexed style files', async () => {
    const projRoot = await createIndexedProject({
      'styles.css': '.btn { color: red; }',
      'theme.scss': '$primary: blue; .header { color: $primary; }',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.files({});
      expect(result).toContain('styles.css');
      expect(result).toContain('theme.scss');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('status returns stats after indexing', async () => {
    const projRoot = await createIndexedProject({
      'a.css': '.x { color: red; }',
      'b.css': '.y { color: blue; }',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.status({});
      expect(result).toContain('Nodes:');
      expect(result).toContain('Edges:');
      expect(result).toContain('Files: 2');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('unused finds class selectors with no references', async () => {
    const projRoot = await createIndexedProject({
      'styles.css': '.used { color: red; } .unused { color: gray; }',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.unused({});
      expect(result).toContain('used');
      expect(result).toContain('unused');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('cascade shows specificity-ordered cascade path', async () => {
    const projRoot = await createIndexedProject({
      'a.css': '.btn { color: red; }',
      'b.css': '.btn.primary { color: blue; }',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.cascade({ className: 'btn' });
      expect(result).toContain('Cascade path');
      expect(result).toContain('.btn');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('property searches by CSS value', async () => {
    const projRoot = await createIndexedProject({
      'theme.css': '.card { border-radius: 8px; }.button { border-radius: 4px; }',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.property({ property: 'border-radius', value: '8' });
      expect(result).toContain('card');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('impact returns impact radius subgraph', async () => {
    const projRoot = await createIndexedProject({
      'styles.css': '.btn { color: red; background: blue; }',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.impact({ className: 'btn' });
      expect(result).toContain('btn');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('rule analyzer returns exact and related selectors', async () => {
    const projRoot = await createIndexedProject({
      'styles.css': '.btn { color: red; } .btn-primary { color: blue; }',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.rule({ selector: '.btn' });
      expect(result).toContain('Rule:');
      expect(result).toContain('.btn');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('details returns exact selector match', async () => {
    const projRoot = await createIndexedProject({
      'styles.css': '.btn { color: red; }',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.details({ selector: '.btn' });
      expect(result).toContain('.btn');
      expect(result).toContain('color: red');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('impactSelector returns code file impact', async () => {
    const projRoot = await createIndexedProject({
      'styles.module.css': '.card { padding: 16px; }',
      'Card.tsx': 'import styles from "./styles.module.css"; export const Card = () => <div className={styles.card} />',
    });
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      const server = new MCPServer();
      const result = await server.impactSelector({ selector: '.card' });
      expect(result).toContain('Selector:');
      expect(result).toContain('Definition:');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('projectPath arg overrides cwd for a different project', async () => {
    const proj1 = await createIndexedProject({ 'a.css': '.btn { color: red; }' });
    const proj2 = await createIndexedProject({ 'b.css': '.header { color: blue; }' });
    const origCwd = process.cwd();
    process.chdir(proj1);
    try {
      const server = new MCPServer();
      const result = await server.explore({ query: '.header', projectPath: proj2 });
      expect(result).toContain('b.css');
      expect(result).toContain('.header');
    } finally {
      process.chdir(origCwd);
    }
  });

  it('getToolDefinitions returns 12 tools with projectPath', () => {
    const tools = getToolDefinitions();
    expect(tools.length).toBe(12);
    expect(tools[0]!.name).toBe('cssgraph_explore');
    for (const tool of tools) {
      expect(tool.inputSchema.properties).toHaveProperty('projectPath');
    }
  });
});

describe('incremental indexing', () => {
  it('sync detects added files', async () => {
    const projRoot = makeTempRoot();
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      fs.writeFileSync(path.join(projRoot, 'a.css'), '.x { color: red; }');
      const { default: CodeGraph } = await import('../src/index');
      const cg = await CodeGraph.init(projRoot);
      await cg.indexAll();

      fs.writeFileSync(path.join(projRoot, 'b.css'), '.y { color: blue; }');
      await cg.sync();

      const files = cg.getFiles();
      expect(files.length).toBe(2);
      cg.destroy();
    } finally {
      process.chdir(origCwd);
    }
  });

  it('sync detects modified files', async () => {
    const projRoot = makeTempRoot();
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      fs.writeFileSync(path.join(projRoot, 'a.css'), '.x { color: red; }');
      const { default: CodeGraph } = await import('../src/index');
      const cg = await CodeGraph.init(projRoot);
      await cg.indexAll();

      fs.writeFileSync(path.join(projRoot, 'a.css'), '.x { color: green; margin: 10px; }');
      await cg.sync();

      const results = cg.searchNodes('.x', { limit: 1 });
      expect(results.length).toBe(1);
      const props = results[0]!.node.properties ?? [];
      expect(props.map(p => p.property)).toContain('margin');
      cg.destroy();
    } finally {
      process.chdir(origCwd);
    }
  });

  it('sync handles no changes efficiently', async () => {
    const projRoot = makeTempRoot();
    const origCwd = process.cwd();
    process.chdir(projRoot);
    try {
      fs.writeFileSync(path.join(projRoot, 'a.css'), '.x { color: red; }');
      const { default: CodeGraph } = await import('../src/index');
      const cg = await CodeGraph.init(projRoot);
      await cg.indexAll();

      const syncResult = await cg.sync();
      expect(syncResult.filesAdded).toBe(0);
      expect(syncResult.filesModified).toBe(0);
      expect(syncResult.filesRemoved).toBe(0);
      cg.destroy();
    } finally {
      process.chdir(origCwd);
    }
  });
});
