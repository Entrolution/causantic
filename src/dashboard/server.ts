import express from 'express';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import statsRouter from './routes/stats.js';
import chunksRouter from './routes/chunks.js';
import edgesRouter from './routes/edges.js';
import clustersRouter from './routes/clusters.js';
import projectsRouter from './routes/projects.js';
import graphRouter from './routes/graph.js';
import searchRouter from './routes/search.js';
import sessionsRouter from './routes/sessions.js';
import benchmarkCollectionRouter from './routes/benchmark-collection.js';
import { errorHandler } from './middleware/error-handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  // API routes
  app.use('/api/stats', statsRouter);
  app.use('/api/chunks', chunksRouter);
  app.use('/api/edges', edgesRouter);
  app.use('/api/clusters', clustersRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/graph', graphRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/sessions', sessionsRouter);
  app.use('/api/benchmark-collection', benchmarkCollectionRouter);

  // API error handler (must come after API routes)
  app.use('/api', errorHandler);

  // Static files (built client)
  const clientDir = path.join(__dirname, 'client');
  app.use(express.static(clientDir));

  // SPA fallback: serve index.html for all non-API routes
  app.get('/{*path}', (_req, res) => {
    const indexPath = path.join(clientDir, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(404).send('Dashboard client not built. Run: npm run build');
      }
    });
  });

  return app;
}

export async function startDashboard(port: number): Promise<void> {
  // Ensure database is initialized before starting
  const { getDb } = await import('../storage/db.js');
  getDb();

  const app = createApp();

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`;
      console.log(`Causantic Dashboard running at ${url}`);

      // Try to open browser
      openBrowser(url);

      // Graceful shutdown
      const shutdown = () => {
        console.log('\nShutting down dashboard...');
        server.close(() => {
          resolve();
        });
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Try: causantic dashboard --port ${port + 1}`);
      }
      reject(err);
    });
  });
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "${url}"`
        : `xdg-open "${url}"`;

  exec(cmd, () => {
    // Ignore errors (browser open is best-effort)
  });
}
