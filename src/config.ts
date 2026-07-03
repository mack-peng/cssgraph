import * as fs from 'fs';
import * as path from 'path';

export interface ProjectConfig {
  exclude?: string[];
  extensions?: Record<string, string>;
}

const DEFAULT_EXCLUDE = [
  '**/*.test.*',
  '**/*.stories.*',
  '**/*.spec.*',
  '**/__tests__/**',
  '**/generated/**',
];

export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = path.join(projectRoot, '.cssgraph.json');
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
    return {
      exclude: parsed.exclude,
      extensions: parsed.extensions,
    };
  } catch {
    return {};
  }
}

export function getDefaultExcludes(): string[] {
  return [...DEFAULT_EXCLUDE];
}

export function getMergedExcludes(projectRoot: string): string[] {
  const config = loadProjectConfig(projectRoot);
  return [...DEFAULT_EXCLUDE, ...(config.exclude ?? [])];
}
