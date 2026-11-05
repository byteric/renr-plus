export const CLT_POLICY_VERSION = 'clt-fixed-indemnified-2026-11-v1';
export const CLT_SOURCES = [
  {
    name: 'CLT arts. 130–147 e 487',
    url: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm',
  },
  {
    name: 'Lei 12.506/2011',
    url: 'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2011/lei/l12506.htm',
  },
  { name: 'Lei 4.090/1962', url: 'https://www.planalto.gov.br/ccivil_03/leis/l4090.htm' },
  {
    name: 'Lei 8.036/1990 art. 18',
    url: 'https://www.planalto.gov.br/ccivil_03/leis/l8036consol.htm',
  },
  {
    name: 'HomologNet julho/2013 RN 2.3.1.4 (histórico)',
    url: 'https://acesso.trabalho.gov.br/data/files/8A7C812D412E236B014130CF9D082897/HomologNet%20Caso%20de%20Uso%20Calcular%20Verbas%20Rescis%C3%B3rias%20Julho_2013.pdf',
  },
  {
    name: 'STF ADPF 501',
    url: 'https://portal.stf.jus.br/noticias/verNoticiaDetalhe.asp?idConteudo=492245&ori=1',
  },
] as const;

export interface CltAcquiredVacationPeriod {
  acquisitionStart: string;
  entitlementDays: number;
  balanceDays: number;
  concessionDeadline: string;
  historyKnown: boolean;
}
export interface CltCalculationInput {
  admissionDate: string;
  terminationDate: string;
  monthlySalaryCents: string;
  /** Dias ainda devidos, apesar do nome legado; nunca dias já pagos. */
  paidSalaryDays?: number;
  remunerationType?: 'FIXED' | 'VARIABLE';
  vacationHistoryKnown?: boolean;
  acquiredVacationPeriods?: CltAcquiredVacationPeriod[];
  currentAcquisitionStart?: string;
  currentAcquisitionHistoryKnown?: boolean;
  unjustifiedAbsences?: number;
  complexLeaveHistoryKnown?: boolean;
  hasComplexLeaves?: boolean;
  /** Confirma que dias civis cobertos computam para 13º, salvo mapa mensal. */
  thirteenthHistoryKnown?: boolean;
  thirteenthComputableDaysByMonth?: Record<string, number>;
  thirteenthAdvanceCents?: string;
  fgts?: { terminationBaseCents?: string; confirmedIncludesPending?: boolean };
}
export type CltItemCode =
  | 'SALARY_BALANCE'
  | 'NOTICE_INDEMNITY'
  | 'ACQUIRED_VACATION'
  | 'PROPORTIONAL_VACATION'
  | 'THIRTEENTH'
  | 'THIRTEENTH_ADVANCE';
export interface CltCalculationItem {
  code: CltItemCode;
  label: string;
  amountCents: string | null;
  reference?: string;
  units?: number;
}
export interface CltCalculationResult {
  policyVersion: string;
  sources: { name: string; url: string }[];
  status: 'complete' | 'partial';
  noticeDays: number;
  projectedTerminationDate: string;
  items: CltCalculationItem[];
  /** Bruto antes do adiantamento, que aparece como rubrica negativa separada. */
  grossTotalCents: string | null;
  subtotalCents: string;
  fgtsPenaltyCents: string | null;
  missingInputs: string[];
  reasons: string[];
}
export class CltInputError extends Error {
  readonly code = 'INVALID_CLT_INPUT';
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
    this.name = 'CltInputError';
  }
}

const DAY = 86_400_000;
function date(value: string, field: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new CltInputError(field, 'use YYYY-MM-DD');
  const result = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(result.getTime()) ||
    result.toISOString().slice(0, 10) !== value ||
    result.getUTCFullYear() < 1900 ||
    result.getUTCFullYear() > 9998
  )
    throw new CltInputError(field, 'invalid civil date (1900–9998)');
  return result;
}
function iso(value: Date): string {
  return value.toISOString().slice(0, 10);
}
function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY);
}
function monthDays(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
function addMonths(value: Date, months: number): Date {
  const first = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
  first.setUTCDate(
    Math.min(value.getUTCDate(), monthDays(first.getUTCFullYear(), first.getUTCMonth())),
  );
  return first;
}
function integer(value: number, min: number, max: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new CltInputError(field, `expected integer ${min}–${max}`);
}
function cents(value: string, field: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value))
    throw new CltInputError(field, 'expected nonnegative integer cents, at most 15 digits');
  return BigInt(value);
}
/** Arredonda uma vez por rubrica, meio centavo para cima. */
function round(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}
export function vacationEntitlementDays(absences: number): number {
  integer(absences, 0, 366, 'unjustifiedAbsences');
  return absences <= 5 ? 30 : absences <= 14 ? 24 : absences <= 23 ? 18 : absences <= 32 ? 12 : 0;
}
function vacationMonths(start: Date, endExclusive: Date): number {
  let months = 0;
  while (addMonths(start, months + 1) <= endExclusive) months += 1;
  return (
    months + ((endExclusive.getTime() - addMonths(start, months).getTime()) / DAY > 14 ? 1 : 0)
  );
}

/** Sem relógio, I/O, ORM ou dependência de framework; entrada não é modificada. */
export function calculateCltSettlement(input: CltCalculationInput): CltCalculationResult {
  const admission = date(input.admissionDate, 'admissionDate');
  const termination = date(input.terminationDate, 'terminationDate');
  if (admission > termination)
    throw new CltInputError('terminationDate', 'must not precede admission');
  const salary = cents(input.monthlySalaryCents, 'monthlySalaryCents');
  if (
    input.remunerationType !== undefined &&
    !['FIXED', 'VARIABLE'].includes(input.remunerationType)
  )
    throw new CltInputError('remunerationType', 'unsupported remuneration');
  for (const field of [
    'vacationHistoryKnown',
    'currentAcquisitionHistoryKnown',
    'complexLeaveHistoryKnown',
    'hasComplexLeaves',
    'thirteenthHistoryKnown',
  ] as const) {
    if (input[field] !== undefined && typeof input[field] !== 'boolean')
      throw new CltInputError(field, 'expected boolean');
  }
  if (input.unjustifiedAbsences !== undefined) vacationEntitlementDays(input.unjustifiedAbsences);
  let years = termination.getUTCFullYear() - admission.getUTCFullYear();
  if (addMonths(admission, years * 12) > termination) years -= 1;
  const noticeDays = Math.min(90, 30 + 3 * years);
  const projected = addDays(termination, noticeDays);
  if (projected.getUTCFullYear() > 9998)
    throw new CltInputError('terminationDate', 'projection exceeds supported range');
  const daysInMonth = monthDays(termination.getUTCFullYear(), termination.getUTCMonth());
  const firstDueDay =
    admission.getUTCFullYear() === termination.getUTCFullYear() &&
    admission.getUTCMonth() === termination.getUTCMonth()
      ? admission.getUTCDate()
      : 1;
  const maximumDueDays = termination.getUTCDate() - firstDueDay + 1;
  const dueDays = input.paidSalaryDays ?? maximumDueDays;
  integer(dueDays, 0, maximumDueDays, 'paidSalaryDays');
  if (input.thirteenthAdvanceCents !== undefined)
    cents(input.thirteenthAdvanceCents, 'thirteenthAdvanceCents');
  if (input.fgts?.terminationBaseCents !== undefined)
    cents(input.fgts.terminationBaseCents, 'fgts.terminationBaseCents');
  if (
    input.fgts?.confirmedIncludesPending !== undefined &&
    typeof input.fgts.confirmedIncludesPending !== 'boolean'
  )
    throw new CltInputError('fgts.confirmedIncludesPending', 'expected boolean');

  const missingInputs: string[] = [];
  const reasons: string[] = [];
  const missing = (field: string, reason: string): void => {
    if (!missingInputs.includes(field)) missingInputs.push(field);
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  const fixed = input.remunerationType !== 'VARIABLE';
  if (!fixed)
    missing(
      'assessedRemunerationCents',
      'Remuneração variável exige bases apuradas por rubrica; fora deste motor de salário fixo.',
    );
  const ordinaryHistory =
    input.complexLeaveHistoryKnown === true && input.hasComplexLeaves === false;
  if (input.complexLeaveHistoryKnown !== true)
    missing('complexLeaveHistoryKnown', 'Histórico de afastamentos não confirmado.');
  if (input.hasComplexLeaves === undefined)
    missing('hasComplexLeaves', 'Informe se existem afastamentos complexos.');
  if (input.hasComplexLeaves === true)
    missing(
      'assessedLeaveHistory',
      'Afastamentos complexos exigem apuração dos períodos computáveis.',
    );
  const items: CltCalculationItem[] = [];
  const add = (
    code: CltItemCode,
    label: string,
    amount: bigint | null,
    reference?: string,
    units?: number,
  ): void => {
    items.push({
      code,
      label,
      amountCents: amount === null ? null : amount.toString(),
      ...(reference === undefined ? {} : { reference }),
      ...(units === undefined ? {} : { units }),
    });
  };
  add(
    'SALARY_BALANCE',
    'Saldo de salário (divisor dias reais do mês)',
    fixed && ordinaryHistory ? round(salary * BigInt(dueDays), BigInt(daysInMonth)) : null,
    input.terminationDate.slice(0, 7),
    dueDays,
  );
  add(
    'NOTICE_INDEMNITY',
    'Aviso prévio integral indenizado',
    fixed ? round(salary * BigInt(noticeDays), 30n) : null,
    undefined,
    noticeDays,
  );
  if (input.vacationHistoryKnown !== true)
    missing('vacationHistoryKnown', 'Histórico completo de férias adquiridas não confirmado.');
  if (input.acquiredVacationPeriods === undefined)
    missing(
      'acquiredVacationPeriods',
      'Informe períodos adquiridos e saldos; lista vazia exige confirmação do histórico.',
    );
  if (input.acquiredVacationPeriods !== undefined && !Array.isArray(input.acquiredVacationPeriods))
    throw new CltInputError('acquiredVacationPeriods', 'expected array');
  const seen = new Set<string>();
  for (const [index, period] of (input.acquiredVacationPeriods ?? []).entries()) {
    const path = `acquiredVacationPeriods.${index}`;
    const start = date(period.acquisitionStart, `${path}.acquisitionStart`);
    const deadline = date(period.concessionDeadline, `${path}.concessionDeadline`);
    if (
      start < admission ||
      addMonths(start, 12) > addDays(termination, 1) ||
      deadline < addMonths(start, 12)
    )
      throw new CltInputError(path, 'inconsistent acquired period or deadline');
    if (seen.has(period.acquisitionStart))
      throw new CltInputError(path, 'duplicate acquisition start');
    for (const previous of seen) {
      const previousStart = date(previous, 'acquisitionStart');
      if (start < addMonths(previousStart, 12) && previousStart < addMonths(start, 12))
        throw new CltInputError(path, 'overlapping acquisition periods');
    }
    seen.add(period.acquisitionStart);
    if (![0, 12, 18, 24, 30].includes(period.entitlementDays))
      throw new CltInputError(`${path}.entitlementDays`, 'expected 0, 12, 18, 24 or 30 days');
    integer(period.balanceDays, 0, period.entitlementDays, `${path}.balanceDays`);
    if (typeof period.historyKnown !== 'boolean')
      throw new CltInputError(`${path}.historyKnown`, 'expected boolean');
    if (!period.historyKnown)
      missing(`${path}.historyKnown`, 'Saldo e concessão do período adquirido não confirmados.');
    const doubled = projected > deadline;
    add(
      'ACQUIRED_VACATION',
      doubled
        ? 'Férias adquiridas: saldo em dobro com terço'
        : 'Férias adquiridas: saldo com terço',
      fixed && ordinaryHistory && period.historyKnown
        ? round(salary * BigInt(period.balanceDays) * 4n * (doubled ? 2n : 1n), 90n)
        : null,
      period.acquisitionStart,
      period.balanceDays,
    );
  }
  if (input.vacationHistoryKnown !== true || input.acquiredVacationPeriods === undefined)
    add('ACQUIRED_VACATION', 'Férias adquiridas: histórico incompleto', null);
  let current: Date | undefined;
  if (input.currentAcquisitionStart !== undefined) {
    current = date(input.currentAcquisitionStart, 'currentAcquisitionStart');
    if (current < admission || current > termination || addMonths(current, 12) <= termination)
      throw new CltInputError(
        'currentAcquisitionStart',
        'must identify open period at termination',
      );
    for (const start of seen)
      if (addMonths(date(start, 'acquisitionStart'), 12) > current)
        throw new CltInputError('acquiredVacationPeriods', 'overlapping acquisition periods');
  } else missing('currentAcquisitionStart', 'Início do período aquisitivo atual não informado.');
  if (input.currentAcquisitionHistoryKnown !== true)
    missing(
      'currentAcquisitionHistoryKnown',
      'Histórico do período aquisitivo atual não confirmado.',
    );
  if (input.unjustifiedAbsences === undefined)
    missing('unjustifiedAbsences', 'Faltas injustificadas do período atual não informadas.');
  const vacationKnown =
    fixed &&
    ordinaryHistory &&
    input.currentAcquisitionHistoryKnown === true &&
    input.unjustifiedAbsences !== undefined;
  if (vacationKnown && current !== undefined && input.unjustifiedAbsences !== undefined) {
    const entitlement = vacationEntitlementDays(input.unjustifiedAbsences);
    const endExclusive = addDays(projected, 1);
    if (addMonths(current, 12) <= endExclusive) {
      add(
        'ACQUIRED_VACATION',
        'Férias adquiridas na projeção com terço',
        round(salary * BigInt(entitlement) * 4n, 90n),
        iso(current),
        entitlement,
      );
      current = addMonths(current, 12);
      const months = vacationMonths(current, endExclusive);
      // Novo período existe somente no aviso indenizado, sem faltas de trabalho.
      add(
        'PROPORTIONAL_VACATION',
        'Férias proporcionais com terço',
        round(salary * BigInt(months) * 4n, 36n),
        iso(current),
        months,
      );
    } else {
      const months = vacationMonths(current, endExclusive);
      add(
        'PROPORTIONAL_VACATION',
        'Férias proporcionais com terço',
        round(salary * BigInt(entitlement) * BigInt(months) * 4n, 1080n),
        iso(current),
        months,
      );
    }
  } else add('PROPORTIONAL_VACATION', 'Férias proporcionais: apuração pendente', null);

  for (const [month, days] of Object.entries(input.thirteenthComputableDaysByMonth ?? {})) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
      throw new CltInputError('thirteenthComputableDaysByMonth', 'expected YYYY-MM keys');
    const start = date(`${month}-01`, 'thirteenthComputableDaysByMonth');
    integer(
      days,
      0,
      monthDays(start.getUTCFullYear(), start.getUTCMonth()),
      `thirteenthComputableDaysByMonth.${month}`,
    );
  }
  for (let year = termination.getUTCFullYear(); year <= projected.getUTCFullYear(); year += 1) {
    let avos = 0;
    let known = fixed && ordinaryHistory;
    for (let month = 0; month < 12; month += 1) {
      const from = Math.max(Date.UTC(year, month, 1), admission.getTime());
      const to = Math.min(Date.UTC(year, month + 1, 0), projected.getTime());
      if (from > to) continue;
      const coveredDays = (to - from) / DAY + 1;
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;
      const override = input.thirteenthComputableDaysByMonth?.[key];
      if (override !== undefined && override > coveredDays)
        throw new CltInputError(`thirteenthComputableDaysByMonth.${key}`, 'exceeds covered days');
      if (override === undefined && input.thirteenthHistoryKnown !== true) {
        known = false;
        missing(
          `thirteenthComputableDaysByMonth.${key}`,
          'Dias computáveis do 13º não confirmados; informe mapa mensal ou histórico sem perdas.',
        );
      }
      if ((override ?? coveredDays) >= 15) avos += 1;
    }
    add(
      'THIRTEENTH',
      '13º proporcional',
      known ? round(salary * BigInt(avos), 12n) : null,
      String(year),
      known ? avos : undefined,
    );
  }
  if (input.thirteenthAdvanceCents === undefined)
    missing(
      'thirteenthAdvanceCents',
      'Adiantamento de 13º desconhecido; informe zero quando inexistente.',
    );
  add(
    'THIRTEENTH_ADVANCE',
    'Compensação de adiantamento de 13º (separada do bruto)',
    input.thirteenthAdvanceCents === undefined
      ? null
      : -cents(input.thirteenthAdvanceCents, 'thirteenthAdvanceCents'),
  );
  const remunerationComplete =
    items.every((entry) => entry.amountCents !== null) &&
    input.vacationHistoryKnown === true &&
    ordinaryHistory;
  const subtotal = items.reduce(
    (sum, entry) =>
      sum +
      (entry.amountCents === null || entry.code === 'THIRTEENTH_ADVANCE'
        ? 0n
        : BigInt(entry.amountCents)),
    0n,
  );
  let fgtsPenalty: bigint | null = null;
  if (input.fgts?.terminationBaseCents === undefined)
    missing(
      'fgts.terminationBaseCents',
      'Base rescisória do FGTS não informada; saldo disponível não a substitui.',
    );
  if (input.fgts?.confirmedIncludesPending !== true)
    missing(
      'fgts.confirmedIncludesPending',
      'Confirme depósitos rescisórios e pendências na base do FGTS.',
    );
  if (
    input.fgts?.terminationBaseCents !== undefined &&
    input.fgts.confirmedIncludesPending === true
  )
    fgtsPenalty = round(
      cents(input.fgts.terminationBaseCents, 'fgts.terminationBaseCents') * 40n,
      100n,
    );
  return {
    policyVersion: CLT_POLICY_VERSION,
    sources: CLT_SOURCES.map((source) => ({ ...source })),
    status: missingInputs.length === 0 && remunerationComplete ? 'complete' : 'partial',
    noticeDays,
    projectedTerminationDate: iso(projected),
    items,
    subtotalCents: subtotal.toString(),
    grossTotalCents: remunerationComplete ? subtotal.toString() : null,
    fgtsPenaltyCents: fgtsPenalty === null ? null : fgtsPenalty.toString(),
    missingInputs,
    reasons,
  };
}
