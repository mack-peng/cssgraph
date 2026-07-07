export function getToolDefinitions() {
  return [
    {
      name: 'cssgraph_explore',
      description: 'PRIMARY TOOL: Get the full style context for a className — properties, overrides, specificity, and callers in one call.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const, description: 'Class name or natural language query' },
          maxFiles: { type: 'number' as const, description: 'Maximum files to include (default: 12)' },
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional; auto-detected from cwd)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'cssgraph_search',
      description: 'Search for className selectors by name.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string' as const, description: 'Class name to search for' },
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'cssgraph_callers',
      description: 'Find JSX components that reference a className.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          className: { type: 'string' as const, description: 'Class name' },
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional)' },
        },
        required: ['className'],
      },
    },
    {
      name: 'cssgraph_impact',
      description: 'Analyze the impact radius of changing a className.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          className: { type: 'string' as const, description: 'Class name' },
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional)' },
        },
        required: ['className'],
      },
    },
    {
      name: 'cssgraph_rule',
      description: 'Analyze the impact radius of a CSS selector (exact, related selectors, class usage, loose/strict impact).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' as const, description: 'Full CSS selector to analyze' },
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional)' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'cssgraph_details',
      description: 'Quick exact match: find files defining a specific CSS selector string.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' as const, description: 'Full CSS selector string (exact match)' },
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional)' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'cssgraph_impact_selector',
      description: 'Find code files (JS/TS/JSX/TSX/es6) affected by a CSS selector — strict (all classes) and loose (any class) impact.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          selector: { type: 'string' as const, description: 'Full CSS selector to analyze' },
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional)' },
        },
        required: ['selector'],
      },
    },
    {
      name: 'cssgraph_files',
      description: 'List project style files from the index.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional)' },
        },
      },
    },
    {
      name: 'cssgraph_status',
      description: 'Show index statistics.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional)' },
        },
      },
    },
    {
      name: 'cssgraph_unused',
      description: 'Find CSS class selectors that have no incoming references.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number' as const, description: 'Maximum results (default: 50, max: 200)' },
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional)' },
        },
      },
    },
    {
      name: 'cssgraph_cascade',
      description: 'Visualize the cascade path for a className, ordered by specificity.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          className: { type: 'string' as const, description: 'Class name to analyze' },
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional)' },
        },
        required: ['className'],
      },
    },
    {
      name: 'cssgraph_property',
      description: 'Search selectors by CSS property value (e.g. property="display", value="flex").',
      inputSchema: {
        type: 'object' as const,
        properties: {
          property: { type: 'string' as const, description: 'CSS property name (optional)' },
          value: { type: 'string' as const, description: 'Property value to search for' },
          exact: { type: 'boolean' as const, description: 'Exact value match' },
          limit: { type: 'number' as const, description: 'Maximum results (default: 50, max: 200)' },
          projectPath: { type: 'string' as const, description: 'Path to project with .cssgraph/ initialized (optional)' },
        },
        required: ['value'],
      },
    },
  ];
}

export class MCPServer {
  private async getProjectPath(args: Record<string, unknown>): Promise<string | null> {
    const cwd = (args['projectPath'] as string) || process.env.CSSGRAPH_PROJECT_PATH || process.cwd();
    const { default: CodeGraph } = await import('../index');
    if (CodeGraph.isInitialized(cwd)) return cwd;
    const { findNearestCodeGraphRoot } = await import('../directory');
    return findNearestCodeGraphRoot(cwd);
  }

  private notInitialized(): string {
    return 'cssgraph is not initialized in this project. Run "cssgraph init" first.\n\nIf the project lives at a different path, pass the `projectPath` argument.';
  }

  async explore(args: Record<string, unknown>): Promise<string> {
    const query = args['query'] as string || '';
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
    const cg = await CodeGraph.open(root);
    try {
      return cg.explore(query, (args['maxFiles'] as number) ?? 12);
    } finally {
      cg.destroy();
    }
  }

  async search(args: Record<string, unknown>): Promise<string> {
    const query = args['query'] as string || '';
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
    const cg = await CodeGraph.open(root);
    try {
      const results = cg.searchNodes(query, { limit: 10 });
      if (results.length === 0) return `No results found for "${query}".`;
      return results.map(r => `${r.node.kind}: ${r.node.name} (${r.node.filePath}:${r.node.startLine})`).join('\n');
    } finally {
      cg.destroy();
    }
  }

  async callers(args: Record<string, unknown>): Promise<string> {
    const className = args['className'] as string || '';
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
    const cg = await CodeGraph.open(root);
    try {
      const results = cg.searchNodes(className, { limit: 1 });
      if (results.length === 0) return `No results found for "${className}".`;
      const callers = cg.getCallers(results[0]!.node.id, 2);
      if (callers.length === 0) return `No callers found for "${className}".`;
      return callers.map(c => `${c.node.kind}: ${c.node.name} (${c.node.filePath}:${c.node.startLine})`).join('\n');
    } finally {
      cg.destroy();
    }
  }

  async impact(args: Record<string, unknown>): Promise<string> {
    const className = args['className'] as string || '';
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
    const cg = await CodeGraph.open(root);
    try {
      const results = cg.searchNodes(className, { limit: 1 });
      if (results.length === 0) return `No results found for "${className}".`;
      const subgraph = cg.getImpactRadius(results[0]!.node.id, 3);
      const lines: string[] = [];
      for (const [, node] of subgraph.nodes) {
        lines.push(`${node.kind}: ${node.name} (${node.filePath}:${node.startLine})`);
      }
      return lines.join('\n') || `No impact found for "${className}".`;
    } finally {
      cg.destroy();
    }
  }

  async rule(args: Record<string, unknown>): Promise<string> {
    const selector = args['selector'] as string || '';
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
    const cg = await CodeGraph.open(root);
    try {
      const result = cg.analyzeRule(selector);
      if (result.exactMatches.length === 0 && result.containsMatches.length === 0 && result.classUsage.length === 0) {
        return `No rules found matching "${selector}".`;
      }

      const lines: string[] = [`Rule: ${selector}\n`];

      if (result.exactMatches.length > 0) {
        lines.push('Exact matches:');
        for (const m of result.exactMatches) {
          lines.push(`  ${m.node.selector ?? m.node.name} — ${m.node.filePath}:${m.node.startLine}`);
        }
        lines.push('');
      }

      if (result.containsMatches.length > 0) {
        lines.push('Related selectors:');
        for (const m of result.containsMatches) {
          lines.push(`  ${m.node.selector ?? m.node.name} — ${m.node.filePath}:${m.node.startLine}`);
        }
        lines.push('');
      }

      lines.push('Class usage:');
      for (const u of result.classUsage) {
        lines.push(`  .${u.className} → ${u.files.length} files`);
      }
      lines.push('');

      lines.push(`Loose impact: ${result.looseFiles.length} files`);
      lines.push(`Strict impact: ${result.strictFiles.length} files`);
      for (const f of result.strictFiles.slice(0, 20)) {
        lines.push(`  ${f}`);
      }
      if (result.strictFiles.length > 20) {
        lines.push(`  ... and ${result.strictFiles.length - 20} more`);
      }

      return lines.join('\n');
    } finally {
      cg.destroy();
    }
  }

  async details(args: Record<string, unknown>): Promise<string> {
    const selector = args['selector'] as string || '';
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
    const cg = await CodeGraph.open(root);
    try {
      const matches = cg.selectorDetails(selector);
      if (matches.length === 0) return `No exact match for "${selector}".`;
      return matches.map(m =>
        `${m.node.selector ?? m.node.name} — ${m.node.filePath}:${m.node.startLine}` +
        (m.properties?.length ? ` (${m.properties.map(p => `${p.property}: ${p.value}`).join('; ')})` : '')
      ).join('\n');
    } finally {
      cg.destroy();
    }
  }

  async impactSelector(args: Record<string, unknown>): Promise<string> {
    const selector = args['selector'] as string || '';
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
    const cg = await CodeGraph.open(root);
    try {
      const impact = cg.selectorImpact(selector);
      const lines: string[] = [`Selector: ${impact.selector}\n`];

      if (impact.definition.length > 0) {
        lines.push('Definition:');
        for (const d of impact.definition) {
          lines.push(`  ${d.filePath}:${d.line}  ${d.selector}`);
        }
        lines.push('');
      }

      if (impact.strict.length > 0) {
        lines.push(`Strict impact (all classes): ${impact.strict.length} file(s)`);
        for (const f of impact.strict.slice(0, 20)) lines.push(`  ${f}`);
        if (impact.strict.length > 20) lines.push(`  ... and ${impact.strict.length - 20} more`);
      }

      if (impact.loose.length > impact.strict.length) {
        lines.push(`\nLoose impact (any class): ${impact.loose.length} file(s)`);
        for (const f of impact.loose.slice(0, 20)) lines.push(`  ${f}`);
        if (impact.loose.length > 20) lines.push(`  ... and ${impact.loose.length - 20} more`);
      }

      return lines.join('\n');
    } finally {
      cg.destroy();
    }
  }

  async files(args: Record<string, unknown>): Promise<string> {
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
    const cg = await CodeGraph.open(root);
    try {
      const files = cg.getFiles();
      if (files.length === 0) return 'No style files indexed.';
      return files.map(f => `${f.language.padEnd(6)} ${f.path} (${f.nodeCount} nodes)`).join('\n');
    } finally {
      cg.destroy();
    }
  }

  async status(args: Record<string, unknown>): Promise<string> {
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
    const cg = await CodeGraph.open(root);
    try {
      const stats = cg.getStats();
      return `Nodes: ${stats.nodeCount} | Edges: ${stats.edgeCount} | Files: ${stats.fileCount}`;
    } finally {
      cg.destroy();
    }
  }

  async unused(args: Record<string, unknown>): Promise<string> {
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
    const cg = await CodeGraph.open(root);
    try {
      const limit = Math.min((args['limit'] as number) ?? 50, 200);
      const results = cg.findUnusedClassSelectors(limit);
      if (results.length === 0) return 'No unused class selectors found.';
      return results.map(r => `${r.node.name} (${r.node.filePath}:${r.node.startLine})`).join('\n');
    } finally {
      cg.destroy();
    }
  }

  async cascade(args: Record<string, unknown>): Promise<string> {
    const className = args['className'] as string || '';
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
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

  async property(args: Record<string, unknown>): Promise<string> {
    const property = args['property'] as string | undefined;
    const value = args['value'] as string || '';
    const root = await this.getProjectPath(args);
    if (!root) return this.notInitialized();
    const { default: CodeGraph } = await import('../index');
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
}
