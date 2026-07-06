import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

let tmpRoots: string[] = [];

const { mockHomedirFn } = vi.hoisted(() => {
  return {
    mockHomedirFn: vi.fn().mockReturnValue(require('os').homedir()),
  };
});

vi.mock('os', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    homedir: (...args: any[]) => mockHomedirFn(...args),
  };
});

import { claudeTarget } from '../src/installer/targets/claude';
import { opencodeTarget } from '../src/installer/targets/opencode';
import { cursorTarget } from '../src/installer/targets/cursor';
import { codexTarget } from '../src/installer/targets/codex';
import { geminiTarget } from '../src/installer/targets/gemini';
import { hermesTarget } from '../src/installer/targets/hermes';
import { antigravityTarget } from '../src/installer/targets/antigravity';
import { kiroTarget } from '../src/installer/targets/kiro';
import { ALL_TARGETS, getTarget, resolveTargetFlag } from '../src/installer/targets/registry';
import {
  jsonDeepEqual,
  readJsonFile,
  writeJsonFile,
  upsertInstructionsEntry,
  removeMarkedSection,
} from '../src/installer/targets/shared';
import {
  serializeTomlTableBody,
  buildTomlTable,
  upsertTomlTable,
  removeTomlTable,
} from '../src/installer/targets/toml';

beforeEach(() => {
  tmpRoots = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  mockHomedirFn.mockReturnValue(require('os').homedir());
  for (const dir of tmpRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tmpRoots = [];
});

function makeTempRoot(): string {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cssgraph-installer-'));
  tmpRoots.push(dir);
  return dir;
}

function mockHomedir(home: string) {
  mockHomedirFn.mockReturnValue(home);
}

function mockCwd(cwd: string) {
  vi.spyOn(process, 'cwd').mockReturnValue(cwd);
}

// ---------------------------------------------------------------------------
// Claude Code target
// ---------------------------------------------------------------------------
describe('claude target', () => {
  it('installs global MCP entry in ~/.claude.json', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    const result = claudeTarget.install('global', { autoAllow: false });
    const updated = result.files.find((f) => f.path.endsWith('.claude.json'));
    expect(updated).toBeDefined();
    expect(updated!.action).toBe('created');
    const content = JSON.parse(fs.readFileSync(updated!.path, 'utf-8'));
    expect(content.mcpServers?.cssgraph?.command).toBe('cssgraph');
  });

  it('installs global with autoAllow writes settings.json', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    const result = claudeTarget.install('global', { autoAllow: true });
    const settingsFile = result.files.find((f) => f.path.endsWith('settings.json'));
    expect(settingsFile).toBeDefined();
    const content = JSON.parse(fs.readFileSync(settingsFile!.path, 'utf-8'));
    expect(content.permissions.allow).toContain('mcp__cssgraph__*');
  });

  it('installs local writes ./.mcp.json', () => {
    const home = makeTempRoot();
    const projectDir = path.join(home, 'my-project');
    fs.mkdirSync(projectDir, { recursive: true });
    mockHomedir(home);
    mockCwd(projectDir);
    const result = claudeTarget.install('local', { autoAllow: false });
    const mcpFile = result.files.find((f) => f.path.endsWith('.mcp.json'));
    expect(mcpFile).toBeDefined();
    expect(mcpFile!.path).toContain('my-project');
  });

  it('detects already configured global', () => {
    const home = makeTempRoot();
    fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
      mcpServers: { cssgraph: { type: 'stdio', command: 'cssgraph', args: ['serve', '--mcp'] } },
    }));
    mockHomedir(home);
    const det = claudeTarget.detect('global');
    expect(det.alreadyConfigured).toBe(true);
  });

  it('install is idempotent', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    claudeTarget.install('global', { autoAllow: false });
    const result2 = claudeTarget.install('global', { autoAllow: false });
    const mcpFile = result2.files.find((f) => f.path.endsWith('.claude.json'));
    expect(mcpFile!.action).toBe('unchanged');
  });

  it('uninstall reverses install', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    claudeTarget.install('global', { autoAllow: true });
    const uninstallResult = claudeTarget.uninstall('global');
    const mcpFile = uninstallResult.files.find((f) => f.path.endsWith('.claude.json'));
    expect(mcpFile!.action).toBe('removed');
  });

  it('describes expected paths', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    const paths = claudeTarget.describePaths('global');
    expect(paths.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// opencode target
// ---------------------------------------------------------------------------
describe('opencode target', () => {
  it('installs global MCP entry', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    const result = opencodeTarget.install('global', { autoAllow: false });
    const configFile = result.files.find((f) => f.path.endsWith('.jsonc') || f.path.endsWith('.json'));
    expect(configFile).toBeDefined();
    expect(['created', 'updated']).toContain(configFile!.action);
  });

  it('writes AGENTS.md instructions block', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    opencodeTarget.install('global', { autoAllow: false });
    // AGENTS.md lands in the opencode config dir (new-style ~/.opencode or legacy ~/.config/opencode)
    const agentsNew = path.join(home, '.opencode', 'AGENTS.md');
    const agentsLegacy = path.join(home, '.config', 'opencode', 'AGENTS.md');
    const agentsPath = fs.existsSync(agentsNew) ? agentsNew : agentsLegacy;
    expect(fs.existsSync(agentsPath)).toBe(true);
    const content = fs.readFileSync(agentsPath, 'utf-8');
    expect(content).toContain('CSSGRAPH_START');
    expect(content).toContain('cssgraph_explore');
  });

  it('is idempotent (JSONC survives re-run)', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    opencodeTarget.install('global', { autoAllow: false });
    const result2 = opencodeTarget.install('global', { autoAllow: false });
    const configFile = result2.files.find((f) =>
      f.path.endsWith('.jsonc') || f.path.endsWith('.json'));
    expect(configFile!.action).toBe('unchanged');
  });

  it('uninstall reverses install', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    opencodeTarget.install('global', { autoAllow: false });
    const uninstallResult = opencodeTarget.uninstall('global');
    const configFile = uninstallResult.files.find((f) =>
      f.path.endsWith('.jsonc') || f.path.endsWith('.json'));
    expect(configFile!.action).toBe('removed');
  });

  it('prints config as a snippet', () => {
    const snippet = opencodeTarget.printConfig('global');
    expect(typeof snippet).toBe('string');
    expect(snippet).toContain('cssgraph');
  });

  it('describes expected paths', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    const paths = opencodeTarget.describePaths('global');
    expect(paths.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Cursor target
// ---------------------------------------------------------------------------
describe('cursor target', () => {
  it('installs global MCP entry in ~/.cursor/mcp.json', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    const result = cursorTarget.install('global', { autoAllow: false });
    const configFile = result.files.find((f) => f.path.includes('.cursor'));
    expect(configFile).toBeDefined();
    const content = JSON.parse(fs.readFileSync(configFile!.path, 'utf-8'));
    expect(content.mcpServers?.cssgraph?.command).toBe('cssgraph');
    expect(content.mcpServers?.cssgraph?.args).toContain('--path');
  });

  it('uninstall reverses install', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    cursorTarget.install('global', { autoAllow: false });
    const uninstallResult = cursorTarget.uninstall('global');
    const configFile = uninstallResult.files.find((f) => f.path.includes('.cursor'));
    expect(configFile!.action).toBe('removed');
  });
});

// ---------------------------------------------------------------------------
// Codex CLI target
// ---------------------------------------------------------------------------
describe('codex target', () => {
  it('installs global TOML entry in ~/.codex/config.toml', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    const result = codexTarget.install('global', { autoAllow: false });
    const tomlFile = result.files.find((f) => f.path.endsWith('config.toml'));
    expect(tomlFile).toBeDefined();
    const content = fs.readFileSync(tomlFile!.path, 'utf-8');
    expect(content).toContain('[mcp_servers.cssgraph]');
    expect(content).toContain('cssgraph');
    expect(content).toContain('--mcp');
  });

  it('writes AGENTS.md to ~/.codex/AGENTS.md', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    codexTarget.install('global', { autoAllow: false });
    const agentsPath = path.join(home, '.codex', 'AGENTS.md');
    expect(fs.existsSync(agentsPath)).toBe(true);
  });

  it('is idempotent', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    codexTarget.install('global', { autoAllow: false });
    const result2 = codexTarget.install('global', { autoAllow: false });
    const tomlFile = result2.files.find((f) => f.path.endsWith('config.toml'));
    expect(tomlFile!.action).toBe('unchanged');
  });

  it('uninstall reverses install', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    codexTarget.install('global', { autoAllow: false });
    const uninstallResult = codexTarget.uninstall('global');
    const tomlFile = uninstallResult.files.find((f) => f.path.endsWith('config.toml'));
    expect(tomlFile!.action).toBe('removed');
  });

  it('does not support local location', () => {
    expect(codexTarget.supportsLocation('local')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gemini target
// ---------------------------------------------------------------------------
describe('gemini target', () => {
  it('installs global MCP entry', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    const result = geminiTarget.install('global', { autoAllow: false });
    const configFile = result.files.find((f) => f.path.includes('.gemini'));
    expect(configFile).toBeDefined();
    const content = JSON.parse(fs.readFileSync(configFile!.path, 'utf-8'));
    expect(content.mcpServers?.cssgraph?.command).toBe('cssgraph');
  });

  it('writes GEMINI.md instructions', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    geminiTarget.install('global', { autoAllow: false });
    const instructionsPath = path.join(home, '.gemini', 'GEMINI.md');
    expect(fs.existsSync(instructionsPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hermes target
// ---------------------------------------------------------------------------
describe('hermes target', () => {
  it('installs global MCP entry', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    const result = hermesTarget.install('global', { autoAllow: false });
    const configFile = result.files.find((f) => f.path.includes('.hermes'));
    expect(configFile).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Antigravity target
// ---------------------------------------------------------------------------
describe('antigravity target', () => {
  it('installs global MCP entry in ~/.kiro/steering/mcp.json', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    const result = antigravityTarget.install('global', { autoAllow: false });
    const configFile = result.files.find((f) => f.path.includes('.kiro'));
    expect(configFile).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Kiro target
// ---------------------------------------------------------------------------
describe('kiro target', () => {
  it('installs YAML steering entry', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    const result = kiroTarget.install('global', { autoAllow: false });
    const yamlFile = result.files.find((f) => f.path.endsWith('steering.yaml'));
    expect(yamlFile).toBeDefined();
    const content = fs.readFileSync(yamlFile!.path, 'utf-8');
    expect(content).toContain('cssgraph:');
    expect(content).toContain('command: npx');
  });

  it('uninstall reverses install', () => {
    const home = makeTempRoot();
    mockHomedir(home);
    kiroTarget.install('global', { autoAllow: false });
    const uninstallResult = kiroTarget.uninstall('global');
    const yamlFile = uninstallResult.files.find((f) => f.path.endsWith('steering.yaml'));
    expect(yamlFile!.action).toBe('removed');
  });
});

// ---------------------------------------------------------------------------
// Registry tests
// ---------------------------------------------------------------------------
describe('registry', () => {
  it('returns all targets', () => {
    expect(ALL_TARGETS.length).toBe(8);
    const ids = ALL_TARGETS.map((t) => t.id);
    expect(ids).toContain('claude');
    expect(ids).toContain('cursor');
    expect(ids).toContain('codex');
    expect(ids).toContain('opencode');
    expect(ids).toContain('hermes');
    expect(ids).toContain('gemini');
    expect(ids).toContain('antigravity');
    expect(ids).toContain('kiro');
  });

  it('getTarget resolves by id', () => {
    expect(getTarget('claude')?.id).toBe('claude');
    expect(getTarget('unknown')).toBeUndefined();
  });

  it('resolveTargetFlag all returns all', () => {
    const result = resolveTargetFlag('all', 'global');
    expect(result.length).toBe(ALL_TARGETS.length);
  });

  it('resolveTargetFlag none returns empty', () => {
    const result = resolveTargetFlag('none', 'global');
    expect(result.length).toBe(0);
  });

  it('resolveTargetFlag csv works', () => {
    const result = resolveTargetFlag('claude,cursor', 'global');
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('claude');
    expect(result[1].id).toBe('cursor');
  });

  it('resolveTargetFlag throws on unknown id', () => {
    expect(() => resolveTargetFlag('nonexistent', 'global')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------
describe('shared', () => {
  it('jsonDeepEqual compares deeply', () => {
    expect(jsonDeepEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(jsonDeepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(jsonDeepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(jsonDeepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it('readJsonFile returns empty object for missing file', () => {
    const result = readJsonFile('/nonexistent/path.json');
    expect(result).toEqual({});
  });

  it('writeJsonFile writes and readJsonFile reads back', () => {
    const tmp = makeTempRoot();
    const tmpFile = path.join(tmp, 'test.json');
    writeJsonFile(tmpFile, { hello: 'world' });
    const result = readJsonFile(tmpFile);
    expect(result).toEqual({ hello: 'world' });
  });

  it('upsertInstructionsEntry creates file', () => {
    const tmp = makeTempRoot();
    const tmpFile = path.join(tmp, 'CLAUDE.md');
    const result = upsertInstructionsEntry(tmpFile);
    expect(fs.existsSync(tmpFile)).toBe(true);
    expect(result.action).toBe('created');
    const content = fs.readFileSync(tmpFile, 'utf-8');
    expect(content).toContain('CSSGRAPH_START');
  });

  it('removeMarkedSection strips markers', () => {
    const tmp = makeTempRoot();
    const tmpFile = path.join(tmp, 'CLAUDE.md');
    upsertInstructionsEntry(tmpFile);
    expect(fs.existsSync(tmpFile)).toBe(true);
    const action = removeMarkedSection(tmpFile, '<!-- CSSGRAPH_START -->', '<!-- CSSGRAPH_END -->');
    expect(action).toBe('removed');
    expect(fs.existsSync(tmpFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TOML helpers
// ---------------------------------------------------------------------------
describe('toml', () => {
  it('serializeTomlTableBody works', () => {
    const result = serializeTomlTableBody({ type: 'stdio', command: 'test' });
    expect(result).toContain('type = "stdio"');
    expect(result).toContain('command = "test"');
  });

  it('buildTomlTable produces a header', () => {
    const result = buildTomlTable('mcp_servers.cssgraph', { type: 'stdio', command: 'cssgraph', args: ['serve', '--mcp'] });
    expect(result).toContain('[mcp_servers.cssgraph]');
    expect(result).toContain('cssgraph');
    expect(result).toContain('--mcp');
  });

  it('upsertTomlTable inserts into empty content', () => {
    const block = buildTomlTable('mcp.test', { type: 'stdio', command: 'x' });
    const result = upsertTomlTable('', 'mcp.test', block);
    expect(result.action).toBe('inserted');
    expect(result.content).toContain('[mcp.test]');
  });

  it('upsertTomlTable is unchanged when identical', () => {
    const block = buildTomlTable('mcp.test', { type: 'stdio', command: 'x' });
    const { content } = upsertTomlTable('', 'mcp.test', block);
    const result = upsertTomlTable(content, 'mcp.test', block);
    expect(result.action).toBe('unchanged');
  });

  it('removeTomlTable removes a block', () => {
    const block = buildTomlTable('mcp.test', { type: 'stdio', command: 'x' });
    const { content } = upsertTomlTable('', 'mcp.test', block);
    const result = removeTomlTable(content, 'mcp.test');
    expect(result.action).toBe('removed');
    expect(result.content).not.toContain('[mcp.test]');
  });
});
