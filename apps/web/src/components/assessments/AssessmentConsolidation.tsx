import { useEffect, useRef, useState } from 'react';
import { assessmentConsolidationSchema, type AssessmentResults as Result } from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { AssessmentReferenceFields } from './AssessmentReferenceFields';
import { AssessmentResults } from './AssessmentResults';
import './assessments-policies.css';
export function AssessmentConsolidation({
  organizationId,
  onExpire,
}: {
  organizationId: string;
  onExpire: () => void;
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
            <option value="">Toda a organização</option>
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
