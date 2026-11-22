import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  clientRegistrationSchema,
  createPlatformClientSchema,
  platformClientListSchema,
  writeClientRegistrationSchema,
  type ClientRegistration,
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

export function ClientCreator({
  onCreated,
  onExpire,
  onDenied,
}: {
  onCreated: (created: ClientRegistration) => void;
  onExpire: () => void;
  onDenied: () => void;
}) {
  const idPrefix = useId();
  const [name, setName] = useState('');
  const [fiscalIdentifier, setFiscalIdentifier] = useState('');
  const [classification, setClassification] = useState<'CLIENT' | 'DEMONSTRATION' | 'UNCLASSIFIED'>(
    'CLIENT',
  );
  const [active, setActive] = useState(true);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const controller = useRef(new AbortController());
  const busy = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy.current || pending) return;
    const parsed = createPlatformClientSchema.safeParse({
      name,
      fiscalIdentifier: fiscalIdentifier.trim() || null,
      clientClassification: classification,
      isActive: active,
      reason,
    });
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        nextErrors[key] =
          key === 'name'
            ? 'Informe a razão social ou nome da empresa (2 a 160 caracteres).'
            : key === 'fiscalIdentifier'
              ? 'Informe um CNPJ válido (14 caracteres) ou deixe em branco para empresas sem classificação de cliente.'
              : key === 'reason'
                ? 'Informe o motivo do cadastro (mínimo de 3 caracteres).'
                : issue.message;
      }
      setFieldErrors(nextErrors);
      setError('Confira os campos destacados antes de cadastrar a empresa.');
      const firstKey = Object.keys(nextErrors)[0];
      const firstControl = firstKey ? formRef.current?.elements.namedItem(firstKey) : null;
      if (firstControl instanceof HTMLElement) firstControl.focus();
      return;
    }
    if (parsed.data.clientClassification === 'CLIENT' && !parsed.data.fiscalIdentifier) {
      setFieldErrors({
        fiscalIdentifier: 'Classificar como cliente exige um CNPJ válido informado.',
      });
      setError('Informe um CNPJ válido para cadastrar a empresa como cliente.');
      const control = formRef.current?.elements.namedItem('fiscalIdentifier');
      if (control instanceof HTMLElement) control.focus();
      return;
    }

    const { signal } = controller.current;
    busy.current = true;
    setPending(true);
    setError('');
    setFieldErrors({});
    try {
      const created = await request('/platform/clients', clientRegistrationSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        signal,
      });
      if (!signal.aborted) onCreated(created);
    } catch (failure) {
      if (signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) {
        onExpire();
        return;
      }
      if (failure instanceof RequestError && failure.status === 403) {
        onDenied();
        return;
      }
      if (failure instanceof RequestError && failure.status === 409) {
        setFieldErrors({
          fiscalIdentifier: 'CNPJ já cadastrado, inválido ou com conflito pendente no catálogo.',
        });
        setError(
          'CNPJ já cadastrado, inválido ou com conflito pendente no catálogo. Seu rascunho foi preservado; confira o identificador antes de tentar novamente.',
        );
        const control = formRef.current?.elements.namedItem('fiscalIdentifier');
        if (control instanceof HTMLElement) control.focus();
      } else {
        setError(
          failure instanceof Error ? failure.message : 'Não foi possível cadastrar a empresa.',
        );
      }
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  return (
    <form
      ref={formRef}
      className="platform-editor"
      onSubmit={(event) => void save(event)}
      aria-label="Cadastrar empresa no catálogo"
      noValidate
    >
      <p>
        Use apenas dados autorizados ou fictícios. Empresas classificadas como{' '}
        <strong>Cliente</strong> exigem CNPJ válido (numérico ou alfanumérico) sem duplicidade no
        catálogo. A validação não consulta a Receita Federal.
      </p>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      <div>
        <label htmlFor={`${idPrefix}-name`}>Nome da empresa</label>
        <input
          id={`${idPrefix}-name`}
          name="name"
          required
          minLength={2}
          maxLength={160}
          value={name}
          aria-invalid={!!fieldErrors.name}
          aria-describedby={fieldErrors.name ? `${idPrefix}-name-err` : undefined}
          onChange={(event) => {
            setName(event.target.value);
            if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: '' });
          }}
        />
        {fieldErrors.name && (
          <span id={`${idPrefix}-name-err`} className="field-error">
            {fieldErrors.name}
          </span>
        )}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-cnpj`}>CNPJ</label>
        <input
          id={`${idPrefix}-cnpj`}
          name="fiscalIdentifier"
          maxLength={32}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={fiscalIdentifier}
          aria-invalid={!!fieldErrors.fiscalIdentifier}
          aria-describedby={
            fieldErrors.fiscalIdentifier ? `${idPrefix}-cnpj-err` : `${idPrefix}-cnpj-hint`
          }
          onChange={(event) => {
            setFiscalIdentifier(event.target.value);
            if (fieldErrors.fiscalIdentifier)
              setFieldErrors({ ...fieldErrors, fiscalIdentifier: '' });
          }}
        />
        <span id={`${idPrefix}-cnpj-hint`} className="input-hint">
          Informe os 14 caracteres (com ou sem pontuação). Obrigatório para classificação Cliente.
        </span>
        {fieldErrors.fiscalIdentifier && (
          <span id={`${idPrefix}-cnpj-err`} className="field-error">
            {fieldErrors.fiscalIdentifier}
          </span>
        )}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-classification`}>Classificação inicial</label>
        <select
          id={`${idPrefix}-classification`}
          name="clientClassification"
          value={classification}
          onChange={(event) => {
            const next = event.target.value as typeof classification;
            setClassification(next);
            if (next !== 'CLIENT' && fieldErrors.fiscalIdentifier) {
              setFieldErrors({ ...fieldErrors, fiscalIdentifier: '' });
            }
          }}
        >
          <option value="CLIENT">Cliente</option>
          <option value="DEMONSTRATION">Demonstração</option>
          <option value="UNCLASSIFIED">Não classificado</option>
        </select>
      </div>
      <label className="platform-check" htmlFor={`${idPrefix}-active`}>
        <input
          id={`${idPrefix}-active`}
          name="isActive"
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        Cadastro ativo no catálogo
      </label>
      <div>
        <label htmlFor={`${idPrefix}-reason`}>Motivo do cadastro</label>
        <textarea
          id={`${idPrefix}-reason`}
          name="reason"
          required
          minLength={3}
          maxLength={1000}
          value={reason}
          aria-invalid={!!fieldErrors.reason}
          aria-describedby={fieldErrors.reason ? `${idPrefix}-reason-err` : undefined}
          onChange={(event) => {
            setReason(event.target.value);
            if (fieldErrors.reason) setFieldErrors({ ...fieldErrors, reason: '' });
          }}
        />
        {fieldErrors.reason && (
          <span id={`${idPrefix}-reason-err`} className="field-error">
            {fieldErrors.reason}
          </span>
        )}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Cadastrando…' : 'Salvar empresa no catálogo'}
      </Button>
    </form>
  );
}
