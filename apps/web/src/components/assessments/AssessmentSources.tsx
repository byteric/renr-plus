import { useEffect, useRef, useState } from 'react';
import {
  assessmentSourceSchema,
  assessmentSourceListSchema,
  createAssessmentSourceSchema,
  type AssessmentSource,
  type CreateAssessmentSource,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { useWorkforceData } from '../workforce/useWorkforceData';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import './assessment-cycle.css';
export type AssessmentSourcesProps = {
  organizationId: string;
  cycleId: string;
  canEdit: boolean;
  onExpire: () => void;
};
const kinds: Record<CreateAssessmentSource['kind'], string> = {
  OBSERVATION: 'Observação',
  INTERVIEW: 'Entrevista',
  WORKSHOP: 'Oficina',
  DOCUMENT_ANALYSIS: 'Análise documental',
};
export function AssessmentSources(props: AssessmentSourcesProps) {
  return <Sources key={`${props.organizationId}:${props.cycleId}`} {...props} />;
}
function Sources({ organizationId, cycleId, canEdit, onExpire }: AssessmentSourcesProps) {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [kind, setKind] = useState<CreateAssessmentSource['kind']>('OBSERVATION');
  const [context, setContext] = useState('');
  const [date, setDate] = useState('');
  const [summary, setSummary] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<AssessmentSource | null>(null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);
  const path = `/organizations/${organizationId}/assessment-cycles/${cycleId}/sources`;
  const scopeSchema = useState(() => ({
    parse(value: unknown) {
      const result = assessmentSourceListSchema.parse(value);
      if (result.items.some((item) => item.cycleId !== cycleId)) throw new RequestError(502);
      return result;
    },
  }))[0];
  const sources = useWorkforceData(
    `${path}?page=${page}&pageSize=20`,
    scopeSchema,
    organizationId,
    onExpire,
    attempt,
  );
  async function save() {
    if (active.current || !canEdit) return;
    const parsed = createAssessmentSourceSchema.safeParse({
      kind,
      context,
      occurredOn: date,
      summary,
    });
    if (!parsed.success) {
      setError('Confira o contexto, a data da atividade e a síntese da fonte.');
      return;
    }
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError('');
    try {
      const source = await request(path, assessmentSourceSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        signal: controller.signal,
      });
      if (!mounted.current) return;
      if (source.organizationId !== organizationId || source.cycleId !== cycleId)
        throw new RequestError(502);
      setCreated(source);
      setContext('');
      setSummary('');
      setDate('');
      setPage(1);
      setAttempt((value) => value + 1);
    } catch (failure) {
      if (!mounted.current) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a fonte.');
    } finally {
      active.current = null;
      if (mounted.current) setPending(false);
    }
  }
  const items = sources.data?.items ?? [];
  return (
    <section className="assessment-sources">
      <h3>Fontes complementares</h3>
      <p>
        Registre apenas o contexto coletivo, sem nomes ou outros dados que identifiquem
        participantes. A autoria é registrada pela sessão. Fontes podem ser acrescentadas mesmo após
        o encerramento.
      </p>
      {canEdit && (
        <form
          className="assessment-source-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            Tipo de fonte
            <select
              value={kind}
              disabled={pending}
              onChange={(event) => setKind(event.target.value as CreateAssessmentSource['kind'])}
            >
              {Object.entries(kinds).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Contexto da fonte
            <textarea
              required
              minLength={3}
              maxLength={1000}
              value={context}
              disabled={pending}
              onChange={(event) => setContext(event.target.value)}
            />
          </label>
          <label>
            Data da fonte
            <input
              type="date"
              required
              value={date}
              disabled={pending}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            Síntese da fonte
            <textarea
              required
              minLength={3}
              maxLength={4000}
              value={summary}
              disabled={pending}
              onChange={(event) => setSummary(event.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? 'Registrando…' : 'Registrar fonte'}
          </Button>
        </form>
      )}
      {created && <p role="status">Fonte registrada por {created.createdBy.name}.</p>}
      {sources.loading && <p role="status">Carregando fontes…</p>}
      {sources.error && <p role="alert">{sources.error}</p>}
      {!sources.loading && !sources.error && items.length === 0 && <p>Nenhuma fonte registrada.</p>}
      <ul className="assessment-source-list">
        {items.map((source) => (
          <li key={source.id}>
            <h4>{kinds[source.kind]}</h4>
            <p>{source.context}</p>
            <p>Data da atividade: {source.occurredOn.split('-').reverse().join('/')}</p>
            <p className="assessment-source-summary">{source.summary}</p>
            <p>
              Registrada por {source.createdBy.name} em{' '}
              {new Date(source.createdAt).toLocaleString('pt-BR')}
            </p>
          </li>
        ))}
      </ul>
      <Pagination
        label="Páginas de fontes"
        page={page}
        pageSize={sources.data?.pageSize ?? 20}
        total={sources.data?.total ?? 0}
        pending={sources.loading || pending}
        onPageChange={setPage}
      />
      <Button
        variant="outline"
        disabled={pending || sources.loading}
        onClick={() => setAttempt((value) => value + 1)}
      >
        Atualizar fontes
      </Button>
    </section>
  );
}
