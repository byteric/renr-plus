import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  supportTicketAssigneesSchema,
  supportTicketDetailSchema,
  supportTicketListSchema,
  type PlatformCapability,
} from '@renr/contracts';
import request from 'supertest';
import { createApplication } from '../src/app.factory';
import { parseEnvironment } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';
import { localDatabaseUrl } from './local-database-url';

const runDb = process.env.RUN_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL);
const describeDb = runDb ? describe : describe.skip;
const origin = 'http://127.0.0.1:5173';
const platform = '/api/v1/platform/support-tickets';
const company = (id: string) => `/api/v1/organizations/${id}/support-tickets`;
const openTicket = {
  subject: 'Ajuda com cadastro',
  category: 'TECHNICAL',
  description: 'Cenário fictício de atendimento.',
};

describeDb('ID 50 support tickets on PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let firstId: string;
  let otherId: string;
  const suffix = randomUUID().slice(0, 8);

  beforeAll(async () => {
    const env = parseEnvironment({
      ...process.env,
      NODE_ENV: 'test',
      CORS_ORIGIN: origin,
      STORAGE_ENABLED: 'false',
    });
    localDatabaseUrl(env.DATABASE_URL);
    app = await createApplication(env);
    await app.init();
    db = app.get(PrismaService);
    const [first, second] = await Promise.all([
      db.client.organization.create({ data: { name: `Empresa fictícia 50 A ${suffix}` } }),
      db.client.organization.create({ data: { name: `Empresa fictícia 50 B ${suffix}` } }),
    ]);
    firstId = first.id;
    otherId = second.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function actor(
    key: string,
    options: {
      organizationId?: string;
      role?: 'ADMIN' | 'READER';
      grants?: PlatformCapability[];
    } = {},
  ) {
    const user = await db.client.user.create({
      data: {
        email: `id50-${key}-${suffix}@renr.example`,
        name: `Conta fictícia ${key}`,
        passwordHash: 'unused-test-fixture',
        platformGrants: { create: options.grants?.map((capability) => ({ capability })) ?? [] },
        ...(options.organizationId
          ? {
              memberships: {
                create: { organizationId: options.organizationId, role: options.role ?? 'ADMIN' },
              },
            }
          : {}),
      },
    });
    const token = randomBytes(32).toString('base64url');
    await db.client.session.create({
      data: {
        userId: user.id,
        activeOrganizationId: options.organizationId ?? null,
        expiresAt: new Date(Date.now() + 300_000),
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
    });
    return { ...user, cookie: `renr_session=${token}` };
  }

  it('opens, assigns, sets a civil deadline, records progress and resolves with immutable company-visible history', async () => {
    const [client, manager, agent, reader, finance] = await Promise.all([
      actor('client', { organizationId: firstId }),
      actor('manager', { grants: ['MANAGE_SUPPORT'] }),
      actor('agent', { grants: ['MANAGE_SUPPORT'] }),
      actor('support-read', { grants: ['READ_SUPPORT'] }),
      actor('finance', { grants: ['MANAGE_BILLING'] }),
    ]);
    const http = request(app.getHttpServer());
    await http.post(company(firstId)).set('Cookie', client.cookie).send(openTicket).expect(403);
    const created = await http
      .post(company(firstId))
      .set('Cookie', client.cookie)
      .set('Origin', origin)
      .send(openTicket)
      .expect(201);
    expect(created.headers['cache-control']).toBe('private, no-store');
    const { ticket } = supportTicketDetailSchema.parse(created.body);
    expect(ticket).toMatchObject({
      organizationId: firstId,
      status: 'OPEN',
      version: 1,
      assignee: null,
      dueOn: null,
    });
    const route = `${platform}/${ticket.id}`;
    const payload = {
      expectedVersion: 1,
      status: 'IN_PROGRESS',
      assigneeId: agent.id,
      dueOn: '2026-12-17',
      note: 'Análise da equipe de atendimento iniciada.',
    };

    const assignees = await http
      .get(`${platform}/assignees`)
      .set('Cookie', manager.cookie)
      .expect(200);
    const options = supportTicketAssigneesSchema.parse(assignees.body).items;
    expect(options).toContainEqual({ id: agent.id, name: agent.name });
    expect(options.some(({ id }) => id === finance.id || id === reader.id)).toBe(false);
    await http.get(route).set('Cookie', reader.cookie).expect(200);
    await http.get(route).set('Cookie', finance.cookie).expect(403);
    await http.get(route).set('Cookie', client.cookie).expect(403);
    await http
      .patch(route)
      .set('Cookie', reader.cookie)
      .set('Origin', origin)
      .send(payload)
      .expect(403);
    await http
      .patch(route)
      .set('Cookie', manager.cookie)
      .set('Origin', origin)
      .send({ ...payload, assigneeId: finance.id })
      .expect(409);

    const attempt = (note: string) =>
      request(app.getHttpServer())
        .patch(route)
        .set('Cookie', manager.cookie)
        .set('Origin', origin)
        .send({ ...payload, note });
    const changes = await Promise.all([
      attempt(payload.note),
      attempt('Atualização concorrente de atendimento.'),
    ]);
    expect(changes.map(({ status }) => status).sort()).toEqual([200, 409]);
    const assigned = supportTicketDetailSchema.parse(
      changes.find(({ status }) => status === 200)!.body,
    );
    expect(assigned.ticket).toMatchObject({
      version: 2,
      status: 'IN_PROGRESS',
      dueOn: '2026-12-17',
      assignee: { id: agent.id, name: agent.name },
    });

    const resolution = await http
      .patch(route)
      .set('Cookie', agent.cookie)
      .set('Origin', origin)
      .send({
        ...payload,
        expectedVersion: 2,
        status: 'RESOLVED',
        note: 'Cadastro revisado com a empresa.',
      })
      .expect(200);
    expect(supportTicketDetailSchema.parse(resolution.body).ticket.resolvedAt).not.toBeNull();
    const companyDetail = await http
      .get(`${company(firstId)}/${ticket.id}`)
      .set('Cookie', client.cookie)
      .expect(200);
    const detail = supportTicketDetailSchema.parse(companyDetail.body);
    expect(detail.history.map((item) => [item.version, item.status])).toEqual([
      [1, 'OPEN'],
      [2, 'IN_PROGRESS'],
      [3, 'RESOLVED'],
    ]);
    expect(detail.history.at(-1)).toMatchObject({
      actorName: agent.name,
      note: 'Cadastro revisado com a empresa.',
    });
    await db.client.supportTicketRevision
      .update({
        where: { id: detail.history[0]!.id },
        data: { note: 'Trilha adulterada' },
      })
      .then(
        () => {
          throw new Error('Historic update accepted');
        },
        (error: unknown) => {
          expect(String(error)).toContain('Support ticket history is immutable');
        },
      );
  });

  it('blocks direct cross-company access, separated grants, revoked grants and suspended customers', async () => {
    const [first, second, reader, operator] = await Promise.all([
      actor('first', { organizationId: firstId }),
      actor('second', { organizationId: otherId }),
      actor('company-read', { organizationId: otherId, role: 'READER' }),
      actor('operator', { grants: ['MANAGE_SUPPORT'] }),
    ]);
    const http = request(app.getHttpServer());
    const created = await http
      .post(company(firstId))
      .set('Cookie', first.cookie)
      .set('Origin', origin)
      .send(openTicket)
      .expect(201);
    const id = supportTicketDetailSchema.parse(created.body).ticket.id;
    await http
      .get(`${company(firstId)}/${id}`)
      .set('Cookie', second.cookie)
      .expect(404);
    await http
      .get(`${company(otherId)}/${id}`)
      .set('Cookie', second.cookie)
      .expect(404);
    await http.get(company(otherId)).set('Cookie', reader.cookie).expect(403);
    const otherQueue = await http.get(company(otherId)).set('Cookie', second.cookie).expect(200);
    expect(supportTicketListSchema.parse(otherQueue.body)).toMatchObject({ items: [], total: 0 });
    const filterOther = await http
      .get(`${platform}?organizationId=${otherId}`)
      .set('Cookie', operator.cookie)
      .expect(200);
    expect(supportTicketListSchema.parse(filterOther.body)).toMatchObject({ items: [], total: 0 });
    await http.get(`${platform}/${id}`).set('Cookie', operator.cookie).expect(200);
    await db.client.platformGrant.update({
      where: { userId_capability: { userId: operator.id, capability: 'MANAGE_SUPPORT' } },
      data: { isActive: false },
    });
    await http.get(`${platform}/${id}`).set('Cookie', operator.cookie).expect(403);
    await http.get(platform).set('Cookie', operator.cookie).expect(403);

    const contract = await db.client.commercialContract.create({
      data: { organizationId: otherId },
    });
    await db.client.commercialContractAccess.create({
      data: {
        organizationId: otherId,
        contractId: contract.id,
        status: 'SUSPENDED',
        lastTransitionKind: 'SUSPENSION',
        lastRule: 'MANUAL_CONTRACT_SUSPENSION',
        lastEffectiveOn: new Date('2026-11-25T00:00:00.000Z'),
        lastReason: 'Suspensão fictícia para teste de fronteira.',
        lastNextStep: 'Consultar o atendimento.',
        updatedBy: first.id,
      },
    });
    await http.get(company(otherId)).set('Cookie', second.cookie).expect(403);
  });
});
