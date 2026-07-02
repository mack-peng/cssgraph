import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentTarget, DetectionResult, InstallOptions, Location, WriteResult } from './types';
import { atomicWriteFileSync, jsonDeepEqual } from './shared';

function globalConfigPath(): string {
  return path.join(os.homedir(), '.claude.json');
}

function localConfigPath(): string {
  return path.join(process.cwd(), '.claude', 'mcp.json');
}

function configPath(loc: Location): string {
  return loc === 'global' ? globalConfigPath() : localConfigPath();
}

function settingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function getServerEntry() {
  return {
    type: 'stdio',
    command: 'cssgraph',
    args: ['serve', '--mcp'],
  };
}

class ClaudeTarget implements AgentTarget {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude Code';
  readonly docsUrl = 'https://docs.anthropic.com/en/docs/claude-code';

  supportsLocation(loc: Location): boolean {
    return loc === 'global';
  }

  detect(loc: Location): DetectionResult {
    const file = configPath(loc);
    const installed = fs.existsSync(file);
    let alreadyConfigured = false;
    if (installed) {
      try {
        const config = JSON.parse(fs.readFileSync(file, 'utf-8'));
        alreadyConfigured = !!config.mcpServers?.cssgraph;
      } catch { /* ignore */ }
    }
    return { installed, alreadyConfigured, configPath: file };
  }

  install(loc: Location, opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];
    files.push(writeMcpEntry(loc));

    if (opts.autoAllow) {
      files.push(writePermissions());
    }

    return { files };
  }

  uninstall(loc: Location): WriteResult {
    const files: WriteResult['files'] = [];
    files.push(removeMcpEntry(loc));
    files.push(removePermissions());
    return { files };
  }

  printConfig(loc: Location): string {
    const snippet = JSON.stringify({
      mcpServers: { cssgraph: getServerEntry() },
    }, null, 2);
    return `# Add to ${configPath(loc)}\n\n${snippet}\n`;
  }
}

function writeMcpEntry(loc: Location): WriteResult['files'][number] {
  const file = configPath(loc);
  const existed = fs.existsSync(file);

  let config: Record<string, any> = {};
  if (existed) {
    try { config = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { /* use empty */ }
  }

  const before = config.mcpServers?.cssgraph;
  const after = getServerEntry();

  if (jsonDeepEqual(before, after)) {
    return { path: file, action: 'unchanged' };
  }

  if (!config.mcpServers) config.mcpServers = {};
  config.mcpServers.cssgraph = after;

  atomicWriteFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return { path: file, action: existed ? 'updated' : 'created' };
}

function removeMcpEntry(loc: Location): WriteResult['files'][number] {
  const file = configPath(loc);
  if (!fs.existsSync(file)) return { path: file, action: 'not-found' };

  let config: Record<string, any> = {};
  try { config = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return { path: file, action: 'not-found' }; }

  if (!config.mcpServers?.cssgraph) return { path: file, action: 'not-found' };
  delete config.mcpServers.cssgraph;
  if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers;

  atomicWriteFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return { path: file, action: 'removed' };
}

function writePermissions(): WriteResult['files'][number] {
  const file = settingsPath();
  const existed = fs.existsSync(file);
  const dir = path.dirname(file);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let config: Record<string, any> = {};
  if (existed) {
    try { config = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { /* use empty */ }
  }

  if (!config.permissions) config.permissions = {};
  if (!config.permissions.allow) config.permissions.allow = [];

  const allowList: string[] = config.permissions.allow;
  if (!allowList.includes('mcp__cssgraph__*')) {
    allowList.push('mcp__cssgraph__*');
    atomicWriteFileSync(file, JSON.stringify(config, null, 2) + '\n');
    return { path: file, action: existed ? 'updated' : 'created' };
  }

  return { path: file, action: 'unchanged' };
}

function removePermissions(): WriteResult['files'][number] {
  const file = settingsPath();
  if (!fs.existsSync(file)) return { path: file, action: 'not-found' };

  let config: Record<string, any> = {};
  try { config = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return { path: file, action: 'not-found' }; }

  const allowList: string[] = config.permissions?.allow ?? [];
  const idx = allowList.indexOf('mcp__cssgraph__*');
  if (idx === -1) return { path: file, action: 'not-found' };

  allowList.splice(idx, 1);
  if (allowList.length === 0) delete config.permissions.allow;
  if (Object.keys(config.permissions || {}).length === 0) delete config.permissions;

  atomicWriteFileSync(file, JSON.stringify(config, null, 2) + '\n');
  return { path: file, action: 'removed' };
}

export const claudeTarget: AgentTarget = new ClaudeTarget();
