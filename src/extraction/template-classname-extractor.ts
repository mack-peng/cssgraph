export interface ClassNameReference {
  className: string;
  filePath: string;
  line: number;
}

export function extractTemplateClassNameUsage(
  source: string,
  filePath: string,
): ClassNameReference[] {
  const results: ClassNameReference[] = [];
  const seen = new Set<string>();
  const ext = filePath.split('.').pop()?.toLowerCase();

  const add = (className: string, line: number) => {
    const key = `${className}:${line}`;
    if (seen.has(key)) return;
    if (!/^[A-Za-z0-9_-]+$/.test(className)) return;
    seen.add(key);
    results.push({ className, filePath, line });
  };

  const addAll = (value: string, line: number) => {
    for (const cls of value.split(/\s+/).map(s => s.trim()).filter(Boolean)) {
      add(cls, line);
    }
  };

  // Strategy 1: class="..." / class='...' HTML attribute (all file types).
  const attrPattern = /\bclass\s*=\s*"([^"]*)"|class\s*=\s*'([^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(source)) !== null) {
    const line = source.slice(0, match.index).split('\n').length;
    const value = match[1] ?? match[2]!;
    addAll(value, line);
  }

  // Strategy 2: Haml dot-shorthand .classname (haml only).
  if (ext === 'haml') {
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (trimmed.startsWith('-') || trimmed.startsWith('=') || trimmed === '') continue;
      const dotMatch = lines[i]!.matchAll(/\.([\w-]+)/g);
      for (const m of dotMatch) {
        add(m[1]!, i + 1);
      }
    }
  }

  // Strategy 3: Haml hash syntax {:class => "..."} / {class: "..."} (haml only).
  // Handles both hash-rocket (:class => "foo") and Ruby 1.9+ colon (class: "foo").
  if (ext === 'haml') {
    const hashPattern = /[{,]\s*(?::)?class\s*(?:=>|:)\s*["']([^"']*)["']/g;
    while ((match = hashPattern.exec(source)) !== null) {
      const line = source.slice(0, match.index).split('\n').length;
      addAll(match[1]!, line);
    }
  }

  return results;
}
