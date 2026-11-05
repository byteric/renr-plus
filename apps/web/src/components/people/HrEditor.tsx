import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  updateHrProfileSchema,
  writeEmploymentPeriodSchema,
  writeRemunerationSchema,
  writeVacationPeriodSchema,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';

export type HrRecord = { version: number; id?: string; [field: string]: unknown };
export type HrKind = 'profile' | 'employment' | 'remuneration' | 'vacation';
type Field = {
  key: string;
  label: string;
  type?: 'date' | 'month' | 'number' | 'checkbox' | 'select' | 'text';
  options?: [string, string][];
  required?: boolean;
  min?: number;
  max?: number;
};
const fields: Record<HrKind, Field[]> = {
  profile: [
    { key: 'birthDate', label: 'Data de nascimento', type: 'date' },
    {
      key: 'gender',
      label: 'Gênero',
      type: 'select',
      options: [
        ['', 'Não informado'],
        ['FEMALE', 'Feminino'],
        ['MALE', 'Masculino'],
        ['NON_BINARY', 'Não binário'],
        ['SELF_DESCRIBED', 'Autodescrito'],
        ['PREFER_NOT_TO_SAY', 'Prefere não informar'],
      ],
    },
    { key: 'genderDescription', label: 'Autodescrição de gênero' },
    { key: 'vacationHistoryKnown', label: 'Histórico de férias conhecido', type: 'checkbox' },
    {
      key: 'complexLeaveHistoryKnown',
      label: 'Histórico de afastamentos conhecido',
      type: 'checkbox',
    },
    { key: 'hasComplexLeaves', label: 'Há afastamentos complexos', type: 'checkbox' },
    { key: 'followUp', label: 'Requer acompanhamento', type: 'checkbox' },
  ],
  employment: [
    { key: 'startsOn', label: 'Início do vínculo', type: 'date', required: true },
    { key: 'endsOn', label: 'Fim do vínculo', type: 'date' },
  ],
  remuneration: [
    { key: 'competence', label: 'Competência salarial', type: 'month', required: true },
    { key: 'salaryCents', label: 'Salário em centavos', type: 'text', required: true },
    {
      key: 'remunerationType',
      label: 'Tipo de remuneração',
      type: 'select',
      options: [
        ['FIXED', 'Fixa'],
        ['VARIABLE', 'Variável'],
      ],
    },
  ],
  vacation: [
    { key: 'acquisitionStart', label: 'Início aquisitivo', type: 'date', required: true },
    { key: 'acquisitionEnd', label: 'Fim aquisitivo', type: 'date', required: true },
    { key: 'concessionDeadline', label: 'Limite concessivo', type: 'date', required: true },
    {
      key: 'entitlementDays',
      label: 'Dias de direito',
      type: 'number',
      min: 0,
      max: 30,
      required: true,
    },
    { key: 'balanceDays', label: 'Dias de saldo', type: 'number', min: 0, max: 30, required: true },
    {
      key: 'unjustifiedAbsences',
      label: 'Faltas injustificadas',
      type: 'number',
      min: 0,
      max: 366,
      required: true,
    },
    { key: 'historyKnown', label: 'Histórico do período conhecido', type: 'checkbox' },
  ],
};
const schemas = {
  profile: updateHrProfileSchema,
  employment: writeEmploymentPeriodSchema,
  remuneration: writeRemunerationSchema,
  vacation: writeVacationPeriodSchema,
};
const saveLabels = {
  profile: 'Salvar perfil',
  employment: 'Salvar vínculo',
  remuneration: 'Salvar salário',
  vacation: 'Salvar férias',
};
function initialValues(kind: HrKind, record: HrRecord | null) {
  const values: Record<string, string | boolean> = {};
  for (const field of fields[kind])
    values[field.key] =
      field.type === 'checkbox'
        ? record?.[field.key] === true
        : String(record?.[field.key] ?? (field.key === 'remunerationType' ? 'FIXED' : ''));
  values.source = String(record?.source ?? '');
  values.reason = '';
  return values;
}
type VacationUse = { startsOn: string; endsOn: string; paidOn: string | null };

/** Four versioned forms share validation, conflict review and abortable mutation semantics. */
export function HrEditor({
  kind,
  record,
  path,
  resultSchema,
  onSaved,
  onCancel,
  onExpire,
  onDenied,
  loadCurrent,
}: {
  kind: HrKind;
  record: HrRecord | null;
  path: string;
  resultSchema: { parse(value: unknown): HrRecord };
  onSaved: () => void;
  onCancel: () => void;
  onExpire: () => void;
  onDenied: () => void;
  loadCurrent: (signal: AbortSignal) => Promise<HrRecord>;
}) {
  const [values, setValues] = useState(() => initialValues(kind, record));
  const [uses, setUses] = useState<VacationUse[]>(() =>
    Array.isArray(record?.uses) ? (record.uses as VacationUse[]) : [],
  );
  const [version, setVersion] = useState(record?.version ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [review, setReview] = useState<HrRecord | null>(null);
  const controller = useRef(new AbortController());
  const form = useRef<HTMLFormElement>(null);
  const vacationHintId = useId();
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  async function fail(failure: unknown) {
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
        'O registro mudou. Seu rascunho foi preservado; carregue e revise a versão atual antes de salvar novamente.',
      );
    } else
      setError(
        failure instanceof Error
          ? failure.message
          : 'Não foi possível salvar. Seu rascunho foi preservado.',
      );
    if (failure instanceof RequestError)
      setErrors(Object.fromEntries(failure.fields.map((field) => [field.field, field.message])));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || conflict) return;
    const payload: Record<string, unknown> = {
      expectedVersion: version,
      source: values.source,
      reason: values.reason,
    };
    for (const field of fields[kind]) {
      const value = values[field.key];
      payload[field.key] =
        field.type === 'number'
          ? value === ''
            ? undefined
            : Number(value)
          : field.type === 'checkbox'
            ? value === true
            : value;
    }
    if (kind === 'profile') {
      payload.birthDate ||= null;
      payload.gender ||= null;
      payload.genderDescription =
        payload.gender === 'SELF_DESCRIBED' ? payload.genderDescription || null : null;
    }
    if (kind === 'employment') payload.endsOn ||= null;
    if (kind === 'vacation')
      payload.uses = uses.map((use) => ({ ...use, paidOn: use.paidOn || null }));
    const parsed = schemas[kind].safeParse(payload);
    if (!parsed.success) {
      const fieldErrors = Object.fromEntries(
        parsed.error.issues.map((issue) => [issue.path.join('.') || 'form', issue.message]),
      );
      setErrors(fieldErrors);
      setError('Confira os campos e as datas informadas.');
      queueMicrotask(() =>
        form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setPending(true);
    setError('');
    setErrors({});
    try {
      await request(path, resultSchema, {
        method: kind === 'profile' ? 'PUT' : record ? 'PATCH' : 'POST',
        body: JSON.stringify(parsed.data),
        signal: controller.current.signal,
      });
      if (!controller.current.signal.aborted) onSaved();
    } catch (failure) {
      await fail(failure);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  async function reviewCurrent() {
    setPending(true);
    try {
      const current = await loadCurrent(controller.current.signal);
      if (!controller.current.signal.aborted) setReview(current);
    } catch (failure) {
      await fail(failure);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <form ref={form} className="people-editor" onSubmit={save} aria-label={saveLabels[kind]}>
      <p>Versão em edição: {version}. Fonte e motivo ficam no histórico da alteração.</p>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {kind === 'vacation' && (
        <p id={vacationHintId} className="input-hint">
          Informe 0, 12, 18, 24 ou 30 dias de direito conforme o cenário CLT.
        </p>
      )}
      <div className="people-fields">
        {fields[kind].map((field) => (
          <label key={field.key} className={field.type === 'checkbox' ? 'people-check' : ''}>
            {field.type === 'checkbox' ? (
              <input
                type="checkbox"
                checked={values[field.key] === true}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.checked })}
              />
            ) : null}
            {field.label}
            {field.type === 'select' ? (
              <select
                value={String(values[field.key])}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
              >
                {field.options?.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            ) : field.type !== 'checkbox' ? (
              <input
                type={field.type ?? 'text'}
                min={field.min}
                max={field.max}
                maxLength={field.key === 'genderDescription' ? 120 : undefined}
                required={field.required}
                value={String(values[field.key])}
                aria-invalid={!!errors[field.key]}
                aria-describedby={
                  [
                    field.key === 'entitlementDays' ? vacationHintId : '',
                    errors[field.key] ? `people-error-${field.key}` : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
              />
            ) : null}
            {errors[field.key] && (
              <small id={`people-error-${field.key}`}>{errors[field.key]}</small>
            )}
          </label>
        ))}
      </div>
      {kind === 'vacation' && (
        <fieldset>
          <legend>Usos de férias (até três)</legend>
          {uses.map((use, index) => (
            <div className="people-fields" key={index}>
              {(['startsOn', 'endsOn', 'paidOn'] as const).map((key, column) => (
                <label key={key}>
                  {['Início do uso', 'Fim do uso', 'Pagamento'][column]} {index + 1}
                  <input
                    type="date"
                    required={key !== 'paidOn'}
                    value={use[key] ?? ''}
                    onChange={(event) =>
                      setUses(
                        uses.map((item, current) =>
                          current === index ? { ...item, [key]: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </label>
              ))}
              <Button
                variant="outline"
                onClick={() => setUses(uses.filter((_, current) => current !== index))}
              >
                Remover uso {index + 1}
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            disabled={uses.length >= 3}
            onClick={() => setUses([...uses, { startsOn: '', endsOn: '', paidOn: null }])}
          >
            Adicionar uso
          </Button>
        </fieldset>
      )}
      <label>
        Fonte
        <input
          value={String(values.source)}
          required
          minLength={3}
          maxLength={500}
          onChange={(event) => setValues({ ...values, source: event.target.value })}
          aria-invalid={!!errors.source}
        />
      </label>
      <label>
        Motivo
        <textarea
          value={String(values.reason)}
          required
          minLength={3}
          maxLength={1000}
          onChange={(event) => setValues({ ...values, reason: event.target.value })}
          aria-invalid={!!errors.reason}
        />
      </label>
      {conflict && (
        <>
          <Button variant="outline" disabled={pending} onClick={reviewCurrent}>
            Carregar versão atual para revisão
          </Button>
          {review && (
            <section className="people-review">
              <h4>Versão atual: {review.version}</h4>
              <p>
                Compare com seu rascunho antes de confirmar. A confirmação não salva
                automaticamente.
              </p>
              <dl>
                {fields[kind].map((field) => (
                  <div key={field.key}>
                    <dt>{field.label}</dt>
                    <dd>
                      {typeof review[field.key] === 'boolean'
                        ? review[field.key]
                          ? 'Sim'
                          : 'Não'
                        : String(review[field.key] ?? 'Não informado')}
                    </dd>
                  </div>
                ))}
              </dl>
              <Button
                onClick={() => {
                  setVersion(review.version);
                  setConflict(false);
                  setReview(null);
                  setError('Versão revisada. Confira seu rascunho antes de salvar.');
                }}
              >
                Confirmar versão revisada
              </Button>
            </section>
          )}
        </>
      )}
      <div className="people-form-actions">
        <Button type="submit" disabled={pending || conflict}>
          {pending ? 'Aguarde…' : saveLabels[kind]}
        </Button>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar edição
        </Button>
      </div>
    </form>
  );
}
