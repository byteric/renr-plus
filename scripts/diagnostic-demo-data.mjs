import { createHash } from 'node:crypto';

/** Deterministic IDs identify fixtures, never credentials or participants. */
export function diagnosticDemoId(organizationId, key) {
  const hex = createHash('sha256').update(`renr-demo-v1:${organizationId}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function buildDemoInstrument(organizationId) {
  const id = diagnosticDemoId(organizationId, 'instrument');
  const definitions = [
    [
      'Como você prefere receber orientações em uma situação fictícia?',
      'SINGLE_CHOICE',
      ['Mensagem escrita', 'Conversa direta'],
    ],
    [
      'Em um cenário de teste, a organização das tarefas está clara?',
      'SINGLE_CHOICE',
      ['Adequada', 'Precisa de ajustes'],
    ],
    [
      'Qual frequência de alinhamento você escolheria para uma equipe fictícia?',
      'SINGLE_CHOICE',
      ['Semanal', 'Quinzenal'],
    ],
    [
      'Quais canais seriam úteis no cenário de teste?',
      'MULTIPLE_CHOICE',
      ['Reunião', 'Mensagem', 'Quadro de tarefas'],
    ],
    [
      'Quais ações você priorizaria para uma equipe fictícia?',
      'MULTIPLE_CHOICE',
      ['Definir prioridades', 'Revisar distribuição', 'Reservar alinhamentos'],
    ],
  ];
  return {
    id,
    organizationId,
    title: 'Instrumento demonstrativo ReNR+',
    version: 1,
    status: 'PUBLISHED',
    isDemo: true,
    questions: {
      create: definitions.map(([label, type, options], index) => ({
        id: diagnosticDemoId(organizationId, `question-${index}`),
        label,
        type,
        required: true,
        position: index + 1,
        options: {
          create: options.map((option, position) => ({
            id: diagnosticDemoId(organizationId, `question-${index}-option-${position}`),
            label: option,
            position: position + 1,
          })),
        },
      })),
    },
  };
}

export async function provisionDemoInstrument(transaction, organizationId) {
  // A new catalog may also have a version 1; only the reserved projection is legacy.
  const existing = await transaction.instrumentVersion.findFirst({
    where: { organizationId, version: 1, isDemo: true },
  });
  if (existing) return existing;
  return transaction.instrumentVersion.create({ data: buildDemoInstrument(organizationId) });
}
