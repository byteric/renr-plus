import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createEmployeeSchema,
  createAssessmentGroupSchema,
  employeeSchema,
  assessmentGroupSchema,
  type Employee,
  type AssessmentGroup,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { ReferenceSelect } from './ReferenceSelect';
import { resource } from './workforce-paths';

export type WorkforceKind = 'colaboradores' | 'grupos';
export type WorkforceItem = Employee | AssessmentGroup;

export function WorkforceEditor({
  kind,
  item,
  organizationId,
  initialUnitId,
  initialSectorId,
  onSaved,
  onCancel,
  onExpire,
  onDenied,
}: {
  kind: WorkforceKind;
  item: WorkforceItem | null;
  organizationId: string;
  initialUnitId: string;
  initialSectorId: string;
  onSaved: () => void;
  onCancel: () => void;
  onExpire: () => void;
  onDenied: () => void;
}) {
  const employee = kind === 'colaboradores';
  // A background refresh must not silently authorize overwriting somebody else's edit.
  const [baseVersion] = useState(item?.version);
  const [name, setName] = useState(item?.name ?? '');
  const [internalIdentifier, setIdentifier] = useState(
    item && 'internalIdentifier' in item ? (item.internalIdentifier ?? '') : '',
  );
  const [unitId, setUnit] = useState(item?.unitId ?? initialUnitId);
  const [sectorId, setSector] = useState(item?.sectorId ?? initialSectorId);
  const [linkedUserId, setLinkedUser] = useState(
    item && 'linkedUserId' in item ? (item.linkedUserId ?? '') : '',
  );
  const [linkUser, setLinkUser] = useState(!!linkedUserId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<{ field: string; message: string }[]>([]);
  const nameRef = useRef<HTMLInputElement>(null);
  const controller = useRef(new AbortController());
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    nameRef.current?.focus();
    return () => current.abort();
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const body = employee
      ? {
          name,
          internalIdentifier: internalIdentifier.trim() || null,
          unitId,
          sectorId,
          linkedUserId: linkUser ? linkedUserId || null : null,
        }
      : item
        ? { name }
        : { name, sectorId };
    const parsed = employee
      ? createEmployeeSchema.safeParse(body)
      : item
        ? createAssessmentGroupSchema.pick({ name: true }).safeParse(body)
        : createAssessmentGroupSchema.safeParse(body);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => ({
        field: String(issue.path[0]),
        message:
          issue.path[0] === 'name'
            ? 'Informe um nome entre 2 e 120 caracteres.'
            : 'Selecione uma opção válida para este campo.',
      }));
      setErrors(fields);
      setError('Confira os campos informados.');
      const first = formRef.current?.elements.namedItem(fields[0]?.field ?? 'name');
      if (first instanceof HTMLElement) first.focus();
      return;
    }
    setPending(true);
    setError('');
    setErrors([]);
    try {
      const path = `/organizations/${organizationId}/${resource(kind)}${item ? `/${item.id}` : ''}`;
      const options = {
        method: item ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...parsed.data, ...(item ? { version: baseVersion } : {}) }),
        signal: controller.current.signal,
      };
      if (employee) await request(path, employeeSchema, options);
      else await request(path, assessmentGroupSchema, options);
      if (!controller.current.signal.aborted) onSaved();
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) return onExpire();
      if (failure instanceof RequestError && failure.status === 403) return onDenied();
      setError(
        failure instanceof RequestError && failure.status === 409
          ? 'Cadastro duplicado, vínculo indisponível ou versão desatualizada. Seu rascunho foi mantido. Confira os vínculos; se outra pessoa editou, cancele e abra o cadastro atualizado.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível salvar. Tente novamente.',
      );
      if (failure instanceof RequestError) setErrors(failure.fields);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  const nameId = employee ? 'employee-name' : 'group-name';
  const nameError = errors.find((field) => field.field === 'name');
  return (
    <section className="surface workforce-editor" aria-labelledby="workforce-editor-title">
      <p className="panel-label">{item ? 'EDITAR CADASTRO' : 'NOVO CADASTRO'}</p>
      <h2 id="workforce-editor-title">
        {item ? 'Editar' : 'Cadastrar'} {employee ? 'colaborador' : 'grupo de avaliação'}
      </h2>
      <form
        ref={formRef}
        aria-label={`${item ? 'Editar' : 'Cadastrar'} ${employee ? 'colaborador' : 'grupo de avaliação'}`}
        onSubmit={(event) => void save(event)}
        noValidate
      >
        <fieldset disabled={pending}>
          <legend className="sr-only">Dados do cadastro</legend>
          <label htmlFor={nameId}>Nome {employee ? 'do colaborador' : 'do grupo'}</label>
          <input
            ref={nameRef}
            id={nameId}
            name="name"
            value={name}
            required
            maxLength={120}
            autoComplete="off"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 'workforce-name-error' : undefined}
            onChange={(event) => setName(event.target.value)}
          />
          {nameError && (
            <span className="field-error" id="workforce-name-error">
              {nameError.message}
            </span>
          )}
          {employee && (
            <>
              <label htmlFor="internal-identifier">Identificação interna (opcional)</label>
              <input
                id="internal-identifier"
                name="internalIdentifier"
                value={internalIdentifier}
                maxLength={64}
                onChange={(event) => setIdentifier(event.target.value)}
              />
              <span className="input-hint">
                Use a matrícula interna, não CPF ou informações clínicas.
              </span>
            </>
          )}
          {employee || !item ? (
            <div className="workforce-location">
              <ReferenceSelect
                kind="unit"
                organizationId={organizationId}
                value={unitId}
                initialLabel={item?.unitName}
                label="Unidade do cadastro"
                onExpire={onExpire}
                required
                onChange={(value) => {
                  setUnit(value);
                  setSector('');
                }}
              />
              <ReferenceSelect
                key={unitId}
                kind="sector"
                organizationId={organizationId}
                unitId={unitId}
                value={sectorId}
                initialLabel={item?.sectorName}
                label="Setor do cadastro"
                onExpire={onExpire}
                required
                onChange={setSector}
              />
            </div>
          ) : (
            <p>
              Vinculado a {item.unitName} · {item.sectorName}. O setor é preservado para manter a
              continuidade dos registros.
            </p>
          )}
          {!employee && !item && (
            <p className="input-hint">
              Há um grupo por setor. Se já existir um grupo criado durante um diagnóstico ou
              registro de risco, edite esse grupo em vez de criar outro.
            </p>
          )}
          {employee && (
            <div className="workforce-user-link">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={linkUser}
                  onChange={(event) => setLinkUser(event.target.checked)}
                />
                Vincular a um usuário existente
              </label>
              <p className="input-hint">
                Opcional. Não concede permissões e não identifica quem respondeu aos diagnósticos.
              </p>
              {linkUser && (
                <ReferenceSelect
                  kind="member"
                  organizationId={organizationId}
                  value={linkedUserId}
                  label="Usuário vinculado"
                  onChange={setLinkedUser}
                  onExpire={onExpire}
                />
              )}
            </div>
          )}
        </fieldset>
        {error && (
          <StatusMessage tone="error">
            <p>{error}</p>
            {errors
              .filter((field) => field.field !== 'name')
              .map((field) => (
                <p key={field.field}>
                  {field.field}: {field.message}
                </p>
              ))}
          </StatusMessage>
        )}
        <div className="form-actions">
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando…' : `Salvar ${employee ? 'colaborador' : 'grupo'}`}
          </Button>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancelar edição
          </Button>
        </div>
      </form>
    </section>
  );
}
