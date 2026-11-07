import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  createPlatformReportSchema,
  createTenantReportSchema,
  sstReportSectionLabels,
  peopleReportSectionLabels,
  reportListSchema,
  reportQuerySchema,
  reportSnapshotSchema,
  sessionCapabilitiesSchema,
  platformCapabilitiesSchema,
  type ReportSnapshot,
} from '@renr/contracts';
import { request, RequestError, send } from '../../lib/api';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { ReferenceSelect } from '../workforce/ReferenceSelect';
import { useAccessRefresh, usePrivateQuery } from '../platform/usePrivateQuery';
import { usePresentationMotion } from '../../hooks/usePresentationMotion';
import './reports.css';

type Props = {
  organizationId: string | null;
  organizationName?: string;
  onExpire: () => void;
  platform?: boolean;
};
type Filters = {
  kind: 'SST' | 'PEOPLE';
  unitId: string;
  sectorId: string;
  isActive: string;
  competence: string;
  search: string;
  classification: string;
  fiscalState: string;
  page: number;
  invalid: boolean;
};
function readFilters(platform: boolean): Filters {
  const query = new URLSearchParams(window.location.hash.split('?')[1]);
  const keys = platform
    ? ['search', 'classification', 'fiscalState', 'isActive']
    : ['kind', 'unitId', 'sectorId', 'isActive', 'competence'];
  const raw = Object.fromEntries(
    keys.filter((key) => query.has(key)).map((key) => [key, query.get(key)]),
  );
  if (platform && raw.fiscalState === 'ALL') delete raw.fiscalState;
  if (!platform && (raw.kind === undefined || raw.kind === 'SST')) {
    delete raw.isActive;
    delete raw.competence;
  }
  const parsed = platform
    ? createPlatformReportSchema.safeParse(raw)
    : createTenantReportSchema.safeParse({ kind: 'SST', ...raw });
  const page = reportQuerySchema.safeParse({ page: query.get('page') ?? 1, pageSize: 25 });
  const duplicates = [...keys, 'page'].some((key) => query.getAll(key).length > 1);
  return {
    kind: query.get('kind') === 'PEOPLE' ? 'PEOPLE' : 'SST',
    unitId: query.get('unitId') ?? '',
    sectorId: query.get('sectorId') ?? '',
    isActive: raw.isActive ?? '',
    competence: raw.competence ?? '',
    search: query.get('search') ?? '',
    classification: query.get('classification') ?? 'CLIENT',
    fiscalState: query.get('fiscalState') === 'ALL' ? '' : (query.get('fiscalState') ?? 'VALID'),
    page: page.success ? page.data.page : 1,
    invalid: !parsed.success || !page.success || duplicates,
  };
}

export function ReportsWorkspace(props: Props) {
  return (
    <ReportsAccess
      key={props.platform ? 'platform' : (props.organizationId ?? 'none')}
      {...props}
    />
  );
}
function ReportsAccess({ organizationId, organizationName, platform = false, onExpire }: Props) {
  const access = useAccessRefresh();
  const [expired, setExpired] = useState(false);
  const [denied, setDenied] = useState(false);
  const expire = useCallback(() => {
    setExpired(true);
    onExpire();
  }, [onExpire]);
  const deny = useCallback(() => setDenied(true), []);
  const tenant = usePrivateQuery(
    !expired && !platform && organizationId ? '/auth/session-capabilities' : null,
    sessionCapabilitiesSchema,
    access.revision,
    expire,
    deny,
    organizationId ?? undefined,
    true,
  );
  const global = usePrivateQuery(
    !expired && platform ? '/platform/capabilities' : null,
    platformCapabilitiesSchema,
    access.revision,
    expire,
    deny,
    undefined,
    true,
  );
  const capabilities = platform ? global : tenant;
  if (!platform && !organizationId)
    return <StatusMessage>Selecione uma empresa para acessar os relatórios.</StatusMessage>;
  if (expired)
    return (
      <StatusMessage tone="error">
        Sua sessão terminou. Os relatórios privados foram removidos.
      </StatusMessage>
    );
  if (capabilities.loading && !capabilities.data)
    return <StatusMessage tone="loading">Verificando acesso aos relatórios…</StatusMessage>;
  if (capabilities.error || denied)
    return (
      <StatusMessage
        tone="error"
        action={
          <Button
            onClick={() => {
              setDenied(false);
              access.refresh();
            }}
          >
            Revalidar acesso aos relatórios
          </Button>
        }
      >
        {capabilities.error ||
          'Seu acesso aos relatórios foi revogado. Os snapshots foram removidos.'}
      </StatusMessage>
    );
  const grants: string[] = capabilities.data?.capabilities ?? [];
  if (platform && !grants.includes('READ_OVERVIEW'))
    return <StatusMessage>Relatórios globais exigem leitura da plataforma.</StatusMessage>;
  return (
    <ReportsContent
      key={[...grants].sort().join(',')}
      organizationId={organizationId}
      organizationName={organizationName}
      platform={platform}
      grants={grants}
      onExpire={expire}
      onDenied={deny}
    />
  );
}
function ReportsContent({
  organizationId,
  organizationName,
  platform,
  grants,
  onExpire,
  onDenied,
}: {
  organizationId: string | null;
  organizationName?: string;
  platform: boolean;
  grants: string[];
  onExpire: () => void;
  onDenied: () => void;
}) {
  const [filters, setFilters] = useState(() => readFilters(platform));
  const [draft, setDraft] = useState(filters);
  const [details, setDetails] = useState(false);
  const [financial, setFinancial] = useState(false);
  const [sectionKeys, setSectionKeys] = useState<string[] | null>(null);
  const sectionLabels = draft.kind === 'SST' ? sstReportSectionLabels : peopleReportSectionLabels;
  const allSections = Object.keys(sectionLabels);
  const selectedSections = sectionKeys ?? allSections;
  const sectionOptions = useRef<HTMLDetailsElement>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [created, setCreated] = useState<ReportSnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef(new AbortController());
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    const change = () => {
      const value = readFilters(platform);
      setFilters(value);
      setDraft(value);
      setSelected(null);
      setCreated(null);
      setDetails(false);
      setFinancial(false);
      setSectionKeys(null);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, [platform]);
  const people = grants.includes('HR_EXPORT') && grants.includes('HR_ANALYTICS_READ');
  const profile = grants.includes('HR_PROFILE_READ') || grants.includes('HR_PROFILE_MANAGE');
  const compensation =
    grants.includes('HR_COMPENSATION_READ') || grants.includes('HR_COMPENSATION_MANAGE');
  const base = platform ? '/platform/reports' : `/organizations/${organizationId}/reports`;
  const invalid = filters.invalid || (!platform && filters.kind === 'PEOPLE' && !people);
  const list = usePrivateQuery(
    !invalid ? `${base}?page=${filters.page}&pageSize=25` : null,
    reportListSchema,
    revision,
    onExpire,
    onDenied,
    platform ? null : organizationId,
  );
  const snapshotSchema = useMemo(
    () => ({
      parse(value: unknown) {
        const data = reportSnapshotSchema.parse(value);
        if (
          data.organizationId !== (platform ? null : organizationId) ||
          (platform
            ? data.kind !== 'PLATFORM' || data.nominal || data.financial
            : data.kind === 'PLATFORM')
        )
          throw new RequestError(502);
        if (
          !platform &&
          data.kind === 'PEOPLE' &&
          (!people || (data.nominal && !profile) || (data.financial && !compensation))
        )
          throw new RequestError(403);
        return data;
      },
    }),
    [platform, organizationId, people, profile, compensation],
  );
  const selectedSnapshotSchema = useMemo(
    () => ({
      parse(value: unknown) {
        const data = snapshotSchema.parse(value);
        if (data.id !== selected) throw new RequestError(502);
        return data;
      },
    }),
    [selected, snapshotSchema],
  );
  const snapshot = usePrivateQuery(
    selected ? `${base}/${selected}` : null,
    selectedSnapshotSchema,
    0,
    onExpire,
    onDenied,
    platform ? null : organizationId,
  );
  function payload(value: Filters) {
    const common = { ...(value.isActive ? { isActive: value.isActive } : {}) };
    return platform
      ? {
          ...common,
          ...(value.search ? { search: value.search } : {}),
          classification: value.classification,
          ...(value.fiscalState ? { fiscalState: value.fiscalState } : {}),
          includeDetails: details,
        }
      : {
          kind: value.kind,
          ...(sectionKeys && sectionKeys.length !== allSections.length ? { sectionKeys } : {}),
          ...(value.unitId ? { unitId: value.unitId } : {}),
          ...(value.sectorId ? { sectorId: value.sectorId } : {}),
          ...(value.kind === 'PEOPLE'
            ? {
                ...common,
                ...(value.competence ? { competence: value.competence } : {}),
                includeDetails: details && profile,
                includeFinancial: financial && compensation,
              }
            : {}),
        };
  }
  function navigate(value: Filters) {
    const query = new URLSearchParams();
    const entries = platform
      ? (['search', 'classification', 'fiscalState', 'isActive'] as const)
      : (['kind', 'unitId', 'sectorId', 'isActive', 'competence'] as const);
    for (const key of entries) if (value[key]) query.set(key, value[key]);
    if (platform && !value.fiscalState) query.set('fiscalState', 'ALL');
    if (value.page > 1) query.set('page', String(value.page));
    window.history.replaceState(
      null,
      '',
      `${window.location.hash.split('?')[0] || '#/relatorios'}?${query}`,
    );
    setFilters(value);
    setDraft(value);
    setError('');
  }
  function toggleSection(key: string, checked: boolean) {
    setSectionKeys(
      checked
        ? allSections.filter(
            (candidate) => candidate === key || selectedSections.includes(candidate),
          )
        : selectedSections.filter((candidate) => candidate !== key),
    );
    setError('');
  }
  function validate(value: Filters) {
    return platform
      ? createPlatformReportSchema.safeParse(payload(value)).success
      : createTenantReportSchema.safeParse(payload(value)).success;
  }
  function validateSections() {
    if (platform || selectedSections.length) return true;
    const options = sectionOptions.current;
    if (options) {
      options.open = true;
      options.querySelector('summary')?.focus();
    }
    setError('Selecione ao menos uma seção.');
    return false;
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    if (!validateSections()) return;
    if (!validate(draft) || (!platform && draft.kind === 'PEOPLE' && !people)) {
      setError('Confira os filtros e as permissões antes de emitir.');
      return;
    }
    navigate({ ...draft, invalid: false, page: 1 });
  }
  async function emit() {
    if (!validateSections()) return;
    if (
      pending ||
      invalid ||
      !validate(draft) ||
      (!platform && draft.kind === 'PEOPLE' && !people)
    ) {
      setError('Aplique filtros válidos antes de emitir o relatório.');
      return;
    }
    setPending(true);
    setError('');
    setNotice('');
    try {
      const data = await request(base, snapshotSchema, {
        method: 'POST',
        body: JSON.stringify(payload(draft)),
        signal: controller.current.signal,
      });
      if (!controller.current.signal.aborted) {
        setCreated(data);
        setSelected(null);
        setNotice('Relatório emitido. A prévia abaixo preserva o snapshot desta emissão.');
        setRevision((value) => value + 1);
      }
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) {
        onExpire();
        return;
      }
      if (failure instanceof RequestError && failure.status === 403) {
        onDenied();
        return;
      }
      setError(
        failure instanceof Error
          ? failure.message
          : 'Não foi possível emitir. Os filtros foram preservados.',
      );
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <section className="reports-workspace" aria-labelledby="reports-title">
      <header>
        <p className="eyebrow">PERCURSO · {platform ? 'ESCOPO GLOBAL' : 'RELATÓRIOS'}</p>
        <h2 id="reports-title">
          {platform ? 'Emissão e consulta global' : 'Relatórios da empresa'}
        </h2>
        {!platform && organizationName && (
          <p>
            <strong>{organizationName}</strong>
          </p>
        )}
        <p>
          Cada emissão guarda os dados daquele momento. A prévia e o PDF mostram as mesmas
          informações.
        </p>
      </header>
      <form className="reports-filters" onSubmit={apply} aria-label="Filtros de emissão">
        {platform ? (
          <>
            <label>
              Nome ou CNPJ
              <input
                maxLength={160}
                value={draft.search}
                onChange={(event) => setDraft({ ...draft, search: event.target.value })}
              />
            </label>
            <label>
              Classificação
              <select
                value={draft.classification}
                onChange={(event) => setDraft({ ...draft, classification: event.target.value })}
              >
                <option value="CLIENT">Cliente</option>
                <option value="DEMONSTRATION">Demonstração</option>
                <option value="UNCLASSIFIED">Não classificado</option>
              </select>
            </label>
            <label>
              Estado fiscal
              <select
                value={draft.fiscalState}
                onChange={(event) => setDraft({ ...draft, fiscalState: event.target.value })}
              >
                <option value="VALID">Válido</option>
                <option value="">Todos (inclui pendências)</option>
                <option value="MISSING">Não informado</option>
                <option value="INVALID">Inválido</option>
                <option value="CONFLICT">Em conflito</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              Tipo de relatório
              <select
                value={draft.kind}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    kind: event.target.value as Filters['kind'],
                    isActive: '',
                    competence: '',
                  });
                  setDetails(false);
                  setFinancial(false);
                  setSectionKeys(null);
                }}
              >
                <option value="SST">SST</option>
                {people && <option value="PEOPLE">Gestão de Pessoas</option>}
              </select>
            </label>
            <ReferenceSelect
              kind="unit"
              label="Unidade do relatório"
              organizationId={organizationId!}
              value={draft.unitId}
              includeInactive
              onChange={(unitId) => setDraft({ ...draft, unitId, sectorId: '' })}
              onExpire={onExpire}
            />
            <ReferenceSelect
              key={draft.unitId}
              kind="sector"
              label="Setor do relatório"
              organizationId={organizationId!}
              unitId={draft.unitId}
              value={draft.sectorId}
              includeInactive
              onChange={(sectorId) => setDraft({ ...draft, sectorId })}
              onExpire={onExpire}
            />
            {draft.kind === 'PEOPLE' && (
              <label>
                Competência
                <input
                  type="month"
                  value={draft.competence}
                  onChange={(event) => setDraft({ ...draft, competence: event.target.value })}
                />
              </label>
            )}
          </>
        )}
        {(platform || draft.kind === 'PEOPLE') && (
          <label>
            Situação
            <select
              value={draft.isActive}
              onChange={(event) => setDraft({ ...draft, isActive: event.target.value })}
            >
              <option value="">Todas</option>
              <option value="true">Ativos</option>
              <option value="false">Inativos</option>
            </select>
          </label>
        )}
        {(platform || (draft.kind === 'PEOPLE' && profile)) && (
          <label className="reports-check">
            <input
              type="checkbox"
              checked={details}
              onChange={(event) => setDetails(event.target.checked)}
            />
            Incluir detalhes{!platform && draft.kind === 'PEOPLE' ? ' nominais' : ''}
          </label>
        )}
        {!platform && draft.kind === 'PEOPLE' && compensation && (
          <label className="reports-check">
            <input
              type="checkbox"
              checked={financial}
              onChange={(event) => setFinancial(event.target.checked)}
            />
            Incluir dados financeiros
          </label>
        )}
        {!platform && (
          <details className="report-section-disclosure" ref={sectionOptions}>
            <summary>
              <span>Personalizar seções</span>{' '}
              <small>
                {selectedSections.length} de {allSections.length} selecionadas
              </small>
            </summary>
            <fieldset className="report-section-options">
              <legend>Seções da emissão</legend>
              {Object.entries(sectionLabels).map(([key, label]) => (
                <label className="reports-check" key={key}>
                  <input
                    type="checkbox"
                    value={key}
                    checked={selectedSections.includes(key)}
                    onChange={(event) => toggleSection(key, event.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          </details>
        )}
        <Button type="submit">Aplicar filtros</Button>
        <Button
          variant="outline"
          onClick={() => {
            navigate({
              kind: 'SST',
              unitId: '',
              sectorId: '',
              isActive: '',
              competence: '',
              search: '',
              classification: 'CLIENT',
              fiscalState: 'VALID',
              page: 1,
              invalid: false,
            });
            setDetails(false);
            setFinancial(false);
            setSectionKeys(null);
          }}
        >
          Limpar filtros
        </Button>
      </form>
      {(error || invalid) && (
        <StatusMessage tone="error">
          {error ||
            'Filtros da URL inválidos ou sem permissão. Corrija os filtros ou use Limpar filtros.'}
        </StatusMessage>
      )}
      <div className="reports-actions">
        <Button disabled={pending || invalid} onClick={emit}>
          {pending ? 'Emitindo…' : 'Emitir relatório'}
        </Button>
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          Atualizar lista de relatórios
        </Button>
      </div>
      {!platform && !people && (
        <p>
          Emissão de Gestão de Pessoas exige exportação e leitura de indicadores de RH. Detalhes
          nominais e financeiros exigem permissões adicionais.
        </p>
      )}
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {list.loading && (
        <StatusMessage tone="loading">Carregando relatórios emitidos…</StatusMessage>
      )}
      {list.error && <StatusMessage tone="error">Lista indisponível. {list.error}</StatusMessage>}
      {list.data && (
        <>
          <h3>Emissões preservadas</h3>
          <ul className="reports-list">
            {list.data.items
              .filter((item) => platform || item.kind === 'SST' || people)
              .map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>
                      {item.context} · {item.createdAt} ·{' '}
                      {item.financial ? 'Com dados financeiros' : 'Sem dados financeiros'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    aria-label={`Abrir ${item.title}`}
                    onClick={() => {
                      setCreated(null);
                      setSelected(item.id);
                    }}
                  >
                    Abrir prévia
                  </Button>
                </li>
              ))}
          </ul>
          {!list.data.items.length && <StatusMessage>Nenhum relatório emitido.</StatusMessage>}
          <Pagination
            label="Páginas de relatórios"
            page={list.data.page}
            pageSize={25}
            total={list.data.total}
            onPageChange={(page) => navigate({ ...filters, page })}
          />
        </>
      )}
      {snapshot.loading && (
        <StatusMessage tone="loading">Carregando snapshot preservado…</StatusMessage>
      )}
      {snapshot.error && (
        <StatusMessage tone="error">Prévia indisponível. {snapshot.error}</StatusMessage>
      )}
      {(created || snapshot.data) && (
        <ReportPreview
          key={(created || snapshot.data)!.id}
          snapshot={(created || snapshot.data)!}
          base={base}
          onExpire={onExpire}
          onDenied={onDenied}
        />
      )}
    </section>
  );
}

function ReportPreview({
  snapshot,
  base,
  onExpire,
  onDenied,
}: {
  snapshot: ReportSnapshot;
  base: string;
  onExpire: () => void;
  onDenied: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef(new AbortController());
  const urls = useRef(new Set<string>());
  const scope = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  usePresentationMotion(scope, snapshot);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    const activeUrls = urls.current;
    return () => {
      current.abort();
      activeUrls.forEach((url) => URL.revokeObjectURL(url));
      activeUrls.clear();
    };
  }, []);
  async function download() {
    if (pending) return;
    setPending(true);
    setError('');
    setNotice('');
    try {
      const response = await send(
        `${base}/${snapshot.id}/pdf`,
        { signal: controller.current.signal, headers: { Accept: 'application/pdf' } },
        35_000,
      );
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf'))
        throw new RequestError(502);
      const blob = await response.blob();
      if (!blob.size) throw new RequestError(502);
      if (controller.current.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `renr-${snapshot.kind.toLowerCase()}-${snapshot.referenceDate}.pdf`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => {
        if (urls.current.delete(url)) URL.revokeObjectURL(url);
      }, 250);
      setNotice('PDF preparado para download.');
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) {
        onExpire();
        return;
      }
      if (failure instanceof RequestError && failure.status === 403) {
        onDenied();
        return;
      }
      setError(
        failure instanceof Error
          ? failure.message
          : 'Não foi possível preparar o PDF. Tente novamente.',
      );
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <section
      ref={scope}
      className="report-preview"
      data-motion-content=""
      aria-label="Prévia congelada do relatório"
    >
      <header>
        <p className="eyebrow">
          RENR+ · {snapshot.kind === 'PLATFORM' ? 'ESCOPO GLOBAL' : 'EMISSÃO DA EMPRESA'}
        </p>
        <h3 ref={heading} tabIndex={-1}>
          {snapshot.title}
        </h3>
        <p>{snapshot.context}</p>
        <p>
          Referência {snapshot.referenceDate} · {snapshot.timeZone} · emitido em{' '}
          {snapshot.createdAt}
        </p>
        <p>
          {snapshot.nominal ? 'Contém detalhes nominais.' : 'Sem detalhes nominais.'}{' '}
          {snapshot.financial ? 'Contém dados financeiros.' : 'Sem dados financeiros.'}
        </p>
      </header>
      <dl className="report-context">
        {snapshot.filters.map((filter, index) => (
          <div key={`${filter.label}:${index}`}>
            <dt>{filter.label}</dt>
            <dd>{filter.value}</dd>
          </div>
        ))}
      </dl>
      {snapshot.sections.map((section) => (
        <section key={section.key}>
          <h4>{section.title}</h4>
          <div
            className="report-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={`Tabela rolável: ${section.title}`}
          >
            <table aria-label={section.title}>
              <thead>
                <tr>
                  {section.columns.map((column, index) => (
                    <th key={index} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((value, index) => (
                      <td key={index}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!section.rows.length && <p>Sem registros nesta seção na data da emissão.</p>}
          <ul>
            {section.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </section>
      ))}
      {snapshot.limitations.length > 0 && (
        <aside>
          <h4>Limitações da emissão</h4>
          <ul>
            {snapshot.limitations.map((limit, index) => (
              <li key={index}>{limit}</li>
            ))}
          </ul>
        </aside>
      )}
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      <Button onClick={download} disabled={pending}>
        {pending ? 'Preparando PDF…' : 'Baixar PDF'}
      </Button>
    </section>
  );
}
