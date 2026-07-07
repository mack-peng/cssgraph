import { Language } from '../types';

export function detectLanguage(filePath: string): Language {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'css': return 'css';
    case 'scss': return 'scss';
    case 'less': return 'less';
    case 'sass': return 'sass';
    case 'pcss': return 'pcss';
    case 'js': return 'js';
    case 'ts': return 'ts';
    case 'jsx': return 'jsx';
    case 'tsx': return 'tsx';
    case 'es6': return 'es6';
    case 'erb': return 'erb';
    case 'haml': return 'haml';
    case 'html': return 'html';
    default: return 'unknown';
  }
}

export function isSourceFile(filePath: string): boolean {
  const lang = detectLanguage(filePath);
  return lang !== 'unknown';
}

export function isLanguageSupported(lang: Language): boolean {
  return lang === 'css' || lang === 'scss' || lang === 'less' || lang === 'sass' || lang === 'pcss' ||
    lang === 'js' || lang === 'ts' || lang === 'jsx' || lang === 'tsx' || lang === 'es6' ||
    lang === 'erb' || lang === 'haml' || lang === 'html';
}

export function isJSXFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext === 'jsx' || ext === 'tsx' || ext === 'es6' || ext === 'js' || ext === 'ts';
}

export function isViewFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext === 'erb' || ext === 'haml' || ext === 'html';
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
