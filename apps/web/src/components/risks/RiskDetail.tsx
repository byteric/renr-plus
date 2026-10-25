import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { preliminaryEvaluationListSchema, riskDetailSchema } from '@renr/contracts';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { StatusBadge } from '../ui/status-badge';
import { request, RequestError } from '../../lib/api';
import { RiskForm } from './RiskForm';
import { PreliminaryEvaluationForm } from './PreliminaryEvaluationForm';
import { riskDate, statusLabels, useRiskData } from './useRiskData';

const sections = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'exposicao', label: 'Exposição' },
  { id: 'origem', label: 'Origem' },
  { id: 'fichas', label: 'Fichas' },
  { id: 'historico', label: 'Histórico' },
];
export function RiskDetail({
  organizationId,
  id,
  canWrite,
  query,
  onExpire,
}: {
  organizationId: string;
  id: string;
  canWrite: boolean;
  query: string;
  onExpire: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationPage, setEvaluationPage] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [activeSection, setActiveSection] = useState(() => {
    const selected = new URLSearchParams(query).get('section');
    return sections.find((entry) => entry.id === selected)?.id ?? 'resumo';
  });
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const controller = useRef(new AbortController());
  const path = `/organizations/${organizationId}/risks/${id}`;
  const detail = useRiskData(path, riskDetailSchema, onExpire, attempt);
  const history = useRiskData(
    detail.data ? `${path}/evaluations?page=${evaluationPage}&pageSize=50` : null,
    preliminaryEvaluationListSchema,
    onExpire,
    attempt,
  );
  const item = detail.data;
  const params = new URLSearchParams(query);
  const rawReturn = params.get('returnTo') ?? '';
  const returnTo = /^#\/inventario(?:\?|$)/.test(rawReturn) ? rawReturn : '#/inventario';
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    if (!item || editing) return;
    const section = new URLSearchParams(query).get('section');
    const target = sections.some((entry) => entry.id === section)
      ? root.current?.querySelector<HTMLElement>(`#risk-${section}`)
      : null;
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    } else {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    }
    if (typeof IntersectionObserver === 'undefined') return;
    const visibleSections = new Map<Element, IntersectionObserverEntry>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0)
            visibleSections.set(entry.target, entry);
          else visibleSections.delete(entry.target);
        }
        const visible = [...visibleSections.values()].sort(
          (a, b) => b.intersectionRatio - a.intersectionRatio,
        )[0];
        if (visible) setActiveSection(visible.target.id.replace('risk-', ''));
      },
      { rootMargin: '-120px 0px -45% 0px', threshold: [0, 0.25, 0.5] },
    );
    root.current
      ?.querySelectorAll('section[id^="risk-"]')
      .forEach((section) => observer.observe(section));
    return () => {
      observer.disconnect();
      visibleSections.clear();
    };
  }, [item?.id, editing, item, query]);
  function jump(event: MouseEvent<HTMLAnchorElement>, section: string) {
    event.preventDefault();
    const target = root.current?.querySelector<HTMLElement>(`#risk-${section}`);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    const next = new URLSearchParams(query);
    next.set('section', section);
    window.history.replaceState(null, '', `#/inventario/${id}?${next}`);
    setActiveSection(section);
  }
  async function archive() {
    if (!item || pending || needsRefresh) return;
    setPending(true);
    setError('');
    try {
      await request(path, riskDetailSchema, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ARCHIVED', expectedVersion: item.version }),
        signal: controller.current.signal,
      });
      if (!controller.current.signal.aborted) {
        setConfirming(false);
        setAttempt(attempt + 1);
      }
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      else {
        setConfirming(false);
        setNeedsRefresh(true);
        setError(
          failure instanceof RequestError && failure.status === 409
            ? 'Este registro foi alterado. Atualize os dados antes de arquivar.'
            : failure instanceof RequestError && [0, 502].includes(failure.status)
              ? 'Não foi possível confirmar o resultado. Atualize o registro antes de repetir o arquivamento.'
              : failure instanceof Error
                ? failure.message
                : 'Não foi possível arquivar.',
        );
      }
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  if (detail.loading)
    return (
      <StatusMessage className="surface" tone="loading">
        Carregando registro…
      </StatusMessage>
    );
  if (detail.error || !item)
    return (
      <StatusMessage tone="error" className="feedback error">
        <p>{detail.error || 'Registro indisponível.'}</p>
        <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
          Atualizar registro
        </Button>
        <a href={returnTo}>Voltar ao inventário</a>
      </StatusMessage>
    );
  if (editing)
    return (
      <RiskForm
        organizationId={organizationId}
        item={item}
        onExpire={onExpire}
        onCancel={() => {
          setEditing(false);
          setAttempt(attempt + 1);
        }}
        onSaved={() => {
          setEditing(false);
          setAttempt(attempt + 1);
        }}
      />
    );
  const writable = canWrite && item.status !== 'ARCHIVED' && !needsRefresh;
  return (
    <div className="risk-stack risk-detail" ref={root}>
      <a className="back-link" href={returnTo}>
        ← Voltar ao inventário
      </a>
      <header className="surface risk-detail-header">
        <div>
          <p className="panel-label">INVENTÁRIO · VERSÃO {item.version}</p>
          <h2 ref={heading} tabIndex={-1}>
            {item.factor}
          </h2>
          <p className="muted">
            {item.unit.name} <span aria-hidden="true">/</span> {item.sector.name}
          </p>
          <StatusBadge
            className={`risk-status risk-status-${item.status.toLowerCase()}`}
            label={statusLabels[item.status]}
            tone={item.status === 'REGISTERED' ? 'info' : 'neutral'}
          />
        </div>
        <div className="record-actions">
          <a className="action-link" href={`#/acoes?riskId=${id}&page=1`}>
            Ver ações deste risco
          </a>
          {canWrite &&
            item.status === 'REGISTERED' &&
            item.unit.isActive &&
            item.sector.isActive && (
              <a className="primary-link" href={`#/acoes/nova?riskId=${id}`}>
                Criar ação preventiva
              </a>
            )}
          {writable && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Editar registro
            </Button>
          )}
          {writable && (
            <Button variant="outline" onClick={() => setConfirming(true)}>
              Arquivar risco
            </Button>
          )}
        </div>
      </header>
      {item.status === 'ARCHIVED' && (
        <p className="feedback">
          Registro arquivado · somente leitura. Fichas e contexto permanecem no histórico.
        </p>
      )}
      <p className="risk-disclaimer">
        Este registro é preliminar e não substitui uma avaliação técnica de SST. Não representa
        laudo ou garantia de conformidade com a NR-01.
      </p>
      {error && (
        <div role="alert" className="feedback error">
          <p>{error}</p>
          {needsRefresh && (
            <Button
              variant="outline"
              onClick={() => {
                setError('');
                setNeedsRefresh(false);
                setAttempt(attempt + 1);
              }}
            >
              Atualizar registro
            </Button>
          )}
        </div>
      )}
      {confirming && (
        <section className="surface risk-confirm" aria-labelledby="archive-title">
          <h3 id="archive-title">Arquivar este registro?</h3>
          <p>
            O histórico será preservado, mas não será possível editar ou acrescentar fichas. Não há
            restauração neste incremento.
          </p>
          <div className="record-actions">
            <Button disabled={pending} onClick={() => void archive()}>
              {pending ? 'Arquivando…' : 'Confirmar arquivamento'}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setConfirming(false)}>
              Manter registro
            </Button>
          </div>
        </section>
      )}
      <nav className="risk-section-nav" aria-label="Seções do registro">
        {sections.map((section) => {
          const next = new URLSearchParams(query);
          next.set('section', section.id);
          return (
            <a
              key={section.id}
              href={`#/inventario/${id}?${next}`}
              aria-current={activeSection === section.id ? 'location' : undefined}
              onClick={(event) => jump(event, section.id)}
            >
              {section.label}
            </a>
          );
        })}
      </nav>
      <section id="risk-resumo" className="surface risk-content-section" tabIndex={-1}>
        <p className="panel-label">01 · IDENTIFICAÇÃO</p>
        <h3>Resumo</h3>
        <p className="risk-long-text">
          {item.description || 'Descrição ainda não informada no rascunho.'}
        </p>
        <dl className="risk-metadata">
          <div>
            <dt>Empresa / unidade</dt>
            <dd>
              {item.unit.name}
              {!item.unit.isActive ? ' · Inativa' : ''}
            </dd>
          </div>
          <div>
            <dt>Setor</dt>
            <dd>
              {item.sector.name}
              {!item.sector.isActive ? ' · Inativo' : ''}
            </dd>
          </div>
          <div>
            <dt>Autoria do cadastro</dt>
            <dd>{item.createdBy.name}</dd>
          </div>
          <div>
            <dt>Criado em</dt>
            <dd>
              <time dateTime={item.createdAt}>{riskDate(item.createdAt)}</time>
            </dd>
          </div>
        </dl>
      </section>
      <section id="risk-exposicao" className="surface risk-content-section" tabIndex={-1}>
        <p className="panel-label">02 · CONTEXTO</p>
        <h3>Exposição</h3>
        {[
          { label: 'Contexto de exposição', value: item.exposureDescription },
          { label: 'Grupo exposto', value: item.exposedGroupDescription },
          { label: 'Possíveis agravos', value: item.possibleHarms },
          { label: 'Controles existentes', value: item.existingControls },
        ].map((field) => (
          <div className="risk-reading-block" key={field.label}>
            <h4>{field.label}</h4>
            <p className="risk-long-text">{field.value || 'Ainda não informado no rascunho.'}</p>
          </div>
        ))}
      </section>
      <section id="risk-origem" className="surface risk-content-section" tabIndex={-1}>
        <p className="panel-label">03 · RASTREABILIDADE</p>
        <h3>Origem</h3>
        <p>
          <strong>
            {item.sourceKind === 'DIAGNOSTIC_CYCLE'
              ? 'Diagnóstico coletivo'
              : item.sourceKind === 'TECHNICAL_RECORD'
                ? 'Registro técnico contextual'
                : 'Origem ainda não informada'}
          </strong>
        </p>
        <p className="risk-long-text">
          {item.sourceNote || 'Complete a origem antes de registrar.'}
        </p>
        {item.diagnosticCycleId && (
          <>
            <p className="field-hint">Ciclo: {item.diagnosticCycleId}</p>
            <a href={`#/diagnostico?cycleId=${item.diagnosticCycleId}`}>
              Consultar diagnóstico de origem →
            </a>
          </>
        )}
        <p className="muted">
          O contexto é coletivo. Nenhuma resposta individual é vinculada ao registro.
        </p>
      </section>
      <section id="risk-fichas" className="risk-content-section risk-stack" tabIndex={-1}>
        <div className="risk-section-heading">
          <div>
            <p className="panel-label">04 · FUNDAMENTAÇÃO</p>
            <h3>Fichas preliminares</h3>
          </div>
          {writable && item.status === 'REGISTERED' && !evaluating && (
            <Button onClick={() => setEvaluating(true)}>Adicionar ficha preliminar</Button>
          )}
        </div>
        {item.status === 'DRAFT' && (
          <p className="feedback">Complete e registre o risco antes de adicionar uma ficha.</p>
        )}
        {evaluating && (
          <PreliminaryEvaluationForm
            risk={item}
            onExpire={onExpire}
            onCancel={() => {
              setEvaluating(false);
              setAttempt(attempt + 1);
            }}
            onSaved={() => {
              setEvaluating(false);
              setAttempt(attempt + 1);
            }}
          />
        )}
        {history.loading && <p role="status">Carregando fichas…</p>}
        {history.error && (
          <div className="feedback error" role="alert">
            <p>{history.error}</p>
            <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
              Atualizar fichas
            </Button>
          </div>
        )}
        {history.data?.items.length === 0 && (
          <div className="surface empty-state">
            <h4>Nenhuma ficha registrada</h4>
            <p>O preenchimento de uma ficha não equivale a uma classificação técnica aprovada.</p>
          </div>
        )}
        {history.data?.items.map((evaluation) => (
          <article key={evaluation.id} className="surface evaluation-card">
            <div className="risk-section-heading">
              <h4>Ficha {evaluation.sequence}</h4>
              <StatusBadge className="risk-status" label="Preliminar" />
            </div>
            <p className="evaluation-method">{evaluation.methodReference}</p>
            <p className="muted">
              Método v{evaluation.methodVersion} · Contexto do risco v{evaluation.riskVersion}
            </p>
            <h5>Observação preliminar</h5>
            <p className="risk-long-text">{evaluation.observation}</p>
            <h5>Justificativa</h5>
            <p className="risk-long-text">{evaluation.rationale}</p>
            <p className="field-hint">
              {evaluation.author.name} ·{' '}
              <time dateTime={evaluation.createdAt}>{riskDate(evaluation.createdAt)}</time>
            </p>
            <details>
              <summary>Contexto preservado nesta ficha</summary>
              <dl className="risk-metadata">
                <div>
                  <dt>Fator</dt>
                  <dd>{evaluation.contextSnapshot.factor}</dd>
                </div>
                <div>
                  <dt>Descrição</dt>
                  <dd>{evaluation.contextSnapshot.description}</dd>
                </div>
                <div>
                  <dt>Exposição</dt>
                  <dd>{evaluation.contextSnapshot.exposureDescription}</dd>
                </div>
                <div>
                  <dt>Grupo exposto</dt>
                  <dd>{evaluation.contextSnapshot.exposedGroupDescription}</dd>
                </div>
                <div>
                  <dt>Agravos</dt>
                  <dd>{evaluation.contextSnapshot.possibleHarms}</dd>
                </div>
                <div>
                  <dt>Controles</dt>
                  <dd>{evaluation.contextSnapshot.existingControls}</dd>
                </div>
                <div>
                  <dt>Unidade e setor</dt>
                  <dd>
                    {evaluation.contextSnapshot.unit.name} /{' '}
                    {evaluation.contextSnapshot.sector.name}
                  </dd>
                </div>
                <div>
                  <dt>Nota de origem</dt>
                  <dd>{evaluation.contextSnapshot.sourceNote}</dd>
                </div>
              </dl>
            </details>
          </article>
        ))}
        {history.data && history.data.total > 50 && (
          <Pagination
            label="Paginação de fichas"
            page={evaluationPage}
            pageSize={history.data.pageSize}
            total={history.data.total}
            pending={history.loading}
            onPageChange={setEvaluationPage}
            previousLabel="Fichas anteriores"
            nextLabel="Mais fichas"
          />
        )}
      </section>
      <section id="risk-historico" className="surface risk-content-section" tabIndex={-1}>
        <p className="panel-label">05 · CONTINUIDADE</p>
        <h3>Histórico</h3>
        <ol className="risk-timeline">
          <li>
            <strong>Cadastro</strong>
            <p>
              {item.createdBy.name} ·{' '}
              <time dateTime={item.createdAt}>{riskDate(item.createdAt)}</time>
            </p>
          </li>
          <li>
            <strong>
              Versão atual {item.version} · {statusLabels[item.status]}
            </strong>
            <p>
              {item.updatedBy.name} ·{' '}
              <time dateTime={item.updatedAt}>{riskDate(item.updatedAt)}</time>
            </p>
          </li>
          {history.data?.items.map((evaluation) => (
            <li key={evaluation.id}>
              <strong>
                Ficha preliminar {evaluation.sequence} · Contexto v{evaluation.riskVersion}
              </strong>
              <p>
                {evaluation.author.name} ·{' '}
                <time dateTime={evaluation.createdAt}>{riskDate(evaluation.createdAt)}</time>
              </p>
            </li>
          ))}
        </ol>
        <p className="muted">
          Este histórico mostra metadados do cadastro e das fichas; não é um acesso aos logs gerais
          da organização.
        </p>
      </section>
    </div>
  );
}
