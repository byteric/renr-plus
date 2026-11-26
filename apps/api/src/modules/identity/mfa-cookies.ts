import type { Request, Response } from 'express';
import type { Environment } from '../../config/env';
import { SESSION_COOKIE, type IssuedSession } from './identity.service';
import {
  credentialCookie,
  MFA_CHALLENGE_COOKIE,
  MFA_COOKIE_PATH,
  type PendingLogin,
} from './mfa-security';

function options(environment: Environment, path: string) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: environment.NODE_ENV === 'production',
    path,
  };
}

export function setSessionCookie(
  response: Response,
  environment: Environment,
  issued: IssuedSession,
) {
  response.cookie(SESSION_COOKIE, issued.token, {
    ...options(environment, '/api/v1'),
    expires: new Date(issued.session.expiresAt),
  });
}

export function clearSessionCookie(response: Response, environment: Environment) {
  response.clearCookie(SESSION_COOKIE, options(environment, '/api/v1'));
}

export function setChallengeCookie(
  request: Request,
  response: Response,
  environment: Environment,
  pending: PendingLogin,
) {
  if (credentialCookie(request, SESSION_COOKIE)) clearSessionCookie(response, environment);
  response.cookie(MFA_CHALLENGE_COOKIE, pending.token, {
    ...options(environment, MFA_COOKIE_PATH),
    expires: pending.expiresAt,
  });
}

export function clearChallengeCookie(response: Response, environment: Environment) {
  response.clearCookie(MFA_CHALLENGE_COOKIE, options(environment, MFA_COOKIE_PATH));
}
