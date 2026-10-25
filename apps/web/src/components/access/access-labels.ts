import type { Capability } from '@renr/contracts';

export const capabilityLabels: Record<Capability, string> = {
  EXECUTE_ASSIGNED_ACTIONS: 'Executar ações atribuídas',
  TECHNICAL_DECISIONS: 'Decisões técnicas',
};
export const accessDate = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
