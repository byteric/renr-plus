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
  next();
}
