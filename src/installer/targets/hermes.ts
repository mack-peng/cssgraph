/**
 * Hermes Agent target.
 *
 *   - MCP server entry to ~/.hermes/mcp.json (global-only).
 *   - Instructions to ~/.hermes/AGENTS.md (global-only).
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

function hermesDir(): string { return path.join(os.homedir(), '.hermes'); }
function mcpPath(): string { return path.join(hermesDir(), 'mcp.json'); }
function agentsPath(): string { return path.join(hermesDir(), 'AGENTS.md'); }

class HermesTarget implements AgentTarget {
  readonly id = 'hermes' as const;
  readonly displayName = 'Hermes Agent';

  supportsLocation(_loc: Location): boolean {
    return _loc === 'global';
  }

  detect(_loc: Location): DetectionResult {
    const dir = hermesDir();
    const installed = fs.existsSync(dir) && !directoryIsCssgraphOnly(dir);
    let alreadyConfigured = false;
    if (fs.existsSync(mcpPath())) {
      const config = readJsonFile(mcpPath());
      alreadyConfigured = !!config.mcpServers?.cssgraph;
    }
    return { installed, alreadyConfigured, configPath: mcpPath() };
  }

  install(_loc: Location, _opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];
    const mp = mcpPath();

    const existed = fs.existsSync(mp);
    const config = readJsonFile(mp);
    const before = config.mcpServers?.cssgraph;
    const after = getMcpServerConfig();

    if (!jsonDeepEqual(before, after)) {
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers.cssgraph = after;
      writeJsonFile(mp, config);
      files.push({ path: mp, action: existed ? 'updated' : 'created' });
    } else {
      files.push({ path: mp, action: 'unchanged' });
    }

    files.push(upsertInstructionsEntry(agentsPath()));

    return { files };
  }

  uninstall(_loc: Location): WriteResult {
    const files: WriteResult['files'] = [];
    const mp = mcpPath();

    if (fs.existsSync(mp)) {
      const config = readJsonFile(mp);
      if (config.mcpServers?.cssgraph) {
        delete config.mcpServers.cssgraph;
        if (Object.keys(config.mcpServers).length === 0) {
          delete config.mcpServers;
        }
        writeJsonFile(mp, config);
        files.push({ path: mp, action: 'removed' });
      } else {
        files.push({ path: mp, action: 'not-found' });
      }
    } else {
      files.push({ path: mp, action: 'not-found' });
    }

    const instructionAction = removeMarkedSection(agentsPath(), CSSGRAPH_SECTION_START, CSSGRAPH_SECTION_END);
    files.push({ path: agentsPath(), action: instructionAction });

    return { files };
  }

  printConfig(_loc: Location): string {
    const snippet = JSON.stringify({ mcpServers: { cssgraph: getMcpServerConfig() } }, null, 2);
    return '# Add to ' + mcpPath() + '\n\n' + snippet + '\n';
  }

  describePaths(_loc: Location): string[] {
    return [mcpPath(), agentsPath()];
  }
}

export const hermesTarget: AgentTarget = new HermesTarget();
