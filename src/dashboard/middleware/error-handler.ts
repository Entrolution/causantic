/**
 * Express error middleware for the dashboard API.
 *
 * Catches unhandled errors from route handlers and returns a JSON error
 * response instead of crashing the server.
 */

import type { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[dashboard]', err.message);

  const status = (err as Error & { status?: number }).status ?? 500;
  res.status(status).json({ error: err.message });
}
