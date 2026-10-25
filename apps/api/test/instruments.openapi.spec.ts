import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as contracts from '@renr/contracts';
import { z } from 'zod';

describe('Instrument catalog OpenAPI contract', () => {
  it('parses as OpenAPI 3.1 JSON and keeps its referenced schemas consistent with executable contracts', () => {
    const document = z
      .object({
        openapi: z.literal('3.1.0'),
        paths: z.record(z.string(), z.unknown()),
        components: z.object({ schemas: z.record(z.string(), z.unknown()) }),
      })
      .parse(
        JSON.parse(
          readFileSync(
            resolve(__dirname, '../src/modules/instruments/instruments.openapi.json'),
            'utf8',
          ),
        ),
      );
    expect(Object.keys(document.paths)).toHaveLength(6);
    for (const [name, expected] of Object.entries(document.components.schemas)) {
      const schema = (contracts as Record<string, unknown>)[name];
      if (!(schema instanceof z.ZodType)) throw new Error(`Missing executable contract ${name}`);
      expect(expected).toEqual(z.toJSONSchema(schema, { unrepresentable: 'any' }));
    }
  });
});
