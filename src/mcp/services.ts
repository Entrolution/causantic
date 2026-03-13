/**
 * Service layer for MCP tool business logic.
 *
 * Extracts reusable formatting and computation from tool handlers
 * to keep tools.ts focused on tool definitions and thin wiring.
 */

import { getChunkCount, getChunksByIds, getDistinctProjects } from '../storage/chunk-store.js';
import { getDb } from '../storage/db.js';
import { getEdgeCount } from '../storage/edge-store.js';
import { getClusterCount } from '../storage/cluster-store.js';
import { getEntityCount } from '../storage/entity-store.js';
import { VERSION } from '../utils/version.js';
import type { SimilarChunkResult } from '../retrieval/search-assembler.js';
import type { StoredChunk } from '../storage/types.js';

/**
 * Format a project date range as "Mon YYYY" or "Mon YYYY – Mon YYYY".
 */
export function formatDateRange(firstSeen: string, lastSeen: string): string {
  const first = new Date(firstSeen).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
  const last = new Date(lastSeen).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Format a single scored chunk preview line.
 *
 * Produces: `  N. [XX%] "preview text..." (Mon DD, YYYY)`
 */
export function formatChunkPreview(
  match: SimilarChunkResult,
  chunk: StoredChunk | undefined,
  index: number,
): string {
  const scorePct = Math.round(match.score * 100);
  const preview = chunk ? chunk.content.split('\n')[0].slice(0, 80) : '(chunk not found)';
  const date = chunk
    ? new Date(chunk.startTime).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';
  return `  ${index + 1}. [${scorePct}%] "${preview}" (${date})`;
}

/**
 * Build a chunk map from match IDs for efficient lookup.
 */
export function buildChunkMap(matches: SimilarChunkResult[]): Map<string, StoredChunk> {
  const chunks = getChunksByIds(matches.map((m) => m.id));
  return new Map(chunks.map((c) => [c.id, c]));
}

/**
 * Compute memory statistics including version, counts, projects, and agent teams.
 */
export function getMemoryStats(): string {
  const chunks = getChunkCount();
  const edges = getEdgeCount();
  const clusters = getClusterCount();
  const projects = getDistinctProjects();

  let entities = 0;
  try {
    entities = getEntityCount();
  } catch {
    // Entity tables may not exist yet
  }

  const lines = [
    `Causantic v${VERSION}`,
    '',
    'Memory Statistics:',
    `- Chunks: ${chunks}`,
    `- Edges: ${edges}`,
    `- Clusters: ${clusters}`,
    `- Entities: ${entities}`,
  ];

  if (projects.length > 0) {
    lines.push('', 'Projects:');
    for (const p of projects) {
      const range = formatDateRange(p.firstSeen, p.lastSeen);
      lines.push(`- ${p.slug}: ${p.chunkCount} chunks (${range})`);
    }
  }

  // Agent team stats
  try {
    const db = getDb();
    const agentChunks = db
      .prepare(
        "SELECT COUNT(*) as count FROM chunks WHERE agent_id IS NOT NULL AND agent_id != 'ui'",
      )
      .get() as { count: number };
    const distinctAgents = db
      .prepare(
        "SELECT COUNT(DISTINCT agent_id) as count FROM chunks WHERE agent_id IS NOT NULL AND agent_id != 'ui'",
      )
      .get() as { count: number };

    if (agentChunks.count > 0) {
      lines.push('', 'Agent Teams:');
      lines.push(`- Agent chunks: ${agentChunks.count}`);
      lines.push(`- Distinct agents: ${distinctAgents.count}`);

      const teamEdgeRows = db
        .prepare(
          "SELECT reference_type, COUNT(*) as count FROM edges WHERE reference_type IN ('team-spawn', 'team-report', 'peer-message') GROUP BY reference_type",
        )
        .all() as Array<{ reference_type: string; count: number }>;
      for (const row of teamEdgeRows) {
        lines.push(`- ${row.reference_type} edges: ${row.count}`);
      }
    }
  } catch {
    // Agent stats unavailable (table may not have agent columns yet)
  }

  return lines.join('\n');
}
