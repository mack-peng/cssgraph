#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { isInitialized, unsafeIndexRootReason } from '../directory';

const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8')
);

const program = new Command();

program
  .name('cssgraph')
  .description('CSS intelligence and knowledge graph for AI agents')
  .version(packageJson.version);

function resolveProjectPath(pathArg?: string): string {
  const absolutePath = path.resolve(pathArg || process.cwd());
  if (isInitialized(absolutePath)) return absolutePath;

  let current = absolutePath;
  const root = path.parse(current).root;
  while (current !== root) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    if (isInitialized(current)) return current;
  }
  return absolutePath;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${(seconds % 60).toFixed(0)}s`;
}

/**
 * codegraph init [path]
 */
program
  .command('init [path]')
  .description('Initialize cssgraph in a project directory and build the initial index')
  .option('-i, --index', 'Deprecated: indexing runs by default')
  .option('-f, --force', 'Initialize even if path looks like home directory or filesystem root')
  .action(async (pathArg: string | undefined, options: { force?: boolean }) => {
    const projectPath = path.resolve(pathArg || process.cwd());

    if (!options.force) {
      const unsafe = unsafeIndexRootReason(projectPath);
      if (unsafe) {
        console.error(`Refusing to initialize in ${projectPath} — it looks like ${unsafe}.`);
        console.error('Pass --force to override.');
        process.exit(1);
      }
    }

    if (isInitialized(projectPath)) {
      console.log(`Already initialized in ${projectPath}`);
      console.log('Use "cssgraph index" to re-index');
      return;
    }

    try {
      const { default: CodeGraph } = await import('../index');
      const cg = await CodeGraph.init(projectPath, { index: false });

      console.log(`Initialized in ${projectPath}`);

      const result = await cg.indexAll();
      if (result.success) {
        console.log(`Indexed ${formatNumber(result.filesIndexed)} files`);
        console.log(`${formatNumber(result.nodesCreated)} nodes, ${formatNumber(result.edgesCreated)} edges in ${formatDuration(result.durationMs)}`);
      } else {
        console.log(`Indexed ${formatNumber(result.filesIndexed)} files (${formatNumber(result.filesErrored)} errors)`);
      }

      cg.destroy();
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * codegraph index [path]
 */
program
  .command('index [path]')
  .description('Rebuild the full index from scratch')
  .option('-f, --force', 'Index even if path looks like home directory')
  .option('-q, --quiet', 'Suppress progress output')
  .action(async (pathArg: string | undefined, options: { force?: boolean; quiet?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);

    if (!options.force) {
      const unsafe = unsafeIndexRootReason(projectPath);
      if (unsafe) {
        console.error(`Refusing to index ${projectPath} — pass --force to override.`);
        process.exit(1);
      }
    }

    if (!isInitialized(projectPath)) {
      console.error(`Not initialized in ${projectPath}. Run "cssgraph init" first.`);
      process.exit(1);
    }

    try {
      const { default: CodeGraph } = await import('../index');
      if (!options.quiet) {
        console.log('Indexing project...');
      }

      const cg = await CodeGraph.open(projectPath);

      const result = await cg.indexAll();
      if (!options.quiet) {
        console.log(`Indexed ${formatNumber(result.filesIndexed)} files`);
        console.log(`${formatNumber(result.nodesCreated)} nodes, ${formatNumber(result.edgesCreated)} edges in ${formatDuration(result.durationMs)}`);
      }

      if (!result.success) process.exit(1);
      cg.destroy();
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * codegraph status [path]
 */
program
  .command('status [path]')
  .description('Show index status and statistics')
  .option('-j, --json', 'Output as JSON')
  .action(async (pathArg: string | undefined, options: { json?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);

    if (!isInitialized(projectPath)) {
      if (options.json) {
        console.log(JSON.stringify({ initialized: false, version: packageJson.version, projectPath }));
        return;
      }
      console.log('Not initialized. Run "cssgraph init" first.');
      return;
    }

    try {
      const { default: CodeGraph } = await import('../index');
      const cg = await CodeGraph.open(projectPath);
      const stats = cg.getStats();

      if (options.json) {
        console.log(JSON.stringify({
          initialized: true,
          version: packageJson.version,
          projectPath,
          nodeCount: stats.nodeCount,
          edgeCount: stats.edgeCount,
          fileCount: stats.fileCount,
          nodesByKind: stats.nodesByKind,
          edgesByKind: stats.edgesByKind,
          filesByLanguage: stats.filesByLanguage,
          dbSizeBytes: stats.dbSizeBytes,
          lastUpdated: stats.lastUpdated ? new Date(stats.lastUpdated).toISOString() : null,
        }));
        cg.destroy();
        return;
      }

      console.log('\ncssgraph Status\n');
      console.log(`Project: ${projectPath}`);
      console.log(`  Files:  ${formatNumber(stats.fileCount)}`);
      console.log(`  Nodes:  ${formatNumber(stats.nodeCount)}`);
      console.log(`  Edges:  ${formatNumber(stats.edgeCount)}`);

      const nodesByKind = Object.entries(stats.nodesByKind).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
      if (nodesByKind.length > 0) {
        console.log('\nNodes by Kind:');
        for (const [kind, count] of nodesByKind) {
          console.log(`  ${kind.padEnd(18)} ${formatNumber(count)}`);
        }
      }

      const filesByLang = Object.entries(stats.filesByLanguage).filter(([, c]) => c > 0);
      if (filesByLang.length > 0) {
        console.log('\nFiles by Language:');
        for (const [lang, count] of filesByLang) {
          console.log(`  ${lang.padEnd(18)} ${formatNumber(count)}`);
        }
      }

      cg.destroy();
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * codegraph query <className>
 */
program
  .command('query <search>')
  .description('Search for className selectors')
  .option('-p, --path <path>', 'Project path')
  .option('-l, --limit <number>', 'Maximum results', '10')
  .option('-j, --json', 'Output as JSON')
  .action(async (search: string, options: { path?: string; limit?: string; json?: boolean }) => {
    const projectPath = resolveProjectPath(options.path);

    if (!isInitialized(projectPath)) {
      console.error(`Not initialized in ${projectPath}. Run "cssgraph init" first.`);
      process.exit(1);
    }

    try {
      const { default: CodeGraph } = await import('../index');
      const cg = await CodeGraph.open(projectPath);
      const limit = parseInt(options.limit || '10', 10);
      const results = cg.searchNodes(search, { limit });

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log(`No results found for "${search}"`);
        } else {
          console.log(`\nResults for "${search}":\n`);
          for (const r of results) {
            const n = r.node;
            console.log(`  ${n.kind.padEnd(16)} ${n.name}  (${n.filePath}:${n.startLine})`);
            if (n.selector) console.log(`    Selector: ${n.selector}`);
            if (n.specificity) console.log(`    Specificity: [${n.specificity.join(', ')}]`);
            console.log();
          }
        }
      }

      cg.destroy();
    } catch (err) {
      console.error(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * codegraph explore <query...>
 */
program
  .command('explore <query...>')
  .description('Explore className selectors and their style context')
  .option('-p, --path <path>', 'Project path')
  .option('--max-files <number>', 'Maximum files to include')
  .action(async (queryParts: string[], options: { path?: string; maxFiles?: string }) => {
    const projectPath = resolveProjectPath(options.path);

    if (!isInitialized(projectPath)) {
      console.error(`Not initialized in ${projectPath}.`);
      process.exit(1);
    }

    try {
      const { default: CodeGraph } = await import('../index');
      const cg = await CodeGraph.open(projectPath);
      const maxFiles = options.maxFiles ? parseInt(options.maxFiles, 10) : 12;
      const result = cg.explore(queryParts.join(' '), maxFiles);
      console.log(result || 'No results found.');
      cg.destroy();
    } catch (err) {
      console.error(`Explore failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * codegraph impact <className>
 */
program
  .command('impact <className>')
  .description('Analyze what is affected by changing a className')
  .option('-p, --path <path>', 'Project path')
  .action(async (className: string, options: { path?: string }) => {
    const projectPath = resolveProjectPath(options.path);

    if (!isInitialized(projectPath)) {
      console.error(`Not initialized in ${projectPath}. Run "cssgraph init" first.`);
      process.exit(1);
    }

    try {
      const { default: CodeGraph } = await import('../index');
      const cg = await CodeGraph.open(projectPath);
      const results = cg.searchNodes(className, { limit: 1 });

      if (results.length === 0) {
        console.log(`No results found for "${className}"`);
        cg.destroy();
        return;
      }

      const node = results[0]!.node;
      console.log(`\nImpact analysis for "${className}":\n`);
      console.log(`  Primary: ${node.name} (${node.filePath}:${node.startLine})`);

      const callers = cg.getCallers(node.id, 2);
      if (callers.length > 0) {
        console.log(`\n  Referenced by ${callers.length} nodes:`);
        for (const c of callers) {
          console.log(`    - ${c.node.kind}: ${c.node.name} (${c.node.filePath}:${c.node.startLine})`);
        }
      }

      const overrides = cg.getOutgoingEdges(node.id).filter(e => e.kind === 'overrides');
      if (overrides.length > 0) {
        console.log(`\n  Overrides ${overrides.length} other declarations:`);
        for (const e of overrides) {
          const target = cg.getNode(e.target);
          if (target) {
            console.log(`    - ${target.selector} (${target.filePath}:${target.startLine})`);
          }
        }
      }

      cg.destroy();
    } catch (err) {
      console.error(`Impact analysis failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * codegraph files
 */
program
  .command('files')
  .description('Show project style file structure')
  .option('-p, --path <path>', 'Project path')
  .option('--format <format>', 'Output format (tree, flat)', 'tree')
  .action(async (options: { path?: string; format?: string }) => {
    const projectPath = resolveProjectPath(options.path);

    if (!isInitialized(projectPath)) {
      console.error(`Not initialized. Run "cssgraph init" first.`);
      process.exit(1);
    }

    try {
      const { default: CodeGraph } = await import('../index');
      const cg = await CodeGraph.open(projectPath);
      const files = cg.getFiles();

      if (files.length === 0) {
        console.log('No style files indexed.');
        cg.destroy();
        return;
      }

      if (options.format === 'flat') {
        for (const f of files) {
          console.log(`${f.language.padEnd(6)} ${f.nodeCount.toString().padStart(6)} nodes  ${f.path}`);
        }
      } else {
        // Simple tree view
        const dirMap = new Map<string, string[]>();
        for (const f of files) {
          const dir = path.dirname(f.path);
          const list = dirMap.get(dir) || [];
          list.push(f.path);
          dirMap.set(dir, list);
        }
        for (const [dir, filePaths] of dirMap) {
          console.log(`${dir}/`);
          for (const fp of filePaths) {
            console.log(`  ${path.basename(fp)}`);
          }
        }
      }

      cg.destroy();
    } catch (err) {
      console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * codegraph sync [path]
 */
program
  .command('sync [path]')
  .description('Sync changes since last index')
  .option('-q, --quiet', 'Suppress output')
  .action(async (pathArg: string | undefined, options: { quiet?: boolean }) => {
    const projectPath = resolveProjectPath(pathArg);

    if (!isInitialized(projectPath)) {
      if (!options.quiet) console.error(`Not initialized.`);
      process.exit(1);
    }

    try {
      const { default: CodeGraph } = await import('../index');
      const cg = await CodeGraph.open(projectPath);
      const result = await cg.sync();

      if (!options.quiet) {
        const total = result.filesAdded + result.filesModified + result.filesRemoved;
        if (total === 0) {
          console.log('Already up to date');
        } else {
          console.log(`Synced ${formatNumber(total)} changed files (${formatNumber(result.nodesUpdated)} nodes)`);
        }
      }

      cg.destroy();
    } catch (err) {
      if (!options.quiet) console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * codegraph serve --mcp
 */
program
  .command('serve')
  .description('Start the MCP server')
  .option('--mcp', 'Run in MCP mode')
  .action(async (options: { mcp?: boolean }) => {
    if (options.mcp) {
      try {
        const { MCPServer } = await import('../mcp');
        const server = new MCPServer();
        await server.run();
      } catch (err) {
        console.error(`MCP server error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    } else {
      console.log('Use --mcp flag to start as an MCP server');
    }
  });

/**
 * codegraph version
 */
program
  .command('version')
  .description('Print the installed version')
  .action(() => {
    console.log(packageJson.version);
  });

// Check if running with no arguments - show help
if (process.argv.length === 2) {
  program.help();
}

program.parse();
