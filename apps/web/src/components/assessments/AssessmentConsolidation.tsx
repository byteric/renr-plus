import { useEffect, useRef, useState } from 'react';
import {
  assessmentConsolidationSchema,
  assessmentCycleListSchema,
  type AssessmentResults as Result,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { AssessmentReferenceFields } from './AssessmentReferenceFields';
import { AssessmentResults } from './AssessmentResults';
import { useWorkforceData } from '../workforce/useWorkforceData';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import './assessments-policies.css';
export function AssessmentConsolidation({
  organizationId,
  onExpire,
  delegated = false,
}: {
  organizationId: string;
  onExpire: () => void;
  delegated?: boolean;
}) {
  const [instrumentId, setInstrumentId] = useState('');
  const [instrumentVersionId, setInstrumentVersionId] = useState('');
  const [policyVersionId, setPolicyVersionId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [value, setValue] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const current = useRef(0);
  useEffect(
    () => () => {
      current.current++;
    },
    [],
  );
  const clear = () => {
    current.current++;
    setValue(null);
    setUnits([]);
    setUnitId('');
    setError('');
    setPending(false);
  };
  const consult = async () => {
    const sequence = ++current.current;
    setPending(true);
    setError('');
    setValue(null);
    const query = new URLSearchParams({ instrumentVersionId, policyVersionId });
    if (unitId) query.set('unitId', unitId);
    try {
      const result = await request(
        `/organizations/${organizationId}/assessment-consolidation?${query}`,
        assessmentConsolidationSchema,
      );
      if (sequence !== current.current) return;
      if (
        result.organizationId !== organizationId ||
        result.instrumentVersionId !== instrumentVersionId ||
        result.policyVersionId !== policyVersionId ||
        (!unitId && result.node.nodeType !== 'ORGANIZATION') ||
        (unitId && (result.node.id !== unitId || result.node.nodeType !== 'UNIT'))
      )
        throw new RequestError(502);
      setValue(result);
      if (!unitId)
        setUnits(
          result.node.children
            .filter((n) => n.nodeType === 'UNIT')
            .map(({ id, name }) => ({ id, name })),
        );
    } catch (failure) {
      if (sequence !== current.current) return;
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      setError(
        failure instanceof Error ? failure.message : 'Não foi possível consultar a consolidação.',
      );
    } finally {
      if (sequence === current.current) setPending(false);
    }
  };
  // Validate the selected family again at the rendering boundary.
  const renderValue =
    value?.organizationId === organizationId &&
    value.instrumentVersionId === instrumentVersionId &&
    value.policyVersionId === policyVersionId
      ? value
      : null;
  return (
    <section className="assessment-consolidation">
      <h2>Consolidação de coletas</h2>
      <p>
        Consulte a família formada pela versão exata do instrumento e da política. Os totais
        representam envios, sem identificar pessoas únicas.
      </p>
      {delegated ? (
        <DelegatedCollectionReference
          organizationId={organizationId}
          disabled={pending}
          onExpire={onExpire}
          onSelect={(instrument, policy) => {
            clear();
            setInstrumentVersionId(instrument);
            setPolicyVersionId(policy);
          }}
        />
      ) : (
        <AssessmentReferenceFields
          organizationId={organizationId}
          instrumentId={instrumentId}
          instrumentVersionId={instrumentVersionId}
          policyVersionId={policyVersionId}
          disabled={pending}
          onExpire={onExpire}
          onInstrumentChange={(id, version) => {
            clear();
            setInstrumentId(id);
            setInstrumentVersionId(version);
          }}
          onPolicyChange={(id) => {
            clear();
            setPolicyVersionId(id);
          }}
        />
      )}
      {units.length > 0 && (
        <label>
          Recorte da unidade
          <select
            value={unitId}
            disabled={pending}
            onChange={(e) => {
              current.current++;
              setUnitId(e.target.value);
              setValue(null);
              setError('');
            }}
          >
            <option value="">
              {delegated ? 'Todos os recortes autorizados' : 'Toda a organização'}
            </option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div>
        <Button
          disabled={pending || !instrumentVersionId || !policyVersionId}
          onClick={() => void consult()}
        >
          {pending ? 'Consultando…' : 'Consultar consolidação'}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {renderValue && (
        <>
          <p>
            Família: instrumento {renderValue.instrumentVersionId} · política{' '}
            {renderValue.policyVersionId}
          </p>
          <AssessmentResults value={renderValue} />
        </>
      )}
    </section>
  );
}

function DelegatedCollectionReference({
  organizationId,
  disabled,
  onExpire,
  onSelect,
}: {
  organizationId: string;
  disabled: boolean;
  onExpire: () => void;
  onSelect: (instrumentVersionId: string, policyVersionId: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [cycleId, setCycleId] = useState('');
  const { data, loading, error } = useWorkforceData(
    `/organizations/${organizationId}/assessment-cycles?page=${page}&pageSize=20`,
    assessmentCycleListSchema,
    organizationId,
    onExpire,
  );
  const items = data?.items ?? [];
  if (error) return <StatusMessage tone="error">{error}</StatusMessage>;
  if (loading) return <StatusMessage tone="loading">Carregando coletas autorizadas…</StatusMessage>;
  if (data?.total === 0) return <StatusMessage>Nenhuma coleta no seu recorte.</StatusMessage>;
  return (
    <div className="assessment-reference-fields">
      <label>
        Coleta que define instrumento e política
        <select
          value={cycleId}
          disabled={disabled}
          onChange={(event) => {
            const item = items.find(({ id }) => id === event.target.value);
            setCycleId(item?.id ?? '');
            onSelect(item?.instrumentVersionId ?? '', item?.policyVersionId ?? '');
          }}
        >
          <option value="">Selecione uma coleta</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.sectorName}
            </option>
          ))}
        </select>
      </label>
      {data && data.total > data.pageSize && (
        <Pagination
          page={page}
          pageSize={data.pageSize}
          total={data.total}
          label="Páginas de coletas"
          pending={disabled}
          onPageChange={(next) => {
            setPage(next);
            setCycleId('');
            onSelect('', '');
          }}
        />
      )}
    </div>
  );
}
