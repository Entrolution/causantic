import { Router } from 'express';
import { getAllEdges, getOutgoingEdges, getIncomingEdges } from '../../storage/edge-store.js';

const router = Router();

router.get('/', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
  const chunkId = req.query.chunkId as string | undefined;

  let edges;
  if (chunkId) {
    const outgoing = getOutgoingEdges(chunkId);
    const incoming = getIncomingEdges(chunkId);
    edges = [...outgoing, ...incoming];
  } else {
    edges = getAllEdges();
  }

  const total = edges.length;
  const offset = (page - 1) * limit;
  const paged = edges.slice(offset, offset + limit).map((e) => ({
    id: e.id,
    source: e.sourceChunkId,
    target: e.targetChunkId,
    type: e.edgeType,
    referenceType: e.referenceType,
    weight: e.initialWeight,
    linkCount: e.linkCount,
    createdAt: e.createdAt,
  }));

  res.json({ edges: paged, total, page, limit });
});

export default router;
