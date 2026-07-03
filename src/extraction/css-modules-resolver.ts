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

export function findCSSModuleImports(source: string): CSSModuleImport[] {
  const results: CSSModuleImport[] = [];
  const seen = new Set<string>();

  const add = (bindingName: string, importPath: string, line: number) => {
    const key = `${bindingName}:${importPath}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ bindingName, importPath, line });
  };

  const dynamicImportBindingPattern = new RegExp(String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?import\s*\(\s*['"](${CSS_MODULE_PATH_PATTERN})['"]\s*\)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = dynamicImportBindingPattern.exec(source)) !== null) {
    add(match[1]!, match[2]!, indexToLine(source, match.index));
  }

  const dynamicImportBarePattern = new RegExp(String.raw`import\s*\(\s*['"](${CSS_MODULE_PATH_PATTERN})['"]\s*\)`, 'g');
  while ((match = dynamicImportBarePattern.exec(source)) !== null) {
    add('', match[1]!, indexToLine(source, match.index));
  }

  const requirePattern = new RegExp(String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*['"](${CSS_MODULE_PATH_PATTERN})['"]\s*\)`, 'g');
  while ((match = requirePattern.exec(source)) !== null) {
    add(match[1]!, match[2]!, indexToLine(source, match.index));
  }

  const requireBarePattern = new RegExp(String.raw`(?<!\.)require\s*\(\s*['"](${CSS_MODULE_PATH_PATTERN})['"]\s*\)`, 'g');
  while ((match = requireBarePattern.exec(source)) !== null) {
    add('', match[1]!, indexToLine(source, match.index));
  }

  const staticImportPattern = new RegExp(String.raw`import\s+([A-Za-z_$][\w$]*)\s+from\s+['"](${CSS_MODULE_PATH_PATTERN})['"]`, 'g');
  while ((match = staticImportPattern.exec(source)) !== null) {
    add(match[1]!, match[2]!, indexToLine(source, match.index));
  }

  return results;
}

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

  const dotAccessPattern = new RegExp(`\\b${escapeRegex(bindingName)}\\.(\\w[\-\w]*)`, 'g');
  let match: RegExpExecArray | null;
  while ((match = dotAccessPattern.exec(source)) !== null) {
    add(match[1]!, indexToLine(source, match.index));
  }

  const bracketAccessPattern = new RegExp(`\\b${escapeRegex(bindingName)}\\s*\\[\\s*['\"]([A-Za-z_-][\\w-]*)['\"]\\s*\\]`, 'g');
  while ((match = bracketAccessPattern.exec(source)) !== null) {
    add(match[1]!, indexToLine(source, match.index));
  }

  return results;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveCSSModulePath(projectRoot: string, importingFilePath: string, importPath: string): string {
  const dir = path.dirname(importingFilePath);
  return path.relative(projectRoot, path.resolve(dir, importPath)).replace(/\\/g, '/');
}

/**
 * Build a Map<hashedName, originalName> from a CSS module's source map.
 * Uses source-map-js to parse the .map file or inline base64 source map.
 *
 * Returns null if no source map is found or it cannot be parsed.
 */
export function loadCSSModuleHashMap(cssFilePath: string): Map<string, string> | null {
  const map = new Map<string, string>();

  try {
    let sourceMapContent: string | null = null;
    const cssSource = fs.readFileSync(cssFilePath, 'utf-8');

    // Try inline source map (webpack/vite dev mode)
    const inlineMatch = cssSource.match(/\/\*#\s*sourceMappingURL=data:application\/json[^,]*base64,([^\s]+)\s*\*\//);
    if (inlineMatch) {
      sourceMapContent = Buffer.from(inlineMatch[1]!, 'base64').toString('utf-8');
    } else {
      // Try external .map file (production builds)
      const mapPath = `${cssFilePath}.map`;
      if (fs.existsSync(mapPath)) {
        sourceMapContent = fs.readFileSync(mapPath, 'utf-8');
      }
    }

    if (!sourceMapContent) return null;

    const sourceMap = JSON.parse(sourceMapContent);
    const names = sourceMap.names as string[] | undefined;
    if (!names || names.length === 0) return null;

    // Parse the generated CSS to find hashed class names.
    // Walk rules and match positionally with the names array (CSS Modules
    // typically emit selectors in the same order as the original classes).
    const hashedClasses: string[] = [];
    try {
      const root = postcss.parse(sourceMapContent.includes('"sourcesContent"') ? cssSource : '', { from: cssFilePath });
      root.walkRules(rule => {
        walkSelectorClasses(rule.selector, (cls) => {
          hashedClasses.push(cls);
        });
      });
    } catch { /* generated CSS parse failed — fall through */ }

    // If source map has sourcesContent, extract original class names from source.
    if (hashedClasses.length > 0 && names.length > 0) {
      // Heuristic: zip hashed class names with source map names.
      // Full accuracy requires VLQ-decode of the mappings field — the zip
      // heuristic works when CSS Modules emit classes in declaration order.
      for (let i = 0; i < Math.min(hashedClasses.length, names.length); i++) {
        map.set(hashedClasses[i]!, names[i]!);
      }
      return map.size > 0 ? map : null;
    }

    // If no generated CSS (hashed classes not extractable), fall back to
    // reading the sourcesContent to find original names and mapping them
    // via the names array index.
    const sourcesContent = sourceMap.sourcesContent as string[] | undefined;
    if (sourcesContent) {
      for (let si = 0; si < sourcesContent.length; si++) {
        const originalSource = sourcesContent[si];
        if (!originalSource) continue;
        const originalClasses: string[] = [];
        walkSelectorClassesFallback(originalSource, (cls) => originalClasses.push(cls));

        for (let i = 0; i < originalClasses.length; i++) {
          const originalName = names.find(n => n === originalClasses[i]);
          if (originalName) {
            // We have the original name; the hashed name is the one in the
            // generated file. If we have hashed classes, use them; otherwise
            // store original→original as identity (no-op).
            if (i < hashedClasses.length) {
              map.set(hashedClasses[i]!, originalName);
            } else if (i < names.length) {
              map.set(names[i]!, names[i]!);
            }
          }
        }
      }
    }

    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

function walkSelectorClassesFallback(source: string, cb: (cls: string) => void): void {
  const matches = source.match(/\.([a-zA-Z_][\w-]*)/g);
  if (matches) {
    for (const m of matches) cb(m.slice(1));
  }
}

function indexToLine(source: string, index: number): number {
  let count = 1;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) count++;
  }
  return count;
}
