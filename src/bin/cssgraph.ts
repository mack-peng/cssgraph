#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { isInitialized, unsafeIndexRootReason, getCodeGraphDir } from '../directory';
import { intro, phase, phaseComplete, progressBar, progressClear, outro, warn, err, step, dim, bold, statLine, formatNumber, formatDuration } from '../ui/output';

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

/**
 * cssgraph init [path]
 */
program
  .command('init [path]')
  .description('Initialize cssgraph in a project directory and build the initial index')
  .option('-f, --force', 'Initialize even if path looks like home directory or filesystem root')
  .option('-w, --workers <n>', 'Number of parse worker threads (default: cpu cores - 1)')
  .action(async (pathArg: string | undefined, options: { force?: boolean; workers?: string }) => {
    const projectPath = path.resolve(pathArg || process.cwd());

    if (!options.force) {
      const unsafe = unsafeIndexRootReason(projectPath);
      if (unsafe) {
        console.error(err(`Refusing to initialize in ${projectPath} — it looks like ${unsafe}.`));
        console.error('  Pass --force to override.');
        process.exit(1);
      }
    }

    if (isInitialized(projectPath)) {
      console.log(warn(`Already initialized in ${projectPath}`));
      console.log('  Use "cssgraph index" to re-index');
      return;
    }

    try {
      intro(packageJson.version);

      const { default: CodeGraph } = await import('../index');
      const cg = await CodeGraph.init(projectPath, { index: false });

      step(`Initialized in ${dim(projectPath)}`, 'ok');

      if (options.workers) process.env.CSSGRAPH_PARSE_WORKERS = options.workers;

      let scanTotal = 0;
      let lastPhase = '';

      const result = await cg.indexAll({
        onProgress: (progress) => {
          if (progress.phase !== lastPhase) {
            if (lastPhase) progressClear();
            lastPhase = progress.phase;
            const label = progress.phase === 'scanning' ? 'Scanning style files' :
              progress.phase === 'parsing' ? 'Parsing' :
              progress.phase === 'resolving' ? 'Resolving references' : '';
            phase(label);
            if (progress.phase === 'scanning') {
              scanTotal = progress.total;
            }
          }
          if (progress.phase === 'parsing' && scanTotal > 0) {
            progressBar(progress.current, progress.total, progress.currentFile || '');
          }
        },
      });

      progressClear();
      if (lastPhase) phaseComplete();

      const hasErrors = result.filesErrored > 0;

      if (result.filesIndexed > 0) {
        const skipSuffix = result.filesSkipped > 0 ? ` ${dim('│')}  ${formatNumber(result.filesSkipped)} skipped` : '';
        const filesMsg = hasErrors
          ? `${formatNumber(result.filesIndexed)} files (${formatNumber(result.filesErrored)} failed)${skipSuffix}`
          : `${formatNumber(result.filesIndexed)} files${skipSuffix}`;
        step(filesMsg, hasErrors ? 'warn' : 'ok');
        const statsMsg = `${formatNumber(result.nodesCreated)} nodes  ${dim('│')}  ${formatNumber(result.edgesCreated)} edges  ${dim('│')}  ${formatDuration(result.durationMs)}`;
        step(statsMsg, 'info');
      } else if (hasErrors) {
        step('No files indexed — all failed', 'err');

        const errorsByCode = new Map<string, number>();
        for (const e of result.errors) {
          if (e.severity === 'error') {
            const code = e.code || 'unknown';
            errorsByCode.set(code, (errorsByCode.get(code) || 0) + 1);
          }
        }
        if (errorsByCode.size > 0) {
          for (const [code, count] of errorsByCode) {
            step(`  ${formatNumber(count)} ${code}`, 'warn');
          }
        }
      } else {
        step('No style files found', 'warn');
      }

      if (hasErrors && result.filesIndexed > 0) {
        const errorLogPath = path.join(getCodeGraphDir(projectPath), 'errors.log');
        step(`See ${dim(errorLogPath)} for details`, 'info');
      }

      cg.destroy();
      outro();
    } catch (er) {
      console.error(err(`Failed: ${er instanceof Error ? er.message : String(er)}`));
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
  .option('-w, --workers <n>', 'Number of parse worker threads (default: cpu cores - 1)')
  .action(async (pathArg: string | undefined, options: { force?: boolean; quiet?: boolean; workers?: string }) => {
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
      if (!options.quiet) intro(packageJson.version);

      const { default: CodeGraph } = await import('../index');
      const cg = await CodeGraph.open(projectPath);

      if (!options.quiet) phase('Cleaning existing data');
      cg.reinit();

      if (options.workers) process.env.CSSGRAPH_PARSE_WORKERS = options.workers;

      let scanTotal = 0;
      let lastPhase = '';

      const result = await cg.indexAll({
        onProgress: options.quiet ? undefined : (progress) => {
          if (progress.phase !== lastPhase) {
            if (lastPhase) progressClear();
            lastPhase = progress.phase;
            const label = progress.phase === 'scanning' ? 'Scanning style files' :
              progress.phase === 'parsing' ? 'Parsing' : '';
            phase(label);
            if (progress.phase === 'scanning') scanTotal = progress.total;
          }
          if (progress.phase === 'parsing' && scanTotal > 0) {
            progressBar(progress.current, progress.total, progress.currentFile || '');
          }
        },
      });

      if (!options.quiet) {
        progressClear();
        if (lastPhase) phaseComplete();

        if (result.filesIndexed > 0) {
          const skipPart = result.filesSkipped > 0 ? ` ${dim('│')}  ${formatNumber(result.filesSkipped)} skipped` : '';
          step(`${formatNumber(result.filesIndexed)} files${skipPart}`, 'ok');
          step(`${formatNumber(result.nodesCreated)} nodes  ${dim('│')}  ${formatNumber(result.edgesCreated)} edges  ${dim('│')}  ${formatDuration(result.durationMs)}`, 'info');
        } else {
          step('No style files found', 'warn');
        }
        outro();
      }

      if (!result.success && !options.quiet) process.exit(1);
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

      console.log(`\n${bold('cssgraph Status')}\n`);
      console.log(statLine('Project', projectPath));
      console.log(statLine('Files', formatNumber(stats.fileCount)));
      console.log(statLine('Nodes', formatNumber(stats.nodeCount)));
      console.log(statLine('Edges', formatNumber(stats.edgeCount)));

      const nodesByKind = Object.entries(stats.nodesByKind).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
      if (nodesByKind.length > 0) {
        console.log(`\n${bold('Nodes by Kind:')}`);
        for (const [kind, count] of nodesByKind) {
          console.log(`  ${dim(kind.padEnd(18))} ${formatNumber(count)}`);
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
   * cssgraph unused
   */
  program
    .command('unused')
    .description('Find class selectors with no incoming references')
    .option('-p, --path <path>', 'Project path')
    .option('-l, --limit <number>', 'Maximum results', '50')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: { path?: string; limit?: string; json?: boolean }) => {
      const projectPath = resolveProjectPath(options.path);

      if (!isInitialized(projectPath)) {
        console.error(`Not initialized in ${projectPath}. Run "cssgraph init" first.`);
        process.exit(1);
      }

      try {
        const { default: CodeGraph } = await import('../index');
        const cg = await CodeGraph.open(projectPath);
        const limit = parseInt(options.limit || '50', 10);
        const results = cg.findUnusedClassSelectors().slice(0, limit);

        if (options.json) {
          console.log(JSON.stringify(results.map(r => ({
            name: r.node.name,
            selector: r.node.selector,
            filePath: r.node.filePath,
            line: r.node.startLine,
            referencedBy: r.referencedBy,
          })), null, 2));
        } else {
          if (results.length === 0) {
            console.log('No unused class selectors found.');
          } else {
            console.log(`\n${bold('Unused class selectors')}: ${results.length} found\n`);
            for (const r of results) {
              console.log(`  ${r.node.name.padEnd(24)} ${dim(r.node.filePath)}:${r.node.startLine}`);
              if (r.node.selector) console.log(`    ${dim('selector:')} ${r.node.selector}`);
            }
          }
        }

        cg.destroy();
      } catch (err) {
        console.error(`unused failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  /**
   * cssgraph cascade <className>
   */
  program
    .command('cascade <className>')
    .description('Visualize the cascade path for a className')
    .option('-p, --path <path>', 'Project path')
    .option('-j, --json', 'Output as JSON')
    .action(async (className: string, options: { path?: string; json?: boolean }) => {
      const projectPath = resolveProjectPath(options.path);

      if (!isInitialized(projectPath)) {
        console.error(`Not initialized in ${projectPath}. Run "cssgraph init" first.`);
        process.exit(1);
      }

      try {
        const { default: CodeGraph } = await import('../index');
        const cg = await CodeGraph.open(projectPath);
        const result = cg.getCascade(className);

        if (options.json) {
          console.log(JSON.stringify({
            className: result.className,
            steps: result.steps.map(s => ({
              selector: s.node.selector,
              filePath: s.node.filePath,
              line: s.node.startLine,
              specificity: s.specificity,
              properties: s.properties,
              overrides: s.overrides.map(o => o.selector),
              overriddenBy: s.overriddenBy.map(o => o.selector),
            })),
          }, null, 2));
        } else {
          if (result.steps.length === 0) {
            console.log(`No cascade data found for "${className}"`);
          } else {
            console.log(`\n${bold('Cascade path')} for "${className}":\n`);
            for (let i = 0; i < result.steps.length; i++) {
              const s = result.steps[i]!;
              const spec = s.specificity ? `[${s.specificity.join(', ')}]` : '[0, 0, 0, 0]';
              console.log(`  ${(i + 1).toString().padStart(2)}. ${s.node.selector ?? s.node.name} ${dim(spec)}`);
              console.log(`      ${dim(s.node.filePath)}:${s.node.startLine}`);
              if (s.properties.length > 0) {
                const props = s.properties.map(p => `${p.property}: ${p.value}`).join('; ');
                console.log(`      ${props}`);
              }
              if (s.overrides.length > 0) {
                console.log(`      ${dim('overrides:')} ${s.overrides.map(o => o.selector).join(', ')}`);
              }
              if (s.overriddenBy.length > 0) {
                console.log(`      ${dim('overridden by:')} ${s.overriddenBy.map(o => o.selector).join(', ')}`);
              }
            }
          }
        }

        cg.destroy();
      } catch (err) {
        console.error(`cascade failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  /**
   * cssgraph property <property> [value]
   */
  program
    .command('property <query...>')
    .description('Search selectors by CSS property value (e.g. "display:flex" or "display flex")')
    .option('-p, --path <path>', 'Project path')
    .option('-e, --exact', 'Exact value match', false)
    .option('-l, --limit <number>', 'Maximum results', '50')
    .option('-j, --json', 'Output as JSON')
    .action(async (queryParts: string[], options: { path?: string; exact?: boolean; limit?: string; json?: boolean }) => {
      const projectPath = resolveProjectPath(options.path);

      if (!isInitialized(projectPath)) {
        console.error(`Not initialized in ${projectPath}. Run "cssgraph init" first.`);
        process.exit(1);
      }

      const raw = queryParts.join(' ');
      let property: string | undefined;
      let value: string;

      if (raw.includes(':')) {
        const idx = raw.indexOf(':');
        property = raw.slice(0, idx).trim();
        value = raw.slice(idx + 1).trim();
      } else {
        const parts = raw.split(/\s+/);
        if (parts.length >= 2) {
          property = parts[0];
          value = parts.slice(1).join(' ');
        } else {
          value = raw;
        }
      }

      if (!value) {
        console.error('Please provide a property value to search for.');
        process.exit(1);
      }

      try {
        const { default: CodeGraph } = await import('../index');
        const cg = await CodeGraph.open(projectPath);
        const limit = parseInt(options.limit || '50', 10);
        const results = cg.searchByPropertyValue({ property, value, exact: options.exact, limit });

        if (options.json) {
          console.log(JSON.stringify(results.map(r => ({
            property: r.node.name,
            value: r.node.value,
            selector: r.selectorNode?.selector ?? r.node.selector,
            className: r.selectorNode?.name,
            filePath: r.node.filePath,
            line: r.node.startLine,
          })), null, 2));
        } else {
          if (results.length === 0) {
            console.log(`No results found for property value "${raw}"`);
          } else {
            console.log(`\n${bold('Property matches')} for "${raw}": ${results.length}\n`);
            for (const r of results) {
              const selector = r.selectorNode?.selector ?? r.node.selector ?? r.selectorNode?.name ?? '—';
              const className = r.selectorNode?.name ? `.${r.selectorNode.name}` : '';
              console.log(`  ${selector}${className ? ` ${dim(className)}` : ''}`);
              console.log(`    ${r.node.name}: ${r.node.value}`);
              console.log(`    ${dim(r.node.filePath)}:${r.node.startLine}`);
            }
          }
        }

        cg.destroy();
      } catch (err) {
        console.error(`property search failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  /**
   * cssgraph rule <selector>
   */
  program
    .command('rule <selector>')
    .description('Analyze impact of a CSS selector')
    .option('-p, --path <path>', 'Project path')
    .option('--strict', 'Show only files that reference every class in the selector')
    .option('--json', 'Output as JSON')
    .action(async (selector: string, options: { path?: string; strict?: boolean; json?: boolean }) => {
      const projectPath = resolveProjectPath(options.path);

      if (!isInitialized(projectPath)) {
        console.error(`Not initialized in ${projectPath}. Run "cssgraph init" first.`);
        process.exit(1);
      }

      try {
        const { default: CodeGraph } = await import('../index');
        const cg = await CodeGraph.open(projectPath);
        const result = cg.analyzeRule(selector);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`\n${bold('Rule:')} ${result.selector}\n`);

          if (result.classes.length > 0) {
            console.log(`${bold('Classes:')} ${result.classes.map(c => `.${c}`).join(' ')}`);
          }
          if (result.ids.length > 0) {
            console.log(`${bold('IDs:')} ${result.ids.map(i => `#${i}`).join(' ')}`);
          }
          if (result.tags.length > 0) {
            console.log(`${bold('Tags:')} ${result.tags.join(' ')}`);
          }
          console.log('');

          if (result.exactMatches.length === 0) {
            console.log(`${bold('Exact matches:')} ${dim('(none) — no selector matched exactly')}\n`);
          } else {
            console.log(`${bold('Exact matches:')}`);
            for (const m of result.exactMatches) {
              console.log(`  ${m.node.selector ?? m.node.name}  ${dim(`${m.node.filePath}:${m.node.startLine}`)}`);
            }
            console.log('');
          }

          if (result.containsMatches.length === 0) {
            console.log(`${bold('Related selectors:')} (none)\n`);
          } else {
            if (result.exactMatches.length === 0) {
              console.log(`${dim('Falling back to contains search.')}`);
              console.log(`${bold('Related selectors:')}`);
            } else {
              console.log(`${bold('Related selectors:')}`);
            }
            for (const m of result.containsMatches) {
              console.log(`  ${m.node.selector ?? m.node.name}  ${dim(`${m.node.filePath}:${m.node.startLine}`)}`);
            }
            console.log('');
          }

          if (result.classUsage.length === 0) {
            console.log(`${bold('Class usage:')} (none)\n`);
          } else {
            console.log(`${bold('Class usage:')}`);
            for (const u of result.classUsage) {
              console.log(`  .${u.className}  ${dim(`→ ${u.files.length} files${u.nodeCount > 0 ? `, ${u.nodeCount} selector nodes` : ''}`)}`);
            }
            console.log('');
          }

          const files = options.strict ? result.strictFiles : result.looseFiles;
          const label = options.strict ? 'Strict impact' : 'Loose impact';
          if (files.length === 0) {
            console.log(`${bold(`${label}:`)} (none)`);
          } else {
            console.log(`${bold(`${label}:`)} ${files.length} files`);
            for (const f of files.slice(0, 50)) {
              console.log(`  ${f}`);
            }
            if (files.length > 50) {
              console.log(`  ${dim(`... and ${files.length - 50} more`)}`);
            }
          }
        }

        cg.destroy();
      } catch (err) {
        console.error(`rule analysis failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  /**
   * cssgraph details <selector>
   */
  program
    .command('details <selector>')
    .description('Quick lookup: find files defining a CSS selector (exact match only)')
    .option('-p, --path <path>', 'Project path')
    .option('--json', 'Output as JSON')
    .action(async (selector: string, options: { path?: string; json?: boolean }) => {
      const projectPath = resolveProjectPath(options.path);

      if (!isInitialized(projectPath)) {
        console.error(`Not initialized in ${projectPath}. Run "cssgraph init" first.`);
        process.exit(1);
      }

      try {
        const { default: CodeGraph, normalizeSelector } = await import('../index');
        const cg = await CodeGraph.open(projectPath);
        const matches = cg.selectorDetails(selector);
        const normalized = normalizeSelector(selector);

        if (options.json) {
          console.log(JSON.stringify(matches.map(m => ({
            selector: m.node.selector,
            name: m.node.name,
            filePath: m.node.filePath,
            line: m.node.startLine,
            specificity: m.node.specificity,
            properties: m.properties,
          })), null, 2));
        } else {
          if (matches.length === 0) {
            console.log(`${dim('No exact match found.')} Use ${bold('cssgraph rule')} "${normalized}" for related search.`);
          } else {
            console.log(`\n${matches.length} match(es) for ${bold(normalized)}:\n`);
            for (const m of matches) {
              console.log(`  ${m.node.selector ?? m.node.name}  ${dim(`${m.node.filePath}:${m.node.startLine}`)}`);
              if (m.properties && m.properties.length > 0) {
                for (const p of m.properties.slice(0, 8)) {
                  console.log(`    ${p.property}: ${p.value}`);
                }
                if (m.properties.length > 8) {
                  console.log(`    ${dim(`... and ${m.properties.length - 8} more properties`)}`);
                }
              }
            }
          }
        }

        cg.destroy();
      } catch (err) {
        console.error(`details lookup failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  /**
   * cssgraph impact-selector <selector>
   */
  program
    .command('impact-selector <selector>')
    .description('Find code files (JS/TS/JSX/TSX/es6) affected by a CSS selector')
    .option('-p, --path <path>', 'Project path')
    .option('--loose', 'Show files using any class (default: strict — only files using ALL classes)')
    .option('--json', 'Output as JSON')
    .action(async (selector: string, options: { path?: string; loose?: boolean; json?: boolean }) => {
      const projectPath = resolveProjectPath(options.path);

      if (!isInitialized(projectPath)) {
        console.error(`Not initialized in ${projectPath}. Run "cssgraph init" first.`);
        process.exit(1);
      }

      try {
        const { default: CodeGraph } = await import('../index');
        const cg = await CodeGraph.open(projectPath);
        const impact = cg.selectorImpact(selector);

        if (options.json) {
          console.log(JSON.stringify(impact, null, 2));
        } else {
          console.log(`\n${bold('Selector:')} ${impact.selector}`);
          console.log(`${bold('Classes:')}  ${impact.classes.map(c => `.${c}`).join(' ')}\n`);

          if (impact.definition.length === 0) {
            console.log(`${bold('Definition:')} ${dim('(not found)')}`);
          } else {
            console.log(`${bold('Definition:')}`);
            for (const d of impact.definition) {
              console.log(`  ${dim(`${d.filePath}:${d.line}`)}  ${d.selector}`);
            }
          }
          console.log('');

          const files = options.loose ? impact.loose : impact.strict;
          const label = options.loose ? 'Affected (loose — any class used)' : 'Affected (strict — all classes used)';
          if (files.length === 0) {
            console.log(`${bold(label)}: ${dim('(none)')}`);
            if (!options.loose && impact.loose.length > 0) {
              console.log(`${dim(`  Use --loose to see ${impact.loose.length} file(s) using any class.`)}`);
            }
          } else {
            console.log(`${bold(label)}: ${files.length} file(s)`);
            for (const f of files) {
              console.log(`  ${f}`);
            }
          }
        }

        cg.destroy();
      } catch (err) {
        console.error(`impact-selector failed: ${err instanceof Error ? err.message : String(err)}`);
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
      const result = await cg.sync({});

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
 * cssgraph version
 */
program
  .command('version')
  .description('Print the installed version')
  .action(() => {
    console.log(packageJson.version);
  });

/**
 * cssgraph install
 */
program
  .command('install')
  .description('Wire up cssgraph MCP server to your AI agents')
  .option('--target <ids>', 'Agent targets (auto, all, or csv: claude,opencode)')
  .option('--location <loc>', 'Config location (global, local)', 'global')
  .option('--yes', 'Skip prompts and accept defaults')
  .option('--no-auto-allow', 'Skip Claude Code auto-allow permissions')
  .action(async (options: { target?: string; location?: string; yes?: boolean; autoAllow?: boolean }) => {
    try {
      const { runInstallerWithOptions } = await import('../installer');
      await runInstallerWithOptions({
        target: options.target,
        location: options.location as 'global' | 'local',
        autoAllow: options.autoAllow,
        yes: options.yes,
      });
    } catch (err) {
      console.error(`Install failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

/**
 * cssgraph uninstall
 */
program
  .command('uninstall')
  .description('Remove cssgraph from your AI agents')
  .option('--target <ids>', 'Agent targets (auto, all, or csv: claude,opencode)')
  .option('--location <loc>', 'Config location (global, local)', 'global')
  .option('--yes', 'Skip prompts')
  .action(async (options: { target?: string; location?: string; yes?: boolean }) => {
    try {
      const { runUninstaller } = await import('../installer');
      await runUninstaller({
        target: options.target,
        location: options.location as 'global' | 'local',
        yes: options.yes,
      });
    } catch (err) {
      console.error(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Check if running with no arguments - show help
if (process.argv.length === 2) {
  program.help();
}

program.parse();
