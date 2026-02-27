import { Router } from 'express';
import { getChunkCount, getSessionIds, getAllChunks } from '../../storage/chunk-store.js';
import { getEdgeCount } from '../../storage/edge-store.js';
import { getClusterCount } from '../../storage/cluster-store.js';
import { getDistinctProjects } from '../../storage/chunk-store.js';
import { getDb } from '../../storage/db.js';

const router = Router();

router.get('/', (_req, res) => {
  const chunks = getChunkCount();
  const edges = getEdgeCount();
  const clusters = getClusterCount();
  const sessions = getSessionIds().length;
  const projects = getDistinctProjects();

  // Build time series: chunks grouped by week based on session start time
  const allChunks = getAllChunks();
  const weekCounts = new Map<string, number>();

  for (const chunk of allChunks) {
    const date = new Date(chunk.startTime);
    if (isNaN(date.getTime())) continue;
    // Get Monday of the week (UTC to avoid timezone shifts)
    const day = date.getUTCDay();
    const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff));
    const weekKey = monday.toISOString().slice(0, 10);
    weekCounts.set(weekKey, (weekCounts.get(weekKey) ?? 0) + 1);
  }

  const chunkTimeSeries = [...weekCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week, count }));

  // --- Retrieval analytics from retrieval_feedback ---
  const db = getDb();

  const toolUsage = db
    .prepare(
      `SELECT tool_name as tool, COUNT(*) as count
       FROM retrieval_feedback
       GROUP BY tool_name ORDER BY count DESC`,
    )
    .all() as Array<{ tool: string; count: number }>;

  const retrievalTimeSeries = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', returned_at, 'weekday 1', '-6 days') as week,
              COUNT(*) as count
       FROM retrieval_feedback GROUP BY week ORDER BY week`,
    )
    .all() as Array<{ week: string; count: number }>;

  const topChunks = db
    .prepare(
      `SELECT rf.chunk_id as chunkId, COUNT(*) as count, c.session_slug as project,
              c.approx_tokens as tokens, SUBSTR(c.content, 1, 120) as preview
       FROM retrieval_feedback rf
       JOIN chunks c ON c.id = rf.chunk_id
       GROUP BY rf.chunk_id ORDER BY count DESC LIMIT 10`,
    )
    .all() as Array<{
    chunkId: string;
    count: number;
    project: string;
    tokens: number;
    preview: string;
  }>;

  const projectRetrievals = db
    .prepare(
      `SELECT c.session_slug as project, COUNT(*) as retrievals,
              COUNT(DISTINCT rf.query_hash) as uniqueQueries
       FROM retrieval_feedback rf
       JOIN chunks c ON c.id = rf.chunk_id
       GROUP BY c.session_slug ORDER BY retrievals DESC`,
    )
    .all() as Array<{ project: string; retrievals: number; uniqueQueries: number }>;

  const sizeDistribution = db
    .prepare(
      `SELECT CASE
         WHEN approx_tokens <= 200 THEN '0-200'
         WHEN approx_tokens <= 500 THEN '201-500'
         WHEN approx_tokens <= 1000 THEN '501-1K'
         WHEN approx_tokens <= 2000 THEN '1K-2K'
         WHEN approx_tokens <= 5000 THEN '2K-5K'
         ELSE '5K+'
       END as bucket, COUNT(*) as count
       FROM chunks GROUP BY bucket ORDER BY MIN(approx_tokens)`,
    )
    .all() as Array<{ bucket: string; count: number }>;

  const totalRetrievals = (
    db.prepare('SELECT COUNT(*) as count FROM retrieval_feedback').get() as { count: number }
  ).count;

  res.json({
    chunks,
    edges,
    clusters,
    sessions,
    projects: projects.length,
    chunkTimeSeries,
    analytics: {
      toolUsage,
      retrievalTimeSeries,
      topChunks,
      projectRetrievals,
      sizeDistribution,
      totalRetrievals,
    },
  });
});

export default router;
