/**
 * Dashboard API routes for collection benchmarks.
 *
 * GET /api/benchmark-collection           — run standard benchmark
 * GET /api/benchmark-collection?profile=full  — run full benchmark
 * GET /api/benchmark-collection?categories=health
 * GET /api/benchmark-collection/history   — past runs + trends
 */

import { Router } from 'express';
import type { BenchmarkProfile, BenchmarkCategory } from '../../eval/collection-benchmark/types.js';

const router = Router();

router.get('/history', async (_req, res) => {
  try {
    const { getBenchmarkHistory } = await import('../../eval/collection-benchmark/history.js');
    const history = getBenchmarkHistory(20);
    res.json({ runs: history });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { runCollectionBenchmark } = await import('../../eval/collection-benchmark/runner.js');

    const profile = (req.query.profile as BenchmarkProfile) ?? 'standard';
    const categories = req.query.categories
      ? (req.query.categories as string).split(',') as BenchmarkCategory[]
      : undefined;
    const sampleSize = req.query.sampleSize
      ? parseInt(req.query.sampleSize as string, 10)
      : 50;
    const seed = req.query.seed
      ? parseInt(req.query.seed as string, 10)
      : undefined;
    const project = req.query.project as string | undefined;

    const result = await runCollectionBenchmark({
      profile,
      categories,
      sampleSize,
      seed,
      projectFilter: project,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
