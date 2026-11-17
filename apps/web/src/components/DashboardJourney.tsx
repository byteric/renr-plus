import { useState } from 'react';
import { workspaceJourneySchema, type WorkspaceJourney } from '@renr/contracts';
import { useRiskData } from './risks/useRiskData';
import { Button } from './ui/button';
import { StatusMessage } from './ui/status-message';
import './dashboard-journey.css';

type Stage = {
  status: string;
  ready?: boolean;
  next?: string;
  link?: { href: string; label: string };
};

const structures: Record<WorkspaceJourney['structure'], Stage> = {
  INACTIVE: {
    status: 'Empresa inativa',
    next: 'Confirme a situação da empresa em Cadastros antes de iniciar uma coleta.',
    link: { href: '#/empresas', label: 'Consultar empresa' },
  },
  MISSING_UNIT: {
    status: 'Unidade pendente',
    next: 'Uma unidade ativa é necessária para organizar os setores.',
    link: { href: '#/unidades', label: 'Abrir unidades' },
  },
  MISSING_SECTOR: {
    status: 'Setor pendente',
    next: 'Uma unidade ativa precisa ter ao menos um setor ativo.',
    link: { href: '#/unidades', label: 'Ver setores das unidades' },
  },
  READY: { status: 'Unidade e setor ativos', ready: true },
};

const instruments: Record<WorkspaceJourney['instruments'], Stage> = {
  MISSING_INSTRUMENT: {
    status: 'Instrumento pendente',
    next: 'A coleta precisa de uma versão publicada do instrumento.',
    link: { href: '#/instrumentos', label: 'Abrir instrumentos' },
  },
  MISSING_POLICY: {
    status: 'Política pendente',
    next: 'A coleta precisa de uma política publicada no mesmo modo de uso do instrumento.',
    link: { href: '#/coletas?view=policies', label: 'Abrir políticas de consolidação' },
  },
  READY: { status: 'Versões compatíveis publicadas', ready: true },
};

const collections: Record<WorkspaceJourney['collection'], Stage> = {
  MISSING: {
    status: 'Coleta pendente',
    next: 'A coleta precisa de um grupo ativo, um instrumento publicado e uma política publicada.',
    link: { href: '#/coletas', label: 'Abrir coletas' },
  },
  DRAFT: {
    status: 'Rascunho disponível',
    next: 'Revise os pré-requisitos da coleta antes de abrir a participação.',
    link: { href: '#/coletas?status=DRAFT', label: 'Consultar rascunhos' },
  },
  OPEN: {
    status: 'Coleta em andamento',
    next: 'Acompanhe a coleta aberta. A consolidação fica disponível após o encerramento, conforme a política.',
    link: { href: '#/coletas?status=OPEN', label: 'Acompanhar coletas abertas' },
  },
  CLOSED: {
    status: 'Coleta encerrada',
    ready: true,
    link: { href: '#/coletas?status=CLOSED', label: 'Consultar coletas encerradas' },
  },
};

const results: Record<WorkspaceJourney['result'], Stage> = {
  PENDING: { status: 'Aguardando encerramento da coleta' },
  NO_RESPONSES: {
    status: 'Coleta sem respostas',
    next: 'Consulte o resultado da coleta encerrada antes de planejar uma nova aplicação.',
    link: { href: '#/coletas?status=CLOSED', label: 'Consultar resultado' },
  },
  PROTECTED: {
    status: 'Resultado protegido',
    next: 'A política protege a consolidação quando o mínimo de respostas não foi atingido.',
    link: { href: '#/coletas?status=CLOSED', label: 'Consultar proteção do resultado' },
  },
  READY: {
    status: 'Consolidação coletiva disponível',
    ready: true,
    link: { href: '#/coletas?status=CLOSED', label: 'Consultar resultado coletivo' },
  },
};

const actions: Record<WorkspaceJourney['actions'], Stage> = {
  MISSING: {
    status: 'Plano de ação pendente',
    next: 'Consulte os riscos registrados para definir medidas preventivas.',
    link: { href: '#/inventario', label: 'Abrir inventário de riscos' },
  },
  READY: {
    status: 'Ações registradas',
    ready: true,
    link: { href: '#/acoes', label: 'Acompanhar plano de ação' },
  },
};

function preparation(value: NonNullable<WorkspaceJourney['preparation']>): Stage {
  if (!value.groups)
    return {
      status: 'Grupo de avaliação pendente',
      next: 'Vincule um grupo de avaliação a um setor ativo para preparar a coleta.',
      link: { href: '#/grupos', label: 'Abrir grupos de avaliação' },
    };
  if (!value.employees)
    return {
      status: 'Cadastro de colaboradores pendente',
      next: 'Vincule os colaboradores à unidade e ao setor correspondentes.',
      link: { href: '#/colaboradores', label: 'Abrir colaboradores' },
    };
  return { status: 'Colaboradores e grupos cadastrados', ready: true };
}

function journeyStages(journey: WorkspaceJourney) {
  return [
    { label: 'Estrutura', ...structures[journey.structure] },
    ...(journey.preparation
      ? [{ label: 'Colaboradores e grupos', ...preparation(journey.preparation) }]
      : []),
    { label: 'Instrumento e política', ...instruments[journey.instruments] },
    { label: 'Coleta mais recente', ...collections[journey.collection] },
    { label: 'Resultados da coleta', ...results[journey.result] },
    { label: 'Plano de ação', ...actions[journey.actions] },
  ];
}

export function DashboardJourney({
  organizationId,
  onExpire,
}: {
  organizationId: string;
  onExpire: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const result = useRiskData(
    `/organizations/${encodeURIComponent(organizationId)}/journey`,
    workspaceJourneySchema,
    onExpire,
    attempt,
  );
  const journey = result.data?.organizationId === organizationId ? result.data : null;

  if (result.loading)
    return <StatusMessage tone="loading">Carregando a jornada da empresa…</StatusMessage>;
  if (!journey)
    return (
      <StatusMessage
        tone="error"
        action={
          <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
            Recarregar jornada
          </Button>
        }
      >
        Não foi possível consultar a jornada da empresa.
      </StatusMessage>
    );

  const stages = journeyStages(journey);
  const next = stages.find((stage) => stage.next) ?? stages.at(-1);
  return (
    <section className="surface dashboard-journey" aria-labelledby="dashboard-journey-heading">
      <div>
        <h2 id="dashboard-journey-heading">Jornada da empresa</h2>
        <p className="muted">
          Veja o progresso da empresa inteira, independentemente dos filtros do painel.
        </p>
        {journey.demo && <p className="panel-label">Cenário de demonstração</p>}
      </div>
      {next?.link && (
        <div className="dashboard-journey-next">
          <h3>Próximo passo · {next.label}</h3>
          <p>{next.next ?? 'Acompanhe as medidas preventivas registradas.'}</p>
          <a className="action-link" href={next.link.href}>
            {next.link.label}
          </a>
        </div>
      )}
      <ol className="dashboard-journey-stages" aria-label="Etapas da jornada">
        {stages.map((stage) => (
          <li key={stage.label}>
            <h3>{stage.label}</h3>
            <p className={stage.ready ? 'dashboard-journey-ready' : 'muted'}>{stage.status}</p>
            {stage !== next && stage.link && (
              <a className="action-link" href={stage.link.href}>
                {stage.link.label}
              </a>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
