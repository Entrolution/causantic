/**
 * CRUD operations for edges.
 * Edges are forward-only (source=earlier, target=later).
 * Direction is inferred at query time via getForwardEdges/getBackwardEdges.
 */

import { getDb, generateId } from './db.js';
import type { StoredEdge, EdgeInput, EdgeType } from './types.js';

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
      reference_type, initial_weight, created_at, link_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    edge.sourceChunkId,
    edge.targetChunkId,
    edge.edgeType,
    edge.referenceType ?? null,
    edge.initialWeight,
    createdAt,
    1,
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
      reference_type, initial_weight, created_at, link_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
        1,
      );
      ids.push(id);
    }
  });

  insertMany(edges);
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
 * Get forward edges from a chunk (chunks this chunk points to, i.e. later chunks).
 * Uses composite index idx_edges_source_type.
 */
export function getForwardEdges(chunkId: string): StoredEdge[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM edges WHERE source_chunk_id = ? AND edge_type = 'forward'")
    .all(chunkId) as DbEdgeRow[];
  return rows.map(rowToEdge);
}

/**
 * Get backward edges to a chunk (chunks that point to this chunk, i.e. earlier chunks).
 * Backward traversal = follow edges where target_chunk_id = chunkId, then go to source.
 * Uses composite index idx_edges_target_type.
 */
export function getBackwardEdges(chunkId: string): StoredEdge[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM edges WHERE target_chunk_id = ? AND edge_type = 'forward'")
    .all(chunkId) as DbEdgeRow[];
  return rows.map(rowToEdge);
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
 * Delete all edges for a session (identified by chunk IDs).
 */
export function deleteEdgesForSession(chunkIds: string[]): number {
  if (chunkIds.length === 0) return 0;

  const db = getDb();
  const placeholders = chunkIds.map(() => '?').join(',');
  const result = db
    .prepare(
      `DELETE FROM edges WHERE source_chunk_id IN (${placeholders}) OR target_chunk_id IN (${placeholders})`,
    )
    .run(...chunkIds, ...chunkIds);
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
    linkCount: row.link_count ?? 1,
  };
}
