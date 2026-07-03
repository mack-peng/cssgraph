/**
 * Git-aware file discovery — uses `git ls-files` as the primary file source
 * and falls back to a filesystem walk when git is unavailable.
 *
 * `git ls-files --cached --others --exclude-standard` returns every
 * git-tracked and untracked-but-not-ignored file in one shot, null-separated
 * so compound file names (spaces, newlines) survive intact. This is
 * substantially faster than a recursive `readdir`+`.gitignore` walk for large
 * repos and automatically respects `.gitignore` / `.git/info/exclude` rules
 * without needing the `ignore` library.
 */

import { execFileSync } from 'child_process';

/**
 * Return the set of project-root-relative file paths visible to git
 * (tracked + untracked but not gitignored). Returns `null` when git is not
 * available or the directory is not in a git repository — callers fall back
 * to a plain filesystem walk.
 */
export function getGitVisibleFiles(rootDir: string): string[] | null {
  try {
    // -z       : NUL-delimited output (safe for filenames with spaces/newlines)
    // --cached : tracked files (HEAD index)
    // --others : untracked files that are NOT gitignored
    // --exclude-standard : respect .gitignore, .git/info/exclude, etc.
    const stdout = execFileSync('git', [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
    ], {
      cwd: rootDir,
      maxBuffer: 200 * 1024 * 1024, // 200 MB — enough for ~2M file paths
      encoding: 'buffer',
    });

    return (stdout as Buffer)
      .toString('utf-8')
      .split('\0')
      .map(p => p.replace(/\\/g, '/'))
      .filter(Boolean);
  } catch {
    return null;
  }
}
