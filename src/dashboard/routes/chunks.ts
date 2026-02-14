import { Router } from 'express';
import { getAllChunks, getChunksBySessionSlug, getChunksByIds } from '../../storage/chunk-store.js';

const router = Router();

router.get('/', (req, res) => {
  const chunkId = req.query.chunkId as string | undefined;

  // Single chunk lookup by ID
  if (chunkId) {
    const chunks = getChunksByIds([chunkId]).map((c) => ({
      id: c.id,
      sessionId: c.sessionId,
      sessionSlug: c.sessionSlug,
      startTime: c.startTime,
      endTime: c.endTime,
      content: c.content,
      approxTokens: c.approxTokens,
    }));
    res.json({ chunks, total: chunks.length, page: 1, limit: 1 });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
  const project = req.query.project as string | undefined;

  const allChunks = project ? getChunksBySessionSlug(project) : getAllChunks();

  // Sort by startTime descending (most recent first)
  allChunks.sort((a, b) => b.startTime.localeCompare(a.startTime));

  const total = allChunks.length;
  const offset = (page - 1) * limit;
  const chunks = allChunks.slice(offset, offset + limit).map((c) => ({
    id: c.id,
    sessionSlug: c.sessionSlug,
    startTime: c.startTime,
    preview: c.content.slice(0, 200),
    tokenCount: c.approxTokens,
    codeBlockCount: c.codeBlockCount,
    toolUseCount: c.toolUseCount,
  }));

  res.json({ chunks, total, page, limit });
});

export default router;
