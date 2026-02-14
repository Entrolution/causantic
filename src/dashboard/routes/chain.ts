import { Router } from 'express';
import { getForwardEdges, getBackwardEdges } from '../../storage/edge-store.js';
import { getChunksByIds } from '../../storage/chunk-store.js';
import { getConfig } from '../../config/memory-config.js';

const router = Router();

/**
 * GET /api/chain/walk — Structural chain walk from a seed chunk.
 *
 * No query embedding needed — this is pure structural traversal for dashboard display.
 * Follows edges in the specified direction until depth limit or no more edges.
 *
 * Query params:
 *   chunkId    — seed chunk ID (required)
 *   direction  — 'backward' or 'forward' (default: 'backward')
 */
router.get('/walk', (req, res) => {
  const chunkId = req.query.chunkId as string;
  const direction = (req.query.direction as string) || 'backward';

  if (!chunkId) {
    res.status(400).json({ error: 'chunkId is required' });
    return;
  }

  if (direction !== 'backward' && direction !== 'forward') {
    res.status(400).json({ error: 'direction must be backward or forward' });
    return;
  }

  const config = getConfig();
  const maxDepth = config.maxChainDepth;

  // Walk the chain structurally
  const chainIds: string[] = [];
  const visited = new Set<string>([chunkId]);
  let current = chunkId;

  for (let depth = 0; depth < maxDepth; depth++) {
    const edges =
      direction === 'forward' ? getForwardEdges(current) : getBackwardEdges(current);

    if (edges.length === 0) break;

    // Pick first unvisited neighbor
    const next = edges.find((e) => {
      const neighbor =
        direction === 'forward' ? e.targetChunkId : e.sourceChunkId;
      return !visited.has(neighbor);
    });

    if (!next) break;

    const neighborId =
      direction === 'forward' ? next.targetChunkId : next.sourceChunkId;
    visited.add(neighborId);
    chainIds.push(neighborId);
    current = neighborId;
  }

  // Fetch chunk metadata
  const allIds = [chunkId, ...chainIds];
  const chunks = getChunksByIds(allIds);
  const chunkMap = new Map(chunks.map((c) => [c.id, c]));

  const toMeta = (id: string) => {
    const c = chunkMap.get(id);
    return {
      id,
      sessionSlug: c?.sessionSlug ?? '',
      sessionId: c?.sessionId ?? '',
      startTime: c?.startTime ?? '',
      endTime: c?.endTime ?? '',
      preview: c?.content.slice(0, 200) ?? '',
      approxTokens: c?.approxTokens ?? 0,
    };
  };

  const totalTokens = allIds.reduce(
    (sum, id) => sum + (chunkMap.get(id)?.approxTokens ?? 0),
    0,
  );

  res.json({
    seed: toMeta(chunkId),
    chain: chainIds.map(toMeta),
    direction,
    totalTokens,
  });
});

export default router;
