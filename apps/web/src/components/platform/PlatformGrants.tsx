import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  platformGrantListSchema,
  platformGrantSchema,
  writePlatformGrantSchema,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { usePrivateQuery } from './usePrivateQuery';

type Grant = ReturnType<typeof platformGrantSchema.parse>;
const labels = {
  READ_OVERVIEW: 'Ler resumo e catálogo',
  MANAGE_CLIENTS: 'Corrigir cadastros de clientes',
  MANAGE_GRANTS: 'Gerenciar concessões globais',
};
export function PlatformGrants({
  onExpire,
  onDenied,
}: {
  onExpire: () => void;
  onDenied: () => void;
}) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<{ grant: Grant | null } | null>(null);
  const [notice, setNotice] = useState('');
  const path = `/platform/grants?page=${page}&pageSize=25`;
  const list = usePrivateQuery(path, platformGrantListSchema, revision, onExpire, onDenied);
  return (
    <section className="platform-grants">
      <h3>Concessões globais</h3>
      <p>
        Concessões são explícitas e revogáveis. Elas não autorizam acesso a dados nominais ou
        financeiros das empresas.
      </p>
      <Button
        onClick={() => {
          setSelected({ grant: null });
          setNotice('');
        }}
      >
        Adicionar concessão
      </Button>
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {list.loading && <StatusMessage tone="loading">Carregando concessões…</StatusMessage>}
      {list.error && (
        <StatusMessage
          tone="error"
          action={
            <Button onClick={() => setRevision((value) => value + 1)}>Recarregar concessões</Button>
          }
        >
          {list.error}
        </StatusMessage>
      )}
      {selected && (
        <GrantEditor
          key={selected.grant ? `${selected.grant.userId}:${selected.grant.capability}` : 'new'}
          grant={selected.grant}
          listPath={path}
          onSaved={() => {
            setSelected(null);
            setNotice('Concessão atualizada com histórico.');
            setRevision((value) => value + 1);
          }}
          onCancel={() => setSelected(null)}
          onExpire={onExpire}
          onDenied={onDenied}
        />
      )}
      {list.data && (
        <>
          <ul className="platform-records">
            {list.data.items.map((grant) => (
              <li key={`${grant.userId}:${grant.capability}`}>
                <div>
                  <strong>{grant.name}</strong>
                  <p>{grant.email}</p>
                  <p>
                    {labels[grant.capability]} · {grant.isActive ? 'Ativa' : 'Revogada'} · versão{' '}
                    {grant.version}
                  </p>
                </div>
                <Button
                  variant="outline"
                  aria-label={`Editar concessão de ${grant.name}: ${labels[grant.capability]}`}
                  onClick={() => {
                    setSelected({ grant });
                    setNotice('');
                  }}
                >
                  Editar concessão
                </Button>
              </li>
            ))}
          </ul>
          {!list.data.items.length && <StatusMessage>Nenhuma concessão cadastrada.</StatusMessage>}
          <Pagination
            label="Páginas de concessões"
            page={list.data.page}
            pageSize={25}
            total={list.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </section>
  );
}
function GrantEditor({
  grant,
  listPath,
  onSaved,
  onCancel,
  onExpire,
  onDenied,
}: {
  grant: Grant | null;
  listPath: string;
  onSaved: () => void;
  onCancel: () => void;
  onExpire: () => void;
  onDenied: () => void;
}) {
  const [userId, setUserId] = useState(grant?.userId ?? '');
  const [capability, setCapability] = useState(grant?.capability ?? 'READ_OVERVIEW');
  const [active, setActive] = useState(grant?.isActive ?? true);
  const [reason, setReason] = useState('');
  const [version, setVersion] = useState(grant?.version ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState<Grant | null>(null);
  const controller = useRef(new AbortController());
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  function fail(failure: unknown) {
    if (controller.current.signal.aborted) return;
    if (failure instanceof RequestError && failure.status === 401) {
      onExpire();
      return;
    }
    if (failure instanceof RequestError && failure.status === 403) {
      onDenied();
      return;
    }
    if (failure instanceof RequestError && failure.status === 409) {
      setConflict(true);
      setError(
        'A concessão mudou ou esta alteração removeria o último gestor. Seu rascunho foi preservado; revise a versão atual.',
      );
    } else
      setError(
        failure instanceof Error ? failure.message : 'Não foi possível atualizar a concessão.',
      );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || conflict) return;
    const parsed = writePlatformGrantSchema.safeParse({
      expectedVersion: version,
      userId,
      capability,
      isActive: active,
      reason,
    });
    if (!parsed.success) {
      setError('Confira o identificador do usuário e o motivo (mínimo de 3 caracteres).');
      return;
    }
    setPending(true);
    setError('');
    try {
      await request('/platform/grants', platformGrantSchema, {
        method: 'PUT',
        body: JSON.stringify(parsed.data),
        signal: controller.current.signal,
      });
      if (!controller.current.signal.aborted) onSaved();
    } catch (failure) {
      fail(failure);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  async function reload() {
    setPending(true);
    try {
      const list = await request(listPath, platformGrantListSchema, {
        signal: controller.current.signal,
      });
      const current = list.items.find(
        (item) => item.userId === userId && item.capability === capability,
      );
      if (!current) {
        setError(
          'A concessão não foi encontrada nesta página. O rascunho foi preservado; confira o cadastro existente antes de tentar novamente.',
        );
        return;
      }
      if (!controller.current.signal.aborted) setReview(current);
    } catch (failure) {
      fail(failure);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <form onSubmit={save} className="platform-editor" aria-label="Editar concessão global">
      <h4>{grant ? `Concessão de ${grant.name}` : 'Nova concessão'}</h4>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      <label>
        Identificador do usuário
        <input
          required
          value={userId}
          readOnly={!!grant || conflict}
          onChange={(event) => setUserId(event.target.value)}
        />
      </label>
      <label>
        Permissão global
        <select
          value={capability}
          disabled={!!grant || conflict}
          onChange={(event) => setCapability(event.target.value as typeof capability)}
        >
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="platform-check">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        Concessão ativa
      </label>
      <label>
        Motivo da concessão
        <textarea
          required
          minLength={3}
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <p>Versão em edição {version}. Desmarcar a concessão ativa registra sua revogação.</p>
      {conflict && (
        <>
          <Button variant="outline" disabled={pending} onClick={reload}>
            Carregar concessão atual para revisão
          </Button>
          {review && (
            <section className="platform-review">
              <p>
                {review.name} · {labels[review.capability]} ·{' '}
                {review.isActive ? 'Ativa' : 'Revogada'} · versão {review.version}
              </p>
              <Button
                onClick={() => {
                  setVersion(review.version);
                  setConflict(false);
                  setReview(null);
                  setError('Versão revisada. Confira a mudança antes de salvar.');
                }}
              >
                Confirmar revisão da concessão
              </Button>
            </section>
          )}
        </>
      )}
      <div className="platform-areas">
        <Button type="submit" disabled={pending || conflict}>
          {pending ? 'Salvando…' : 'Salvar concessão'}
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar concessão
        </Button>
      </div>
    </form>
  );
}
