export class CodeGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeGraphError';
  }
}

export class FileError extends CodeGraphError {
  constructor(message: string, public filePath?: string) {
    super(message);
    this.name = 'FileError';
  }
}

export class ParseError extends CodeGraphError {
  constructor(message: string, public filePath?: string, public line?: number) {
    super(message);
    this.name = 'ParseError';
  }
}

export class DatabaseError extends CodeGraphError {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ConfigError extends CodeGraphError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export const defaultLogger: Logger = {
  info: (msg) => console.log(`[cssgraph] ${msg}`),
  warn: (msg) => console.warn(`[cssgraph] ${msg}`),
  error: (msg) => console.error(`[cssgraph] ${msg}`),
  debug: (msg) => console.debug(`[cssgraph] ${msg}`),
};

let logger: Logger = defaultLogger;

export function setLogger(l: Logger): void {
  logger = l;
}

export function getLogger(): Logger {
  return logger;
}

export function logDebug(msg: string): void {
  logger.debug(msg);
}

export function logWarn(msg: string): void {
  logger.warn(msg);
}
