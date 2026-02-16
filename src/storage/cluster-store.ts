/**
 * CRUD operations for clusters and chunk-cluster assignments.
 */

import { getDb, generateId } from './db.js';
import type { StoredCluster, ClusterInput, ChunkClusterAssignment } from './types.js';

/**
 * Create or update a cluster.
 */
export function upsertCluster(input: ClusterInput): string {
  const db = getDb();
  const id = input.id || generateId();
  const now = new Date().toISOString();

  // Check if exists
  const existing = db.prepare('SELECT id FROM clusters WHERE id = ?').get(id);

  if (existing) {
    // Update
    const updates: string[] = [];
    const params: (string | null | Buffer)[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      params.push(input.description);
    }
    if (input.centroid !== undefined) {
      updates.push('centroid = ?');
      params.push(serializeCentroid(input.centroid));
    }
    if (input.exemplarIds !== undefined) {
      updates.push('exemplar_ids = ?');
      params.push(JSON.stringify(input.exemplarIds));
    }
    if (input.membershipHash !== undefined) {
      updates.push('membership_hash = ?');
      params.push(input.membershipHash);
    }
    if (input.description !== undefined) {
      updates.push('refreshed_at = ?');
      params.push(now);
    }

    if (updates.length > 0) {
      params.push(id);
      db.prepare(`UPDATE clusters SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
  } else {
    // Insert
    db.prepare(
      `
      INSERT INTO clusters (
        id, name, description, centroid, exemplar_ids,
        membership_hash, created_at, refreshed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      input.name ?? null,
      input.description ?? null,
      input.centroid ? serializeCentroid(input.centroid) : null,
      input.exemplarIds ? JSON.stringify(input.exemplarIds) : null,
      input.membershipHash ?? null,
      now,
      input.description ? now : null,
    );
  }

  return id;
}

/**
 * Get a cluster by ID.
 */
export function getClusterById(id: string): StoredCluster | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM clusters WHERE id = ?').get(id) as DbClusterRow | undefined;

  if (!row) {
    return null;
  }

  return rowToCluster(row);
}

/**
 * Get all clusters.
 */
export function getAllClusters(): StoredCluster[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM clusters ORDER BY created_at').all() as DbClusterRow[];
  return rows.map(rowToCluster);
}

/**
 * Get all clusters that have a description.
 * Avoids loading description-less clusters that would be filtered out anyway.
 */
export function getClustersWithDescriptions(): StoredCluster[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM clusters WHERE description IS NOT NULL ORDER BY created_at')
    .all() as DbClusterRow[];
  return rows.map(rowToCluster);
}

/**
 * Get clusters that need refresh (stale descriptions).
 * A cluster is stale if its membership_hash doesn't match current members
 * or if it has never been refreshed.
 */
export function getStaleClusters(maxAge?: number): StoredCluster[] {
  const db = getDb();

  let query = 'SELECT * FROM clusters WHERE refreshed_at IS NULL';
  const params: number[] = [];

  if (maxAge !== undefined) {
    const cutoff = new Date(Date.now() - maxAge).toISOString();
    query += ' OR refreshed_at < ?';
    params.push(cutoff as unknown as number);
  }

  const rows = db.prepare(query).all(...params) as DbClusterRow[];
  return rows.map(rowToCluster);
}

/**
 * Assign a chunk to a cluster.
 */
export function assignChunkToCluster(chunkId: string, clusterId: string, distance: number): void {
  const db = getDb();

  db.prepare(
    `
    INSERT OR REPLACE INTO chunk_clusters (chunk_id, cluster_id, distance)
    VALUES (?, ?, ?)
  `,
  ).run(chunkId, clusterId, distance);
}

/**
 * Assign multiple chunks to clusters in a transaction.
 */
export function assignChunksToClusters(assignments: ChunkClusterAssignment[]): void {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO chunk_clusters (chunk_id, cluster_id, distance)
    VALUES (?, ?, ?)
  `);

  const insertMany = db.transaction((assignments: ChunkClusterAssignment[]) => {
    for (const a of assignments) {
      stmt.run(a.chunkId, a.clusterId, a.distance);
    }
  });

  insertMany(assignments);
}

/**
 * Get cluster assignments for a chunk.
 */
export function getChunkClusterAssignments(chunkId: string): ChunkClusterAssignment[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM chunk_clusters WHERE chunk_id = ? ORDER BY distance')
    .all(chunkId) as DbAssignmentRow[];

  return rows.map((r) => ({
    chunkId: r.chunk_id,
    clusterId: r.cluster_id,
    distance: r.distance,
  }));
}

/**
 * Get all chunk IDs in a cluster.
 */
export function getClusterChunkIds(clusterId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT chunk_id FROM chunk_clusters WHERE cluster_id = ? ORDER BY distance')
    .all(clusterId) as { chunk_id: string }[];

  return rows.map((r) => r.chunk_id);
}

/**
 * Get project relevance scores for multiple clusters in a single query.
 * Replaces the N+1 pattern of calling getClusterChunkIds + getChunksByIds per cluster.
 */
export function getClusterProjectRelevance(
  clusterIds: string[],
  projectSlug: string,
): Array<{ clusterId: string; relevance: number }> {
  if (clusterIds.length === 0) return [];

  const db = getDb();
  const placeholders = clusterIds.map(() => '?').join(', ');

  const rows = db
    .prepare(
      `
      SELECT cc.cluster_id,
             SUM(CASE WHEN c.session_slug = ? THEN 1 ELSE 0 END) as project_count,
             COUNT(*) as total_count
      FROM chunk_clusters cc
      JOIN chunks c ON cc.chunk_id = c.id
      WHERE cc.cluster_id IN (${placeholders})
      GROUP BY cc.cluster_id
      HAVING project_count > 0
    `,
    )
    .all(projectSlug, ...clusterIds) as Array<{
    cluster_id: string;
    project_count: number;
    total_count: number;
  }>;

  return rows
    .map((r) => ({
      clusterId: r.cluster_id,
      relevance: r.project_count / r.total_count,
    }))
    .sort((a, b) => b.relevance - a.relevance);
}

/**
 * Remove all cluster assignments for a chunk.
 */
export function removeChunkAssignments(chunkId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM chunk_clusters WHERE chunk_id = ?').run(chunkId);
  return result.changes;
}

/**
 * Remove all assignments for a cluster.
 */
export function clearClusterAssignments(clusterId: string): number {
  const db = getDb();
  const result = db.prepare('DELETE FROM chunk_clusters WHERE cluster_id = ?').run(clusterId);
  return result.changes;
}

/**
 * Delete a cluster and its assignments.
 */
export function deleteCluster(id: string): boolean {
  const db = getDb();

  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM chunk_clusters WHERE cluster_id = ?').run(id);
    return db.prepare('DELETE FROM clusters WHERE id = ?').run(id);
  });

  const result = deleteAll();
  return result.changes > 0;
}

/**
 * Delete all clusters and assignments.
 */
export function clearAllClusters(): void {
  const db = getDb();

  db.transaction(() => {
    db.exec('DELETE FROM chunk_clusters');
    db.exec('DELETE FROM clusters');
  })();
}

/**
 * Get cluster count.
 */
export function getClusterCount(): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as count FROM clusters').get() as { count: number };
  return row.count;
}

/**
 * Compute membership hash for staleness detection.
 */
export function computeMembershipHash(chunkIds: string[]): string {
  const sorted = [...chunkIds].sort();
  // Simple hash: join and use first 16 chars of base64
  const str = sorted.join(',');
  return Buffer.from(str).toString('base64').slice(0, 16);
}

// Internal types and helpers

interface DbClusterRow {
  id: string;
  name: string | null;
  description: string | null;
  centroid: Buffer | null;
  exemplar_ids: string | null;
  membership_hash: string | null;
  created_at: string;
  refreshed_at: string | null;
}

interface DbAssignmentRow {
  chunk_id: string;
  cluster_id: string;
  distance: number;
}

function rowToCluster(row: DbClusterRow): StoredCluster {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    centroid: row.centroid ? deserializeCentroid(row.centroid) : null,
    exemplarIds: row.exemplar_ids ? (JSON.parse(row.exemplar_ids) as string[]) : [],
    membershipHash: row.membership_hash,
    createdAt: row.created_at,
    refreshedAt: row.refreshed_at,
  };
}

function serializeCentroid(centroid: number[]): Buffer {
  const float32 = new Float32Array(centroid);
  return Buffer.from(float32.buffer);
}

function deserializeCentroid(buffer: Buffer): number[] {
  const float32 = new Float32Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.length / Float32Array.BYTES_PER_ELEMENT,
  );
  return Array.from(float32);
}
