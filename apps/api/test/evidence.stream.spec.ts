import { Test } from '@nestjs/testing';
import { Readable } from 'node:stream';
import { EvidenceController, EvidenceGuard } from '../src/modules/evidence/evidence.controller';
import { EvidenceService } from '../src/modules/evidence/evidence.service';

describe('Private attachment stream failures', () => {
  it('does not expose provider diagnostics or replace the API error envelope', async () => {
    const module = await Test.createTestingModule({
      controllers: [EvidenceController],
      providers: [
        {
          provide: EvidenceService,
          useValue: {
            download: async () => ({
              stream: Readable.from([]),
              file: { mimeType: 'application/pdf', fileName: 'synthetic.pdf', size: 100 },
            }),
          },
        },
      ],
    })
      .overrideGuard(EvidenceGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const controller = module.get(EvidenceController);
    const response = {
      setHeader: jest.fn(),
      removeHeader: jest.fn(),
      locals: { requestId: '11111111-1111-4111-8111-111111111111' },
    };
    const stream = await Reflect.apply(controller.download, controller, [
      {},
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      response,
    ]);
    const wire = {
      destroyed: false,
      headersSent: false,
      statusCode: 200,
      send: jest.fn(),
      end: jest.fn(),
    };
    stream.errorHandler(new Error('provider key=secret diagnostic'), wire);
    expect(wire.statusCode).toBe(503);
    expect(JSON.parse(wire.send.mock.calls[0]?.[0] ?? '{}')).toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      requestId: '11111111-1111-4111-8111-111111111111',
    });
    expect(wire.send.mock.calls[0]?.[0]).not.toContain('secret');
    await module.close();
  });
});
