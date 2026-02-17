import { Router } from 'express';
import { KeywordStore } from '../../storage/keyword-store.js';
import { vectorStore } from '../../storage/vector-store.js';
import { fuseRRF } from '../../retrieval/rrf.js';
import { getChunksByIds } from '../../storage/chunk-store.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { searchContext } from '../../retrieval/search-assembler.js';

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
 * GET /api/search/compare — Side-by-side vector, keyword, fused, and full pipeline results.
 */
router.get(
  '/compare',
  asyncHandler(async (req, res) => {
    const query = req.query.q as string;
    const project = req.query.project as string | undefined;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skipClusters = req.query.skipClusters === 'true';

    if (!query) {
      res.status(400).json({ error: 'q is required' });
      return;
    }

    // Run full pipeline first to get the shared query embedding.
    // No token budget — result count is controlled by `limit` instead.
    const fullResponse = await searchContext({
      query,
      projectFilter: project,
      maxTokens: Infinity,
      vectorSearchLimit: limit * 2,
    });

    // Run without clusters if A/B toggle is active
    let noClustersResponse: typeof fullResponse | undefined;
    if (skipClusters) {
      noClustersResponse = await searchContext({
        query,
        projectFilter: project,
        maxTokens: Infinity,
        vectorSearchLimit: limit * 2,
        skipClusters: true,
      });
    }

    // Use the shared embedding for standalone vector search
    const queryEmbedding = fullResponse.queryEmbedding;

    // Keyword search
    const keywordStore = new KeywordStore();
    const keywordResults = project
      ? keywordStore.searchByProject(query, project, limit)
      : keywordStore.search(query, limit);

    // Vector search using the shared embedding
    let vectorResults: Array<{ id: string; score: number }> = [];
    try {
      const raw = project
        ? await vectorStore.searchByProject(queryEmbedding, project, limit)
        : await vectorStore.search(queryEmbedding, limit);

      vectorResults = raw.map((r) => ({
        id: r.id,
        score: 1 - r.distance / 2,
      }));
    } catch {
      // Vector search may fail — degrade gracefully
    }

    // Fuse with RRF
    const fused = fuseRRF([
      { items: vectorResults.map((r) => ({ chunkId: r.id, score: r.score })), weight: 1 },
      { items: keywordResults.map((r) => ({ chunkId: r.id, score: r.score })), weight: 1 },
    ]);

    // Gather all unique chunk IDs (include full pipeline chunks)
    const allIds = new Set([
      ...keywordResults.map((r) => r.id),
      ...vectorResults.map((r) => r.id),
      ...fused.map((r) => r.chunkId),
      ...fullResponse.chunks.map((c) => c.id),
      ...(noClustersResponse?.chunks.map((c) => c.id) ?? []),
    ]);
    const chunks = getChunksByIds([...allIds]);
    const chunkMap = new Map(chunks.map((c) => [c.id, c]));

    const enrich = (
      items: Array<{ id?: string; chunkId?: string; score: number; source?: string }>,
    ) =>
      items.slice(0, limit).map((r) => {
        const id = r.id ?? r.chunkId ?? '';
        const chunk = chunkMap.get(id);
        return {
          id,
          score: r.score,
          preview: chunk?.content.slice(0, 200) ?? '',
          sessionSlug: chunk?.sessionSlug ?? '',
          startTime: chunk?.startTime ?? '',
          ...(r.source ? { source: r.source } : {}),
        };
      });

    const enrichPipeline = (pipelineChunks: typeof fullResponse.chunks) =>
      pipelineChunks.slice(0, limit).map((c) => {
        const chunk = chunkMap.get(c.id);
        return {
          id: c.id,
          score: c.weight,
          preview: chunk?.content.slice(0, 200) ?? c.preview,
          sessionSlug: c.sessionSlug,
          startTime: chunk?.startTime ?? '',
          ...(c.source ? { source: c.source } : {}),
        };
      });

    // Compute source breakdown
    const sourceBreakdown = { vector: 0, keyword: 0, cluster: 0 };
    for (const c of fullResponse.chunks) {
      if (c.source === 'vector') sourceBreakdown.vector++;
      else if (c.source === 'keyword') sourceBreakdown.keyword++;
      else if (c.source === 'cluster') sourceBreakdown.cluster++;
    }

    const response: Record<string, unknown> = {
      vector: enrich(vectorResults),
      keyword: enrich(keywordResults),
      fused: enrich(fused.map((r) => ({ id: r.chunkId, score: r.score }))),
      fullPipeline: enrichPipeline(fullResponse.chunks),
      sourceBreakdown,
    };

    if (noClustersResponse) {
      response.fullPipelineNoClusters = enrichPipeline(noClustersResponse.chunks);
    }

    res.json(response);
  }),
);

export default router;
