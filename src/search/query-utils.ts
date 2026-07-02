export function normalizeNameToken(name: string): string {
  return name.replace(/^[.#]/, '');
}

export function isTestFile(filePath: string): boolean {
  return /\.(test|spec)\./.test(filePath) || filePath.includes('__tests');
}

export function deriveProjectNameTokens(projectRoot: string): Set<string> {
  const tokens = new Set<string>();
  try {
    const parts = projectRoot.split(/[/\\]/);
    const name = parts[parts.length - 1] || '';
    tokens.add(name.toLowerCase());
  } catch { /* ignore */ }
  return tokens;
}
