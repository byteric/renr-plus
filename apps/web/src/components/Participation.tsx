import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  participationAccessSchema,
  participationInstrumentSchema,
  diagnosticSubmissionSchema,
  type ParticipationInstrument,
} from '@renr/contracts';
import { Button } from './ui/button';
import { request, RequestError } from '../lib/api';

export function DemoNotice() {
  return (
    <p className="demo-notice">
      Demonstração — use somente dados fictícios; instrumento não validado.
    </p>
  );
}
export function Participation() {
  const [code, setCode] = useState('');
  const [access, setAccess] = useState<ParticipationInstrument | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [invalid, setInvalid] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const busy = useRef(false);
  const controller = useRef(new AbortController());
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const parsed = participationAccessSchema.safeParse({ inviteCode: code.trim() });
    if (!parsed.success) {
      setError('Informe o código completo do convite recebido.');
      return;
    }
    if (access) {
      const missing = access.instrument.questions
        .filter((q) => q.required && !answers[q.id]?.length)
        .map((q) => q.id);
      setInvalid(missing);
      if (missing.length) {
        setError('Responda todas as questões obrigatórias.');
        form.current?.querySelector<HTMLInputElement>(`[name="${missing[0]}"]`)?.focus();
        return;
      }
    }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      if (!access) {
        const value = await request('/participation/instrument', participationInstrumentSchema, {
          method: 'POST',
          credentials: 'omit',
          signal: controller.current.signal,
          body: JSON.stringify(parsed.data),
        });
        if (!controller.current.signal.aborted) setAccess(value);
      } else {
        await request('/participation/responses', diagnosticSubmissionSchema, {
          method: 'POST',
          credentials: 'omit',
          signal: controller.current.signal,
          body: JSON.stringify({
            ...parsed.data,
            instrumentVersionId: access.instrument.id,
            answers: access.instrument.questions.map((q) => ({
              questionId: q.id,
              optionIds: answers[q.id] ?? [],
            })),
          }),
        });
        if (!controller.current.signal.aborted) {
          setAccepted(true);
          setCode('');
          setAnswers({});
          setAccess(null);
        }
      }
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      setError(
        failure instanceof RequestError && failure.status === 0 && access
          ? 'A conexão foi interrompida. Não foi possível confirmar o recebimento. Preserve este código e consulte o responsável antes de enviar novamente.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível concluir a participação.',
      );
    } finally {
      if (!controller.current.signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  return (
    <section className="participation surface">
      <p className="eyebrow">PARTICIPAÇÃO · ReNR+</p>
      <h1>
        {accepted
          ? 'Participação concluída'
          : access
            ? access.cycleName
            : 'Sua voz ajuda a orientar o cuidado'}
      </h1>
      <DemoNotice />
      {accepted ? (
        <p role="status" className="feedback success">
          Sua resposta foi recebida. Obrigado por participar.
        </p>
      ) : (
        <form
          ref={form}
          noValidate
          onSubmit={(event) => void submit(event)}
          aria-label="Participação no diagnóstico"
        >
          {!access ? (
            <>
              <p className="muted">
                Informe o código recebido do responsável. Você não precisa de uma conta
                administrativa.
              </p>
              <label htmlFor="invite-code">Código do convite</label>
              <input
                id="invite-code"
                disabled={pending}
                value={code}
                maxLength={128}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setCode(event.target.value)}
                aria-describedby={error ? 'participation-error' : undefined}
              />
            </>
          ) : (
            <>
              <p className="muted">
                Todas as questões são obrigatórias. Participação disponível até{' '}
                {new Date(access.endsAt).toLocaleString('pt-BR')}.
              </p>
              {access.instrument.questions.map((question, index) => (
                <fieldset
                  className="question"
                  key={question.id}
                  aria-describedby={
                    invalid.includes(question.id) ? `error-${question.id}` : undefined
                  }
                >
                  <legend>
                    {index + 1}. {question.label} <span className="muted">(obrigatória)</span>
                  </legend>
                  <p className="input-hint">
                    {question.type === 'SINGLE_CHOICE'
                      ? 'Selecione uma opção.'
                      : 'Selecione uma ou mais opções.'}
                  </p>
                  {question.options.map((option) => (
                    <label className="choice" key={option.id}>
                      <input
                        type={question.type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox'}
                        name={question.id}
                        checked={(answers[question.id] ?? []).includes(option.id)}
                        disabled={pending}
                        onChange={(event) => {
                          setAnswers((current) => ({
                            ...current,
                            [question.id]:
                              question.type === 'SINGLE_CHOICE'
                                ? [option.id]
                                : event.target.checked
                                  ? [...(current[question.id] ?? []), option.id]
                                  : (current[question.id] ?? []).filter((id) => id !== option.id),
                          }));
                          setInvalid((current) => current.filter((id) => id !== question.id));
                        }}
                      />
                      {option.label}
                    </label>
                  ))}
                  {invalid.includes(question.id) && (
                    <p id={`error-${question.id}`} className="field-error">
                      Selecione ao menos uma opção.
                    </p>
                  )}
                </fieldset>
              ))}
            </>
          )}
          {error && (
            <p role="alert" id="participation-error" className="feedback error">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? 'Aguarde…' : access ? 'Enviar respostas' : 'Acessar questionário'}
          </Button>
        </form>
      )}
    </section>
  );
}
