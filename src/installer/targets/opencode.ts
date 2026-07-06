// opencode target.
//
//   - MCP server entry to ~/.config/opencode/opencode.jsonc (global,
//     XDG-style on EVERY platform, Windows included) or
//     ./opencode.jsonc (local). Falls back to opencode.json when a
//     .json file already exists; defaults new installs to .jsonc
//     because that is what opencode itself creates on first run.
//
//   - Instructions to ~/.config/opencode/AGENTS.md (global) or
//     ./AGENTS.md (local). opencode reads AGENTS.md for agent
//     instructions.
//   - No permissions concept.
//
// Config shape uses opencode wrapper:
//   {
//     "$schema": "https://opencode.ai/config.json",
//     "mcp": { "cssgraph": { "type": "local", "command": [...], "enabled": true } }
//   }
//
// Reads and writes go through jsonc-parser so any // and /* *-/ comments
// the user has added to their .jsonc survive idempotent re-runs.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parse as parseJsonc, modify, applyEdits } from 'jsonc-parser';
import {
  AgentTarget,
  DetectionResult,
  InstallOptions,
  Location,
  WriteResult,
} from './types';
import {
  atomicWriteFileSync,
  jsonDeepEqual,
  removeMarkedSection,
  upsertInstructionsEntry,
} from './shared';
import {
  CSSGRAPH_SECTION_END,
  CSSGRAPH_SECTION_START,
} from '../instructions-template';

// opencode stores config at ~/.opencode/opencode.json (current layout)
// or ~/.config/opencode/opencode.jsonc (legacy XDG layout). Detect which
// one is actually in use by checking directory existence.
function globalConfigDir(): string {
  const newStyle = path.join(os.homedir(), '.opencode');
  const xdg = process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim().length > 0
    ? process.env.XDG_CONFIG_HOME
    : path.join(os.homedir(), '.config');
  const legacyStyle = path.join(xdg, 'opencode');

  // Priority: new-style (~/.opencode) if it exists, otherwise legacy.
  // If neither exists, default to new-style (current opencode layout).
  if (fs.existsSync(newStyle)) return newStyle;
  if (fs.existsSync(legacyStyle)) return legacyStyle;
  return newStyle;
}

// Pre-#535 installs wrote the global entry to %%APPDATA%%/opencode — a dir
// today's opencode never reads. Returns that legacy dir when it could hold
// stale state (APPDATA set and resolving somewhere other than the real config dir).
function legacyWindowsConfigDir(): string | null {
  const appData = process.env.APPDATA;
  if (!appData || !appData.trim()) return null;
  const legacy = path.join(appData, 'opencode');
  return path.resolve(legacy) === path.resolve(globalConfigDir()) ? null : legacy;
}

function configBaseDir(loc: Location): string {
  return loc === 'global' ? globalConfigDir() : process.cwd();
}

function configPath(loc: Location): string {
  const dir = configBaseDir(loc);
  const jsonc = path.join(dir, 'opencode.jsonc');
  const json = path.join(dir, 'opencode.json');
  if (fs.existsSync(jsonc)) return jsonc;
  if (fs.existsSync(json)) return json;
  // Default: .jsonc for legacy XDG dir, .json for new-style ~/.opencode
  return dir.endsWith('.opencode') ? json : jsonc;
}

function instructionsPath(loc: Location): string {
  return path.join(configBaseDir(loc), 'AGENTS.md');
}

function readConfigText(file: string): string {
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf-8');
}

function parseConfig(text: string): Record<string, any> {
  if (!text.trim()) return {};
  const errors: any[] = [];
  const result = parseJsonc(text, errors, { allowTrailingComma: true });
  if (result == null || typeof result !== 'object' || Array.isArray(result)) {
    return {};
  }
  return result as Record<string, any>;
}

function getOpencodeServerEntry(): { type: string; command: string[]; enabled: boolean } {
  return {
    type: 'local',
    command: ['cssgraph', 'serve', '--mcp'],
    enabled: true,
  };
}

const FORMATTING = { tabSize: 2, insertSpaces: true, eol: '\n' };

class OpencodeTarget implements AgentTarget {
  readonly id = 'opencode' as const;
  readonly displayName = 'opencode';
  readonly docsUrl = 'https://opencode.ai/docs/config';

  supportsLocation(_loc: Location): boolean {
    return true;
  }

  detect(loc: Location): DetectionResult {
    const file = configPath(loc);
    const config = parseConfig(readConfigText(file));
    const alreadyConfigured = !!config.mcp?.cssgraph;
    const legacy = legacyWindowsConfigDir();
    const installed = loc === 'global'
      ? fs.existsSync(globalConfigDir()) || (!!legacy && fs.existsSync(legacy))
      : fs.existsSync(file);
    return { installed, alreadyConfigured, configPath: file };
  }

  install(loc: Location, _opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];
    files.push(writeMcpEntry(loc));

    // AGENTS.md gets the short marker-fenced cssgraph block:
    // subagents and non-MCP harnesses read AGENTS.md but never the MCP
    // initialize instructions.
    files.push(upsertInstructionsEntry(instructionsPath(loc)));

    // Clean up stale pre-#535 install in %APPDATA%/opencode
    if (loc === 'global') files.push(...cleanupLegacyWindowsState());

    return { files };
  }

  uninstall(loc: Location): WriteResult {
    const files: WriteResult['files'] = [];
    files.push(removeMcpEntryAt(configPath(loc)));
    files.push(removeInstructionsEntry(loc));
    if (loc === 'global') files.push(...cleanupLegacyWindowsState());
    return { files };
  }

  printConfig(loc: Location): string {
    const target = configPath(loc);
    const snippet = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: { cssgraph: getOpencodeServerEntry() },
    }, null, 2);
    return '# Add to ' + target + '\n\n' + snippet + '\n';
  }

  describePaths(loc: Location): string[] {
    return [configPath(loc), instructionsPath(loc)];
  }
}

function writeMcpEntry(loc: Location): WriteResult['files'][number] {
  const file = configPath(loc);
  const existed = fs.existsSync(file);
  let text = readConfigText(file);

  if (!text.trim()) {
    text = '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  }

  const config = parseConfig(text);
  const before = config.mcp?.cssgraph;
  const after = getOpencodeServerEntry();

  if (jsonDeepEqual(before, after)) {
    return { path: file, action: 'unchanged' };
  }

  if (!config.$schema) {
    const schemaEdits = modify(text, ['$schema'], 'https://opencode.ai/config.json', {
      formattingOptions: FORMATTING,
    });
    text = applyEdits(text, schemaEdits);
  }

  // Surgical edit — preserves comments, formatting, and order of
  // every key we do not touch.
  const edits = modify(text, ['mcp', 'cssgraph'], after, {
    formattingOptions: FORMATTING,
  });
  const updated = applyEdits(text, edits);
  atomicWriteFileSync(file, updated);

  return { path: file, action: existed ? 'updated' : 'created' };
}

// Surgically drop mcp.cssgraph from one config file. Leaves sibling
// servers, comments, and formatting untouched; drops an emptied mcp
// wrapper too. Shared by uninstall and the legacy-%%APPDATA%% sweep.
function removeMcpEntryAt(file: string): WriteResult['files'][number] {
  if (!fs.existsSync(file)) return { path: file, action: 'not-found' };
  const text = readConfigText(file);
  const config = parseConfig(text);
  if (!config.mcp?.cssgraph) return { path: file, action: 'not-found' };

  let edits = modify(text, ['mcp', 'cssgraph'], undefined, {
    formattingOptions: FORMATTING,
  });
  let updated = applyEdits(text, edits);

  const afterParsed = parseConfig(updated);
  if (afterParsed.mcp && typeof afterParsed.mcp === 'object' &&
      Object.keys(afterParsed.mcp).length === 0) {
    edits = modify(updated, ['mcp'], undefined, { formattingOptions: FORMATTING });
    updated = applyEdits(updated, edits);
  }

  atomicWriteFileSync(file, updated);
  return { path: file, action: 'removed' };
}

// Remove whatever pre-#535 install left in %APPDATA%/opencode — an MCP
// entry opencode never reads, plus our marker-fenced AGENTS.md block.
function cleanupLegacyWindowsState(): WriteResult['files'] {
  const dir = legacyWindowsConfigDir();
  if (!dir || !fs.existsSync(dir)) return [];
  const out: WriteResult['files'] = [];
  for (const name of ['opencode.jsonc', 'opencode.json']) {
    const res = removeMcpEntryAt(path.join(dir, name));
    if (res.action === 'removed') out.push(res);
  }
  const agents = path.join(dir, 'AGENTS.md');
  const action = removeMarkedSection(agents, CSSGRAPH_SECTION_START, CSSGRAPH_SECTION_END);
  if (action === 'removed') out.push({ path: agents, action });
  return out;
}

// Strip the marker-delimited cssgraph block from AGENTS.md if a prior
// install wrote one. Used by both install (self-heal on upgrade) and uninstall.
function removeInstructionsEntry(loc: Location): WriteResult['files'][number] {
  const file = instructionsPath(loc);
  const action = removeMarkedSection(file, CSSGRAPH_SECTION_START, CSSGRAPH_SECTION_END);
  return { path: file, action };
}

export const opencodeTarget: AgentTarget = new OpencodeTarget();
