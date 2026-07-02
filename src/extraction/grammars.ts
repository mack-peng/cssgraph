import { Language } from '../types';

export function detectLanguage(filePath: string): Language {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'css': return 'css';
    case 'scss': return 'scss';
    case 'less': return 'less';
    case 'sass': return 'sass';
    case 'pcss': return 'pcss';
    case 'jsx': return 'jsx';
    case 'tsx': return 'tsx';
    default: return 'unknown';
  }
}

export function isSourceFile(filePath: string): boolean {
  const lang = detectLanguage(filePath);
  return lang !== 'unknown';
}

export function isLanguageSupported(lang: Language): boolean {
  return lang === 'css' || lang === 'scss' || lang === 'less' || lang === 'sass' || lang === 'pcss' || lang === 'jsx' || lang === 'tsx';
}

export function isJSXFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext === 'jsx' || ext === 'tsx';
}

export function isFileLevelOnlyLanguage(_lang: Language): boolean {
  return false;
}

export async function initGrammars(): Promise<void> {
  // no-op: PostCSS doesn't need tree-sitter grammars
}

export async function loadGrammarsForLanguages(_langs: Language[]): Promise<void> {
  // no-op
}
