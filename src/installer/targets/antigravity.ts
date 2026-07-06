/**
 * Antigravity IDE target.
 *
 *   - MCP server entry to ~/.kiro/steering/mcp.json (global-only).
 *   - No project-local config as of 2026.
 *   - No instructions file concept.
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
} from './shared';

function antigravityDir(): string { return path.join(os.homedir(), '.kiro'); }
function steeringDir(): string { return path.join(antigravityDir(), 'steering'); }
function mcpPath(): string { return path.join(steeringDir(), 'mcp.json'); }

class AntigravityTarget implements AgentTarget {
  readonly id = 'antigravity' as const;
  readonly displayName = 'Antigravity IDE';

  supportsLocation(_loc: Location): boolean {
    return _loc === 'global';
  }

  detect(_loc: Location): DetectionResult {
    const dir = antigravityDir();
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

    return { files };
  }

  printConfig(_loc: Location): string {
    const snippet = JSON.stringify({ mcpServers: { cssgraph: getMcpServerConfig() } }, null, 2);
    return '# Add to ' + mcpPath() + '\n\n' + snippet + '\n';
  }

  describePaths(_loc: Location): string[] {
    return [mcpPath()];
  }
}

export const antigravityTarget: AgentTarget = new AntigravityTarget();
