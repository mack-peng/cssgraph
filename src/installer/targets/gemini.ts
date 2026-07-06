/**
 * Gemini CLI target.
 *
 *   - MCP server entry to `~/.gemini/mcp_settings.json` (global-only).
 *   - Instructions to `~/.gemini/GEMINI.md` (global-only).
 *   - No project-local config as of 2026.
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
  getMcpServerConfig,
  jsonDeepEqual,
  directoryIsCssgraphOnly,
  readJsonFile,
  writeJsonFile,
  upsertInstructionsEntry,
  removeMarkedSection,
} from './shared';
import {
  CSSGRAPH_SECTION_END,
  CSSGRAPH_SECTION_START,
} from '../instructions-template';

function geminiDir(): string { return path.join(os.homedir(), '.gemini'); }
function mcpPathRef(): string { return path.join(geminiDir(), 'mcp_settings.json'); }
function instructionsPathRef(): string { return path.join(geminiDir(), 'GEMINI.md'); }

class GeminiTarget implements AgentTarget {
  readonly id = 'gemini' as const;
  readonly displayName = 'Gemini CLI';
  readonly docsUrl = 'https://google-gemini.github.io/gemini-cli';

  supportsLocation(_loc: Location): boolean {
    return _loc === 'global';
  }

  detect(_loc: Location): DetectionResult {
    const dir = geminiDir();
    const installed = fs.existsSync(dir) && !directoryIsCssgraphOnly(dir);
    let alreadyConfigured = false;
    if (fs.existsSync(mcpPathRef())) {
      const config = readJsonFile(mcpPathRef());
      alreadyConfigured = !!config.mcpServers?.cssgraph;
    }
    return { installed, alreadyConfigured, configPath: mcpPathRef() };
  }

  install(_loc: Location, _opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];
    const mcpPath = mcpPathRef();

    const existed = fs.existsSync(mcpPath);
    const config = readJsonFile(mcpPath);
    const before = config.mcpServers?.cssgraph;
    const after = getMcpServerConfig();

    if (!jsonDeepEqual(before, after)) {
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers.cssgraph = after;
      writeJsonFile(mcpPath, config);
      files.push({ path: mcpPath, action: existed ? 'updated' : 'created' });
    } else {
      files.push({ path: mcpPath, action: 'unchanged' });
    }

    files.push(upsertInstructionsEntry(instructionsPathRef()));

    return { files };
  }

  uninstall(_loc: Location): WriteResult {
    const files: WriteResult['files'] = [];
    const mcpPath = mcpPathRef();

    if (fs.existsSync(mcpPath)) {
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
    } else {
      files.push({ path: mcpPath, action: 'not-found' });
    }

    const instructionAction = removeMarkedSection(instructionsPathRef(), CSSGRAPH_SECTION_START, CSSGRAPH_SECTION_END);
    files.push({ path: instructionsPathRef(), action: instructionAction });

    return { files };
  }

  printConfig(_loc: Location): string {
    const snippet = JSON.stringify({ mcpServers: { cssgraph: getMcpServerConfig() } }, null, 2);
    return `# Add to ${mcpPathRef()}\n\n${snippet}\n`;
  }

  describePaths(_loc: Location): string[] {
    return [mcpPathRef(), instructionsPathRef()];
  }
}

export const geminiTarget: AgentTarget = new GeminiTarget();
