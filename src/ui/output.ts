/**
 * Terminal output helpers — ANSI color codes, glyphs, and phase rendering.
 */

export const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

export const glyphs = {
  ok: '◆',
  err: '▲',
  warn: '▲',
  info: '◆',
  dash: '│',
  rail: '│',
};

export function ok(msg: string): string {
  return `${colors.green}${glyphs.ok}${colors.reset} ${msg}`;
}

export function warn(msg: string): string {
  return `${colors.yellow}${glyphs.warn}${colors.reset} ${msg}`;
}

export function err(msg: string): string {
  return `${colors.red}${glyphs.err}${colors.reset} ${msg}`;
}

export function info(msg: string): string {
  return `${colors.cyan}${glyphs.info}${colors.reset} ${msg}`;
}

export function dim(msg: string): string {
  return `${colors.dim}${msg}${colors.reset}`;
}

export function bold(msg: string): string {
  return `${colors.bold}${msg}${colors.reset}`;
}

export function rail(isDim: boolean = true): string {
  const prefix = isDim ? colors.dim : '';
  const suffix = isDim ? colors.reset : '';
  return `${prefix}${glyphs.rail}${suffix}`;
}

let currentPhase = '';
let phaseStartTime = 0;
let lastProgressRender = 0;
const PROGRESS_RENDER_INTERVAL_MS = 50;

export function intro(version: string): void {
  console.log('');
  console.log(dim('┌') + `  ${bold('cssgraph')} ${dim('v' + version)}`);
  console.log(dim('│'));
}

export function phase(name: string): void {
  if (currentPhase) {
    const elapsed = Date.now() - phaseStartTime;
    if (elapsed > 100) {
      process.stdout.write(`\r\x1b[K${rail()}  ${ok(name)}\n`);
    }
  } else {
    console.log(`${rail()}  ${ok(name)}`);
  }
  currentPhase = name;
  phaseStartTime = Date.now();
}

export function phaseComplete(): void {
  if (!currentPhase) return;
  const elapsed = ((Date.now() - phaseStartTime) / 1000).toFixed(1);
  process.stdout.write(`\r\x1b[K${rail()}  ${ok(currentPhase)} ${dim(`(${elapsed}s)`)}\n`);
  currentPhase = '';
}

export function step(msg: string, status: 'ok' | 'warn' | 'err' | 'info' = 'ok'): void {
  const icon = status === 'ok' ? ok('') : status === 'warn' ? warn('') : status === 'err' ? err('') : info('');
  console.log(`${rail(false)}  ${icon} ${msg}`);
}

/**
 * Render inline progress — overwrites current line with \r\x1b[K.
 * Call with a status object. Set done=true for final static render.
 */
export function progressBar(current: number, total: number, label: string, done: boolean = false): void {
  const now = Date.now();
  if (!done && now - lastProgressRender < PROGRESS_RENDER_INTERVAL_MS) {
    return;
  }
  lastProgressRender = now;

  const barWidth = 20;
  const filled = total > 0 ? Math.floor((current / total) * barWidth) : 0;
  const empty = barWidth - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const counter = `${current}/${total}`;
  const line = `${rail()}  ${dim(bar)} ${counter} ${dim(label)}`;

  if (done) {
    console.log(`\r\x1b[K${line}`);
  } else {
    process.stdout.write(`\r\x1b[K${line}`);
  }
}

export function progressClear(): void {
  process.stdout.write('\r\x1b[K');
}

export function outro(message?: string): void {
  console.log(dim('│'));
  console.log(dim('└') + `  ${message || 'Done'}`);
  console.log('');
}

export function statLine(label: string, value: string): string {
  return `  ${dim(label.padEnd(12))} ${value}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
}
