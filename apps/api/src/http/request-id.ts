import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export function requestIdMiddleware(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = randomUUID();
  response.locals.requestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  if (_request.path.startsWith('/api/v1/') && !_request.path.startsWith('/api/v1/health'))
    response.setHeader('Cache-Control', 'private, no-store');
  next();
}
