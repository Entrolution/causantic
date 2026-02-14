import { Router } from 'express';
import { getDb } from '../../storage/db.js';
import { getClusterChunkIds, getAllClusters } from '../../storage/cluster-store.js';

const router = Router();

interface DbTimelineRow {
  id: string;
  session_id: string;
  session_slug: string;
  start_time: string;
  end_time: string;
  content: string;
  approx_tokens: number;
}

/**
 * GET /api/timeline — Chunks ordered by time with forward edges for arc rendering.
 *
 * Query params:
 *   project  — filter by session_slug
 *   from     — ISO start time
 *   to       — ISO end time
 *   limit    — max chunks (default 500, max 1000)
 */
router.get('/', (req, res) => {
  const project = req.query.project as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const limit = Math.min(1000, Math.max(10, parseInt(req.query.limit as string) || 500));

  const db = getDb();

  // Build chunk query
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (project) {
    conditions.push('session_slug = ?');
    params.push(project);
  }
  if (from) {
    conditions.push('start_time >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('start_time < ?');
    params.push(to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const chunkRows = db
    .prepare(
      `SELECT id, session_id, session_slug, start_time, end_time, content, approx_tokens
       FROM chunks ${where}
       ORDER BY start_time ASC
       LIMIT ?`,
    )
    .all(...params, limit) as DbTimelineRow[];

  if (chunkRows.length === 0) {
    res.json({ chunks: [], edges: [], timeRange: { earliest: null, latest: null } });
    return;
  }

  const chunkIds = new Set(chunkRows.map((r) => r.id));

  // Build cluster lookup for returned chunks
  const clusters = getAllClusters();
  const chunkCluster = new Map<string, string>();
  for (const cluster of clusters) {
    const memberIds = getClusterChunkIds(cluster.id);
    for (const id of memberIds) {
      if (chunkIds.has(id)) {
        chunkCluster.set(id, cluster.id);
      }
    }
  }

  // Get forward edges where both endpoints are in the returned chunk set
  const idList = [...chunkIds];
  const placeholders = idList.map(() => '?').join(',');
  const edgeRows = db
    .prepare(
      `SELECT source_chunk_id, target_chunk_id, reference_type
       FROM edges
       WHERE edge_type = 'forward'
         AND source_chunk_id IN (${placeholders})
         AND target_chunk_id IN (${placeholders})`,
    )
    .all(...idList, ...idList) as Array<{
    source_chunk_id: string;
    target_chunk_id: string;
    reference_type: string | null;
  }>;

  const chunks = chunkRows.map((r) => ({
    id: r.id,
    startTime: r.start_time,
    endTime: r.end_time,
    sessionSlug: r.session_slug,
    sessionId: r.session_id,
    preview: r.content.slice(0, 200),
    approxTokens: r.approx_tokens,
    clusterId: chunkCluster.get(r.id) ?? null,
  }));

  const edges = edgeRows.map((e) => ({
    sourceId: e.source_chunk_id,
    targetId: e.target_chunk_id,
    referenceType: e.reference_type,
  }));

  const timeRange = {
    earliest: chunkRows[0].start_time,
    latest: chunkRows[chunkRows.length - 1].start_time,
  };

  res.json({ chunks, edges, timeRange });
});

export default router;
