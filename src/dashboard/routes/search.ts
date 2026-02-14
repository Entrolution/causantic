import { Router } from 'express';
import { KeywordStore } from '../../storage/keyword-store.js';
import { vectorStore } from '../../storage/vector-store.js';
import { fuseRRF } from '../../retrieval/rrf.js';
import { getChunksByIds } from '../../storage/chunk-store.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router = Router();

/**
 * GET /api/search — Keyword search with BM25 scores.
 */
router.get('/', (req, res) => {
  const query = req.query.q as string;
  const project = req.query.project as string | undefined;
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

  if (!query) {
    res.status(400).json({ error: 'q is required' });
    return;
  }

  const keywordStore = new KeywordStore();
  const results = project
    ? keywordStore.searchByProject(query, project, limit)
    : keywordStore.search(query, limit);

  // Enrich with chunk previews
  const chunks = getChunksByIds(results.map((r) => r.id));
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  const enriched = results.map((r) => {
    const chunk = chunkMap.get(r.id);
    return {
      id: r.id,
      score: r.score,
      preview: chunk?.content.slice(0, 200) ?? '',
      sessionSlug: chunk?.sessionSlug ?? '',
      startTime: chunk?.startTime ?? '',
    };
  });

  res.json({ results: enriched });
});

/**
 * GET /api/search/compare — Side-by-side vector, keyword, and fused results.
 */
router.get(
  '/compare',
  asyncHandler(async (req, res) => {
    const query = req.query.q as string;
    const project = req.query.project as string | undefined;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));

    if (!query) {
      res.status(400).json({ error: 'q is required' });
      return;
    }

    // Keyword search
    const keywordStore = new KeywordStore();
    const keywordResults = project
      ? keywordStore.searchByProject(query, project, limit)
      : keywordStore.search(query, limit);

    // Vector search (requires embedding the query)
    let vectorResults: Array<{ id: string; score: number }> = [];
    try {
      const { Embedder } = await import('../../models/embedder.js');
      const { getModel } = await import('../../models/model-registry.js');
      const embedder = new Embedder();
      await embedder.load(getModel('jina-small'));
      const result = await embedder.embed(query);
      await embedder.dispose();

      const raw = project
        ? await vectorStore.searchByProject(result.embedding, project, limit)
        : await vectorStore.search(result.embedding, limit);

      vectorResults = raw.map((r) => ({
        id: r.id,
        score: 1 - r.distance / 2, // Convert distance to similarity score
      }));
    } catch {
      // Vector search may fail if model can't load — degrade gracefully
    }

    // Fuse with RRF
    const fused = fuseRRF([
      { items: vectorResults.map((r) => ({ chunkId: r.id, score: r.score })), weight: 1 },
      { items: keywordResults.map((r) => ({ chunkId: r.id, score: r.score })), weight: 1 },
    ]);

    // Gather all unique chunk IDs
    const allIds = new Set([
      ...keywordResults.map((r) => r.id),
      ...vectorResults.map((r) => r.id),
      ...fused.map((r) => r.chunkId),
    ]);
    const chunks = getChunksByIds([...allIds]);
    const chunkMap = new Map(chunks.map((c) => [c.id, c]));

    const enrich = (items: Array<{ id?: string; chunkId?: string; score: number }>) =>
      items.slice(0, limit).map((r) => {
        const id = r.id ?? r.chunkId ?? '';
        const chunk = chunkMap.get(id);
        return {
          id,
          score: r.score,
          preview: chunk?.content.slice(0, 200) ?? '',
          sessionSlug: chunk?.sessionSlug ?? '',
          startTime: chunk?.startTime ?? '',
        };
      });

    res.json({
      vector: enrich(vectorResults),
      keyword: enrich(keywordResults),
      fused: enrich(fused.map((r) => ({ id: r.chunkId, score: r.score }))),
    });
  }),
);

export default router;
