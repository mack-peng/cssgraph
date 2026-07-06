/**
 * Claude Code target. Writes:
 *
 *   - MCP server entry to `~/.claude.json` (global = user scope) or
 *     `./.mcp.json` (local = project scope).
 *   - Permissions to `~/.claude/settings.json` (global) or
 *     `./.claude/settings.json` (local), gated on `autoAllow`.
 *   - Instructions to `~/.claude/CLAUDE.md` (global) or
 *     `./.claude/CLAUDE.md` (local).
 *
 * Earlier versions wrote the local MCP entry to `./.claude.json` — a
 * file Claude Code never reads — so we now write `./.mcp.json` and
 * migrate any stale `./.claude.json` entry out of the way on install
 * and uninstall.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  WriteResult,
} from './types';
import {
  getCodeGraphPermissions,
  getMcpServerConfig,
  jsonDeepEqual,
  readJsonFile,
  removeMarkedSection,
  writeJsonFile,
  upsertInstructionsEntry,
} from './shared';
import {
  CSSGRAPH_SECTION_END,
  CSSGRAPH_SECTION_START,
} from '../instructions-template';

function configDir(loc: Location): string {
  return loc === 'global'
    ? path.join(os.homedir(), '.claude')
    : path.join(process.cwd(), '.claude');
}

function mcpJsonPath(loc: Location): string {
  return loc === 'global'
    ? path.join(os.homedir(), '.claude.json')
    : path.join(process.cwd(), '.mcp.json');
}

function legacyLocalMcpPath(): string {
  return path.join(process.cwd(), '.claude.json');
}

function settingsJsonPath(loc: Location): string {
  return path.join(configDir(loc), 'settings.json');
}

function instructionsPath(loc: Location): string {
  return path.join(configDir(loc), 'CLAUDE.md');
}

/**
 * Legacy codegraph auto-sync hook commands that pre-0.8 installs wrote.
 * Matching on substring to catch both bare `codegraph mark-dirty` and
 * `npx @colbymchenry/codegraph …` forms.
 */
const LEGACY_HOOK_MARKERS = ['codegraph mark-dirty', 'codegraph sync-if-dirty'];

function isLegacyCodegraphHookCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  return LEGACY_HOOK_MARKERS.some((m) => command.includes(m));
}

const PROMPT_HOOK_COMMAND = 'cssgraph prompt-hook';
function isPromptHookCommand(command: unknown): boolean {
  return typeof command === 'string' && command.includes(PROMPT_HOOK_COMMAND);
}

class ClaudeCodeTarget implements AgentTarget {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude Code';
  readonly docsUrl = 'https://docs.claude.com/en/docs/claude-code';

  supportsLocation(_loc: Location): boolean {
    return true;
  }

  detect(loc: Location): DetectionResult {
    const mcpPath = mcpJsonPath(loc);
    const config = readJsonFile(mcpPath);
    const alreadyConfigured = !!config.mcpServers?.cssgraph;
    const installed = fs.existsSync(configDir(loc)) || fs.existsSync(mcpPath);
    return { installed, alreadyConfigured, configPath: mcpPath };
  }

  install(loc: Location, opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];

    // 1. MCP server entry
    files.push(writeMcpEntry(loc));

    // 1b. Migrate stale ./.claude.json from pre-#207 local install
    if (loc === 'local') {
      const migrated = cleanupLegacyLocalMcp();
      if (migrated) files.push(migrated);
    }

    // 2. Permissions (only when autoAllow)
    if (opts.autoAllow) {
      files.push(writePermissionsEntry(loc));
    }

    // 2b. Strip stale auto-sync hooks from pre-0.8 install
    const hookCleanup = cleanupLegacyHooks(loc);
    if (hookCleanup.action === 'removed') files.push(hookCleanup);

    // 2c. Front-load prompt hook (Claude UserPromptSubmit)
    if (opts.promptHook === true) {
      files.push(writePromptHookEntry(loc));
    } else if (opts.promptHook === false) {
      const removed = removePromptHookEntry(loc);
      if (removed.action === 'removed') files.push(removed);
    }

    // 3. CLAUDE.md instructions
    files.push(upsertInstructionsEntry(instructionsPath(loc)));

    return { files };
  }

  uninstall(loc: Location): WriteResult {
    const files: WriteResult['files'] = [];

    // 1. MCP server entry
    const mcpPath = mcpJsonPath(loc);
    const config = readJsonFile(mcpPath);
    if (config.mcpServers?.cssgraph) {
      delete config.mcpServers.cssgraph;
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers;
      }
      writeJsonFile(mcpPath, config);
      files.push({ path: mcpPath, action: 'removed' });
    } else {
      files.push({ path: mcpPath, action: 'not-found' });
    }

    // 1b. Strip legacy local MCP entry
    if (loc === 'local') {
      const migrated = cleanupLegacyLocalMcp();
      if (migrated) files.push(migrated);
    }

    // 2. Permissions
    const settingsPath = settingsJsonPath(loc);
    const settings = readJsonFile(settingsPath);
    if (Array.isArray(settings.permissions?.allow)) {
      const before = settings.permissions.allow.length;
      settings.permissions.allow = settings.permissions.allow.filter(
        (p: string) => !p.startsWith('mcp__cssgraph__'),
      );
      if (settings.permissions.allow.length !== before) {
        if (settings.permissions.allow.length === 0) {
          delete settings.permissions.allow;
        }
        if (Object.keys(settings.permissions).length === 0) {
          delete settings.permissions;
        }
        writeJsonFile(settingsPath, settings);
        files.push({ path: settingsPath, action: 'removed' });
      } else {
        files.push({ path: settingsPath, action: 'not-found' });
      }
    } else {
      files.push({ path: settingsPath, action: 'not-found' });
    }

    // 2b. Strip stale auto-sync hooks
    const hookCleanup = cleanupLegacyHooks(loc);
    if (hookCleanup.action === 'removed') files.push(hookCleanup);

    // 2c. Remove prompt hook
    const promptHookCleanup = removePromptHookEntry(loc);
    if (promptHookCleanup.action === 'removed') files.push(promptHookCleanup);

    // 3. Instructions
    files.push(removeInstructionsEntry(loc));

    return { files };
  }

  printConfig(loc: Location): string {
    const target = mcpJsonPath(loc);
    const snippet = JSON.stringify({ mcpServers: { cssgraph: getMcpServerConfig() } }, null, 2);
    return `# Add to ${target}\n\n${snippet}\n`;
  }

  describePaths(loc: Location): string[] {
    return [mcpJsonPath(loc), settingsJsonPath(loc), instructionsPath(loc)];
  }
}

/**
 * Per-file write helpers, exported so external callers can write
 * only the named operation instead of the full multi-file install.
 */
export function writeMcpEntry(loc: Location): WriteResult['files'][number] {
  const file = mcpJsonPath(loc);
  const existing = readJsonFile(file);
  const before = existing.mcpServers?.cssgraph;
  const after = getMcpServerConfig();

  if (jsonDeepEqual(before, after)) {
    return { path: file, action: 'unchanged' };
  }

  const action: 'created' | 'updated' = before ? 'updated' : (fs.existsSync(file) ? 'updated' : 'created');
  if (!existing.mcpServers) existing.mcpServers = {};
  existing.mcpServers.cssgraph = after;
  writeJsonFile(file, existing);
  return { path: file, action };
}

/**
 * Strip the cssgraph entry from a legacy project-local `./.claude.json`.
 */
function cleanupLegacyLocalMcp(): WriteResult['files'][number] | null {
  const file = legacyLocalMcpPath();
  if (!fs.existsSync(file)) return null;
  const config = readJsonFile(file);
  if (!config.mcpServers?.cssgraph) return null;
  delete config.mcpServers.cssgraph;
  if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers;
  if (Object.keys(config).length === 0) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
  } else {
    writeJsonFile(file, config);
  }
  return { path: file, action: 'removed' };
}

function removeHookCommandsMatching(
  loc: Location,
  match: (command: unknown) => boolean,
): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  if (!fs.existsSync(file)) return { path: file, action: 'not-found' };

  const settings = readJsonFile(file);
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return { path: file, action: 'unchanged' };
  }

  let removedAny = false;
  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || !Array.isArray(group.hooks)) continue;
      const before = group.hooks.length;
      group.hooks = group.hooks.filter((h: any) => !match(h?.command));
      if (group.hooks.length !== before) removedAny = true;
    }
  }

  if (!removedAny) return { path: file, action: 'unchanged' };

  for (const event of Object.keys(hooks)) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;
    hooks[event] = groups.filter(
      (g: any) => !(g && Array.isArray(g.hooks) && g.hooks.length === 0),
    );
    if (hooks[event].length === 0) delete hooks[event];
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;

  writeJsonFile(file, settings);
  return { path: file, action: 'removed' };
}

export function cleanupLegacyHooks(loc: Location): WriteResult['files'][number] {
  return removeHookCommandsMatching(loc, isLegacyCodegraphHookCommand);
}

export function removePromptHookEntry(loc: Location): WriteResult['files'][number] {
  return removeHookCommandsMatching(loc, isPromptHookCommand);
}

export function writePermissionsEntry(loc: Location): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  const settings = readJsonFile(file);
  const created = !fs.existsSync(file);

  if (!settings.permissions) settings.permissions = {};
  if (!Array.isArray(settings.permissions.allow)) settings.permissions.allow = [];

  const want = getCodeGraphPermissions();
  const before = [...settings.permissions.allow];
  for (const perm of want) {
    if (!settings.permissions.allow.includes(perm)) {
      settings.permissions.allow.push(perm);
    }
  }
  if (jsonDeepEqual(before, settings.permissions.allow) && !created) {
    return { path: file, action: 'unchanged' };
  }
  writeJsonFile(file, settings);
  return { path: file, action: created ? 'created' : 'updated' };
}

export function writePromptHookEntry(loc: Location): WriteResult['files'][number] {
  const file = settingsJsonPath(loc);
  const created = !fs.existsSync(file);
  const settings = readJsonFile(file);

  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }
  if (!Array.isArray(settings.hooks.UserPromptSubmit)) settings.hooks.UserPromptSubmit = [];

  const already = settings.hooks.UserPromptSubmit.some(
    (g: any) => g && Array.isArray(g.hooks) && g.hooks.some((h: any) => isPromptHookCommand(h?.command)),
  );
  if (already) return { path: file, action: 'unchanged' };

  settings.hooks.UserPromptSubmit.push({
    hooks: [{ type: 'command', command: PROMPT_HOOK_COMMAND }],
  });
  writeJsonFile(file, settings);
  return { path: file, action: created ? 'created' : 'updated' };
}

export function removeInstructionsEntry(loc: Location): WriteResult['files'][number] {
  const file = instructionsPath(loc);
  const action = removeMarkedSection(file, CSSGRAPH_SECTION_START, CSSGRAPH_SECTION_END);
  return { path: file, action };
}

export const claudeTarget: AgentTarget = new ClaudeCodeTarget();
