import { Router } from 'express';
import { getChunkCount, getSessionIds, getAllChunks } from '../../storage/chunk-store.js';
import { getEdgeCount } from '../../storage/edge-store.js';
import { getClusterCount } from '../../storage/cluster-store.js';
import { getDistinctProjects } from '../../storage/chunk-store.js';

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

  res.json({
    chunks,
    edges,
    clusters,
    sessions,
    projects: projects.length,
    chunkTimeSeries,
  });
});

export default router;
