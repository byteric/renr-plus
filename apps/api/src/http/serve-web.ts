import type { INestApplication } from '@nestjs/common';
import { realpathSync, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { Environment } from '../config/env';

const publicExtensions = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
  '.webp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.webmanifest',
  '.json',
  '.txt',
]);

function isWithinDirectory(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return (
    path !== '' &&
    path !== '..' &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path) &&
    !path.split(sep).some((segment) => segment.startsWith('.'))
  );
}

export function configureWebServing(app: INestApplication, environment: Environment): void {
  if (app.getHttpAdapter().getType() !== 'express') {
    throw new Error('SERVE_WEB requires the Express HTTP adapter');
  }
  if (!environment.WEB_DIST_PATH) {
    throw new Error('SERVE_WEB requires WEB_DIST_PATH');
  }
  let directory: string;
  let index: string;
  try {
    directory = realpathSync(resolve(environment.WEB_DIST_PATH));
    index = realpathSync(resolve(directory, 'index.html'));
    if (
      !statSync(directory).isDirectory() ||
      !statSync(index).isFile() ||
      !isWithinDirectory(directory, index)
    ) {
      throw new Error('Invalid web build');
    }
  } catch {
    throw new Error('SERVE_WEB requires a built WEB_DIST_PATH directory containing index.html');
  }

  app.use(async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      next();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(request.path);
    } catch {
      next();
      return;
    }
    const segments = path.split('/');
    const reservedPath = path.toLowerCase();
    if (
      reservedPath === '/api' ||
      reservedPath.startsWith('/api/') ||
      path.includes('\\') ||
      path.includes('\0') ||
      segments.some((segment) => segment.startsWith('.'))
    ) {
      next();
      return;
    }
    const extension = extname(path).toLowerCase();
    if (publicExtensions.has(extension)) {
      try {
        const file = await realpath(resolve(directory, `.${path}`));
        if (isWithinDirectory(directory, file) && (await stat(file)).isFile()) {
          response.sendFile(file, { dotfiles: 'deny' }, (error) => {
            if (error) next(error);
          });
          return;
        }
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
        ) {
          next(error);
          return;
        }
      }
    }
    const acceptsHtml =
      /(?:^|,)\s*text\/html\s*(?:;|,|$)/i.test(request.get('accept') ?? '') &&
      request.accepts('html');
    if (
      extension ||
      reservedPath === '/assets' ||
      reservedPath.startsWith('/assets/') ||
      !acceptsHtml
    ) {
      next();
      return;
    }
    response.setHeader('Cache-Control', 'no-cache');
    response.sendFile(index, { dotfiles: 'deny' }, (error) => {
      if (error) next(error);
    });
  });
}
