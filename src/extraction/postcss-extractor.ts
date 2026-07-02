import postcss, { Root, Rule, AtRule, Declaration, ChildNode } from 'postcss';
import { Node, Edge, ExtractionResult, ExtractionError } from '../types';
import { detectLanguage } from './grammars';
import { buildFullSelector, SelectorContext } from './selector-builder';
import { calculateSpecificity } from './specificity';
import * as crypto from 'crypto';
import path from 'path';

function hashId(qualifiedName: string): string {
  return crypto.createHash('sha256').update(qualifiedName).digest('hex').slice(0, 16);
}

function walkClasses(selector: string, cb: (className: string) => void): void {
  try {
    const parserModule = require('postcss-selector-parser') as
      (handler: (selectors: { walk: (cb: (node: { type: string; value: string }) => void) => void }) => void) =>
      { processSync: (s: string) => void };

    parserModule((selectors) => {
      selectors.walk((node) => {
        if (node.type === 'class') {
          cb(node.value);
        }
      });
    }).processSync(selector);
  } catch {
    const matches = selector.match(/\.([a-zA-Z_][\w-]*)/g);
    if (matches) {
      for (const m of matches) {
        cb(m.slice(1));
      }
    }
  }
}

function walkIds(selector: string, cb: (id: string) => void): void {
  try {
    const parserModule = require('postcss-selector-parser') as
      (handler: (selectors: { walk: (cb: (node: { type: string; value: string }) => void) => void }) => void) =>
      { processSync: (s: string) => void };

    parserModule((selectors) => {
      selectors.walk((node) => {
        if (node.type === 'id') {
          cb(node.value);
        }
      });
    }).processSync(selector);
  } catch {
    const matches = selector.match(/#([a-zA-Z_][\w-]*)/g);
    if (matches) {
      for (const m of matches) {
        cb(m.slice(1));
      }
    }
  }
}

export function extractFromSource(filePath: string, source: string): ExtractionResult {
  const language = detectLanguage(filePath);
  if (language === 'unknown') {
    return {
      nodes: [],
      edges: [],
      errors: [{
        message: `Unsupported language for ${filePath}`,
        filePath,
        severity: 'warning',
        code: 'unsupported_language',
      }],
      durationMs: 0,
    };
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const errors: ExtractionError[] = [];
  const fileBaseName = path.basename(filePath, path.extname(filePath));
  const isModule = filePath.includes('.module.');

  try {
    let root: Root | undefined;
    switch (language) {
      case 'scss': {
        const scssSyntax = require('postcss-scss');
        root = postcss().process(source, { from: filePath, syntax: scssSyntax }).root;
        break;
      }
      case 'less': {
        const lessSyntax = require('postcss-less');
        root = postcss().process(source, { from: filePath, syntax: lessSyntax }).root;
        break;
      }
      case 'sass':
        try {
          const sass = require('sass');
          const result = sass.compileString(source, {
            syntax: 'indented',
            url: new URL(`file://${filePath}`),
          });
          root = postcss.parse(result.css, { from: filePath });
        } catch { /* sass not installed or parse error */ }
        break;
      case 'pcss':
        root = postcss.parse(source, { from: filePath });
        break;
      default:
        root = postcss.parse(source, { from: filePath });
    }

    if (!root) {
      return { nodes, edges, errors, durationMs: 0 };
    }

    const fileNodeId = hashId(`file:${filePath}`);
    nodes.push({
      id: fileNodeId,
      kind: 'file',
      name: fileBaseName,
      qualifiedName: `file:${filePath}`,
      filePath,
      language,
      startLine: 1,
      endLine: source.split('\n').length,
      startColumn: 0,
      endColumn: 0,
      updatedAt: Date.now(),
    });

    const allSelectorNodes: Node[] = [];

    const walkRules = (
      children: ChildNode[],
      context: SelectorContext,
    ) => {
      for (const child of children) {
        if (child.type === 'rule') {
          visitRule(child as Rule, context);
        } else if (child.type === 'atrule') {
          const atRule = child as AtRule;
          const atRuleContext: SelectorContext = {
            parentSelectors: context.parentSelectors,
            atRules: [...context.atRules, { name: atRule.name, params: atRule.params }],
          };

          const atRuleId = hashId(`${filePath}:@${atRule.name}:${atRule.params}`);
          nodes.push({
            id: atRuleId,
            kind: 'at_rule',
            name: atRule.name,
            qualifiedName: `${filePath}:@${atRule.name}:${atRule.params}`,
            filePath,
            language,
            startLine: atRule.source?.start?.line ?? 0,
            endLine: atRule.source?.end?.line ?? 0,
            startColumn: 0,
            endColumn: 0,
            params: atRule.params,
            updatedAt: Date.now(),
          });

          edges.push({
            source: fileNodeId,
            target: atRuleId,
            kind: 'contains',
            provenance: 'postcss',
          });

          if (atRule.nodes && atRule.nodes.length > 0) {
            if (atRule.name === 'keyframes' || atRule.name === '-webkit-keyframes') {
              const kfNodeId = hashId(`${filePath}:@keyframes:${atRule.params}`);
              nodes.push({
                id: kfNodeId,
                kind: 'at_rule',
                name: atRule.name,
                qualifiedName: `${filePath}:@keyframes:${atRule.params}`,
                filePath,
                language,
                startLine: atRule.source?.start?.line ?? 0,
                endLine: atRule.source?.end?.line ?? 0,
                startColumn: 0,
                endColumn: 0,
                params: atRule.params,
                updatedAt: Date.now(),
              });
              edges.push({ source: fileNodeId, target: kfNodeId, kind: 'contains', provenance: 'postcss' });
            } else {
              walkRules(atRule.nodes, atRuleContext);
            }
          }
        }
      }
    };

    const visitRule = (rule: Rule, context: SelectorContext) => {
      const fullSelector = buildFullSelector(rule, context);

      const declarations: { property: string; value: string }[] = [];
      const variables: { name: string; value: string }[] = [];
      const varRefs: { name: string }[] = [];

      rule.nodes?.forEach(decl => {
        if (decl.type === 'decl') {
          const d = decl as Declaration;
          if (d.prop.startsWith('--')) {
            variables.push({ name: d.prop, value: d.value });
          } else {
            declarations.push({ property: d.prop, value: d.value });
          }

          const varMatches = d.value.match(/var\((--[^,)]+)/g);
          if (varMatches) {
            for (const m of varMatches) {
              const varName = m.replace('var(', '').trim();
              varRefs.push({ name: varName });
            }
          }
        }
      });

      const specificity = calculateSpecificity(fullSelector);

      const visitedClasses = new Set<string>();
      walkClasses(fullSelector, (className) => {
        if (visitedClasses.has(className)) return;
        visitedClasses.add(className);

        const selectorNodeId = hashId(`${filePath}:${fullSelector}:${className}`);

        const node: Node = {
          id: selectorNodeId,
          kind: 'class_selector',
          name: className,
          qualifiedName: `${filePath}::${fullSelector}::${className}`,
          filePath,
          language,
          startLine: rule.source?.start?.line ?? 0,
          endLine: rule.source?.end?.line ?? 0,
          startColumn: rule.source?.start?.column ?? 0,
          endColumn: rule.source?.end?.column ?? 0,
          specificity,
          properties: declarations.length > 0 ? declarations : undefined,
          selector: fullSelector,
          updatedAt: Date.now(),
        };

        nodes.push(node);
        allSelectorNodes.push(node);

        edges.push({
          source: fileNodeId,
          target: selectorNodeId,
          kind: 'contains',
          provenance: 'postcss',
          line: rule.source?.start?.line,
          column: rule.source?.start?.column,
        });

        if (isModule) {
          edges.push({
            source: selectorNodeId,
            target: fileNodeId,
            kind: 'exports',
            provenance: 'heuristic',
          });
        }

        for (const decl of declarations) {
          const propNodeId = hashId(`${filePath}:${fullSelector}:${className}:${decl.property}`);
          nodes.push({
            id: propNodeId,
            kind: 'css_property',
            name: decl.property,
            qualifiedName: `${filePath}::${fullSelector}::${className}::${decl.property}`,
            filePath,
            language,
            startLine: rule.source?.start?.line ?? 0,
            endLine: rule.source?.end?.line ?? 0,
            startColumn: 0,
            endColumn: 0,
            value: decl.value,
            selector: fullSelector,
            specificity,
            updatedAt: Date.now(),
          });
          edges.push({ source: selectorNodeId, target: propNodeId, kind: 'contains', provenance: 'postcss' });
        }

        for (const vref of varRefs) {
          const varNodeId = sourceVarNodeId(vref.name, nodes);
          if (varNodeId) {
            edges.push({
              source: selectorNodeId,
              target: varNodeId,
              kind: 'references',
              provenance: 'heuristic',
              line: rule.source?.start?.line,
            });
          }
        }
      });

      walkIds(fullSelector, (idName) => {
        const idNodeId = hashId(`${filePath}:${fullSelector}:#${idName}`);
        nodes.push({
          id: idNodeId,
          kind: 'class_selector',
          name: `#${idName}`,
          qualifiedName: `${filePath}::${fullSelector}::#${idName}`,
          filePath,
          language,
          startLine: rule.source?.start?.line ?? 0,
          endLine: rule.source?.end?.line ?? 0,
          startColumn: 0,
          endColumn: 0,
          specificity,
          selector: fullSelector,
          updatedAt: Date.now(),
        });
        edges.push({ source: fileNodeId, target: idNodeId, kind: 'contains', provenance: 'postcss' });

        for (const decl of declarations) {
          const propNodeId = hashId(`${filePath}:${fullSelector}:#${idName}:${decl.property}`);
          nodes.push({
            id: propNodeId,
            kind: 'css_property',
            name: decl.property,
            qualifiedName: `${filePath}::${fullSelector}::#${idName}::${decl.property}`,
            filePath,
            language,
            startLine: rule.source?.start?.line ?? 0,
            endLine: rule.source?.end?.line ?? 0,
            startColumn: 0,
            endColumn: 0,
            value: decl.value,
            selector: fullSelector,
            specificity,
            updatedAt: Date.now(),
          });
          edges.push({ source: idNodeId, target: propNodeId, kind: 'contains', provenance: 'postcss' });
        }
      });

      for (const varDecl of variables) {
        const varNodeId = hashId(`${filePath}:${varDecl.name}`);
        if (!nodes.some(n => n.id === varNodeId)) {
          nodes.push({
            id: varNodeId,
            kind: 'css_variable',
            name: varDecl.name,
            qualifiedName: `${filePath}::${varDecl.name}`,
            filePath,
            language,
            startLine: rule.source?.start?.line ?? 0,
            endLine: rule.source?.end?.line ?? 0,
            startColumn: 0,
            endColumn: 0,
            value: varDecl.value,
            updatedAt: Date.now(),
          });
        }
      }

      // Process nested rules
      const nestedRules: Rule[] = [];
      if (rule.nodes) {
        for (const n of rule.nodes) {
          if (n.type === 'rule') nestedRules.push(n as Rule);
        }
      }

      if (nestedRules.length > 0) {
        for (const nested of nestedRules) {
          const parentNodes = nodes.filter(n => n.selector === fullSelector);

          walkRules([nested], {
            parentSelectors: rule.selectors,
            atRules: context.atRules,
          });

          const childSelector = buildFullSelector(nested, {
            parentSelectors: rule.selectors,
            atRules: context.atRules,
          });
          const childNodes = nodes.filter(n => n.selector === childSelector);

          for (const pn of parentNodes) {
            for (const cn of childNodes) {
              edges.push({
                source: pn.id,
                target: cn.id,
                kind: 'nests',
                provenance: 'postcss',
                line: nested.source?.start?.line,
              });
            }
          }
        }
      }
    };

    // Process @import/@use/@forward
    root.walkAtRules(['import', 'use', 'forward'] as any, (atRule: AtRule) => {
      const importPath = atRule.params.replace(/['"]/g, '').split(/\s+/)[0] ?? '';
      const kind = atRule.name as string;
      const importNodeId = hashId(`${filePath}:@${kind}:${importPath}`);
      nodes.push({
        id: importNodeId,
        kind: 'at_rule',
        name: kind,
        qualifiedName: `${filePath}:@${kind}:${importPath}`,
        filePath,
        language,
        startLine: atRule.source?.start?.line ?? 0,
        endLine: atRule.source?.end?.line ?? 0,
        startColumn: 0,
        endColumn: 0,
        params: importPath,
        updatedAt: Date.now(),
      });
      edges.push({
        source: fileNodeId,
        target: importNodeId,
        kind: 'imports',
        provenance: 'postcss',
      });
    });

    walkRules(root.nodes ?? [], { parentSelectors: [], atRules: [] });

    // Build overrides edges
    const classNameMap = new Map<string, Node[]>();
    for (const n of allSelectorNodes) {
      if (!n.name.startsWith('#')) {
        const list = classNameMap.get(n.name) || [];
        list.push(n);
        classNameMap.set(n.name, list);
      }
    }

    for (const [, classNodes] of classNameMap) {
      if (classNodes.length < 2) continue;
      for (let i = 0; i < classNodes.length; i++) {
        for (let j = i + 1; j < classNodes.length; j++) {
          const a = classNodes[i]!;
          const b = classNodes[j]!;
          const specA = a.specificity ?? [0, 0, 0, 0];
          const specB = b.specificity ?? [0, 0, 0, 0];

          if (cmpSpecificity(specA, specB) > 0) {
            edges.push({ source: a.id, target: b.id, kind: 'overrides', provenance: 'heuristic' });
          } else if (cmpSpecificity(specB, specA) > 0) {
            edges.push({ source: b.id, target: a.id, kind: 'overrides', provenance: 'heuristic' });
          }
        }
      }
    }

  } catch (err) {
    errors.push({
      message: err instanceof Error ? err.message : String(err),
      filePath,
      severity: 'error',
      code: 'parse_error',
    });
  }

  return { nodes, edges, errors, durationMs: 0 };
}

function sourceVarNodeId(varName: string, nodes: Node[]): string | null {
  const found = nodes.find(n => n.kind === 'css_variable' && n.name === varName);
  return found ? found.id : null;
}

function cmpSpecificity(a: [number, number, number, number], b: [number, number, number, number]): number {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0);
  }
  return 0;
}
