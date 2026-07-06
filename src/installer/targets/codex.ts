/**
 * Codex CLI target. Writes:
 *
 *   - MCP server entry to `~/.codex/config.toml` (global-only).
 *   - Instructions to `~/.codex/AGENTS.md`.
 *
 * Codex uses TOML for its config and has no project-local config concept
 * as of 2026 — only a single `~/.codex/` directory is read.
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
  atomicWriteFileSync,
  directoryIsCssgraphOnly,
  upsertInstructionsEntry,
  removeMarkedSection,
} from './shared';
import {
  buildTomlTable,
  upsertTomlTable,
  removeTomlTable,
} from './toml';
import {
  CSSGRAPH_SECTION_END,
  CSSGRAPH_SECTION_START,
} from '../instructions-template';

function codexDir(): string { return path.join(os.homedir(), '.codex'); }
function configPathRef(): string { return path.join(codexDir(), 'config.toml'); }
function agentsPathRef(): string { return path.join(codexDir(), 'AGENTS.md'); }
const TABLE_HEADER = 'mcp_servers.cssgraph';

function getTomlEntry(): Record<string, string | string[]> {
  return {
    type: 'stdio',
    command: 'cssgraph',
    args: ['serve', '--mcp'],
  };
}

class CodexTarget implements AgentTarget {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex CLI';
  readonly docsUrl = 'https://github.com/openai/codex';

  supportsLocation(_loc: Location): boolean {
    return _loc === 'global';
  }

  detect(_loc: Location): DetectionResult {
    const dir = codexDir();
    const installed = fs.existsSync(dir) && !directoryIsCssgraphOnly(dir);
    let alreadyConfigured = false;
    if (fs.existsSync(configPathRef())) {
      const content = fs.readFileSync(configPathRef(), 'utf-8');
      alreadyConfigured = content.includes(`[${TABLE_HEADER}]`);
    }
    return { installed, alreadyConfigured, configPath: configPathRef() };
  }

  install(_loc: Location, _opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];
    const cfgPath = configPathRef();

    const block = buildTomlTable(TABLE_HEADER, getTomlEntry());
    const existed = fs.existsSync(cfgPath);
    const content = existed ? fs.readFileSync(cfgPath, 'utf-8') : '';
    const result = upsertTomlTable(content, TABLE_HEADER, block);

    if (result.action !== 'unchanged') {
      atomicWriteFileSync(cfgPath, result.content);
    }
    files.push({
      path: cfgPath,
      action: result.action === 'inserted' ? (existed ? 'updated' : 'created') :
              result.action === 'replaced' ? 'updated' :
              result.action as 'unchanged',
    });

    files.push(upsertInstructionsEntry(agentsPathRef()));

    return { files };
  }

  uninstall(_loc: Location): WriteResult {
    const files: WriteResult['files'] = [];
    const cfgPath = configPathRef();

    if (fs.existsSync(cfgPath)) {
      const content = fs.readFileSync(cfgPath, 'utf-8');
      const result = removeTomlTable(content, TABLE_HEADER);
      if (result.action === 'removed') {
        atomicWriteFileSync(cfgPath, result.content);
        files.push({ path: cfgPath, action: 'removed' });
      } else {
        files.push({ path: cfgPath, action: 'not-found' });
      }
    } else {
      files.push({ path: cfgPath, action: 'not-found' });
    }

    const instructionAction = removeMarkedSection(agentsPathRef(), CSSGRAPH_SECTION_START, CSSGRAPH_SECTION_END);
    files.push({ path: agentsPathRef(), action: instructionAction });

    return { files };
  }

  printConfig(_loc: Location): string {
    const snippet = buildTomlTable(TABLE_HEADER, getTomlEntry());
    return `# Add to ${configPathRef()}\n\n${snippet}\n`;
  }

  describePaths(_loc: Location): string[] {
    return [configPathRef(), agentsPathRef()];
  }
}

export const codexTarget: AgentTarget = new CodexTarget();
