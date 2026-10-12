import test from 'node:test';
import assert from 'node:assert/strict';
import { homologationConfig } from './homologation-config.mjs';
import { provisionHomologation } from './provision-homologation.mjs';

const env = {
  NODE_ENV: 'production',
  ALLOW_HOMOLOGATION_PROVISION: 'true',
  DATABASE_URL_UNPOOLED:
    'postgresql://user:secret@ep-test.neon.tech/homologation?sslmode=verify-full&channel_binding=require',
  HOMOLOGATION_CONFIRM_HOST: 'ep-test.neon.tech',
  HOMOLOGATION_CONFIRM_DATABASE: 'homologation',
  HOMOLOGATION_PASSWORD: 'a-new-homologation-password',
};
test('requires explicit opt-in, exact host/database and a new password', () => {
  assert.equal(homologationConfig(env).url.hostname, env.HOMOLOGATION_CONFIRM_HOST);
  for (const key of [
    'NODE_ENV',
    'ALLOW_HOMOLOGATION_PROVISION',
    'HOMOLOGATION_CONFIRM_HOST',
    'HOMOLOGATION_CONFIRM_DATABASE',
    'HOMOLOGATION_PASSWORD',
  ])
    assert.throws(() => homologationConfig({ ...env, [key]: '' }));
  assert.throws(
    () => homologationConfig({ ...env, DEMO_PASSWORD: env.HOMOLOGATION_PASSWORD }),
    /new/,
  );
});
test('rejects pooled endpoints, unverified TLS and unsafe URL parameters', () => {
  for (const url of [
    env.DATABASE_URL_UNPOOLED.replace('ep-test.', 'ep-test-pooler.'),
    env.DATABASE_URL_UNPOOLED.replace('verify-full', 'require'),
    `${env.DATABASE_URL_UNPOOLED}&sslaccept=accept_invalid_certs`,
    `${env.DATABASE_URL_UNPOOLED}&uselibpqcompat=true`,
    `${env.DATABASE_URL_UNPOOLED}&sslmode=disable`,
    'https://ep-test.neon.tech/homologation',
  ])
    assert.throws(() => homologationConfig({ ...env, DATABASE_URL_UNPOOLED: url }));
  assert.throws(() => homologationConfig({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /TLS/);
});
test('manual entry point fails guards before loading dependencies or connecting', async () => {
  await assert.rejects(
    provisionHomologation({ ...env, ALLOW_HOMOLOGATION_PROVISION: 'false' }),
    /ALLOW_HOMOLOGATION_PROVISION/,
  );
});
