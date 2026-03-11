/**
 * Maintenance task: Backfill index entries for chunks that lack them.
 *
 * Generates normalised descriptions via LLM (or heuristic fallback)
 * and embeds them for the semantic index search layer.
 */

import type { MaintenanceResult } from '../types.js';

export interface BackfillIndexDeps {
  backfill: (options?: { limit?: number }) => Promise<{
    entriesCreated: number;
    llmEntries: number;
    jeopardyEntries: number;
    heuristicEntries: number;
    skipped: number;
    durationMs: number;
  }>;
  getBackfillStatus: () => { indexed: number; total: number; remaining: number };
  batchLimit: number;
}

export async function backfillIndex(deps: BackfillIndexDeps): Promise<MaintenanceResult> {
  const startTime = Date.now();

  try {
    const status = deps.getBackfillStatus();

    if (status.remaining === 0) {
      return {
        success: true,
        duration: Date.now() - startTime,
        message: `Index backfill complete: all ${status.total} chunks indexed`,
        details: { indexed: status.indexed, total: status.total },
      };
    }

    const result = await deps.backfill({ limit: deps.batchLimit });

    const newStatus = deps.getBackfillStatus();

    return {
      success: true,
      duration: Date.now() - startTime,
      message: `Backfilled ${result.entriesCreated} index entries (${result.jeopardyEntries} jeopardy, ${result.llmEntries} LLM, ${result.heuristicEntries} heuristic). ${newStatus.remaining} chunks remaining.`,
      details: {
        entriesCreated: result.entriesCreated,
        llmEntries: result.llmEntries,
        jeopardyEntries: result.jeopardyEntries,
        heuristicEntries: result.heuristicEntries,
        skipped: result.skipped,
        remaining: newStatus.remaining,
        total: newStatus.total,
      },
    };
  } catch (error) {
    return {
      success: false,
      duration: Date.now() - startTime,
      message: `Index backfill failed: ${(error as Error).message}`,
    };
  }
}
