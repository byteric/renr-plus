import { useState } from 'react';
import {
  instrumentListSchema,
  instrumentSchema,
  instrumentVersionListSchema,
  instrumentVersionSchema,
  consolidationPolicyListSchema,
  consolidationPolicySchema,
} from '@renr/contracts';
import { useWorkforceData } from '../workforce/useWorkforceData';
import { Pagination } from '../ui/pagination';
import './assessments-policies.css';
export type AssessmentReferenceFieldsProps = {
  organizationId: string;
  instrumentId: string;
  instrumentVersionId: string;
  policyVersionId: string;
  onInstrumentChange: (instrumentId: string, versionId: string) => void;
  onPolicyChange: (policyId: string) => void;
  disabled: boolean;
  attempt?: number;
  onExpire: () => void;
};
export function AssessmentReferenceFields({
  organizationId,
  instrumentId,
  instrumentVersionId,
  policyVersionId,
  onInstrumentChange,
  onPolicyChange,
  disabled,
  onExpire,
  attempt = 0,
}: AssessmentReferenceFieldsProps) {
  const [instrumentPage, setInstrumentPage] = useState(1);
  const [versionPage, setVersionPage] = useState(1);
  const [policyPage, setPolicyPage] = useState(1);
  const root = `/organizations/${organizationId}`;
  const instruments = useWorkforceData(
    `${root}/instruments?page=${instrumentPage}&pageSize=20`,
    instrumentListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const identity = useWorkforceData(
    instrumentId ? `${root}/instruments/${instrumentId}` : null,
    instrumentSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const versions = useWorkforceData(
    instrumentId
      ? `${root}/instruments/${instrumentId}/versions?page=${versionPage}&pageSize=20`
      : null,
    instrumentVersionListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const version = useWorkforceData(
    instrumentId && instrumentVersionId
      ? `${root}/instruments/${instrumentId}/versions/${instrumentVersionId}`
      : null,
    instrumentVersionSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const policies = useWorkforceData(
    `${root}/consolidation-policies?page=${policyPage}&pageSize=20`,
    consolidationPolicyListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  const policy = useWorkforceData(
    policyVersionId ? `${root}/consolidation-policies/${policyVersionId}` : null,
    consolidationPolicySchema,
    organizationId,
    onExpire,
    attempt,
  );
  const instrumentItems = [...(instruments.data?.items ?? [])];
  if (identity.data?.id === instrumentId && !instrumentItems.some((i) => i.id === instrumentId))
    instrumentItems.push(identity.data);
  const versionItems = (versions.data?.items ?? []).filter(
    (v) => v.status === 'PUBLISHED' && v.instrumentId === instrumentId,
  );
  if (
    version.data?.id === instrumentVersionId &&
    version.data.instrumentId === instrumentId &&
    version.data.status === 'PUBLISHED' &&
    !versionItems.some((v) => v.id === instrumentVersionId)
  )
    versionItems.push(version.data);
  const policyItems = (policies.data?.items ?? []).filter((p) => p.status === 'PUBLISHED');
  if (
    policy.data?.id === policyVersionId &&
    policy.data.status === 'PUBLISHED' &&
    !policyItems.some((p) => p.id === policyVersionId)
  )
    policyItems.push(policy.data);
  const errors = [
    instruments.error,
    identity.error,
    versions.error,
    version.error,
    policies.error,
    policy.error,
  ].filter(Boolean);
  return (
    <div className="assessment-reference-fields">
      <div>
        <label>
          Instrumento da coleta
          <select
            value={instrumentId}
            disabled={disabled || instruments.loading}
            onChange={(e) => {
              setVersionPage(1);
              onInstrumentChange(e.target.value, '');
            }}
          >
            <option value="">Selecione o instrumento</option>
            {instrumentId && !instrumentItems.some((i) => i.id === instrumentId) && (
              <option value={instrumentId}>Instrumento selecionado · {instrumentId}</option>
            )}
            {instrumentItems.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <Pagination
          label="Páginas de instrumentos"
          previousLabel="Instrumentos anteriores"
          nextLabel="Próximos instrumentos"
          page={instrumentPage}
          pageSize={instruments.data?.pageSize ?? 20}
          total={instruments.data?.total ?? 0}
          pending={disabled || instruments.loading}
          onPageChange={setInstrumentPage}
        />
      </div>
      <div>
        <label>
          Versão publicada do instrumento
          <select
            value={instrumentVersionId}
            disabled={disabled || !instrumentId || versions.loading}
            onChange={(e) => onInstrumentChange(instrumentId, e.target.value)}
          >
            <option value="">Selecione a versão publicada</option>
            {instrumentVersionId && !versionItems.some((v) => v.id === instrumentVersionId) && (
              <option value={instrumentVersionId}>
                Versão selecionada · {instrumentVersionId}
              </option>
            )}
            {versionItems.map((v) => (
              <option key={v.id} value={v.id}>
                {v.title} · v{v.version} · {v.usageMode === 'REAL' ? 'Uso real' : 'Demonstração'}
              </option>
            ))}
          </select>
        </label>
        <Pagination
          label="Páginas de versões"
          previousLabel="Versões anteriores"
          nextLabel="Próximas versões"
          page={versionPage}
          pageSize={versions.data?.pageSize ?? 20}
          total={versions.data?.total ?? 0}
          pending={disabled || versions.loading || !instrumentId}
          onPageChange={setVersionPage}
        />
      </div>
      <div>
        <label>
          Política de consolidação
          <select
            value={policyVersionId}
            disabled={disabled || policies.loading}
            onChange={(e) => onPolicyChange(e.target.value)}
          >
            <option value="">Selecione a política publicada</option>
            {policyVersionId && !policyItems.some((p) => p.id === policyVersionId) && (
              <option value={policyVersionId}>Política selecionada · {policyVersionId}</option>
            )}
            {policyItems.map((p) => (
              <option key={p.id} value={p.id}>
                Política v{p.version} · {p.usageMode === 'REAL' ? 'Uso real' : 'Demonstração'}
              </option>
            ))}
          </select>
        </label>
        <Pagination
          label="Páginas de políticas publicadas"
          previousLabel="Políticas anteriores"
          nextLabel="Próximas políticas"
          page={policyPage}
          pageSize={policies.data?.pageSize ?? 20}
          total={policies.data?.total ?? 0}
          pending={disabled || policies.loading}
          onPageChange={setPolicyPage}
        />
      </div>
      {errors.length > 0 && <p role="alert">{errors[0]}</p>}
    </div>
  );
}
