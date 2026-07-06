/**
 * Kiro target.
 *
 *   - MCP server entry to `~/.kiro/steering/steering.yaml` (global-only).
 *   - Uses YAML steering format.
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
  atomicWriteFileSync,
  directoryIsCssgraphOnly,
} from './shared';

function kiroDir(): string { return path.join(os.homedir(), '.kiro'); }
function steeringPathRef(): string { return path.join(kiroDir(), 'steering', 'steering.yaml'); }

function buildYamlBlock(): string {
  return `mcp_servers:
  cssgraph:
    type: stdio
    command: npx
    args:
      - cssgraph
      - serve
      - --mcp`;
}

function getBlockStart(): string {
  return 'mcp_servers:';
}

class KiroTarget implements AgentTarget {
  readonly id = 'kiro' as const;
  readonly displayName = 'Kiro';

  supportsLocation(_loc: Location): boolean {
    return _loc === 'global';
  }

  detect(_loc: Location): DetectionResult {
    const dir = kiroDir();
    const installed = fs.existsSync(dir) && !directoryIsCssgraphOnly(dir);
    let alreadyConfigured = false;
    if (fs.existsSync(steeringPathRef())) {
      const content = fs.readFileSync(steeringPathRef(), 'utf-8');
      alreadyConfigured = content.includes('cssgraph:');
    }
    return { installed, alreadyConfigured, configPath: steeringPathRef() };
  }

  install(_loc: Location, _opts: InstallOptions): WriteResult {
    const files: WriteResult['files'] = [];
    const existed = fs.existsSync(steeringPathRef());
    const block = buildYamlBlock();

    if (existed) {
      const content = fs.readFileSync(steeringPathRef(), 'utf-8');
      if (content.includes('cssgraph:')) {
        files.push({ path: steeringPathRef(), action: 'unchanged' });
        return { files };
      }

      // Append to existing steering file
      const blockStart = getBlockStart();
      if (content.includes(blockStart)) {
        // Extract up to mcp_servers section, append cssgraph entry
        const lines = content.split('\n');
        const mcpIdx = lines.findIndex((l) => l.trim() === blockStart);
        if (mcpIdx !== -1) {
          const cssgraphLines = [
            '  cssgraph:',
            '    type: stdio',
            '    command: npx',
            '    args:',
            '      - cssgraph',
            '      - serve',
            '      - --mcp',
          ];
          lines.splice(mcpIdx + 1, 0, ...cssgraphLines);
          atomicWriteFileSync(steeringPathRef(), lines.join('\n') + '\n');
          files.push({ path: steeringPathRef(), action: 'updated' });
        } else {
          atomicWriteFileSync(steeringPathRef(), content.trimEnd() + '\n\n' + block + '\n');
          files.push({ path: steeringPathRef(), action: 'updated' });
        }
      } else {
        atomicWriteFileSync(steeringPathRef(), content.trimEnd() + '\n\n' + block + '\n');
        files.push({ path: steeringPathRef(), action: 'updated' });
      }
    } else {
      atomicWriteFileSync(steeringPathRef(), block + '\n');
      files.push({ path: steeringPathRef(), action: 'created' });
    }

    return { files };
  }

  uninstall(_loc: Location): WriteResult {
    const files: WriteResult['files'] = [];

    if (!fs.existsSync(steeringPathRef())) {
      files.push({ path: steeringPathRef(), action: 'not-found' });
      return { files };
    }

    const content = fs.readFileSync(steeringPathRef(), 'utf-8');
    if (!content.includes('cssgraph:')) {
      files.push({ path: steeringPathRef(), action: 'not-found' });
      return { files };
    }

    // Remove the cssgraph sub-block under mcp_servers
    const lines = content.split('\n');
    const startIdx = lines.findIndex((l) => /^\s*cssgraph:/.test(l));
    if (startIdx === -1) {
      files.push({ path: steeringPathRef(), action: 'not-found' });
      return { files };
    }

    // Find where the cssgraph block ends (same or lesser indentation)
    const startLineMatch = lines[startIdx]!.match(/^(\s*)/);
    const indent = startLineMatch?.[1]?.length ?? 0;
    let endIdx = startIdx + 1;
    while (endIdx < lines.length) {
      const currentLine = lines[endIdx]!;
      if (currentLine.trim() === '') {
        endIdx++;
        continue;
      }
      const lineMatch = currentLine.match(/^(\s*)/);
      const lineIndent = lineMatch?.[1]?.length ?? 0;
      if (lineIndent <= indent) break;
      endIdx++;
    }

    // Remove empty lines trailing the block
    while (endIdx < lines.length && lines[endIdx]?.trim() === '') endIdx++;

    lines.splice(startIdx, endIdx - startIdx);
    atomicWriteFileSync(steeringPathRef(), lines.join('\n').trim() + '\n');
    files.push({ path: steeringPathRef(), action: 'removed' });

    return { files };
  }

  printConfig(_loc: Location): string {
    const block = buildYamlBlock();
    return `# Add to ${steeringPathRef()}\n\n${block}\n`;
  }

  describePaths(_loc: Location): string[] {
    return [steeringPathRef()];
  }
}

export const kiroTarget: AgentTarget = new KiroTarget();
