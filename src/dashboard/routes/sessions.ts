import { Router } from 'express';
import { getSessionsForProject } from '../../storage/chunk-store.js';

const router = Router();

router.get('/', (req, res) => {
  const project = req.query.project as string | undefined;
  if (!project) {
    res.status(400).json({ error: 'project query parameter is required' });
    return;
  }

  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const sessions = getSessionsForProject(project, from, to);
  res.json({ sessions });
});

export default router;
