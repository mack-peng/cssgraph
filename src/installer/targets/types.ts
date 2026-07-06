export type Location = 'global' | 'local';

export type TargetId = 'claude' | 'cursor' | 'codex' | 'opencode' | 'hermes' | 'gemini' | 'antigravity' | 'kiro';

export interface DetectionResult {
  installed: boolean;
  alreadyConfigured: boolean;
  configPath?: string;
}

export interface WriteResult {
  files: Array<{
    path: string;
    action: 'created' | 'updated' | 'unchanged' | 'removed' | 'not-found' | 'kept';
  }>;
  notes?: string[];
}

export interface InstallOptions {
  /**
   * Whether to write the agent's permissions / auto-allow surface
   * (Claude `settings.json`, others where applicable). When the
   * target has no permissions concept this option is a no-op.
   */
  autoAllow: boolean;
  /**
   * Front-load prompt hook (Claude `UserPromptSubmit`) that injects
   * cssgraph_explore context for structural prompts. `true` installs it,
   * `false` removes any prior install (so opt-out round-trips), `undefined`
   * leaves it untouched. Targets without a prompt-hook concept ignore it.
   */
  promptHook?: boolean;
}

export interface AgentTarget {
  readonly id: TargetId;
  readonly displayName: string;
  readonly docsUrl?: string;
  supportsLocation(loc: Location): boolean;
  detect(loc: Location): DetectionResult;
  install(loc: Location, opts: InstallOptions): WriteResult;
  uninstall(loc: Location): WriteResult;
  printConfig(loc: Location): string;
  /** Filesystem paths this target would write to at this location. */
  describePaths(loc: Location): string[];
}
