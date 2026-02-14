/**
 * Hook handlers exports.
 */

// Hook status tracking
export {
  recordHookStatus,
  readHookStatus,
  formatHookStatus,
  formatHookStatusMcp,
} from './hook-status.js';
export type { HookStatusEntry, HookStatusMap } from './hook-status.js';

// Hook utilities
export {
  executeHook,
  withRetry,
  logHook,
  configureHooks,
  createMetrics,
  completeMetrics,
  isTransientError,
  ingestCurrentSession,
} from './hook-utils.js';
export type {
  HookLogEntry,
  HookMetrics,
  RetryOptions,
  HookConfig,
  IngestionResult,
} from './hook-utils.js';

// Pre-compact hook
export { handlePreCompact, preCompactCli } from './pre-compact.js';
export type { PreCompactResult, PreCompactOptions } from './pre-compact.js';

// Session end hook
export { handleSessionEnd, sessionEndCli } from './session-end.js';
export type { SessionEndResult, SessionEndOptions } from './session-end.js';

// Session start hook
export { handleSessionStart, generateMemorySection } from './session-start.js';
export type { SessionStartOptions, SessionStartResult } from './session-start.js';

// CLAUDE.md generator
export { updateClaudeMd, removeMemorySection, hasMemorySection } from './claudemd-generator.js';
export type { ClaudeMdOptions, ClaudeMdResult } from './claudemd-generator.js';
