import { useEffect, useRef, useState } from 'react';
import {
  assessmentCycleSchema,
  assessmentGroupListSchema,
  assessmentGroupSchema,
  createAssessmentCycleSchema,
  updateAssessmentCycleSchema,
  type AssessmentCycle,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { useWorkforceData } from '../workforce/useWorkforceData';
import { Pagination } from '../ui/pagination';
import { Button } from '../ui/button';
import { AssessmentReferenceFields } from './AssessmentReferenceFields';
import './assessment-cycle.css';
export type AssessmentCycleFormProps = {
  organizationId: string;
  initial: AssessmentCycle | null;
  onExpire: () => void;
  onSaved: (cycle: AssessmentCycle) => void;
  onCancel: () => void;
};
const localDate = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function AssessmentCycleForm(props: AssessmentCycleFormProps) {
  const key = `${props.organizationId}:${props.initial?.id ?? 'new'}`;
  return <CycleEditor key={key} {...props} />;
}
function CycleEditor({
  organizationId,
  initial,
  onExpire,
  onSaved,
  onCancel,
}: AssessmentCycleFormProps) {
  const [original] = useState(initial);
  const [name, setName] = useState(original?.name ?? '');
  const [group, setGroup] = useState(original?.assessmentGroupId ?? '');
  const [instrumentId, setInstrumentId] = useState(original?.instrumentId ?? '');
  const [version, setVersion] = useState(original?.instrumentVersionId ?? '');
  const [policy, setPolicy] = useState(original?.policyVersionId ?? '');
  const [starts, setStarts] = useState(original ? localDate(original.startsAt) : '');
  const [ends, setEnds] = useState(original ? localDate(original.endsAt) : '');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  const root = `/organizations/${organizationId}`;
  const groups = useWorkforceData(
    `${root}/assessment-groups?isActive=true&page=${page}&pageSize=20`,
    assessmentGroupListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const selected = useWorkforceData(
    group ? `${root}/assessment-groups/${group}` : null,
    assessmentGroupSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const items = (groups.data?.items ?? []).filter((item) => item.isActive);
  if (
    selected.data?.id === group &&
    selected.data.isActive &&
    !items.some((item) => item.id === group)
  )
    items.push(selected.data);
  async function save() {
    if (controller.current || (original?.status && original.status !== 'DRAFT')) return;
    const base = {
      name,
      assessmentGroupId: group,
      instrumentVersionId: version,
      policyVersionId: policy,
      startsAt: starts ? new Date(starts).toISOString() : '',
      endsAt: ends ? new Date(ends).toISOString() : '',
    };
    const parsed = original
      ? updateAssessmentCycleSchema.safeParse({ ...base, expectedRevision: original.revision })
      : createAssessmentCycleSchema.safeParse(base);
    if (!parsed.success) {
      setError(
        'Confira nome, grupo, versões publicadas e período. O fim deve ser posterior ao início.',
      );
      return;
    }
    const active = new AbortController();
    controller.current = active;
    setPending(true);
    setError('');
    try {
      const cycle = await request(
        `${root}/assessment-cycles${original ? `/${original.id}` : ''}`,
        assessmentCycleSchema,
        {
          method: original ? 'PUT' : 'POST',
          body: JSON.stringify(parsed.data),
          signal: active.signal,
        },
      );
      if (!mounted.current) return;
      if (cycle.organizationId !== organizationId || (original && cycle.id !== original.id))
        throw new RequestError(502);
      onSaved(cycle);
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      setError(
        failure instanceof RequestError && failure.status === 409
          ? 'O ciclo mudou no servidor. Seu rascunho foi preservado; consulte a versão atual antes de decidir como continuar.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível salvar a coleta.',
      );
    } finally {
      controller.current = null;
      if (mounted.current) setPending(false);
    }
  }
  return (
    <form
      className="assessment-cycle-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2>{original ? 'Editar coleta' : 'Nova coleta'}</h2>
      <label>
        Nome da coleta
        <input
          required
          minLength={3}
          maxLength={160}
          value={name}
          disabled={pending}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Grupo da coleta
        <select
          required
          value={group}
          disabled={pending || groups.loading}
          onChange={(event) => setGroup(event.target.value)}
        >
          <option value="">Selecione um grupo ativo</option>
          {group && !items.some((item) => item.id === group) && (
            <option value={group}>
              Grupo selecionado · {original?.assessmentGroupName ?? group}
            </option>
          )}
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.unitName} / {item.sectorName}
            </option>
          ))}
        </select>
      </label>
      <Pagination
        label="Páginas de grupos"
        page={page}
        pageSize={groups.data?.pageSize ?? 20}
        total={groups.data?.total ?? 0}
        pending={pending || groups.loading}
        onPageChange={setPage}
      />
      {(groups.error || selected.error) && <p role="alert">{groups.error || selected.error}</p>}
      <AssessmentReferenceFields
        organizationId={organizationId}
        attempt={attempt}
        instrumentId={instrumentId}
        instrumentVersionId={version}
        policyVersionId={policy}
        onInstrumentChange={(id, value) => {
          setInstrumentId(id);
          setVersion(value);
        }}
        onPolicyChange={setPolicy}
        disabled={pending}
        onExpire={onExpire}
      />
      <p>
        Horário local do navegador. O servidor valida as versões publicadas, o mesmo modo de uso e a
        estrutura ativa.
      </p>
      <div className="assessment-cycle-dates">
        <label>
          Início da coleta
          <input
            type="datetime-local"
            required
            value={starts}
            disabled={pending}
            onChange={(event) => setStarts(event.target.value)}
          />
        </label>
        <label>
          Fim da coleta
          <input
            type="datetime-local"
            required
            value={ends}
            disabled={pending}
            onChange={(event) => setEnds(event.target.value)}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="assessment-cycle-actions">
        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar rascunho'}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Atualizar referências
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
