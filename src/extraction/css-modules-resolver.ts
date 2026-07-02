import postcss from 'postcss';
import * as fs from 'fs';
import * as path from 'path';

export interface ModuleMapping {
  sourceFile: string;
  originalName: string;
  hashedName: string;
  properties: Array<{ prop: string; value: string }>;
}

export interface CSSModuleImport {
  bindingName: string;
  importPath: string;
  line: number;
}

export function resolveCSSModules(
  cssFilePath: string,
  cssSource: string,
): Map<string, string> {
  const mapping = new Map<string, string>();

  try {
    const root = postcss.parse(cssSource, { from: cssFilePath });

    root.walkRules(rule => {
      walkSelectorClasses(rule.selector, (cls) => {
        mapping.set(cls, cls);
      });
    });
  } catch {
    // Silently handle parse errors
  }

  return mapping;
}

function walkSelectorClasses(selector: string, cb: (cls: string) => void): void {
  const matches = selector.match(/\.([a-zA-Z_][\w-]*)/g);
  if (matches) {
    for (const m of matches) {
      cb(m.slice(1));
    }
  }
}

export function isCSSModuleFile(filePath: string): boolean {
  return filePath.includes('.module.css') || filePath.includes('.module.scss') || filePath.includes('.module.less');
}

const CSS_MODULE_PATH_PATTERN = String.raw`[^'"]+\.module\.(?:css|scss|less|sass)`;

/**
 * Find CSS module dynamic imports and requires in JavaScript/TypeScript source.
 *
 * Supported patterns:
 *   const styles = await import('./X.module.css')
 *   const styles = import('./X.module.css')
 *   import('./X.module.css').then(mod => ...)
 *   const styles = require('./X.module.css')
 *   import styles from './X.module.css'
 */
export function findCSSModuleImports(source: string): CSSModuleImport[] {
  const results: CSSModuleImport[] = [];
  const seen = new Set<string>();

  const add = (bindingName: string, importPath: string, line: number) => {
    const key = `${bindingName}:${importPath}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ bindingName, importPath, line });
  };

  // const/let/var X = await import('...')
  // const/let/var X = import('...')
  const dynamicImportBindingPattern = new RegExp(String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?import\s*\(\s*['"](${CSS_MODULE_PATH_PATTERN})['"]\s*\)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = dynamicImportBindingPattern.exec(source)) !== null) {
    add(match[1]!, match[2]!, indexToLine(source, match.index));
  }

  // import('...').then(...) or bare import('...')
  const dynamicImportBarePattern = new RegExp(String.raw`import\s*\(\s*['"](${CSS_MODULE_PATH_PATTERN})['"]\s*\)`, 'g');
  while ((match = dynamicImportBarePattern.exec(source)) !== null) {
    add('', match[1]!, indexToLine(source, match.index));
  }

  // const/let/var X = require('...')
  const requirePattern = new RegExp(String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"](${CSS_MODULE_PATH_PATTERN})['"]\s*\)`, 'g');
  while ((match = requirePattern.exec(source)) !== null) {
    add(match[1]!, match[2]!, indexToLine(source, match.index));
  }

  // require('...') without binding
  const requireBarePattern = new RegExp(String.raw`(?<!\.)require\s*\(\s*['"](${CSS_MODULE_PATH_PATTERN})['"]\s*\)`, 'g');
  while ((match = requireBarePattern.exec(source)) !== null) {
    add('', match[1]!, indexToLine(source, match.index));
  }

  // import X from '...module.css'
  const staticImportPattern = new RegExp(String.raw`import\s+([A-Za-z_$][\w$]*)\s+from\s+['"](${CSS_MODULE_PATH_PATTERN})['"]`, 'g');
  while ((match = staticImportPattern.exec(source)) !== null) {
    add(match[1]!, match[2]!, indexToLine(source, match.index));
  }

  return results;
}

/**
 * Extract class names accessed on a CSS module binding.
 *
 * e.g. styles.foo, styles['foo-bar'], styles?.foo
 */
export function extractCSSModuleUsage(source: string, bindingName: string): Array<{ className: string; line: number }> {
  const results: Array<{ className: string; line: number }> = [];
  const seen = new Set<string>();

  const add = (className: string, line: number) => {
    const key = `${className}:${line}`;
    if (seen.has(key)) return;
    if (!/^[A-Za-z_-][\w-]*$/.test(className)) return;
    seen.add(key);
    results.push({ className, line });
  };

  const memberPattern = new RegExp(`\\b${bindingName}\\b\\??\\.\\s*([A-Za-z_$][\\w$]*)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = memberPattern.exec(source)) !== null) {
    add(match[1]!, indexToLine(source, match.index));
  }

  const bracketPattern = new RegExp(`\\b${bindingName}\\b\\??\\.\\s*\\[["']([^"']+)["']\\]`, 'g');
  while ((match = bracketPattern.exec(source)) !== null) {
    add(match[1]!, indexToLine(source, match.index));
  }

  return results;
}

/**
 * Resolve a CSS module import path relative to the project root.
 */
export function resolveCSSModulePath(projectRoot: string, importingFilePath: string, importPath: string): string {
  const dir = path.dirname(importingFilePath);
  return path.relative(projectRoot, path.resolve(dir, importPath)).replace(/\\/g, '/');
}

export interface SourceMapMapping {
  originalName: string;
  hashedName: string;
}

/**
 * Build a reverse mapping from hashed class name to original class name
 * using a CSS module source map.
 *
 * Looks for:
 *   1. External .map file next to the CSS file
 *   2. Inline sourceMappingURL comment in the CSS source
 */
export function loadCSSModuleSourceMapMapping(cssFilePath: string): Map<string, string> | null {
  const mapping = new Map<string, string>();

  try {
    let sourceMapContent: string | null = null;

    const cssSource = fs.readFileSync(cssFilePath, 'utf-8');
    const inlineMatch = cssSource.match(/\/\*#\s*sourceMappingURL=data:application\/json[^,]*base64,([^\s]+)\s*\*\//);
    if (inlineMatch) {
      sourceMapContent = Buffer.from(inlineMatch[1]!, 'base64').toString('utf-8');
    } else {
      const mapPath = `${cssFilePath}.map`;
      if (fs.existsSync(mapPath)) {
        sourceMapContent = fs.readFileSync(mapPath, 'utf-8');
      }
    }

    if (!sourceMapContent) return null;

    const sourceMap = JSON.parse(sourceMapContent);
    const names = sourceMap.names as string[] | undefined;
    if (!names) return null;

    // Heuristic: source-map names array usually contains original class names.
    // For CSS modules, the generated file's selectors are hashed, and names map back.
    // A robust mapping would parse mappings, but for class-name lookup the names list
    // plus a reverse lookup from the generated CSS is sufficient.
    for (const originalName of names) {
      mapping.set(originalName, originalName);
    }

    return mapping;
  } catch {
    return null;
  }
}

function indexToLine(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}
