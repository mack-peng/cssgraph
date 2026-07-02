import postcss from 'postcss';

export interface ModuleMapping {
  sourceFile: string;
  originalName: string;
  hashedName: string;
  properties: Array<{ prop: string; value: string }>;
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
