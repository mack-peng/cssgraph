import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveTargetFlag, detectAll } from './targets/registry';
import type { AgentTarget, Location } from './targets/types';

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return '0.1.0';
  }
}

export interface InstallerOptions {
  target?: string;
  location?: Location;
  autoAllow?: boolean;
  yes?: boolean;
}

function tildify(p: string): string {
  const home = require('os').homedir();
  if (p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

export async function runInstaller(): Promise<void> {
  return runInstallerWithOptions({});
}

export async function runInstallerWithOptions(opts: InstallerOptions): Promise<void> {
  const useDefaults = opts.yes === true;
  const location: Location = opts.location ?? 'global';

  let targets: AgentTarget[];
  if (opts.target !== undefined) {
    targets = resolveTargetFlag(opts.target, location);
  } else if (useDefaults) {
    targets = resolveTargetFlag('auto', location);
  } else {
    // Interactive: prompt user
    const detected = detectAll(location);
    const installed = detected
      .filter(({ detection }) => detection.installed)
      .map(({ target }) => target.id);

    // Non-interactive detection for CLI
    if (installed.length > 0) {
      console.log('Detected agents:');
      for (const id of installed) {
        console.log(`  - ${id}`);
      }
      targets = resolveTargetFlag(installed.join(','), location);
    } else {
      console.log('No agents detected. Configuring all supported agents:');
      targets = resolveTargetFlag('all', location);
    }
  }

  if (targets.length === 0) {
    console.log('No agents to configure.');
    return;
  }

  const autoAllow = opts.autoAllow ?? useDefaults;

  console.log(`\ncssgraph v${getVersion()} — installer\n`);

  let sawCreated = false;
  for (const target of targets) {
    if (!target.supportsLocation(location)) {
      console.log(`${target.displayName}: skipped (${location}-only)`);
      continue;
    }
    const result = target.install(location, { autoAllow });
    for (const file of result.files) {
      if (file.action === 'created') sawCreated = true;
      const verb = file.action === 'created' ? 'Created' :
        file.action === 'updated' ? 'Updated' :
        file.action === 'unchanged' ? 'Already configured' : 'Skipped';
      console.log(`${target.displayName}: ${verb} ${tildify(file.path)}`);
    }
    for (const note of result.notes ?? []) {
      console.log(`${target.displayName}: ${note}`);
    }
  }

  if (sawCreated) {
    console.log(`\nDone! Restart your agent${targets.length > 1 ? 's' : ''} to use cssgraph.`);
    console.log('\nNext: cd <your-project> && cssgraph init');
  }
}

export async function runUninstaller(): Promise<void> {
  const location: Location = 'global';
  const targets = resolveTargetFlag('all', location);

  console.log(`\ncssgraph v${getVersion()} — uninstall\n`);

  for (const target of targets) {
    if (!target.supportsLocation(location)) continue;
    const result = target.uninstall(location);
    for (const file of result.files) {
      const verb = file.action === 'removed' ? 'Removed from' :
        file.action === 'not-found' ? 'Not found in' : 'Skipped';
      console.log(`${target.displayName}: ${verb} ${tildify(file.path)}`);
    }
  }

  console.log('\nRemaining project indexes (.cssgraph/) are untouched.');
  console.log('Remove them per-project: rm -rf .cssgraph');
}
