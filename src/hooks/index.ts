/**
 * Hook handlers exports.
 */

// Hook utilities
export {
  executeHook,
  withRetry,
  logHook,
  configureHooks,
  createMetrics,
  completeMetrics,
  isTransientError,
} from './hook-utils.js';
export type {
  HookLogEntry,
  HookMetrics,
  RetryOptions,
  HookConfig,
} from './hook-utils.js';

// Pre-compact hook
export { handlePreCompact, preCompactCli } from './pre-compact.js';
export type { PreCompactResult, PreCompactOptions } from './pre-compact.js';

// Session start hook
export { handleSessionStart, generateMemorySection } from './session-start.js';
export type { SessionStartOptions, SessionStartResult } from './session-start.js';

// CLAUDE.md generator
export { updateClaudeMd, removeMemorySection, hasMemorySection } from './claudemd-generator.js';
export type { ClaudeMdOptions, ClaudeMdResult } from './claudemd-generator.js';
