import * as path from 'path';
import * as fs from 'fs';
import ignore, { Ignore } from 'ignore';
import { isInitialized, findNearestCodeGraphRoot } from './directory';

export function loadExcludePatterns(projectRoot: string): Ignore {
  const ig = ignore();

  ig.add([
    'node_modules',
    'dist',
    'build',
    '.git',
    '.next',
    '.nuxt',
    '.output',
    '.venv',
    'vendor',
    'target',
    'Pods',
    '.cssgraph',
    '.codegraph',
  ]);

  const gitignorePath = path.join(projectRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    try {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      ig.add(content);
    } catch { /* ignore */ }
  }

  const configPath = path.join(projectRoot, '.cssgraph.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (Array.isArray(config.exclude)) {
        ig.add(config.exclude);
      }
    } catch { /* ignore */ }
  }

  return ig;
}

export function loadExtensionOverrides(projectRoot: string): Record<string, string> {
  const configPath = path.join(projectRoot, '.cssgraph.json');
  if (!fs.existsSync(configPath)) return {};

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.extensions && typeof config.extensions === 'object') {
      return config.extensions as Record<string, string>;
    }
  } catch { /* ignore */ }

  return {};
}

export function planFrontload(cwd: string, _prompt: string): { exploreRoot: string | null; nudgeProjects: string[]; viaSubScan: boolean } {
  const root = findNearestCodeGraphRoot(cwd);
  if (root) return { exploreRoot: root, nudgeProjects: [], viaSubScan: false };

  const resolvedCwd = path.resolve(cwd);
  if (!fs.existsSync(resolvedCwd)) return { exploreRoot: null, nudgeProjects: [], viaSubScan: false };

  const childProjects: string[] = [];
  try {
    for (const entry of fs.readdirSync(resolvedCwd, { withFileTypes: true })) {
      if (entry.isDirectory() && isInitialized(path.join(resolvedCwd, entry.name))) {
        childProjects.push(path.join(resolvedCwd, entry.name));
      }
    }
  } catch { /* ignore */ }

  return { exploreRoot: null, nudgeProjects: childProjects, viaSubScan: false };
}

export function isStructuralKeyword(_prompt: string): boolean {
  return false;
}

export function extractCodeTokens(_prompt: string): string[] {
  return [];
}
