import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  clientRegistrationSchema,
  platformClientListSchema,
  writeClientRegistrationSchema,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';

type Client = ReturnType<typeof platformClientListSchema.parse>['items'][number];
export function ClientEditor({
  client,
  listPath,
  onSaved,
  onExpire,
  onDenied,
}: {
  client: Client;
  listPath: string;
  onSaved: () => void;
  onExpire: () => void;
  onDenied: () => void;
}) {
  const [fiscalIdentifier, setFiscalIdentifier] = useState(client.fiscalIdentifier ?? '');
  const [classification, setClassification] = useState(client.clientClassification);
  const [active, setActive] = useState(client.isActive);
  const [reason, setReason] = useState('');
  const [version, setVersion] = useState(client.version);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState<Client | null>(null);
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
        'O cadastro mudou ou o CNPJ está em conflito. Seu rascunho foi preservado; revise a versão atual antes de salvar novamente.',
      );
    } else
      setError(
        failure instanceof Error ? failure.message : 'Não foi possível atualizar o cadastro.',
      );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || conflict) return;
    const parsed = writeClientRegistrationSchema.safeParse({
      expectedVersion: version,
      reason,
      fiscalIdentifier: fiscalIdentifier.trim() || null,
      clientClassification: classification,
      isActive: active,
    });
    if (!parsed.success) {
      setError(
        'Informe um CNPJ válido ou deixe o campo em branco e confira o motivo (mínimo de 3 caracteres).',
      );
      return;
    }
    setPending(true);
    setError('');
    try {
      await request(`/platform/clients/${client.organizationId}`, clientRegistrationSchema, {
        method: 'PATCH',
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
      const list = await request(listPath, platformClientListSchema, {
        signal: controller.current.signal,
      });
      const current = list.items.find((item) => item.organizationId === client.organizationId);
      if (!current) throw new RequestError(404);
      if (!controller.current.signal.aborted) setReview(current);
    } catch (failure) {
      fail(failure);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <form className="platform-editor" onSubmit={save} aria-label="Correção assistida">
      <h3>{client.name}</h3>
      <p>
        Versão em edição {version}. Classificar como cliente exige CNPJ válido. A validação não
        consulta a situação cadastral na Receita Federal.
      </p>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      <label>
        CNPJ
        <input
          value={fiscalIdentifier}
          maxLength={32}
          onChange={(event) => setFiscalIdentifier(event.target.value)}
        />
      </label>
      <label>
        Classificação do cadastro
        <select
          value={classification}
          onChange={(event) => setClassification(event.target.value as typeof classification)}
        >
          <option value="CLIENT">Cliente</option>
          <option value="DEMONSTRATION">Demonstração</option>
          <option value="UNCLASSIFIED">Não classificado</option>
        </select>
      </label>
      <label className="platform-check">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        Cadastro ativo
      </label>
      <label>
        Motivo da correção
        <textarea
          required
          minLength={3}
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {conflict && (
        <>
          <Button variant="outline" disabled={pending} onClick={reload}>
            Carregar cadastro atual para revisão
          </Button>
          {review && (
            <section className="platform-review">
              <h4>Versão atual {review.version}</h4>
              <p>
                {review.name} · CNPJ {review.fiscalIdentifier || 'Não informado'} ·{' '}
                {review.clientClassification} · {review.isActive ? 'Ativo' : 'Inativo'}
              </p>
              <p>Compare com seu rascunho. Confirmar a revisão não salva automaticamente.</p>
              <Button
                onClick={() => {
                  setVersion(review.version);
                  setConflict(false);
                  setReview(null);
                  setError('Versão revisada. Confira o CNPJ e o rascunho antes de salvar.');
                }}
              >
                Confirmar revisão do cadastro
              </Button>
            </section>
          )}
        </>
      )}
      <Button type="submit" disabled={pending || conflict}>
        {pending ? 'Salvando…' : 'Salvar correção'}
      </Button>
    </form>
  );
}
