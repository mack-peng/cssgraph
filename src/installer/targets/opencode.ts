import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentTarget, DetectionResult, InstallOptions, Location, WriteResult } from './types';
import { atomicWriteFileSync, jsonDeepEqual } from './shared';

function globalConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config');
  return path.join(xdg, 'opencode');
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
  return jsonc;
}

function getServerEntry(): { type: string; command: string[]; enabled: boolean } {
  return {
    type: 'local',
    command: ['cssgraph', 'serve', '--mcp'],
    enabled: true,
  };
}

function readConfigText(file: string): string {
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf-8');
}

function parseConfig(text: string): Record<string, any> {
  if (!text.trim()) return {};
  try {
    const { parse, ParseError } = require('jsonc-parser');
    const errors: any[] = [];
    const result = parse(text, errors, { allowTrailingComma: true });
    if (errors.length > 0 && !text.includes('//') && !text.includes('/*')) {
      // not JSONC, try JSON
      return JSON.parse(text);
    }
    if (result == null || typeof result !== 'object' || Array.isArray(result)) {
      return {};
    }
    if (errors.some((e: any) => e instanceof ParseError)) {
      return {};
    }
    return result as Record<string, any>;
  } catch {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2) + '\n';
  } catch {
    return text;
  }
}

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
    const installed = loc === 'global'
      ? fs.existsSync(globalConfigDir())
      : fs.existsSync(file);
    return { installed, alreadyConfigured, configPath: file };
  }

  install(loc: Location, _opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];
    files.push(writeMcpEntry(loc));
    return { files };
  }

  uninstall(loc: Location): WriteResult {
    const files: WriteResult['files'] = [];
    files.push(removeMcpEntry(loc));
    return { files };
  }

  printConfig(loc: Location): string {
    const target = configPath(loc);
    const snippet = JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: { cssgraph: getServerEntry() },
    }, null, 2);
    return `# Add to ${target}\n\n${snippet}\n`;
  }
}

function writeMcpEntry(loc: Location): WriteResult['files'][number] {
  const file = configPath(loc);
  const existed = fs.existsSync(file);
  let text = readConfigText(file);

  if (!text.trim()) {
    text = '{\n  "$schema": "https://opencode.ai/config.json",\n  "mcp": {}\n}\n';
  }

  const config = parseConfig(text);
  const before = config.mcp?.cssgraph;
  const after = getServerEntry();

  if (jsonDeepEqual(before, after)) {
    return { path: file, action: 'unchanged' };
  }

  if (!config.$schema) {
    config.$schema = 'https://opencode.ai/config.json';
  }
  if (!config.mcp) {
    config.mcp = {};
  }
  config.mcp.cssgraph = after;

  atomicWriteFileSync(file, formatJson(JSON.stringify(config)));
  return { path: file, action: existed ? 'updated' : 'created' };
}

function removeMcpEntry(loc: Location): WriteResult['files'][number] {
  const file = configPath(loc);
  if (!fs.existsSync(file)) return { path: file, action: 'not-found' };
  const text = readConfigText(file);
  const config = parseConfig(text);
  if (!config.mcp?.cssgraph) return { path: file, action: 'not-found' };

  delete config.mcp.cssgraph;
  if (Object.keys(config.mcp).length === 0) {
    delete config.mcp;
  }

  atomicWriteFileSync(file, formatJson(JSON.stringify(config)));
  return { path: file, action: 'removed' };
}

export const opencodeTarget: AgentTarget = new OpencodeTarget();
