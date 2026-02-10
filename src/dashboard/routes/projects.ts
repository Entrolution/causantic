import { Router } from 'express';
import { getDistinctProjects } from '../../storage/chunk-store.js';

const router = Router();

router.get('/', (_req, res) => {
  const projects = getDistinctProjects();
  res.json({ projects });
});

export default router;
