import { Router } from 'express';
import { getAllClusters, getClusterChunkIds } from '../../storage/cluster-store.js';
import { getChunksByIds } from '../../storage/chunk-store.js';

const router = Router();

router.get('/', (_req, res) => {
  const clusters = getAllClusters();

  const result = clusters.map((c) => {
    const memberIds = getClusterChunkIds(c.id);
    // Get exemplar previews
    const exemplarChunks = getChunksByIds(c.exemplarIds.slice(0, 3));
    const exemplarPreviews = exemplarChunks.map((ch) => ({
      id: ch.id,
      preview: ch.content.slice(0, 150),
    }));

    return {
      id: c.id,
      name: c.name,
      description: c.description,
      memberCount: memberIds.length,
      exemplarPreviews,
      createdAt: c.createdAt,
      refreshedAt: c.refreshedAt,
    };
  });

  res.json({ clusters: result });
});

export default router;
