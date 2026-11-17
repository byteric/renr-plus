import { useEffect, useRef, useState } from 'react';
import {
  assessmentCycleSchema,
  assessmentResultsSchema,
  type AssessmentCycle,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { useWorkforceData } from '../workforce/useWorkforceData';
import { Button } from '../ui/button';
import { AssessmentResults } from './AssessmentResults';
import { AssessmentInviteDelivery } from './AssessmentInviteDelivery';
import { AssessmentSources } from './AssessmentSources';
import './assessment-cycle.css';
export type AssessmentCycleDetailProps = {
  organizationId: string;
  cycleId: string;
  canEdit: boolean;
  canIssueInvites?: boolean;
  onExpire: () => void;
  onBack: () => void;
  backLabel?: string;
  onEdit: () => void;
  onChanged?: () => void;
};
export function AssessmentCycleDetail(props: AssessmentCycleDetailProps) {
  return <CycleDetail key={`${props.organizationId}:${props.cycleId}`} {...props} />;
}
function CycleDetail({
  organizationId,
  cycleId,
  canEdit,
  canIssueInvites = canEdit,
  onExpire,
  onBack,
  backLabel = 'Voltar às coletas',
  onEdit,
  onChanged,
}: AssessmentCycleDetailProps) {
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'open' | 'close' | null>(null);
  const [text, setText] = useState('');
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);
  const path = `/organizations/${organizationId}/assessment-cycles/${cycleId}`;
  const detail = useWorkforceData(path, assessmentCycleSchema, organizationId, onExpire, attempt);
  const cycle =
    detail.data?.id === cycleId && detail.data.organizationId === organizationId
      ? detail.data
      : null;
  const result = useWorkforceData(
    cycle ? `${path}/results` : null,
    assessmentResultsSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const value = result.data;
  const validResult =
    cycle &&
    value?.organizationId === organizationId &&
    value.instrumentVersionId === cycle.instrumentVersionId &&
    value.policyVersionId === cycle.policyVersionId &&
    value.minimumResponses === cycle.minimumResponses &&
    value.node.nodeType === 'CYCLE' &&
    value.node.id === cycleId
      ? value
      : null;
  async function mutate(action: 'open' | 'close') {
    if (active.current || !cycle || !canEdit) return;
    if (
      text !== (action === 'open' ? 'ABRIR' : 'ENCERRAR') ||
      (action === 'open' ? cycle.status !== 'DRAFT' : cycle.status !== 'OPEN')
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError('');
    try {
      const changed: AssessmentCycle = await request(`${path}/${action}`, assessmentCycleSchema, {
        method: 'POST',
        body: JSON.stringify({ expectedRevision: cycle.revision }),
        signal: controller.signal,
      });
      if (!mounted.current) return;
      if (changed.id !== cycleId || changed.organizationId !== organizationId)
        throw new RequestError(502);
      setConfirm(null);
      setText('');
      setAttempt((value) => value + 1);
      onChanged?.();
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      setError(
        failure instanceof RequestError && failure.status === 409
          ? 'O ciclo foi alterado. Atualize os dados e confira o estado antes de repetir.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível concluir a ação.',
      );
    } finally {
      active.current = null;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <section className="assessment-cycle-detail">
      <Button variant="outline" onClick={onBack}>
        {backLabel}
      </Button>
      {detail.loading && !cycle && <p role="status">Carregando coleta…</p>}
      {(detail.error || (detail.data && !cycle)) && (
        <p role="alert">{detail.error || 'A resposta não corresponde à coleta solicitada.'}</p>
      )}
      {cycle && (
        <>
          <header>
            <h2>{cycle.name}</h2>
            <p>
              {cycle.status === 'DRAFT'
                ? 'Rascunho'
                : cycle.status === 'OPEN'
                  ? 'Em coleta'
                  : 'Encerrada'}{' '}
              · {cycle.usageMode === 'REAL' ? 'Uso real' : 'Demonstração'}
            </p>
          </header>
          <dl className="assessment-cycle-facts">
            <div>
              <dt>Grupo</dt>
              <dd>
                {cycle.assessmentGroupName} · {cycle.unitName} / {cycle.sectorName}
              </dd>
            </div>
            <div>
              <dt>Instrumento</dt>
              <dd>
                {cycle.instrumentTitle} · v{cycle.instrumentVersion}
              </dd>
            </div>
            <div>
              <dt>Política</dt>
              <dd>
                Versão {cycle.policyVersion} · limiar {cycle.minimumResponses} envios
              </dd>
            </div>
            <div>
              <dt>Período</dt>
              <dd>
                {new Date(cycle.startsAt).toLocaleString('pt-BR')} até{' '}
                {new Date(cycle.endsAt).toLocaleString('pt-BR')}
              </dd>
            </div>
          </dl>
          {canEdit && (
            <div className="assessment-cycle-actions">
              {cycle.status === 'DRAFT' && (
                <>
                  <Button variant="outline" disabled={pending} onClick={onEdit}>
                    Editar rascunho
                  </Button>
                  <Button
                    disabled={pending}
                    onClick={() => {
                      setConfirm('open');
                      setText('');
                    }}
                  >
                    Abrir coleta
                  </Button>
                </>
              )}
              {cycle.status === 'OPEN' && (
                <Button
                  disabled={pending}
                  onClick={() => {
                    setConfirm('close');
                    setText('');
                  }}
                >
                  Encerrar coleta
                </Button>
              )}
            </div>
          )}
          {canEdit && confirm && (
            <form
              className="assessment-cycle-confirm"
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(confirm);
              }}
            >
              <h3>{confirm === 'open' ? 'Confirmar abertura' : 'Confirmar encerramento'}</h3>
              <p>
                {confirm === 'open'
                  ? 'Ao abrir, a versão do instrumento, o grupo, o período e a política ficarão fixados. Confira os dados antes de confirmar.'
                  : 'O encerramento impede novos envios e não permite reabertura.'}
              </p>
              <label>
                {confirm === 'open' ? 'Confirmação da abertura' : 'Confirmação do encerramento'}
                <input
                  autoFocus
                  placeholder={confirm === 'open' ? 'Digite ABRIR' : 'Digite ENCERRAR'}
                  value={text}
                  disabled={pending}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <div className="assessment-cycle-actions">
                <Button
                  type="submit"
                  disabled={pending || text !== (confirm === 'open' ? 'ABRIR' : 'ENCERRAR')}
                >
                  {confirm === 'open' ? 'Confirmar abertura' : 'Confirmar encerramento'}
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setConfirm(null)}>
                  Cancelar confirmação
                </Button>
              </div>
            </form>
          )}
          {canIssueInvites && cycle.status !== 'DRAFT' && (
            <AssessmentInviteDelivery
              key={`${attempt}:${cycle.status}`}
              path={`${path}/invite-deliveries`}
              organizationId={organizationId}
              available={cycle.status === 'OPEN'}
              disabled={pending}
              onExpire={onExpire}
            />
          )}
          <section>
            <h3>Resultados protegidos</h3>
            {result.loading && <p role="status">Carregando resultados…</p>}
            {(result.error || (value && !validResult)) && (
              <p role="alert">
                {result.error || 'A resposta de resultados não corresponde a este ciclo.'}
              </p>
            )}
            {validResult && <AssessmentResults value={validResult} />}
          </section>
          <AssessmentSources
            organizationId={organizationId}
            cycleId={cycleId}
            canEdit={canEdit}
            onExpire={onExpire}
          />
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => {
          setConfirm(null);
          setText('');
          setAttempt((value) => value + 1);
        }}
      >
        Atualizar coleta
      </Button>
    </section>
  );
}
