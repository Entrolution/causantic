/**
 * Centralized logging for ECM.
 *
 * Provides structured logging with levels, metadata, and output formatting.
 * Writes to stderr to avoid interfering with stdio-based protocols.
 *
 * Log level is controlled via:
 * 1. ECM_LOG_LEVEL environment variable
 * 2. setLogLevel() function
 *
 * Levels (in order of severity): debug < info < warn < error
 */

/** Log level type */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Log entry structure */
export interface LogEntry {
  timestamp: string;
  level: Exclude<LogLevel, 'silent'>;
  message: string;
  meta?: Record<string, unknown>;
}

/** Logger interface */
export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// Level priority (higher = more severe)
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

// Current log level
let currentLevel: LogLevel = (process.env.ECM_LOG_LEVEL as LogLevel) ?? 'info';

// JSON output mode (for machine parsing)
let jsonMode = process.env.ECM_LOG_JSON === 'true';

/**
 * Set the log level.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Get the current log level.
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * Enable or disable JSON output mode.
 */
export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

/**
 * Check if a level should be logged.
 */
function shouldLog(level: Exclude<LogLevel, 'silent'>): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

/**
 * Format a log entry for output.
 */
function format(entry: LogEntry): string {
  if (jsonMode) {
    return JSON.stringify(entry);
  }

  const { timestamp, level, message, meta } = entry;
  const time = timestamp.split('T')[1].split('.')[0]; // HH:MM:SS
  const levelTag = level.toUpperCase().padEnd(5);

  let output = `[${time}] ${levelTag} ${message}`;

  if (meta && Object.keys(meta).length > 0) {
    const metaStr = Object.entries(meta)
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
      .join(' ');
    output += ` (${metaStr})`;
  }

  return output;
}

/**
 * Write a log entry.
 */
function log(level: Exclude<LogLevel, 'silent'>, msg: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message: msg,
    meta,
  };

  process.stderr.write(format(entry) + '\n');
}

/**
 * Main logger instance.
 */
export const logger: Logger = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};

/**
 * Create a child logger with a fixed prefix.
 */
export function createLogger(prefix: string): Logger {
  return {
    debug: (msg, meta) => log('debug', `[${prefix}] ${msg}`, meta),
    info: (msg, meta) => log('info', `[${prefix}] ${msg}`, meta),
    warn: (msg, meta) => log('warn', `[${prefix}] ${msg}`, meta),
    error: (msg, meta) => log('error', `[${prefix}] ${msg}`, meta),
  };
}

// Export default logger
export default logger;
