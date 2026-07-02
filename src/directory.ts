import * as path from 'path';
import * as fs from 'fs';

export const CODEGRAPH_DIR = '.cssgraph';

export function getCodeGraphDir(projectRoot: string): string {
  return path.join(projectRoot, CODEGRAPH_DIR);
}

export function isInitialized(projectRoot: string): boolean {
  const dbPath = path.join(getCodeGraphDir(projectRoot), 'cssgraph.db');
  return fs.existsSync(dbPath);
}

export function createDirectory(projectRoot: string): void {
  const dir = getCodeGraphDir(projectRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function removeDirectory(projectRoot: string): void {
  const dir = getCodeGraphDir(projectRoot);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export interface DirectoryValidation {
  valid: boolean;
  errors: string[];
}

export function validateDirectory(projectRoot: string): DirectoryValidation {
  const errors: string[] = [];
  const dir = getCodeGraphDir(projectRoot);

  if (!fs.existsSync(dir)) {
    errors.push(`.cssgraph directory not found in ${projectRoot}`);
    return { valid: false, errors };
  }

  const dbPath = path.join(dir, 'cssgraph.db');
  if (!fs.existsSync(dbPath)) {
    errors.push('cssgraph.db not found');
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

export function findNearestCodeGraphRoot(startPath: string): string | null {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;

  while (true) {
    if (isInitialized(current)) return current;
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

export function isCodeGraphDataDir(dirName: string): boolean {
  return dirName.startsWith('.cssgraph');
}

export function unsafeIndexRootReason(projectPath: string): string | null {
  const resolved = path.resolve(projectPath);
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (resolved === home) return 'your home directory';
  if (resolved === path.parse(resolved).root) return 'a filesystem root';
  return null;
}
