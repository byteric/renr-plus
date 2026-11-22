import { useEffect, useRef, useState } from 'react';
import type { CommercialOfferVersion, CommercialOfferVersionInput } from '@renr/contracts';
import { RequestError } from '../../../lib/api';

export const commercialPath = '/platform/commercial';
export const billingPath = '/platform/commercial/billing';
export const contractAccessPath = '/platform/commercial/access';

export type CommercialAccessEvents = {
  onExpire: () => void;
  onDenied: () => void;
};

export const commercialClassifications = {
  CLIENT: 'Cliente',
  DEMONSTRATION: 'Demonstração',
  UNCLASSIFIED: 'Não classificado',
};

export const commercialFiscalStates = {
  VALID: 'CNPJ válido',
  INVALID: 'CNPJ inválido',
  CONFLICT: 'CNPJ em conflito',
  MISSING: 'CNPJ não informado',
};

export const commercialPricingUnits: Record<CommercialOfferVersionInput['pricingUnit'], string> = {
  EMPLOYEE_MONTH: 'por colaborador/mês',
  TRAINING_CLASS: 'por turma',
  SERVICE: 'por serviço',
};

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const displayDate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' });
const displayDateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'short',
});
const civilDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });

export function todayInSaoPaulo() {
  return civilDate.format(new Date());
}

export function currentCompetenceInSaoPaulo() {
  return todayInSaoPaulo().slice(0, 7);
}

export function commercialDate(value: string | null) {
  return value ? displayDate.format(new Date(value)) : 'Não informada';
}

export function commercialDateTime(iso: string) {
  return displayDateTime.format(new Date(iso));
}

export function formatBrlCents(cents: number) {
  return currency.format(cents / 100);
}

export function formatBrlInput(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function parseBrlToCents(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s+/g, '');
  if (!cleaned) return null;
  let normalized: string;
  if (/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/.test(cleaned)) {
    normalized = cleaned.replaceAll('.', '').replace(',', '.');
  } else if (/^\d+(?:[.,]\d{1,2})?$/.test(cleaned)) {
    normalized = cleaned.replace(',', '.');
  } else {
    return null;
  }
  const [integerPart, fractionalPart = ''] = normalized.split('.');
  const cents = Number(integerPart) * 100 + Number(fractionalPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > 2_147_483_647) return null;
  return cents;
}

export function commercialPrice(
  version: Pick<CommercialOfferVersion, 'priceCents' | 'priceMode' | 'pricingUnit'>,
) {
  const formatted = currency.format(version.priceCents / 100);
  return `${version.priceMode === 'STARTING_AT' ? 'A partir de ' : ''}${formatted} ${commercialPricingUnits[version.pricingUnit]}`;
}

export function useCommercialAction({ onExpire, onDenied }: CommercialAccessEvents) {
  const controller = useRef(new AbortController());
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);

  async function run<T>(operation: (signal: AbortSignal) => Promise<T>) {
    if (running.current || conflict) return null;
    const { signal } = controller.current;
    running.current = true;
    setPending(true);
    setError('');
    try {
      const result = await operation(signal);
      return signal.aborted ? null : result;
    } catch (failure) {
      if (signal.aborted) return null;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      else if (failure instanceof RequestError && failure.status === 403) onDenied();
      else if (failure instanceof RequestError && failure.status === 409) {
        setConflict(true);
        setError(
          failure.message ||
            'Há um conflito com o registro atual. Confira os dados atualizados antes de tentar novamente.',
        );
      } else
        setError(
          failure instanceof Error ? failure.message : 'Não foi possível concluir a operação.',
        );
      return null;
    } finally {
      running.current = false;
      if (!signal.aborted) setPending(false);
    }
  }

  function resetConflict() {
    setConflict(false);
    setError('');
  }

  return { pending, error, conflict, setError, resetConflict, run };
}
