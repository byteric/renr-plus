import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  employeeListSchema,
  clientRegistrationSchema,
  peopleOverviewQuerySchema,
  employeeQuerySchema,
  sessionCapabilitiesSchema,
  type Employee,
} from '@renr/contracts';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { Pagination } from '../ui/pagination';
import { ReferenceSelect } from '../workforce/ReferenceSelect';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '../ui/sheet';
import { usePeopleData } from './usePeopleData';
import { PeopleOverview } from './PeopleOverview';
import { fiscalLabels } from '../../lib/fiscal-labels';
import { EmployeeDetails } from './EmployeeDetails';
import './people.css';

type Filters = {
  area: 'overview' | 'employees';
  unitId: string;
  sectorId: string;
  isActive: string;
  competence: string;
  page: number;
  invalid?: boolean;
};
function readFilters(): Filters {
  const query = new URLSearchParams(window.location.hash.split('?')[1]);
  const parsed = peopleOverviewQuerySchema.safeParse(
    Object.fromEntries(
      ['unitId', 'sectorId', 'isActive', 'competence']
        .filter((key) => query.has(key))
        .map((key) => [key, query.get(key)]),
    ),
  );
  const page = Number(query.get('page') ?? 1);
  const value = parsed.success
    ? parsed.data
    : Object.fromEntries(
        ['unitId', 'sectorId', 'isActive', 'competence'].map((key) => [key, query.get(key) ?? '']),
      );
  const validPage = Number.isSafeInteger(page) && page > 0 && page <= 1000000;
  const duplicate = ['unitId', 'sectorId', 'isActive', 'competence', 'area', 'page'].some(
    (key) => query.getAll(key).length > 1,
  );
  return {
    area: query.get('area') === 'employees' ? 'employees' : 'overview',
    unitId: value.unitId ?? '',
    sectorId: value.sectorId ?? '',
    isActive: value.isActive ?? '',
    competence: value.competence ?? '',
    page: validPage ? page : 1,
    invalid:
      !parsed.success ||
      duplicate ||
      !validPage ||
      (query.has('area') && !['overview', 'employees'].includes(query.get('area') ?? '')),
  };
}
function queryFor(filters: Filters, nominal = false) {
  const query = new URLSearchParams();
  for (const key of ['unitId', 'sectorId', 'isActive'] as const)
    if (filters[key]) query.set(key, filters[key]);
  if (nominal) {
    query.set('page', String(filters.page));
    query.set('pageSize', '25');
  } else if (filters.competence) query.set('competence', filters.competence);
  return query;
}

export function PeopleWorkspace(props: { organizationId: string; onExpire: () => void }) {
  return <PeopleManager key={props.organizationId} {...props} />;
}

function PeopleManager({
  organizationId,
  onExpire,
}: {
  organizationId: string;
  onExpire: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [expired, setExpired] = useState(false);
  const expire = useCallback(() => {
    setExpired(true);
    onExpire();
  }, [onExpire]);
  const deny = useCallback(() => setBlocked(true), []);
  const capabilities = usePeopleData(
    expired ? null : '/auth/session-capabilities',
    sessionCapabilitiesSchema,
    organizationId,
    expire,
    deny,
    revision,
    true,
  );
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    const visibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  if (expired)
    return (
      <StatusMessage tone="error">
        Sua sessão terminou. Os dados privados foram removidos.
      </StatusMessage>
    );
  if (capabilities.loading && !capabilities.data)
    return <StatusMessage tone="loading">Verificando permissões de Pessoas…</StatusMessage>;
  if (capabilities.error || blocked)
    return (
      <StatusMessage
        tone="error"
        action={
          <Button
            onClick={() => {
              setBlocked(false);
              setRevision((value) => value + 1);
            }}
          >
            Atualizar permissões
          </Button>
        }
      >
        {capabilities.error ||
          'Seu acesso aos dados de Pessoas foi revogado. Os dados privados foram removidos.'}
      </StatusMessage>
    );
  const grants = capabilities.data?.capabilities ?? [];
  if (!grants.some((grant) => grant.startsWith('HR_')))
    return <StatusMessage>O acesso a Pessoas requer uma permissão de RH específica.</StatusMessage>;
  return (
    <PeopleContent
      key={`${organizationId}:${grants.join(',')}`}
      organizationId={organizationId}
      grants={grants}
      onExpire={expire}
      onDenied={deny}
    />
  );
}

function PeopleContent({
  organizationId,
  grants,
  onExpire,
  onDenied,
}: {
  organizationId: string;
  grants: string[];
  onExpire: () => void;
  onDenied: () => void;
}) {
  const [filters, setFilters] = useState(readFilters);
  const [draft, setDraft] = useState(filters);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [drillLabel, setDrillLabel] = useState<{ id: string; label: string } | null>(null);
  const employeesHeading = useRef<HTMLHeadingElement>(null);
  const focusDrill = useRef(false);
  useEffect(() => {
    if (filters.area === 'employees' && focusDrill.current) {
      employeesHeading.current?.focus();
      focusDrill.current = false;
    }
  }, [filters.area]);
  const canList = grants.includes('HR_PROFILE_READ') || grants.includes('HR_PROFILE_MANAGE');
  const analytics = grants.includes('HR_ANALYTICS_READ');
  useEffect(() => {
    const change = () => {
      const next = readFilters();
      setFilters(next);
      setDraft(next);
      setSelected(null);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const registration = usePeopleData(
    canList && filters.area === 'employees'
      ? `/organizations/${organizationId}/client-registration`
      : null,
    clientRegistrationSchema,
    organizationId,
    onExpire,
    onDenied,
    revision,
  );
  const listQuery = queryFor(filters, true);
  const employees = usePeopleData(
    canList && !filters.invalid && filters.area === 'employees'
      ? `/organizations/${organizationId}/people/employees?${listQuery}`
      : null,
    employeeListSchema,
    organizationId,
    onExpire,
    onDenied,
    revision,
  );
  function navigate(next: Filters) {
    const query = queryFor(next);
    query.set('area', next.area);
    if (next.page > 1) query.set('page', String(next.page));
    const base = window.location.hash.split('?')[0] || '#/pessoas';
    window.history.replaceState(null, '', `${base}?${query}`);
    setFilters(next);
    setDraft(next);
    setSelected(null);
    setError('');
  }
  function openDistribution(dimension: 'unit' | 'sector', id: string, label: string) {
    focusDrill.current = true;
    setDrillLabel({ id, label });
    navigate({
      ...filters,
      area: 'employees',
      page: 1,
      unitId: dimension === 'unit' ? id : filters.unitId,
      sectorId: dimension === 'sector' ? id : id === filters.unitId ? filters.sectorId : '',
    });
  }
  function apply(event: FormEvent) {
    event.preventDefault();
    const query = queryFor(draft);
    if (
      !peopleOverviewQuerySchema.safeParse(Object.fromEntries(query)).success ||
      !employeeQuerySchema.safeParse(Object.fromEntries(queryFor(draft, true))).success
    ) {
      setError('Confira os identificadores da unidade e do setor e a competência.');
      return;
    }
    navigate({ ...draft, page: 1, invalid: false });
  }
  return (
    <section className="people-workspace" aria-labelledby="people-title">
      <header className="people-heading">
        <div>
          <p className="eyebrow">PERCURSO · PESSOAS</p>
          <h2 id="people-title">Gestão de pessoas</h2>
          <p>Indicadores protegidos e registros de RH com histórico.</p>
          {registration.data && (
            <p>
              <strong>{registration.data.name}</strong> · CNPJ{' '}
              {registration.data.fiscalIdentifier || 'não informado'} ·{' '}
              {fiscalLabels[registration.data.fiscalState]} · Cadastro{' '}
              {registration.data.isActive ? 'ativo' : 'inativo'}
            </p>
          )}
          {registration.error && <p>Situação fiscal indisponível.</p>}
        </div>
        <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
          Atualizar dados
        </Button>
      </header>
      <nav className="people-areas" aria-label="Áreas de Pessoas">
        <Button
          aria-pressed={filters.area === 'overview'}
          variant={filters.area === 'overview' ? 'default' : 'outline'}
          onClick={() => navigate({ ...filters, area: 'overview' })}
        >
          Indicadores
        </Button>
        <Button
          aria-pressed={filters.area === 'employees'}
          variant={filters.area === 'employees' ? 'default' : 'outline'}
          onClick={() => navigate({ ...filters, area: 'employees' })}
        >
          Colaboradores
        </Button>
      </nav>
      <form className="people-filters" onSubmit={apply} aria-label="Filtros de Pessoas">
        <ReferenceSelect
          kind="unit"
          label="Unidade"
          organizationId={organizationId}
          value={draft.unitId}
          initialLabel={drillLabel?.id === draft.unitId ? drillLabel.label : undefined}
          onChange={(unitId) => setDraft({ ...draft, unitId, sectorId: '' })}
          onExpire={onExpire}
          includeInactive
        />
        <ReferenceSelect
          key={draft.unitId}
          kind="sector"
          label="Setor"
          organizationId={organizationId}
          unitId={draft.unitId}
          value={draft.sectorId}
          initialLabel={drillLabel?.id === draft.sectorId ? drillLabel.label : undefined}
          onChange={(sectorId) => setDraft({ ...draft, sectorId })}
          onExpire={onExpire}
          includeInactive
        />
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
        <label>
          Competência
          <input
            type="month"
            value={draft.competence}
            onChange={(event) => setDraft({ ...draft, competence: event.target.value })}
          />
        </label>
        <Button type="submit">Aplicar filtros</Button>
        <Button
          variant="outline"
          onClick={() =>
            navigate({
              area: filters.area,
              unitId: '',
              sectorId: '',
              isActive: '',
              competence: '',
              page: 1,
            })
          }
        >
          Limpar filtros
        </Button>
      </form>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {filters.invalid ? (
        <StatusMessage tone="error">
          Filtros da URL inválidos ou duplicados. Corrija os filtros ou use Limpar filtros antes de
          consultar os dados.
        </StatusMessage>
      ) : filters.area === 'overview' ? (
        analytics ? (
          <PeopleOverview
            organizationId={organizationId}
            query={queryFor(filters).toString()}
            onOpenDistribution={canList ? openDistribution : undefined}
            revision={revision}
            onExpire={onExpire}
            onDenied={onDenied}
          />
        ) : (
          <StatusMessage>
            A visão agregada exige a permissão de leitura de indicadores de RH.
          </StatusMessage>
        )
      ) : !canList ? (
        <StatusMessage>A lista nominal exige leitura ou gestão do perfil de RH.</StatusMessage>
      ) : (
        <>
          <h3 ref={employeesHeading} tabIndex={-1}>
            Colaboradores
          </h3>
          {employees.loading && (
            <StatusMessage tone="loading">Carregando colaboradores…</StatusMessage>
          )}
          {employees.error && (
            <StatusMessage
              tone="error"
              action={
                <Button onClick={() => setRevision((value) => value + 1)}>Tentar novamente</Button>
              }
            >
              {employees.error}
            </StatusMessage>
          )}
          {employees.data && (
            <>
              <p>
                {employees.data.total} registros de colaboradores. Dados nominais restritos ao
                contexto desta empresa.
              </p>
              <ul className="people-employees">
                {employees.data.items.map((employee) => (
                  <li key={employee.id}>
                    <div>
                      <strong>{employee.name}</strong>
                      <p>
                        {employee.unitName} · {employee.sectorName}
                      </p>
                      <small>
                        {employee.isActive ? 'Ativo' : 'Inativo'} ·{' '}
                        {employee.internalIdentifier || 'Sem identificador interno'}
                      </small>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setSelected(employee)}
                      aria-label={`Abrir ${employee.name}`}
                    >
                      Abrir cadastro
                    </Button>
                  </li>
                ))}
              </ul>
              {!employees.data.items.length && (
                <StatusMessage>Nenhum colaborador para os filtros selecionados.</StatusMessage>
              )}
              <Pagination
                label="Páginas de colaboradores"
                page={employees.data.page}
                pageSize={25}
                total={employees.data.total}
                onPageChange={(page) => navigate({ ...filters, page })}
              />
            </>
          )}
        </>
      )}
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="people-sheet">
          <SheetTitle>Cadastro de RH{selected ? ` · ${selected.name}` : ''}</SheetTitle>
          <SheetDescription>
            Dados privados desta empresa. Alterações exigem fonte e motivo.
          </SheetDescription>
          {selected && (
            <EmployeeDetails
              key={selected.id}
              employee={selected}
              grants={grants}
              onExpire={onExpire}
              onDenied={onDenied}
            />
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
