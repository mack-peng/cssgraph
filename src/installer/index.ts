/**
 * cssgraph Interactive Installer
 *
 * Multi-target: writes MCP server config + instructions for the
 * agents the user picks (Claude Code, Cursor, Codex CLI, opencode,
 * Hermes Agent, Gemini CLI, Antigravity IDE, Kiro).
 * Defaults to the Claude-only behavior for backwards compatibility
 * when no targets are explicitly chosen and nothing else is detected.
 *
 * Uses @clack/prompts for the interactive UI; `runInstallerWithOptions`
 * is the non-interactive entry point used by the `--target` /
 * `--location` / `--yes` / `--no-auto-allow` CLI flags.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  ALL_TARGETS,
  detectAll,
  getTarget,
  resolveTargetFlag,
} from './targets/registry';
import type { AgentTarget, Location, TargetId } from './targets/types';

// Dynamic import helper — tsc compiles import() to require() in CJS mode,
// which fails for ESM-only packages. This bypasses the transformation.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importESM = new Function('specifier', 'return import(specifier)') as
  (specifier: string) => Promise<typeof import('@clack/prompts')>;

function getVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return packageJson.version;
  } catch {
    return '0.1.0';
  }
}

export interface RunInstallerOptions {
  /** Comma-separated target list, or `auto` / `all` / `none`. */
  target?: string;
  /** Skip the location prompt; use this value directly. */
  location?: Location;
  /** Skip the auto-allow prompt; use this value directly. */
  autoAllow?: boolean;
  /**
   * Skip every confirm and use defaults: location=global,
   * autoAllow=true, target=auto. For scripting / CI.
   */
  yes?: boolean;
}

/**
 * Interactive entry point — preserves the existing UX (`cssgraph
 * install` with no args goes through the prompts), but now starts
 * the targets multi-select pre-populated with detected agents.
 */
export async function runInstaller(): Promise<void> {
  return runInstallerWithOptions({});
}

export async function runInstallerWithOptions(opts: RunInstallerOptions): Promise<void> {
  const clack = await importESM('@clack/prompts');

  clack.intro(`cssgraph v${getVersion()}`);

  // --yes implies all defaults; explicit flags still win.
  const useDefaults = opts.yes === true;

  // Step 1: which agent targets? Asked FIRST so the user knows what
  // they're committing to before we touch npm or disk.
  const detectionLocation: Location = opts.location ?? 'global';
  const targets = await resolveTargets(clack, opts, detectionLocation, useDefaults);
  if (targets.length === 0) {
    clack.outro('No agent targets selected — nothing to do.');
    return;
  }

  // Step 2: install the cssgraph npm package on PATH. Skipped when --yes.
  if (!useDefaults) {
    const shouldInstallGlobally = await clack.confirm({
      message: 'Install the cssgraph CLI on your PATH? (Required so agents can launch the MCP server)',
      initialValue: true,
    });
    if (clack.isCancel(shouldInstallGlobally)) {
      clack.cancel('Installation cancelled.');
      process.exit(0);
    }
    if (shouldInstallGlobally) {
      const s = clack.spinner();
      s.start('Installing cssgraph CLI...');
      try {
        execSync('npm install -g cssgraph', { stdio: 'pipe', windowsHide: true });
        s.stop('Installed cssgraph CLI on PATH');
      } catch {
        s.stop('Could not install (permission denied)');
        clack.log.warn('Try: sudo npm install -g cssgraph');
      }
    } else {
      clack.log.info('Skipped CLI install — agents will not be able to launch the MCP server without it');
    }
  }

  // Step 3: where the per-agent config files should land.
  let location: Location;
  if (opts.location) {
    location = opts.location;
  } else if (useDefaults) {
    location = 'global';
  } else {
    const allGlobalOnly = targets.every((t) => !t.supportsLocation('local'));
    if (allGlobalOnly) {
      location = 'global';
      clack.log.info('Writing user-wide configs (selected agents have no project-local config).');
    } else {
      const sel = await clack.select({
        message: 'Apply agent configs to all your projects, or just this one?',
        options: [
          { value: 'global' as const, label: 'All projects', hint: '~/.claude, ~/.cursor, etc.' },
          { value: 'local' as const, label: 'Just this project', hint: './.claude, ./.cursor, etc.' },
        ],
        initialValue: 'global' as const,
      });
      if (clack.isCancel(sel)) {
        clack.cancel('Installation cancelled.');
        process.exit(0);
      }
      location = sel;
    }
  }

  // Step 4: auto-allow permissions (only meaningful for Claude;
  // skipped silently by other targets).
  let autoAllow: boolean;
  if (opts.autoAllow !== undefined) {
    autoAllow = opts.autoAllow;
  } else if (useDefaults) {
    autoAllow = true;
  } else if (targets.some((t) => t.id === 'claude')) {
    const ans = await clack.confirm({
      message: 'Auto-allow cssgraph commands? (Skips permission prompts in Claude Code)',
      initialValue: true,
    });
    if (clack.isCancel(ans)) {
      clack.cancel('Installation cancelled.');
      process.exit(0);
    }
    autoAllow = ans;
  } else {
    autoAllow = false;
  }

  // Step 4 1/2: front-load prompt hook (Claude Code only). A UserPromptSubmit
  // hook that runs `cssgraph prompt-hook` — it injects cssgraph_explore context
  // on structural prompts so the agent reliably reaches for the graph instead
  // of grepping. Opt-in, default-yes.
  let promptHook: boolean | undefined;
  if (targets.some((t) => t.id === 'claude')) {
    if (useDefaults) {
      promptHook = true;
    } else {
      const ans = await clack.confirm({
        message:
          'Front-load cssgraph on structural prompts? Auto-injects style context so answers need fewer steps (adds a moment to those prompts; Claude Code only).',
        initialValue: true,
      });
      if (clack.isCancel(ans)) {
        clack.cancel('Installation cancelled.');
        process.exit(0);
      }
      promptHook = ans;
    }
  }

  // Step 5: per-target install loop.
  const installedIds: TargetId[] = [];
  for (const target of targets) {
    if (!target.supportsLocation(location)) {
      clack.log.warn(
        `${target.displayName}: skipped — does not support --location=${location}.`,
      );
      continue;
    }
    const result = target.install(location, { autoAllow, promptHook });
    installedIds.push(target.id);
    for (const file of result.files) {
      const verb = file.action === 'unchanged'
        ? 'Unchanged'
        : file.action === 'created' ? 'Created'
          : file.action === 'removed' ? 'Removed'
            : 'Updated';
      clack.log.success(`${target.displayName}: ${verb} ${tildify(file.path)}`);
    }
    for (const note of result.notes ?? []) {
      clack.log.info(`${target.displayName}: ${note}`);
    }
  }

  // Step 6: install wires up agents only — it deliberately does NOT index.
  clack.note(
    location === 'local'
      ? 'cssgraph init        # build this project\'s style graph (one time; auto-syncs after)'
      : 'cd <your-project>\ncssgraph init        # build a project\'s style graph (one time; auto-syncs after)',
    'Next: index a project',
  );

  const finalNote = targets.length > 0
    ? `Done! Restart your agent${targets.length > 1 ? 's' : ''} to use cssgraph.`
    : 'Done!';
  clack.outro(finalNote);
}

export interface RunUninstallerOptions {
  /** Comma-separated target list, or `auto` / `all` / `none`. Defaults to `all`. */
  target?: string;
  /** Skip the location prompt; use this value directly. */
  location?: Location;
  /** Non-interactive: location=global, target=all, no prompts. */
  yes?: boolean;
}

export type UninstallStatus = 'removed' | 'not-configured' | 'unsupported';

export interface UninstallReport {
  id: TargetId;
  displayName: string;
  status: UninstallStatus;
  /** Absolute paths we actually edited/removed (action === 'removed'). */
  removedPaths: string[];
  /** Verbatim notes from the target (rare for uninstall). */
  notes: string[];
}

export function uninstallTargets(
  targets: readonly AgentTarget[],
  location: Location,
): UninstallReport[] {
  return targets.map((target) => {
    if (!target.supportsLocation(location)) {
      const only: Location = location === 'local' ? 'global' : 'local';
      return {
        id: target.id,
        displayName: target.displayName,
        status: 'unsupported' as const,
        removedPaths: [],
        notes: [`no ${location} config — this agent is ${only}-only`],
      };
    }
    const result = target.uninstall(location);
    const removedPaths = result.files
      .filter((f) => f.action === 'removed')
      .map((f) => f.path);
    return {
      id: target.id,
      displayName: target.displayName,
      status: removedPaths.length > 0 ? ('removed' as const) : ('not-configured' as const),
      removedPaths,
      notes: result.notes ?? [],
    };
  });
}

export async function runUninstaller(opts: RunUninstallerOptions): Promise<void> {
  const clack = await importESM('@clack/prompts');

  clack.intro(`cssgraph v${getVersion()} — uninstall`);

  const useDefaults = opts.yes === true;

  let location: Location;
  if (opts.location) {
    location = opts.location;
  } else if (useDefaults) {
    location = 'global';
  } else {
    const sel = await clack.select({
      message: 'Remove cssgraph from all your projects, or just this one?',
      options: [
        { value: 'global' as const, label: 'All projects (global)', hint: '~/.claude, ~/.cursor, ~/.codex, ~/.config/opencode, ~/.hermes, ~/.gemini, ~/.kiro' },
        { value: 'local' as const, label: 'Just this project (local)', hint: './.claude, ./.cursor, ./opencode.jsonc, ./.gemini, ./.kiro' },
      ],
      initialValue: 'global' as const,
    });
    if (clack.isCancel(sel)) {
      clack.cancel('Uninstall cancelled.');
      process.exit(0);
    }
    location = sel;
  }

  let targets: AgentTarget[];
  if (opts.target !== undefined) {
    targets = resolveTargetFlag(opts.target, location);
  } else {
    targets = [...ALL_TARGETS];
  }
  if (targets.length === 0) {
    clack.outro('No agent targets selected — nothing to do.');
    return;
  }

  const reports = uninstallTargets(targets, location);
  const removed = reports.filter((r) => r.status === 'removed');

  for (const r of reports) {
    if (r.status === 'removed') {
      for (const p of r.removedPaths) {
        clack.log.success(`${r.displayName}: removed ${tildify(p)}`);
      }
    } else if (r.status === 'not-configured') {
      clack.log.info(`${r.displayName}: not configured — nothing to remove`);
    } else {
      clack.log.info(`${r.displayName}: skipped — ${r.notes[0] ?? 'unsupported location'}`);
    }
  }

  if (removed.length > 0) {
    const names = removed.map((r) => r.displayName).join(', ');
    clack.outro(
      `Removed cssgraph from ${removed.length} agent${removed.length > 1 ? 's' : ''}: ${names}. ` +
      `Restart ${removed.length > 1 ? 'them' : 'it'} to apply.`,
    );
  } else {
    clack.outro(`cssgraph was not configured in any ${location} agent — nothing to remove.`);
  }
}

function tildify(p: string): string {
  const home = os.homedir();
  if (p.startsWith(home + path.sep)) return '~' + p.substring(home.length);
  return p;
}

async function resolveTargets(
  clack: typeof import('@clack/prompts'),
  opts: RunInstallerOptions,
  location: Location,
  useDefaults: boolean,
): Promise<AgentTarget[]> {
  // Explicit --target flag wins.
  if (opts.target !== undefined) {
    return resolveTargetFlag(opts.target, location);
  }

  // --yes implies auto-detect.
  if (useDefaults) {
    return resolveTargetFlag('auto', location);
  }

  // Interactive multi-select.
  const detected = detectAll(location);
  const initialValues = detected
    .filter(({ detection }) => detection.installed)
    .map(({ target }) => target.id);
  // If nothing detected, default to Claude alone.
  const initial = initialValues.length > 0 ? initialValues : ['claude'];

  const choice = await clack.multiselect<string>({
    message: 'Which agents should cssgraph configure?',
    options: ALL_TARGETS.map((t) => {
      const det = detected.find(({ target }) => target.id === t.id)!.detection;
      const flag = det.installed ? '(detected)' : '(not found)';
      const globalOnly = !t.supportsLocation('local') ? ' — global only' : '';
      return {
        value: t.id,
        label: `${t.displayName} ${flag}${globalOnly}`,
      };
    }),
    initialValues: initial,
    required: false,
  });

  if (clack.isCancel(choice)) {
    clack.cancel('Installation cancelled.');
    process.exit(0);
  }

  return choice
    .map((id) => getTarget(id))
    .filter((t): t is AgentTarget => t !== undefined);
}
