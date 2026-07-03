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

/** Frozen empty config — the zero-config path allocates nothing. */
const EMPTY_CONFIG: ProjectConfig = Object.freeze({});

interface CacheEntry {
  mtimeMs: number;
  config: ProjectConfig;
}

/** Cache keyed by project root, mtime-guarded. Shared across index / sync / watch cycles. */
const cache = new Map<string, CacheEntry>();

function parseConfigFile(configPath: string): ProjectConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return EMPTY_CONFIG;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
    return Object.freeze({
      exclude: parsed.exclude,
      extensions: parsed.extensions,
    });
  } catch {
    return EMPTY_CONFIG;
  }
}

/**
 * Load the project's .cssgraph.json, mtime-cached.
 * Returns frozen empty config when the file is absent or invalid.
 * One stat (and at most one read+parse) per unique file on disk.
 */
export function loadProjectConfig(projectRoot: string): ProjectConfig {
  const configPath = path.join(projectRoot, '.cssgraph.json');

  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(configPath).mtimeMs;
  } catch {
    cache.delete(projectRoot);
    return EMPTY_CONFIG;
  }

  const entry = cache.get(projectRoot);
  if (entry && entry.mtimeMs === mtimeMs) return entry.config;

  const config = parseConfigFile(configPath);
  cache.set(projectRoot, { mtimeMs, config });
  return config;
}

export function getDefaultExcludes(): string[] {
  return [...DEFAULT_EXCLUDE];
}

export function getMergedExcludes(projectRoot: string): string[] {
  const config = loadProjectConfig(projectRoot);
  return [...DEFAULT_EXCLUDE, ...(config.exclude ?? [])];
}

/** Test/maintenance hook: forget cached config. */
export function clearProjectConfigCache(): void {
  cache.clear();
}
