import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createOrganizationSchema,
  createUnitSchema,
  createSectorSchema,
  organizationSchema,
  unitSchema,
  sectorSchema,
  type Organization,
  type Unit,
  type Sector,
} from '@renr/contracts';
import { Button } from './ui/button';
import { request, RequestError } from '../lib/api';
type Kind = 'empresas' | 'unidades' | 'setores';
type RecordItem = Organization | Unit | Sector;
const singular = { empresas: 'empresa', unidades: 'unidade', setores: 'setor' };
export function StructureEditor({
  kind,
  item,
  path,
  onSaved,
  onCancel,
  onExpire,
}: {
  kind: Kind;
  item: RecordItem | null;
  path: string;
  onSaved: () => void;
  onCancel: () => void;
  onExpire: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [extra, setExtra] = useState(
    item && 'fiscalIdentifier' in item
      ? (item.fiscalIdentifier ?? '')
      : item && 'code' in item
        ? (item.code ?? '')
        : '',
  );
  const [timezone, setTimezone] = useState(
    item && 'timezone' in item ? item.timezone : 'America/Sao_Paulo',
  );
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<{ field: string; message: string }[]>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  const controller = useRef(new AbortController());
  useEffect(() => {
    nameInput.current?.focus();
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const body =
      kind === 'empresas'
        ? { name, timezone, fiscalIdentifier: extra.trim() || null }
        : kind === 'unidades'
          ? { name, code: extra.trim() || null }
          : { name };
    const parsed =
      kind === 'empresas'
        ? createOrganizationSchema.safeParse(body)
        : kind === 'unidades'
          ? createUnitSchema.safeParse(body)
          : createSectorSchema.safeParse(body);
    if (!parsed.success) {
      setError('Confira os campos destacados.');
      setFields(
        parsed.error.issues.map((issue) => ({
          field: String(issue.path[0]),
          message:
            issue.path[0] === 'timezone'
              ? 'Informe um fuso horário IANA, como America/Sao_Paulo.'
              : issue.path[0] === 'name'
                ? 'Use entre 2 e 120 caracteres.'
                : 'Confira o tamanho e o formato do campo.',
        })),
      );
      nameInput.current?.focus();
      return;
    }
    setPending(true);
    setError('');
    setFields([]);
    const options = {
      method: item ? 'PATCH' : 'POST',
      body: JSON.stringify(item ? { ...parsed.data, isActive } : parsed.data),
      signal: controller.current.signal,
    };
    try {
      if (kind === 'empresas') await request(path, organizationSchema, options);
      else if (kind === 'unidades') await request(path, unitSchema, options);
      else await request(path, sectorSchema, options);
      if (!controller.current.signal.aborted) onSaved();
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) {
        onExpire();
        return;
      }
      setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.');
      if (failure instanceof RequestError) setFields(failure.fields);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  function fieldError(field: string) {
    const message = fields.find((value) => value.field === field)?.message;
    return message ? (
      <span id={`error-${field}`} className="field-error">
        {message}
      </span>
    ) : null;
  }
  function invalid(field: string) {
    return fields.some((value) => value.field === field);
  }
  return (
    <section className="surface editor" aria-labelledby="editor-title">
      <p className="panel-label">{item ? 'EDITAR CADASTRO' : 'NOVO CADASTRO'}</p>
      <h2 id="editor-title">
        {item ? 'Editar' : 'Cadastrar'} {singular[kind]}
      </h2>
      <form
        aria-label={`${item ? 'Editar' : 'Cadastrar'} ${singular[kind]}`}
        onSubmit={(event) => void save(event)}
        noValidate
      >
        <label htmlFor="record-name">
          Nome {kind === 'setores' ? 'do setor' : `da ${singular[kind]}`}
        </label>
        <input
          ref={nameInput}
          id="record-name"
          value={name}
          maxLength={120}
          required
          aria-invalid={invalid('name')}
          aria-describedby={invalid('name') ? 'error-name' : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {fieldError('name')}
        {kind !== 'setores' && (
          <>
            <label htmlFor="record-extra">
              {kind === 'empresas' ? 'Identificador fiscal' : 'Código'}
            </label>
            <input
              id="record-extra"
              value={extra}
              maxLength={32}
              aria-invalid={invalid(kind === 'empresas' ? 'fiscalIdentifier' : 'code')}
              aria-describedby={
                invalid(kind === 'empresas' ? 'fiscalIdentifier' : 'code')
                  ? `error-${kind === 'empresas' ? 'fiscalIdentifier' : 'code'}`
                  : 'optional-hint'
              }
              onChange={(event) => setExtra(event.target.value)}
            />
            <span id="optional-hint" className="input-hint">
              Campo opcional
            </span>
            {fieldError(kind === 'empresas' ? 'fiscalIdentifier' : 'code')}
          </>
        )}
        {kind === 'empresas' && (
          <>
            <label htmlFor="timezone">Fuso horário</label>
            <input
              id="timezone"
              value={timezone}
              required
              aria-invalid={invalid('timezone')}
              aria-describedby={invalid('timezone') ? 'error-timezone' : 'timezone-hint'}
              onChange={(event) => setTimezone(event.target.value)}
            />
            <span id="timezone-hint" className="input-hint">
              Exemplo: America/Sao_Paulo
            </span>
            {fieldError('timezone')}
          </>
        )}
        {item && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Cadastro ativo
          </label>
        )}
        {item && !isActive && (
          <p className="input-hint">
            Os registros vinculados e seus históricos serão preservados. A desativação não apaga
            cadastros filhos nem substitui a revisão dos acessos da empresa.
          </p>
        )}
        {error && (
          <p role="alert" className="feedback error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando…' : `Salvar ${singular[kind]}`}
          </Button>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </section>
  );
}
