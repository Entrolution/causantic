/**
 * Hook status tracker.
 *
 * Records when each hook last ran, whether it succeeded, and how long it took.
 * Status is persisted to ~/.causantic/hook-status.json as a lightweight
 * alternative to database storage — no schema migration needed.
 *
 * All I/O is wrapped in try/catch so recording failures never break a hook.
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** Status entry for a single hook. */
export interface HookStatusEntry {
  lastRun: string;
  success: boolean;
  durationMs: number;
  project: string | null;
  details?: Record<string, unknown>;
  error: string | null;
}

/** Map of hook name → status entry. */
export type HookStatusMap = Record<string, HookStatusEntry>;

/** Path to the status file. Exported for testing. */
export const STATUS_FILE_PATH = join(homedir(), '.causantic', 'hook-status.json');

/**
 * Record hook execution status.
 *
 * Reads the existing file, merges the update for the given hook, and writes
 * back atomically (write to .tmp, then rename). Fields in `update` are merged
 * into the existing entry for this hook — pass partial updates to enrich
 * a previously recorded entry (e.g., adding `project` or `details` after
 * the basic metrics have been recorded by `executeHook`).
 *
 * Failures are silently swallowed — recording must never break a hook.
 */
export function recordHookStatus(
  hookName: string,
  update: Partial<HookStatusEntry>,
): void {
  try {
    const current = readHookStatus();
    const existing = current[hookName] ?? {};
    current[hookName] = { ...existing, ...update } as HookStatusEntry;

    const dir = dirname(STATUS_FILE_PATH);
    mkdirSync(dir, { recursive: true });

    const tmpPath = STATUS_FILE_PATH + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(current, null, 2) + '\n', 'utf-8');
    renameSync(tmpPath, STATUS_FILE_PATH);
  } catch {
    // Silent — never break a hook
  }
}

/**
 * Read the full hook status map.
 *
 * Returns an empty object if the file is missing, corrupt, or unreadable.
 */
export function readHookStatus(): HookStatusMap {
  try {
    const raw = readFileSync(STATUS_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as HookStatusMap;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Format hook status for human display.
 *
 * Returns a formatted string suitable for CLI or MCP output.
 * If no hooks have run, returns a message indicating that.
 */
export function formatHookStatus(status: HookStatusMap): string {
  const entries = Object.entries(status);
  if (entries.length === 0) {
    return 'Hook Status: (no hooks have run yet)';
  }

  const lines: string[] = [];
  let hasFailure = false;

  for (const [name, entry] of entries) {
    const ago = timeAgo(entry.lastRun);
    const state = entry.success ? 'success' : 'FAILED';
    if (!entry.success) hasFailure = true;
    const duration = formatDuration(entry.durationMs);
    const project = entry.project ? `(${entry.project})` : '';

    let extra = '';
    if (entry.details) {
      const parts: string[] = [];
      if (entry.details.chunks !== undefined) parts.push(`${entry.details.chunks} chunks`);
      if (entry.details.edges !== undefined) parts.push(`${entry.details.edges} edges`);
      if (parts.length > 0) extra = parts.join(', ');
    }
    if (!entry.success && entry.error) {
      extra = entry.error;
    }

    const suffix = extra ? ` ${extra}` : '';
    lines.push(`  ${name.padEnd(16)} ${ago.padEnd(14)} ${state.padEnd(9)} ${duration.padEnd(8)} ${project}${suffix}`);
  }

  const summary = hasFailure
    ? 'Some hooks have failures. Check errors above.'
    : 'No issues detected. All hooks ran successfully.';

  return `Hook Status:\n${lines.join('\n')}\n\n${summary}`;
}

/**
 * Format hook status for MCP tool output (structured text).
 */
export function formatHookStatusMcp(status: HookStatusMap): string {
  const entries = Object.entries(status);
  if (entries.length === 0) {
    return 'Hook Status: (no hooks have run yet)';
  }

  const lines: string[] = ['Hook Status:'];
  let hasFailure = false;

  for (const [name, entry] of entries) {
    const ago = timeAgo(entry.lastRun);
    const state = entry.success ? 'success' : 'FAILED';
    if (!entry.success) hasFailure = true;
    const duration = formatDuration(entry.durationMs);
    const project = entry.project ? ` for ${entry.project}` : '';

    let extra = '';
    if (entry.details) {
      const parts: string[] = [];
      if (entry.details.chunks !== undefined) parts.push(`${entry.details.chunks} chunks`);
      if (entry.details.edges !== undefined) parts.push(`${entry.details.edges} edges`);
      if (parts.length > 0) extra = ` — ${parts.join(', ')}`;
    }
    if (!entry.success && entry.error) {
      extra = ` — ${entry.error}`;
    }

    lines.push(`- ${name}: last ran ${ago} (${state}, ${duration})${project}${extra}`);
  }

  const summary = hasFailure
    ? '\nSome hooks have failures. Check errors above.'
    : '\nNo issues detected. All hooks ran successfully.';

  lines.push(summary);
  return lines.join('\n');
}

/**
 * Human-readable relative time from an ISO date string.
 */
export function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return 'unknown';

  const diffMs = now - then;
  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Format milliseconds as human-readable duration.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
