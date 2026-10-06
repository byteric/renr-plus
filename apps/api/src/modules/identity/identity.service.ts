import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { SessionResponse } from '@renr/contracts';
import { ENVIRONMENT, type Environment } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { verifyPassword } from './password';

export const SESSION_COOKIE = 'renr_session';
const sessionDuration = 8 * 60 * 60 * 1000;
const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');
const includeUser = { user: { include: { memberships: { include: { organization: true } } } } };

@Injectable()
export class IdentityService {
  private readonly attempts = new Map<string, { count: number; expires: number }>();
  constructor(
    private readonly database: PrismaService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  assertOrigin(request: Request): void {
    if (request.get('origin') !== new URL(this.environment.CORS_ORIGIN).origin)
      throw new ForbiddenException();
  }

  async login(
    email: string,
    password: string,
    ip: string,
  ): Promise<{ token: string; session: SessionResponse }> {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.expires <= now) this.attempts.delete(key);
    const key = tokenHash(`${ip}:${email}`);
    const ipKey = tokenHash(`ip:${ip}`);
    const ipAttempt = this.attempts.get(ipKey) ?? { count: 0, expires: now + 15 * 60 * 1000 };
    const attempt = this.attempts.get(key) ?? { count: 0, expires: now + 15 * 60 * 1000 };
    if (attempt.count >= 5 || ipAttempt.count >= 60 || this.attempts.size >= 10000)
      throw new HttpException('Too many requests', 429);
    attempt.count += 1;
    ipAttempt.count += 1;
    this.attempts.set(ipKey, ipAttempt);
    this.attempts.set(key, attempt);
    const user = await this.database.client.user.findUnique({
      where: { email },
      include: { memberships: { include: { organization: true } } },
    });
    const dummy = 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128);
    const valid = await verifyPassword(password, user?.passwordHash ?? dummy);
    if (!user || !valid) {
      await this.database.client.auditEvent.create({
        data: { actorId: user?.id, action: 'AUTH_LOGIN_FAILED' },
      });
      throw new UnauthorizedException();
    }
    const token = randomBytes(32).toString('base64url');
    const session = await this.database.client.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: tokenHash(token),
          activeOrganizationId: user.memberships[0]?.organizationId ?? null,
          expiresAt: new Date(now + sessionDuration),
        },
        include: includeUser,
      });
      await tx.auditEvent.create({
        data: { actorId: user.id, action: 'AUTH_LOGIN', resourceId: created.id },
      });
      return created;
    });
    this.attempts.delete(key);
    return { token, session: this.toResponse(session) };
  }

  async authenticate(request: Request) {
    const cookie = request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
    const token = cookie?.slice(SESSION_COOKIE.length + 1);
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new UnauthorizedException();
    const session = await this.database.client.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: includeUser,
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
    return session;
  }

  async current(request: Request): Promise<SessionResponse> {
    return this.toResponse(await this.authenticate(request));
  }
  async logout(request: Request): Promise<void> {
    const session = await this.authenticate(request);
    await this.database.client.$transaction(async (tx) => {
      await tx.session.delete({ where: { id: session.id } });
      await tx.auditEvent.create({
        data: { actorId: session.userId, action: 'AUTH_LOGOUT', resourceId: session.id },
      });
    });
  }
  async activate(request: Request, organizationId: string): Promise<SessionResponse> {
    const session = await this.authenticate(request);
    if (!session.user.memberships.some((member) => member.organizationId === organizationId))
      throw new ForbiddenException();
    const updated = await this.database.client.session.update({
      where: { id: session.id },
      data: { activeOrganizationId: organizationId },
      include: includeUser,
    });
    return this.toResponse(updated);
  }
  async scope(
    request: Request,
    organizationId: string | undefined,
    write: boolean,
  ): Promise<{ userId: string; organizationId: string }> {
    const session = await this.authenticate(request);
    const active = session.activeOrganizationId;
    const member = session.user.memberships.find((item) => item.organizationId === active);
    if (!active || !member || (organizationId !== undefined && active !== organizationId))
      throw new HttpException('Not found', 404);
    if (write && member.role !== 'ADMIN') throw new ForbiddenException();
    return { userId: session.userId, organizationId: active };
  }
  private toResponse(
    session: Awaited<ReturnType<IdentityService['authenticate']>>,
  ): SessionResponse {
    return {
      user: { id: session.user.id, name: session.user.name, email: session.user.email },
      memberships: session.user.memberships.map((item) => ({
        organizationId: item.organizationId,
        organizationName: item.organization.name,
        role: item.role,
      })),
      activeOrganizationId: session.user.memberships.some(
        (item) => item.organizationId === session.activeOrganizationId,
      )
        ? session.activeOrganizationId
        : null,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
}
