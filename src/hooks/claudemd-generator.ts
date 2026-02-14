/**
 * CLAUDE.md memory section generator.
 * Auto-generates memory context for inclusion in project CLAUDE.md files.
 *
 * Features:
 * - Retry logic for transient errors
 * - Structured JSON logging
 * - Execution metrics
 * - Graceful degradation on failure
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { generateMemorySection } from './session-start.js';
import { executeHook, logHook, isTransientError, type HookMetrics } from './hook-utils.js';
import type { SessionStartOptions } from './session-start.js';

/**
 * Markers for memory section in CLAUDE.md.
 */
const MEMORY_START_MARKER = '<!-- MEMORY_START -->';
const MEMORY_END_MARKER = '<!-- MEMORY_END -->';

/**
 * Options for CLAUDE.md generation.
 */
export interface ClaudeMdOptions extends SessionStartOptions {
  /** Path to CLAUDE.md file. Default: ./CLAUDE.md */
  claudeMdPath?: string;
  /** Create file if it doesn't exist. Default: false */
  createIfMissing?: boolean;
}

/**
 * Result of CLAUDE.md update.
 */
export interface ClaudeMdResult {
  /** Whether the file was updated */
  updated: boolean;
  /** Whether the file was created */
  created: boolean;
  /** Path to the file */
  path: string;
  /** Memory section token count */
  tokenCount: number;
  /** Hook execution metrics */
  metrics?: HookMetrics;
  /** Whether this is a fallback result due to error */
  degraded?: boolean;
}

/**
 * Internal handler without retry logic.
 */
async function internalUpdateClaudeMd(
  projectPath: string,
  options: ClaudeMdOptions,
): Promise<ClaudeMdResult> {
  const {
    claudeMdPath = join(projectPath, 'CLAUDE.md'),
    createIfMissing = false,
    ...sessionOptions
  } = options;

  // Generate memory section
  const memorySection = await generateMemorySection(projectPath, sessionOptions);

  if (!memorySection) {
    logHook({
      level: 'debug',
      hook: 'claudemd-generator',
      event: 'no_memory_section',
      details: { path: claudeMdPath },
    });

    return {
      updated: false,
      created: false,
      path: claudeMdPath,
      tokenCount: 0,
    };
  }

  const wrappedSection = `${MEMORY_START_MARKER}\n${memorySection}\n${MEMORY_END_MARKER}`;

  // Check if file exists
  if (!existsSync(claudeMdPath)) {
    if (createIfMissing) {
      await writeFile(claudeMdPath, wrappedSection, 'utf-8');

      logHook({
        level: 'info',
        hook: 'claudemd-generator',
        event: 'file_created',
        details: { path: claudeMdPath },
      });

      return {
        updated: true,
        created: true,
        path: claudeMdPath,
        tokenCount: memorySection.length / 4, // Rough estimate
      };
    }

    logHook({
      level: 'debug',
      hook: 'claudemd-generator',
      event: 'file_not_found',
      details: { path: claudeMdPath, createIfMissing },
    });

    return {
      updated: false,
      created: false,
      path: claudeMdPath,
      tokenCount: 0,
    };
  }

  // Read existing file
  const existing = await readFile(claudeMdPath, 'utf-8');

  // Check for existing memory section
  const startIdx = existing.indexOf(MEMORY_START_MARKER);
  const endIdx = existing.indexOf(MEMORY_END_MARKER);

  let newContent: string;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace existing section
    newContent =
      existing.slice(0, startIdx) +
      wrappedSection +
      existing.slice(endIdx + MEMORY_END_MARKER.length);

    logHook({
      level: 'debug',
      hook: 'claudemd-generator',
      event: 'section_replaced',
      details: { path: claudeMdPath },
    });
  } else {
    // Append to end
    newContent = existing.trimEnd() + '\n\n' + wrappedSection + '\n';

    logHook({
      level: 'debug',
      hook: 'claudemd-generator',
      event: 'section_appended',
      details: { path: claudeMdPath },
    });
  }

  // Only write if content changed
  if (newContent !== existing) {
    await writeFile(claudeMdPath, newContent, 'utf-8');

    logHook({
      level: 'info',
      hook: 'claudemd-generator',
      event: 'file_updated',
      details: { path: claudeMdPath },
    });

    return {
      updated: true,
      created: false,
      path: claudeMdPath,
      tokenCount: memorySection.length / 4,
    };
  }

  logHook({
    level: 'debug',
    hook: 'claudemd-generator',
    event: 'no_changes',
    details: { path: claudeMdPath },
  });

  return {
    updated: false,
    created: false,
    path: claudeMdPath,
    tokenCount: memorySection.length / 4,
  };
}

/**
 * Update CLAUDE.md with memory section.
 * Inserts or updates the memory section between markers.
 *
 * @param projectPath - Project path (used for memory lookup)
 * @param options - Options for generation
 * @returns Update result
 */
export async function updateClaudeMd(
  projectPath: string,
  options: ClaudeMdOptions = {},
): Promise<ClaudeMdResult> {
  const { enableRetry = true, maxRetries = 3, gracefulDegradation = true } = options;

  const claudeMdPath = options.claudeMdPath ?? join(projectPath, 'CLAUDE.md');

  const fallbackResult: ClaudeMdResult = {
    updated: false,
    created: false,
    path: claudeMdPath,
    tokenCount: 0,
    degraded: true,
  };

  const { result, metrics } = await executeHook(
    'claudemd-generator',
    () => internalUpdateClaudeMd(projectPath, options),
    {
      retry: enableRetry
        ? {
            maxRetries,
            retryOn: isTransientError,
          }
        : undefined,
      fallback: gracefulDegradation ? fallbackResult : undefined,
    },
  );

  return {
    ...result,
    metrics,
  };
}

/**
 * Remove memory section from CLAUDE.md.
 *
 * @param claudeMdPath - Path to CLAUDE.md file
 * @returns Whether section was removed
 */
export async function removeMemorySection(claudeMdPath: string): Promise<boolean> {
  if (!existsSync(claudeMdPath)) {
    return false;
  }

  try {
    const existing = await readFile(claudeMdPath, 'utf-8');

    const startIdx = existing.indexOf(MEMORY_START_MARKER);
    const endIdx = existing.indexOf(MEMORY_END_MARKER);

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      return false;
    }

    const newContent =
      existing.slice(0, startIdx).trimEnd() + existing.slice(endIdx + MEMORY_END_MARKER.length);

    await writeFile(claudeMdPath, newContent.trimEnd() + '\n', 'utf-8');

    logHook({
      level: 'info',
      hook: 'claudemd-generator',
      event: 'section_removed',
      details: { path: claudeMdPath },
    });

    return true;
  } catch (error) {
    logHook({
      level: 'error',
      hook: 'claudemd-generator',
      event: 'remove_failed',
      error: error instanceof Error ? error.message : String(error),
      details: { path: claudeMdPath },
    });
    return false;
  }
}

/**
 * Check if CLAUDE.md has memory section.
 *
 * @param claudeMdPath - Path to CLAUDE.md file
 * @returns Whether memory section exists
 */
export async function hasMemorySection(claudeMdPath: string): Promise<boolean> {
  if (!existsSync(claudeMdPath)) {
    return false;
  }

  try {
    const content = await readFile(claudeMdPath, 'utf-8');
    return content.includes(MEMORY_START_MARKER) && content.includes(MEMORY_END_MARKER);
  } catch {
    return false;
  }
}
