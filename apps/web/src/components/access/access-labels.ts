import type { Capability } from '@renr/contracts';

export const capabilityLabels: Record<Capability, string> = {
  EXECUTE_ASSIGNED_ACTIONS: 'Executar ações atribuídas',
  TECHNICAL_DECISIONS: 'Decisões técnicas',
  HR_PROFILE_READ: 'Consultar perfil e histórico de RH',
  HR_PROFILE_MANAGE: 'Gerenciar perfil e histórico de RH',
  HR_ANALYTICS_READ: 'Consultar indicadores de Gestão de Pessoas',
  HR_COMPENSATION_READ: 'Consultar remuneração e simulações',
  HR_COMPENSATION_MANAGE: 'Gerenciar remuneração',
  HR_EXPORT: 'Emitir relatórios de Gestão de Pessoas',
};
export const accessDate = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
