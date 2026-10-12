import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionHomologationData } from './homologation-data.mjs';

test('synthetic provisioning is idempotent and preserves all existing records', async () => {
  const stores = Object.fromEntries(
    ['user', 'organization', 'membership', 'unit', 'sector'].map((model) => [model, new Map()]),
  );
  const existing = {
    id: 'existing-user',
    email: 'admin1@renr.example',
    name: 'Preserved name',
    passwordHash: 'preserved-password',
  };
  stores.user.set(JSON.stringify({ email: existing.email }), existing);
  const tx = Object.fromEntries(
    Object.entries(stores).map(([model, store]) => [
      model,
      {
        async upsert({ where, update, create }) {
          assert.deepEqual(update, {});
          const key = JSON.stringify(where);
          if (!store.has(key)) store.set(key, { id: `${model}-${store.size}`, ...create });
          return store.get(key);
        },
      },
    ]),
  );
  let transactions = 0;
  const client = {
    async $transaction(fn) {
      transactions++;
      await fn(tx);
    },
  };
  await provisionHomologationData(client, 'new-password-hash');
  const first = JSON.stringify(Object.values(stores).map((store) => [...store]));
  await provisionHomologationData(client, 'another-password-hash');
  assert.equal(JSON.stringify(Object.values(stores).map((store) => [...store])), first);
  assert.deepEqual(stores.user.get(JSON.stringify({ email: existing.email })), existing);
  assert.deepEqual(
    Object.values(stores).map((store) => store.size),
    [3, 2, 3, 2, 2],
  );
  assert.equal(transactions, 2);
});
