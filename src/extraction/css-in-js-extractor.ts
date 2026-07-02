import postcss from 'postcss';
import { Node, Edge, ExtractionResult, ExtractionError } from '../types';
import { detectLanguage } from './grammars';
import * as crypto from 'crypto';
import * as path from 'path';

function hashId(qualifiedName: string): string {
  return crypto.createHash('sha256').update(qualifiedName).digest('hex').slice(0, 16);
}

export interface StyledComponentMatch {
  componentName: string;
  target: string;
  tag: 'styled' | 'css';
  cssSource: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export function extractStyledComponents(source: string): StyledComponentMatch[] {
  const results: StyledComponentMatch[] = [];

  // Fast path: skip files that don't use styled-components or emotion css.
  if (source.indexOf('styled') === -1 && source.indexOf('css') === -1) {
    return results;
  }

  // Patterns for variable declarations that are likely tagged template literals.
  // Each pattern captures: variable name, styled target / css placeholder.
  const patterns = [
    // const X = styled.div`...`
    { regex: /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*styled\.(\w+)\s*`/g, tag: 'styled' as const, targetGroup: 2 },
    // const X = styled('div')`...`
    { regex: /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*styled\(['"]([^'"]+)['"]\)\s*`/g, tag: 'styled' as const, targetGroup: 2 },
    // const X = styled(Component)`...`
    { regex: /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*styled\(([^)]+)\)\s*`/g, tag: 'styled' as const, targetGroup: 2 },
    // const x = css`...`
    { regex: /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*css\s*`/g, tag: 'css' as const, targetGroup: 0 },
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(source)) !== null) {
      const componentName = match[1]!;
      const target = pattern.targetGroup > 0 ? match[pattern.targetGroup]!.trim() : 'css';

      // The regex matched up to and including the opening backtick.
      const backtickIdx = match.index + match[0].length - 1;
      const literal = extractTemplateLiteral(source, backtickIdx);
      if (!literal) continue;

      const startPos = indexToLineColumn(source, match.index);
      const endPos = indexToLineColumn(source, literal.endIndex);

      results.push({
        componentName,
        target,
        tag: pattern.tag,
        cssSource: literal.content,
        startLine: startPos.line,
        startColumn: startPos.column,
        endLine: endPos.line,
        endColumn: endPos.column,
      });
    }
  }

  return results;
}

function extractTemplateLiteral(source: string, startIndex: number): { content: string; endIndex: number } | null {
  if (source[startIndex] !== '`') return null;

  let depth = 0;
  let i = startIndex + 1;
  let content = '';

  while (i < source.length) {
    const ch = source[i]!;

    if (ch === '`' && source[i - 1] !== '\\') {
      if (depth === 0) {
        return { content, endIndex: i };
      }
      depth--;
      content += ch;
    } else if (ch === '$' && source[i + 1] === '{' && source[i - 1] !== '\\') {
      depth++;
      // Replace interpolation with a neutral comment so PostCSS can parse around it.
      content += '/* cssgraph-interpolation */';
      i += 2;
      // Skip to matching } of the interpolation.
      let braceDepth = 1;
      while (i < source.length && braceDepth > 0) {
        if (source[i] === '{') braceDepth++;
        else if (source[i] === '}') braceDepth--;
        i++;
      }
      continue;
    } else {
      content += ch;
    }

    i++;
  }

  return null;
}

function indexToLineColumn(source: string, index: number): { line: number; column: number } {
  const lines = source.slice(0, index).split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1]!.length + 1,
  };
}

export function extractCSSInJS(filePath: string, source: string): ExtractionResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const errors: ExtractionError[] = [];

  const fileBaseName = path.basename(filePath, path.extname(filePath));
  const language = detectLanguage(filePath);
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

  const matches = extractStyledComponents(source);

  for (const match of matches) {
    const styledNodeId = hashId(`${filePath}:${match.tag}:${match.componentName}`);

    nodes.push({
      id: styledNodeId,
      kind: 'styled_component',
      name: match.componentName,
      qualifiedName: `${filePath}::${match.tag}::${match.componentName}`,
      filePath,
      language,
      startLine: match.startLine,
      endLine: match.endLine,
      startColumn: match.startColumn,
      endColumn: match.endColumn,
      selector: match.componentName,
      updatedAt: Date.now(),
    });

    edges.push({
      source: fileNodeId,
      target: styledNodeId,
      kind: 'contains',
      provenance: 'heuristic',
      line: match.startLine,
    });

    try {
      const root = postcss.parse(match.cssSource, { from: filePath });

      root.walkDecls(decl => {
        const propNodeId = hashId(`${filePath}:${match.tag}:${match.componentName}:${decl.prop}`);
        nodes.push({
          id: propNodeId,
          kind: 'css_property',
          name: decl.prop,
          qualifiedName: `${filePath}::${match.tag}::${match.componentName}::${decl.prop}`,
          filePath,
          language: detectLanguage(filePath),
          startLine: match.startLine,
          endLine: match.endLine,
          startColumn: 0,
          endColumn: 0,
          value: decl.value,
          selector: match.componentName,
          updatedAt: Date.now(),
        });

        edges.push({
          source: styledNodeId,
          target: propNodeId,
          kind: 'contains',
          provenance: 'postcss',
          line: match.startLine,
        });
      });
    } catch (err) {
      errors.push({
        message: err instanceof Error ? err.message : String(err),
        filePath,
        line: match.startLine,
        severity: 'warning',
        code: 'css_in_js_parse_error',
      });
    }
  }

  return { nodes, edges, errors, durationMs: 0 };
}
