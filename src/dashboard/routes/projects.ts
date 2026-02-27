import { Router } from 'express';
import { getDistinctProjects } from '../../storage/chunk-store.js';
import { getDb } from '../../storage/db.js';

const router = Router();

router.get('/', (_req, res) => {
  const projects = getDistinctProjects();

  const db = getDb();
  const retrievalCounts = new Map(
    (
      db
        .prepare(
          `SELECT c.session_slug as project, COUNT(*) as retrievals,
                COUNT(DISTINCT rf.query_hash) as uniqueQueries
         FROM retrieval_feedback rf
         JOIN chunks c ON c.id = rf.chunk_id
         GROUP BY c.session_slug`,
        )
        .all() as Array<{ project: string; retrievals: number; uniqueQueries: number }>
    ).map((r) => [r.project, r]),
  );

  const enriched = projects.map((p) => {
    const counts = retrievalCounts.get(p.slug);
    return {
      ...p,
      retrievals: counts?.retrievals ?? 0,
      uniqueQueries: counts?.uniqueQueries ?? 0,
    };
  });

  res.json({ projects: enriched });
});

export default router;
