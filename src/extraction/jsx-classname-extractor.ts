export interface ClassNameReference {
  className: string;
  filePath: string;
  line: number;
}

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

function offsetToLine(offsets: number[], offset: number): number {
  let lo = 0, hi = offsets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid]! <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

export function extractClassNameUsage(jsxSource: string, filePath: string): ClassNameReference[] {
  const results: ClassNameReference[] = [];
  const seen = new Set<string>();
  const lineOffsets = buildLineOffsets(jsxSource);

  const add = (className: string, line: number) => {
    const key = `${className}:${line}`;
    if (seen.has(key)) return;
    if (!/^[A-Za-z0-9_-]+$/.test(className)) return;
    seen.add(key);
    results.push({ className, filePath, line });
  };

  // Single-pass regex for className="...", className='...', className={`...`}, and className={.
  const pattern = /\bclassName\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\{)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(jsxSource)) !== null) {
    const line = offsetToLine(lineOffsets, match.index);

    if (match[1]) {
      for (const cls of splitClassNames(match[1])) add(cls, line);
    } else if (match[2]) {
      for (const cls of splitClassNames(match[2])) add(cls, line);
    } else if (match[3]) {
      for (const cls of splitClassNames(match[3])) add(cls, line);
    } else {
      // Brace expression: find matching } to handle nested braces/strings.
      const braceStart = match.index + match[0].length - 1;
      const braceEnd = findMatchingBrace(jsxSource, braceStart);
      if (braceEnd === -1) continue;
      const expr = jsxSource.slice(braceStart + 1, braceEnd);
      extractClassNamesFromExpression(expr, add, line);
    }
  }

  return results;
}

function splitClassNames(value: string): string[] {
  return value
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function findMatchingBrace(source: string, openIndex: number): number {
  if (source[openIndex] !== '{') return -1;

  let depth = 1;
  let inString: '"' | "'" | '`' | null = null;
  let i = openIndex + 1;

  while (i < source.length) {
    const ch = source[i]!;
    const prev = source[i - 1];

    if (inString) {
      if (ch === inString && prev !== '\\') {
        inString = null;
      } else if (ch === '$' && inString === '`' && source[i + 1] === '{') {
        // Skip template literal interpolation.
        i += 2;
        let tplDepth = 1;
        while (i < source.length && tplDepth > 0) {
          if (source[i] === '{') tplDepth++;
          else if (source[i] === '}') tplDepth--;
          i++;
        }
        continue;
      }
    } else {
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = ch;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }

    i++;
  }

  return -1;
}

function extractClassNamesFromExpression(
  expr: string,
  add: (className: string, line: number) => void,
  line: number,
): void {
  // CSS Modules: styles.foo, styles['foo-bar']
  const moduleMatches = expr.matchAll(/\b\w+\.(\w+)|\b\w+\[["']([^"']+)["']\]/g);
  for (const m of moduleMatches) {
    const cls = m[1] || m[2];
    if (cls) add(cls, line);
  }

  // Utility helpers: cx('foo', 'bar'), classNames(...), clsx(...)
  const helperMatches = expr.matchAll(/\b(?:cx|classNames|clsx)\s*\(([^)]*)\)/g);
  for (const m of helperMatches) {
    const args = m[1];
    if (!args) continue;
    const stringMatches = args.matchAll(/["']([^"']+)["']/g);
    for (const sm of stringMatches) {
      for (const cls of splitClassNames(sm[1]!)) add(cls, line);
    }
    const templateMatches = args.matchAll(/`([^`]*)`/g);
    for (const sm of templateMatches) {
      for (const cls of splitClassNames(sm[1]!)) add(cls, line);
    }
  }

  // String literals anywhere in the expression (e.g. condition ? 'foo' : 'bar')
  const stringMatches = expr.matchAll(/["']([^"']+)["']/g);
  for (const m of stringMatches) {
    for (const cls of splitClassNames(m[1]!)) add(cls, line);
  }

  // Template literals anywhere in the expression (e.g. `button-and-overlay ${dynamic}`)
  const templateMatches = expr.matchAll(/`([^`]*)`/g);
  for (const m of templateMatches) {
    for (const cls of splitClassNames(m[1]!)) add(cls, line);
  }
}


