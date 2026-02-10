/**
 * CRUD operations for edges with decay weight calculation.
 */

import { getDb, generateId } from './db.js';
import type { DecayModelConfig } from '../core/decay-types.js';
import type { StoredEdge, EdgeInput, WeightedEdge, EdgeType } from './types.js';
import type { VectorClock } from '../temporal/vector-clock.js';
import { serialize as serializeClock, deserialize as deserializeClock, merge as mergeClock } from '../temporal/vector-clock.js';
import {
  calculateDecayWeight,
  calculateDecayWeightWithFallback,
  calculateDirectionalDecayWeight,
  applyLinkBoost,
  type EdgeDirection,
} from './decay.js';

/**
 * Create a single edge.
 */
export function createEdge(edge: EdgeInput): string {
  const db = getDb();
  const id = generateId();
  const createdAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO edges (
      id, source_chunk_id, target_chunk_id, edge_type,
      reference_type, initial_weight, created_at, vector_clock, link_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    edge.sourceChunkId,
    edge.targetChunkId,
    edge.edgeType,
    edge.referenceType ?? null,
    edge.initialWeight,
    createdAt,
    edge.vectorClock ? serializeClock(edge.vectorClock) : null,
    1
  );

  return id;
}

/**
 * Create multiple edges in a transaction.
 */
export function createEdges(edges: EdgeInput[]): string[] {
  const db = getDb();
  const ids: string[] = [];
  const createdAt = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO edges (
      id, source_chunk_id, target_chunk_id, edge_type,
      reference_type, initial_weight, created_at, vector_clock, link_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((edges: EdgeInput[]) => {
    for (const edge of edges) {
      const id = generateId();
      stmt.run(
        id,
        edge.sourceChunkId,
        edge.targetChunkId,
        edge.edgeType,
        edge.referenceType ?? null,
        edge.initialWeight,
        createdAt,
        edge.vectorClock ? serializeClock(edge.vectorClock) : null,
        1
      );
      ids.push(id);
    }
  });

  insertMany(edges);
  return ids;
}

/**
 * Create or boost an edge.
 * If an edge with the same source, target, type, and reference already exists,
 * boost it instead of creating a duplicate.
 */
export function createOrBoostEdge(edge: EdgeInput): string {
  const db = getDb();

  // Check for existing edge
  const existing = db.prepare(`
    SELECT id, initial_weight, link_count, vector_clock FROM edges
    WHERE source_chunk_id = ? AND target_chunk_id = ?
      AND edge_type = ? AND (reference_type = ? OR (reference_type IS NULL AND ? IS NULL))
  `).get(
    edge.sourceChunkId,
    edge.targetChunkId,
    edge.edgeType,
    edge.referenceType ?? null,
    edge.referenceType ?? null
  ) as { id: string; initial_weight: number; link_count: number; vector_clock: string | null } | undefined;

  if (existing) {
    // Boost: increment link_count, update clock to more recent, add diminishing weight
    const newClock = edge.vectorClock
      ? mergeClock(deserializeClock(existing.vector_clock), edge.vectorClock)
      : existing.vector_clock;

    const boostWeight = edge.initialWeight * 0.1; // Diminishing boost per additional link

    db.prepare(`
      UPDATE edges SET
        link_count = link_count + 1,
        vector_clock = ?,
        initial_weight = initial_weight + ?
      WHERE id = ?
    `).run(
      newClock ? (typeof newClock === 'string' ? newClock : serializeClock(newClock)) : null,
      boostWeight,
      existing.id
    );

    return existing.id;
  }

  // Create new edge
  return createEdge(edge);
}

/**
 * Create or boost multiple edges in a transaction.
 */
export function createOrBoostEdges(edges: EdgeInput[]): string[] {
  const db = getDb();
  const ids: string[] = [];

  const transaction = db.transaction((edges: EdgeInput[]) => {
    for (const edge of edges) {
      ids.push(createOrBoostEdge(edge));
    }
  });

  transaction(edges);
  return ids;
}

/**
 * Get an edge by ID.
 */
export function getEdgeById(id: string): StoredEdge | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as DbEdgeRow | undefined;

  if (!row) {
    return null;
  }

  return rowToEdge(row);
}

/**
 * Get outgoing edges from a chunk.
 */
export function getOutgoingEdges(chunkId: string, edgeType?: EdgeType): StoredEdge[] {
  const db = getDb();

  let query = 'SELECT * FROM edges WHERE source_chunk_id = ?';
  const params: (string | undefined)[] = [chunkId];

  if (edgeType) {
    query += ' AND edge_type = ?';
    params.push(edgeType);
  }

  const rows = db.prepare(query).all(...params) as DbEdgeRow[];
  return rows.map(rowToEdge);
}

/**
 * Get incoming edges to a chunk.
 */
export function getIncomingEdges(chunkId: string, edgeType?: EdgeType): StoredEdge[] {
  const db = getDb();

  let query = 'SELECT * FROM edges WHERE target_chunk_id = ?';
  const params: (string | undefined)[] = [chunkId];

  if (edgeType) {
    query += ' AND edge_type = ?';
    params.push(edgeType);
  }

  const rows = db.prepare(query).all(...params) as DbEdgeRow[];
  return rows.map(rowToEdge);
}

/**
 * Get weighted edges with decay applied at query time.
 * Filters out edges with weight <= 0 (dead edges).
 * Uses direction-specific decay curves:
 * - Backward: Linear (dies@10) for 4-20 hop range
 * - Forward: Delayed linear (5h, dies@20) for 1-20 hop range
 *
 * @param chunkId - Source chunk ID
 * @param queryTime - Query time in milliseconds (for time-based decay fallback)
 * @param decayConfig - Time-based decay configuration (for fallback)
 * @param edgeType - Optional edge type filter (also determines decay curve)
 * @param referenceClock - Current reference clock for vector decay (optional)
 */
export function getWeightedEdges(
  chunkId: string,
  queryTime: number,
  decayConfig: DecayModelConfig,
  edgeType?: EdgeType,
  referenceClock?: VectorClock
): WeightedEdge[] {
  const edges = getOutgoingEdges(chunkId, edgeType);
  const result: WeightedEdge[] = [];
  const deadEdgeIds: string[] = [];

  const useVectorClock = referenceClock && Object.keys(referenceClock).length > 0;

  for (const edge of edges) {
    let weight: number;

    // Determine decay direction from edge type
    const direction: EdgeDirection = edge.edgeType === 'forward' ? 'forward' : 'backward';

    if (useVectorClock && edge.vectorClock) {
      // Use direction-specific vector clock decay
      weight = edge.initialWeight * calculateDecayWeightWithFallback(
        edge.vectorClock,
        referenceClock!,
        direction,
        new Date(edge.createdAt).getTime(),
        queryTime,
        decayConfig
      );
    } else {
      // Fall back to time-based decay
      const createdAt = new Date(edge.createdAt).getTime();
      const age = queryTime - createdAt;
      const decayedWeight = calculateDecayWeight(decayConfig, age);
      weight = edge.initialWeight * decayedWeight;
    }

    // Apply link boost for edges created multiple times
    if (edge.linkCount > 1) {
      weight = applyLinkBoost(weight, edge.linkCount);
    }

    if (weight <= 0) {
      deadEdgeIds.push(edge.id);
      continue;
    }

    result.push({
      ...edge,
      weight,
    });
  }

  // Queue dead edges for lazy pruning (import at runtime to avoid circular deps)
  if (deadEdgeIds.length > 0) {
    import('./pruner.js').then(({ pruner }) => {
      for (const id of deadEdgeIds) {
        pruner.queueEdgePrune(id);
      }
    });
  }

  return result;
}

/**
 * Check if a chunk has any edges (for orphan detection).
 */
export function hasAnyEdges(chunkId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `
    SELECT 1 FROM edges
    WHERE source_chunk_id = ? OR target_chunk_id = ?
    LIMIT 1
  `
    )
    .get(chunkId, chunkId) as { 1: number } | undefined;

  return row !== undefined;
}

/**
 * Delete an edge by ID.
 */
export function deleteEdge(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM edges WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Delete multiple edges by ID.
 */
export function deleteEdges(ids: string[]): number {
  if (ids.length === 0) {
    return 0;
  }

  const db = getDb();
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM edges WHERE id IN (${placeholders})`).run(...ids);
  return result.changes;
}

/**
 * Delete all edges for a chunk.
 */
export function deleteEdgesForChunk(chunkId: string): number {
  const db = getDb();
  const result = db
    .prepare('DELETE FROM edges WHERE source_chunk_id = ? OR target_chunk_id = ?')
    .run(chunkId, chunkId);
  return result.changes;
}

/**
 * Get edge count.
 */
export function getEdgeCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number };
  return row.count;
}

/**
 * Get all edges (for debugging/export).
 */
export function getAllEdges(): StoredEdge[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM edges ORDER BY created_at').all() as DbEdgeRow[];
  return rows.map(rowToEdge);
}

// Internal types and helpers

interface DbEdgeRow {
  id: string;
  source_chunk_id: string;
  target_chunk_id: string;
  edge_type: string;
  reference_type: string | null;
  initial_weight: number;
  created_at: string;
  // v2: Vector clock support
  vector_clock: string | null;
  link_count: number | null;
}

function rowToEdge(row: DbEdgeRow): StoredEdge {
  return {
    id: row.id,
    sourceChunkId: row.source_chunk_id,
    targetChunkId: row.target_chunk_id,
    edgeType: row.edge_type as EdgeType,
    referenceType: row.reference_type as StoredEdge['referenceType'],
    initialWeight: row.initial_weight,
    createdAt: row.created_at,
    vectorClock: row.vector_clock,
    linkCount: row.link_count ?? 1,
  };
}
