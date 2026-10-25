import { useState } from 'react';
import {
  consolidationPolicyListSchema,
  consolidationPolicySchema,
  createConsolidationPolicySchema,
  updateConsolidationPolicySchema,
  type ConsolidationPolicy,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { useWorkforceData } from '../workforce/useWorkforceData';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import './assessments-policies.css';

export function ConsolidationPolicies({
  organizationId,
  canEdit,
  canPublishReal,
  onExpire,
}: {
  organizationId: string;
  canEdit: boolean;
  canPublishReal: boolean;
  onExpire: () => void;
}) {
  const base = `/organizations/${organizationId}/consolidation-policies`;
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const list = useWorkforceData(
    `${base}?page=${page}&pageSize=20`,
    consolidationPolicyListSchema,
    organizationId,
    onExpire,
    attempt,
  );
  // A deliberate snapshot owns the editor: revalidation never replaces unsaved fields or its revision.
  const [selected, setSelected] = useState<ConsolidationPolicy | null>(null);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<'DEMONSTRATION' | 'REAL'>('DEMONSTRATION');
  const [minimum, setMinimum] = useState('5');
  const [approval, setApproval] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const open = (policy: ConsolidationPolicy) => {
    setSelected(policy);
    setCreating(false);
    setMode(policy.usageMode);
    setMinimum(policy.minimumResponses?.toString() ?? '');
    setApproval(policy.approvalReference ?? '');
    setError('');
    setNotice('');
  };
  const mutate = async (action: 'save' | 'publish' | 'fork') => {
    setPending(true);
    setError('');
    setNotice('');
    try {
      let body: unknown;
      if (action === 'save') {
        const fields = {
          usageMode: mode,
          minimumResponses: mode === 'DEMONSTRATION' ? 5 : minimum === '' ? null : Number(minimum),
        };
        const parsed = selected
          ? updateConsolidationPolicySchema.safeParse({
              ...fields,
              expectedRevision: selected.revision,
            })
          : createConsolidationPolicySchema.safeParse(fields);
        if (!parsed.success) {
          setError('Informe um limiar inteiro entre 2 e 1000, ou deixe vazio no rascunho real.');
          return;
        }
        body = parsed.data;
      } else {
        if (!selected) return;
        if (
          action === 'publish' &&
          selected.usageMode === 'REAL' &&
          (!canPublishReal || !selected.minimumResponses || approval.trim().length < 3)
        ) {
          setError(
            'Publicação real exige decisão técnica, limiar salvo e referência de aprovação.',
          );
          return;
        }
        body = {
          expectedRevision: selected.revision,
          ...(action === 'publish' && selected.usageMode === 'REAL'
            ? { approvalReference: approval.trim() }
            : {}),
        };
      }
      const value = await request(
        `${base}${selected ? `/${selected.id}` : ''}${action === 'save' ? '' : `/${action}`}`,
        consolidationPolicySchema,
        { method: action === 'save' && selected ? 'PUT' : 'POST', body: JSON.stringify(body) },
      );
      if (value.organizationId !== organizationId) throw new RequestError(502);
      open(value);
      setAttempt((v) => v + 1);
      setNotice(
        action === 'publish'
          ? 'Política publicada.'
          : action === 'fork'
            ? 'Nova versão em rascunho criada.'
            : 'Rascunho salvo.',
      );
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 401) onExpire();
      setError(
        failure instanceof RequestError && failure.status === 409
          ? 'A versão mudou no servidor. Seu rascunho foi preservado; cancele para consultar a versão atual.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível salvar a política.',
      );
    } finally {
      setPending(false);
    }
  };
  const editing = creating || !!selected;
  const dirty =
    !!selected &&
    (mode !== selected.usageMode || minimum !== (selected.minimumResponses?.toString() ?? ''));
  const readonly = selected?.status === 'PUBLISHED' || !canEdit;
  return (
    <section className="assessment-policies">
      <div className="workforce-toolbar">
        <h2>Políticas de consolidação</h2>
        {canEdit && !editing && (
          <Button
            onClick={() => {
              setCreating(true);
              setMode('DEMONSTRATION');
              setMinimum('5');
              setApproval('');
              setError('');
            }}
          >
            Criar política
          </Button>
        )}
      </div>
      <p>Versões publicadas são imutáveis. O limiar protege a divulgação dos resultados.</p>
      {list.loading && <p role="status">Carregando políticas…</p>}
      {list.error && <p role="alert">{list.error}</p>}
      {!editing && (
        <>
          <ul className="assessment-policy-list">
            {list.data?.items.map((p) => (
              <li key={p.id}>
                <Button variant="outline" disabled={list.loading} onClick={() => open(p)}>
                  Política v{p.version} · {p.status === 'PUBLISHED' ? 'Publicada' : 'Rascunho'} ·{' '}
                  {p.usageMode === 'REAL' ? 'Uso real' : 'Demonstração'}
                </Button>
              </li>
            ))}
          </ul>
          {list.data?.items.length === 0 && <p>Nenhuma política cadastrada.</p>}
          <Pagination
            label="Páginas de políticas"
            page={page}
            pageSize={list.data?.pageSize ?? 20}
            total={list.data?.total ?? 0}
            onPageChange={setPage}
            pending={list.loading}
          />
        </>
      )}
      {editing && (
        <div className="surface assessment-policy-editor">
          <h3>
            {selected
              ? `Política v${selected.version} · ${selected.status === 'PUBLISHED' ? 'Publicada' : 'Rascunho'}`
              : 'Nova política'}
          </h3>
          <label>
            Modo de uso
            <select
              disabled={readonly || pending}
              value={mode}
              onChange={(e) => {
                const value = e.target.value as typeof mode;
                setMode(value);
                setMinimum(value === 'DEMONSTRATION' ? '5' : '');
              }}
            >
              <option value="DEMONSTRATION">Demonstração</option>
              <option value="REAL">Uso real</option>
            </select>
          </label>
          <label>
            Limiar mínimo de respostas
            <input
              type="number"
              min="2"
              max="1000"
              step="1"
              value={minimum}
              disabled={readonly || pending || mode === 'DEMONSTRATION'}
              onChange={(e) => setMinimum(e.target.value)}
            />
          </label>
          {mode === 'REAL' && (
            <>
              <p>
                Defina o limiar explicitamente antes de publicar. ADMIN não substitui a capacidade
                de decisão técnica.
              </p>
              <label>
                Referência de aprovação
                <input
                  value={approval}
                  maxLength={1000}
                  disabled={pending || selected?.status === 'PUBLISHED' || !canPublishReal}
                  onChange={(e) => setApproval(e.target.value)}
                />
              </label>
            </>
          )}
          {dirty && <p>Salve as alterações antes de publicar.</p>}
          <div className="assessment-policy-actions">
            {!readonly && (
              <Button disabled={pending} onClick={() => void mutate('save')}>
                Salvar rascunho
              </Button>
            )}
            {selected?.status === 'DRAFT' &&
              (selected.usageMode === 'REAL' ? canPublishReal : canEdit) && (
                <Button
                  variant="outline"
                  disabled={pending || dirty}
                  onClick={() => void mutate('publish')}
                >
                  Publicar política
                </Button>
              )}
            {selected?.status === 'PUBLISHED' && canEdit && (
              <Button disabled={pending} onClick={() => void mutate('fork')}>
                Criar nova versão
              </Button>
            )}
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setSelected(null);
                setCreating(false);
                setError('');
                setNotice('');
                setAttempt((value) => value + 1);
              }}
            >
              Cancelar e voltar à lista
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
