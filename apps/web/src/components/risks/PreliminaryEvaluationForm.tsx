import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createPreliminaryEvaluationSchema,
  preliminaryEvaluationSchema,
  type RiskDetail,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { scrollToField } from './useRiskData';

const definitions = [
  { name: 'methodReference', label: 'Referência do método', max: 200, multiline: false },
  { name: 'methodVersion', label: 'Versão do método', max: 40, multiline: false },
  { name: 'observation', label: 'Observação preliminar', max: 2000, multiline: true },
  { name: 'rationale', label: 'Justificativa', max: 2000, multiline: true },
] as const;
export function PreliminaryEvaluationForm({
  risk,
  onExpire,
  onSaved,
  onCancel,
}: {
  risk: RiskDetail;
  onExpire: () => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({
    methodReference: '',
    methodVersion: '',
    observation: '',
    rationale: '',
  });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const controller = useRef(new AbortController());
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    scrollToField(form.current, 'methodReference');
    return () => current.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || uncertain) return;
    const parsed = createPreliminaryEvaluationSchema.safeParse({
      ...values,
      expectedVersion: risk.version,
    });
    if (!parsed.success) {
      const next = Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0]),
          'Preencha este campo com conteúdo suficiente e dentro do limite indicado.',
        ]),
      );
      setFields(next);
      setError('Confira os campos destacados antes de salvar a ficha.');
      scrollToField(form.current, Object.keys(next)[0] ?? 'methodReference');
      return;
    }
    setPending(true);
    setError('');
    setFields({});
    try {
      await request(
        `/organizations/${risk.organizationId}/risks/${risk.id}/evaluations`,
        preliminaryEvaluationSchema,
        { method: 'POST', body: JSON.stringify(parsed.data), signal: controller.current.signal },
      );
      if (!controller.current.signal.aborted) onSaved();
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) {
        onExpire();
        return;
      }
      if (failure instanceof RequestError && failure.status === 409)
        setError(
          'O registro foi alterado ou já recebeu uma ficha. Seu texto foi preservado; confira o histórico antes de enviar uma nova versão.',
        );
      else if (failure instanceof RequestError && [0, 502].includes(failure.status)) {
        setUncertain(true);
        setError(
          'Não foi possível confirmar a gravação. Consulte o histórico antes de reenviar: esta ficha pode ter sido salva. Seu texto foi preservado.',
        );
      } else
        setError(failure instanceof Error ? failure.message : 'Não foi possível salvar a ficha.');
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <form
      ref={form}
      className="surface risk-form risk-stack"
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-label="Ficha preliminar"
    >
      <div className="risk-section-heading">
        <div>
          <p className="panel-label">NOVA FICHA · CONTEXTO V{risk.version}</p>
          <h3>Adicionar ficha preliminar</h3>
        </div>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar ficha
        </Button>
      </div>
      <p className="feedback">
        A ficha registra uma observação e preserva o contexto atual. Não representa classificação de
        risco, laudo ou aprovação técnica. Fichas anteriores não são sobrescritas.
      </p>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      <fieldset className="risk-fieldset" disabled={pending}>
        <legend>Referência e fundamentação</legend>
        {definitions.map(({ name, label, max, multiline }) => (
          <div key={name}>
            <label htmlFor={`evaluation-${name}`}>{label}</label>
            {multiline ? (
              <textarea
                id={`evaluation-${name}`}
                name={name}
                rows={4}
                value={values[name]}
                maxLength={max}
                onChange={(event) => setValues({ ...values, [name]: event.target.value })}
                aria-invalid={!!fields[name]}
                aria-describedby={fields[name] ? `evaluation-error-${name}` : undefined}
              />
            ) : (
              <input
                id={`evaluation-${name}`}
                name={name}
                value={values[name]}
                maxLength={max}
                onChange={(event) => setValues({ ...values, [name]: event.target.value })}
                aria-invalid={!!fields[name]}
                aria-describedby={fields[name] ? `evaluation-error-${name}` : undefined}
              />
            )}
            {fields[name] && (
              <p id={`evaluation-error-${name}`} className="field-error">
                {fields[name]}
              </p>
            )}
            <p className="field-hint">
              {multiline ? 'De 10 a ' : name === 'methodReference' ? 'De 3 a ' : 'De 1 a '}
              {max.toLocaleString('pt-BR')} caracteres.
            </p>
          </div>
        ))}
      </fieldset>
      <Button type="submit" disabled={pending || uncertain}>
        {pending ? 'Salvando ficha…' : 'Salvar ficha preliminar'}
      </Button>
      {uncertain && (
        <Button variant="outline" onClick={onCancel}>
          Conferir histórico antes de reenviar
        </Button>
      )}
    </form>
  );
}
