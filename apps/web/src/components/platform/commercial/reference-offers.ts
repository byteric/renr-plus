import type { CommercialOfferVersionInput, CommercialPlan } from '@renr/contracts';

type ReferenceOffer = {
  name: string;
  kind: CommercialPlan['kind'];
  version: Omit<CommercialOfferVersionInput, 'effectiveOn'>;
};

const bronzeBase = ['Avaliação psicossocial', 'Resumo executivo', 'Painel por departamento'];
const bronzePlanned = ['Atendimento da ReTech+ por e-mail'];
const prataPlanned = ['EAD, matrículas e trilhas', 'Classificação P1/P2/P3'];

export const referenceOffers: Record<string, ReferenceOffer> = {
  BRONZE: {
    name: 'Bronze',
    kind: 'PLAN',
    version: {
      priceCents: 1290,
      pricingUnit: 'EMPLOYEE_MONTH',
      priceMode: 'FIXED',
      conditions:
        'Oferta de referência por colaborador e por mês. Confirmar as condições contratadas.',
      limits: 'Resumo executivo de até 10 páginas, conforme a oferta de referência.',
      includedFeatures: bronzeBase,
      plannedFeatures: bronzePlanned,
    },
  },
  PRATA: {
    name: 'Prata',
    kind: 'PLAN',
    version: {
      priceCents: 1990,
      pricingUnit: 'EMPLOYEE_MONTH',
      priceMode: 'FIXED',
      conditions: 'Oferta de referência baseada no Bronze, com ampliações previstas.',
      limits: 'Limites das ampliações a confirmar no contrato.',
      includedFeatures: bronzeBase,
      plannedFeatures: [...bronzePlanned, ...prataPlanned],
    },
  },
  OURO: {
    name: 'Ouro',
    kind: 'PLAN',
    version: {
      priceCents: 2890,
      pricingUnit: 'EMPLOYEE_MONTH',
      priceMode: 'FIXED',
      conditions: 'Oferta de referência baseada no Prata, com ampliações de governança previstas.',
      limits: 'Limites das ampliações a confirmar no contrato.',
      includedFeatures: bronzeBase,
      plannedFeatures: [
        ...bronzePlanned,
        ...prataPlanned,
        'Governança ampliada',
        'Comparativos de protocolos',
        'Auditoria assistida',
        'IA assistiva em evolução futura',
      ],
    },
  },
  CAPACITACAO: {
    name: 'Capacitação NR-01',
    kind: 'SERVICE',
    version: {
      priceCents: 99000,
      pricingUnit: 'TRAINING_CLASS',
      priceMode: 'FIXED',
      conditions: 'Serviço avulso. Condições de realização a confirmar.',
      limits: 'Até 25 colaboradores por turma.',
      includedFeatures: [],
      plannedFeatures: [],
    },
  },
  PGR: {
    name: 'Elaboração de PGR',
    kind: 'SERVICE',
    version: {
      priceCents: 35000,
      pricingUnit: 'SERVICE',
      priceMode: 'STARTING_AT',
      conditions: 'Serviço avulso. Valor final sujeito à conferência do escopo.',
      limits: '',
      includedFeatures: [],
      plannedFeatures: [],
    },
  },
  AVALIACOES: {
    name: 'Avaliações especializadas',
    kind: 'SERVICE',
    version: {
      priceCents: 55000,
      pricingUnit: 'SERVICE',
      priceMode: 'STARTING_AT',
      conditions: 'Serviço avulso. Valor final sujeito à conferência do escopo.',
      limits: '',
      includedFeatures: [],
      plannedFeatures: [],
    },
  },
};
