import { useState } from 'react';
import {
  hrProfileSchema,
  employmentPeriodListSchema,
  employmentPeriodSchema,
  remunerationListSchema,
  remunerationSchema,
  vacationPeriodListSchema,
  vacationPeriodSchema,
  type Employee,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { HrEditor, type HrKind, type HrRecord } from './HrEditor';
import { SettlementPreview } from './SettlementPreview';
import { usePeopleData, civil, money } from './usePeopleData';

const resources = {
  employment: {
    path: 'employment-periods',
    label: 'Vínculos',
    singular: 'vínculo',
    list: employmentPeriodListSchema,
    result: employmentPeriodSchema,
  },
  remuneration: {
    path: 'remunerations',
    label: 'Salários',
    singular: 'salário',
    list: remunerationListSchema,
    result: remunerationSchema,
  },
  vacation: {
    path: 'vacation-periods',
    label: 'Férias',
    singular: 'período de férias',
    list: vacationPeriodListSchema,
    result: vacationPeriodSchema,
  },
};
const genders = {
  FEMALE: 'Feminino',
  MALE: 'Masculino',
  NON_BINARY: 'Não binário',
  SELF_DESCRIBED: 'Autodescrito',
  PREFER_NOT_TO_SAY: 'Prefere não informar',
};
type DetailsProps = {
  employee: Employee;
  grants: string[];
  onExpire: () => void;
  onDenied: () => void;
};
export function EmployeeDetails({ employee, grants, onExpire, onDenied }: DetailsProps) {
  const [area, setArea] = useState<HrKind | 'settlement'>('profile');
  const compensationRead =
    grants.includes('HR_COMPENSATION_READ') || grants.includes('HR_COMPENSATION_MANAGE');
  const profileManage = grants.includes('HR_PROFILE_MANAGE');
  const base = `/organizations/${employee.organizationId}/employees/${employee.id}`;
  return (
    <div className="people-details">
      <p>
        {employee.unitName} · {employee.sectorName} · {employee.isActive ? 'Ativo' : 'Inativo'}
      </p>
      <nav className="people-areas" aria-label="Áreas do cadastro">
        {[
          ['profile', 'Perfil'],
          ['employment', 'Vínculos'],
          ['remuneration', 'Salários'],
          ['vacation', 'Férias'],
          ['settlement', 'Simulação'],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={area === key ? 'default' : 'outline'}
            aria-pressed={area === key}
            onClick={() => setArea(key as HrKind | 'settlement')}
          >
            {label}
          </Button>
        ))}
      </nav>
      {area === 'profile' ? (
        <ProfilePanel
          base={base}
          organizationId={employee.organizationId}
          manage={profileManage}
          onExpire={onExpire}
          onDenied={onDenied}
        />
      ) : area === 'settlement' ? (
        compensationRead ? (
          <SettlementPreview
            base={base}
            manage={grants.includes('HR_COMPENSATION_MANAGE')}
            onExpire={onExpire}
            onDenied={onDenied}
          />
        ) : (
          <StatusMessage>A simulação exige leitura ou gestão de remunerações.</StatusMessage>
        )
      ) : area === 'remuneration' && !compensationRead ? (
        <StatusMessage>Salários exigem leitura ou gestão de remunerações.</StatusMessage>
      ) : (
        <RecordPanel
          key={area}
          kind={area}
          base={base}
          organizationId={employee.organizationId}
          manage={
            area === 'remuneration' ? grants.includes('HR_COMPENSATION_MANAGE') : profileManage
          }
          onExpire={onExpire}
          onDenied={onDenied}
        />
      )}
    </div>
  );
}
function ProfilePanel({
  base,
  organizationId,
  manage,
  onExpire,
  onDenied,
}: {
  base: string;
  organizationId: string;
  manage: boolean;
  onExpire: () => void;
  onDenied: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const path = `${base}/hr-profile`;
  const profile = usePeopleData(
    path,
    hrProfileSchema,
    organizationId,
    onExpire,
    onDenied,
    revision,
  );
  if (profile.loading) return <StatusMessage tone="loading">Carregando perfil…</StatusMessage>;
  if (profile.error)
    return (
      <StatusMessage
        tone="error"
        action={<Button onClick={() => setRevision((value) => value + 1)}>Tentar novamente</Button>}
      >
        {profile.error}
      </StatusMessage>
    );
  if (!profile.data) return null;
  return (
    <section>
      <h3>Perfil de RH</h3>
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {editing && manage ? (
        <HrEditor
          kind="profile"
          record={profile.data}
          path={path}
          resultSchema={hrProfileSchema}
          loadCurrent={(signal) => request(path, hrProfileSchema, { signal })}
          onSaved={() => {
            setEditing(false);
            setNotice('Perfil salvo com histórico.');
            setRevision((value) => value + 1);
          }}
          onCancel={() => setEditing(false)}
          onExpire={onExpire}
          onDenied={onDenied}
        />
      ) : (
        <>
          <dl className="people-facts">
            <div>
              <dt>Data de nascimento</dt>
              <dd>{civil(profile.data.birthDate)}</dd>
            </div>
            <div>
              <dt>Gênero</dt>
              <dd>
                {profile.data.genderDescription ||
                  (profile.data.gender ? genders[profile.data.gender] : 'Não informado')}
              </dd>
            </div>
            <div>
              <dt>Histórico de férias</dt>
              <dd>{profile.data.vacationHistoryKnown ? 'Conhecido' : 'Desconhecido'}</dd>
            </div>
            <div>
              <dt>Histórico de afastamentos</dt>
              <dd>
                {profile.data.complexLeaveHistoryKnown
                  ? profile.data.hasComplexLeaves
                    ? 'Com afastamentos complexos'
                    : 'Sem afastamentos complexos informados'
                  : 'Desconhecido'}
              </dd>
            </div>
            <div>
              <dt>Acompanhamento</dt>
              <dd>{profile.data.followUp ? 'Requer acompanhamento' : 'Não sinalizado'}</dd>
            </div>
            <div>
              <dt>Fonte</dt>
              <dd>{profile.data.source ?? 'Não informada'}</dd>
            </div>
          </dl>
          {manage ? (
            <Button
              onClick={() => {
                setEditing(true);
                setNotice('');
              }}
            >
              Editar perfil
            </Button>
          ) : (
            <p>Perfil disponível somente para leitura.</p>
          )}
        </>
      )}
    </section>
  );
}

function RecordPanel({
  kind,
  base,
  organizationId,
  manage,
  onExpire,
  onDenied,
}: {
  kind: 'employment' | 'remuneration' | 'vacation';
  base: string;
  organizationId: string;
  manage: boolean;
  onExpire: () => void;
  onDenied: () => void;
}) {
  const config = resources[kind];
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{ record: HrRecord | null } | null>(null);
  const [notice, setNotice] = useState('');
  const path = `${base}/${config.path}`;
  const queryPath = `${path}?page=${page}&pageSize=25`;
  const schema: {
    parse(value: unknown): { items: HrRecord[]; total: number; page: number; pageSize: number };
  } = config.list;
  const list = usePeopleData(queryPath, schema, organizationId, onExpire, onDenied, revision);
  async function loadCurrent(signal: AbortSignal) {
    const fresh = await request(queryPath, schema, { signal });
    const record = fresh.items.find((item) => item.id === editor?.record?.id);
    if (!record) throw new RequestError(404);
    return record;
  }
  return (
    <section>
      <h3>{config.label}</h3>
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {editor && manage ? (
        <HrEditor
          key={editor.record?.id ?? 'new'}
          kind={kind}
          record={editor.record}
          path={editor.record ? `${path}/${editor.record.id}` : path}
          resultSchema={config.result}
          loadCurrent={loadCurrent}
          onSaved={() => {
            setEditor(null);
            setNotice('Registro salvo com histórico.');
            setRevision((value) => value + 1);
          }}
          onCancel={() => setEditor(null)}
          onExpire={onExpire}
          onDenied={onDenied}
        />
      ) : (
        <>
          {manage && (
            <Button
              onClick={() => {
                setEditor({ record: null });
                setNotice('');
              }}
            >
              Adicionar {config.singular}
            </Button>
          )}
          {list.loading && (
            <StatusMessage tone="loading">Carregando {config.label.toLowerCase()}…</StatusMessage>
          )}
          {list.error && (
            <StatusMessage
              tone="error"
              action={
                <Button onClick={() => setRevision((value) => value + 1)}>Tentar novamente</Button>
              }
            >
              {list.error}
            </StatusMessage>
          )}
          {list.data && (
            <>
              {!list.data.items.length && (
                <StatusMessage>
                  Nenhum registro informado. A ausência de histórico não representa saldo zero.
                </StatusMessage>
              )}
              <ul className="people-records">
                {list.data.items.map((record) => (
                  <li key={record.id}>
                    <RecordSummary kind={kind} record={record} />
                    {manage && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditor({ record });
                          setNotice('');
                        }}
                      >
                        Editar {config.singular}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <Pagination
                label={`Páginas de ${config.label.toLowerCase()}`}
                page={list.data.page}
                pageSize={25}
                total={list.data.total}
                onPageChange={setPage}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
function RecordSummary({
  kind,
  record,
}: {
  kind: 'employment' | 'remuneration' | 'vacation';
  record: HrRecord;
}) {
  const date = (field: string) => civil(typeof record[field] === 'string' ? record[field] : null);
  return (
    <div>
      {kind === 'employment' ? (
        <>
          <strong>
            {date('startsOn')} a {record.endsOn ? date('endsOn') : 'vínculo em aberto'}
          </strong>
        </>
      ) : kind === 'remuneration' ? (
        <>
          <strong>
            {String(record.competence)} · {money(String(record.salaryCents))}
          </strong>
          <p>{record.remunerationType === 'FIXED' ? 'Fixa' : 'Variável'}</p>
        </>
      ) : (
        <>
          <strong>
            Aquisição {date('acquisitionStart')} a {date('acquisitionEnd')}
          </strong>
          <p>
            Limite {date('concessionDeadline')} · saldo {String(record.balanceDays)} de{' '}
            {String(record.entitlementDays)} dias · {String(record.unjustifiedAbsences)} faltas
          </p>
          <p>Histórico {record.historyKnown ? 'conhecido' : 'desconhecido'}</p>
          {Array.isArray(record.uses) &&
            record.uses.map(
              (use: { startsOn: string; endsOn: string; paidOn: string | null }, index) => (
                <p key={index}>
                  Uso {civil(use.startsOn)} a {civil(use.endsOn)} · pagamento {civil(use.paidOn)}
                </p>
              ),
            )}
        </>
      )}
      <p>
        Fonte: {String(record.source)} · versão {record.version}
      </p>
    </div>
  );
}
