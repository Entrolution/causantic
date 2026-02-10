/**
 * Wrapper for async Express route handlers.
 *
 * Catches rejected promises and forwards them to Express error middleware,
 * preventing unhandled promise rejections from crashing the server.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
