/**
 * Cursor target.
 *
 *   - MCP server entry to `~/.cursor/mcp.json` (global) or
 *     `./.cursor/mcp.json` (local).
 *   - Supports both locations.
 *
 * Cursor launches MCP subprocesses with the wrong cwd and doesn't pass
 * `rootUri` in `initialize`. The installer injects `--path` into
 * Cursor's MCP args — absolute path for local installs,
 * `${workspaceFolder}` for global installs.
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
  readJsonFile,
  writeJsonFile,
} from './shared';

function configDir(loc: Location): string {
  return loc === 'global'
    ? path.join(os.homedir(), '.cursor')
    : path.join(process.cwd(), '.cursor');
}

function mcpJsonPath(loc: Location): string {
  return path.join(configDir(loc), 'mcp.json');
}

function getCursorServerEntry(loc: Location) {
  const base = getMcpServerConfig();
  // Cursor needs --path to resolve the project root correctly because
  // it launches MCP subprocesses with the wrong cwd.
  const args = [...base.args];
  if (loc === 'local') {
    args.push('--path', process.cwd());
  } else {
    args.push('--path', '${workspaceFolder}');
  }
  return { ...base, args };
}

class CursorTarget implements AgentTarget {
  readonly id = 'cursor' as const;
  readonly displayName = 'Cursor';
  readonly docsUrl = 'https://docs.cursor.com';

  supportsLocation(_loc: Location): boolean {
    return true;
  }

  detect(loc: Location): DetectionResult {
    const file = mcpJsonPath(loc);
    const config = readJsonFile(file);
    const alreadyConfigured = !!config.mcpServers?.cssgraph;
    const installed = loc === 'global'
      ? fs.existsSync(configDir(loc))
      : fs.existsSync(file) || fs.existsSync(configDir(loc));
    return { installed, alreadyConfigured, configPath: file };
  }

  install(loc: Location, _opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];
    const file = mcpJsonPath(loc);
    const existed = fs.existsSync(file);
    const config = readJsonFile(file);

    const before = config.mcpServers?.cssgraph;
    const after = getCursorServerEntry(loc);

    if (jsonDeepEqual(before, after)) {
      files.push({ path: file, action: 'unchanged' });
      return { files };
    }

    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers.cssgraph = after;
    writeJsonFile(file, config);

    files.push({ path: file, action: existed ? 'updated' : 'created' });
    return { files };
  }

  uninstall(loc: Location): WriteResult {
    const files: WriteResult['files'] = [];
    const file = mcpJsonPath(loc);

    if (!fs.existsSync(file)) {
      files.push({ path: file, action: 'not-found' });
      return { files };
    }

    const config = readJsonFile(file);
    if (!config.mcpServers?.cssgraph) {
      files.push({ path: file, action: 'not-found' });
      return { files };
    }

    delete config.mcpServers.cssgraph;
    if (Object.keys(config.mcpServers).length === 0) {
      delete config.mcpServers;
    }
    writeJsonFile(file, config);
    files.push({ path: file, action: 'removed' });
    return { files };
  }

  printConfig(loc: Location): string {
    const target = mcpJsonPath(loc);
    const snippet = JSON.stringify(
      { mcpServers: { cssgraph: getCursorServerEntry(loc) } },
      null,
      2,
    );
    return `# Add to ${target}\n\n${snippet}\n`;
  }

  describePaths(loc: Location): string[] {
    return [mcpJsonPath(loc)];
  }
}

export const cursorTarget: AgentTarget = new CursorTarget();
