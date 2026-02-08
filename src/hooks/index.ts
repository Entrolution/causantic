/**
 * Hook handlers exports.
 */

// Pre-compact hook
export { handlePreCompact, preCompactCli } from './pre-compact.js';
export type { PreCompactResult } from './pre-compact.js';

// Session start hook
export { handleSessionStart, generateMemorySection } from './session-start.js';
export type { SessionStartOptions, SessionStartResult } from './session-start.js';

// CLAUDE.md generator
export { updateClaudeMd, removeMemorySection, hasMemorySection } from './claudemd-generator.js';
export type { ClaudeMdOptions, ClaudeMdResult } from './claudemd-generator.js';
