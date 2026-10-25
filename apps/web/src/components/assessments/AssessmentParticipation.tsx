import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  assessmentAccessSchema,
  assessmentParticipationSchema,
  assessmentSubmissionSchema,
  submitAssessmentResponseSchema,
  type AssessmentParticipation as ParticipationData,
  type SubmitAssessmentResponse,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import './assessments.css';

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
export function AssessmentParticipation() {
  const [code, setCode] = useState('');
  const [access, setAccess] = useState<ParticipationData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [stage, setStage] = useState<'entry' | 'editing' | 'review' | 'uncertain' | 'accepted'>(
    'entry',
  );
  const [invalid, setInvalid] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const controller = useRef(new AbortController());
  const attempted = useRef<SubmitAssessmentResponse | null>(null);
  const busy = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => {
      current.abort();
      attempted.current = null;
    };
  }, []);
  const orient = () => requestAnimationFrame(() => heading.current?.focus());
  async function open(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const parsed = assessmentAccessSchema.safeParse({ inviteCode: code.trim() });
    if (!parsed.success) {
      setError('Informe o código completo do convite recebido.');
      codeInput.current?.focus();
      return;
    }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const value = await request(
        '/assessment-participation/access',
        assessmentParticipationSchema,
        {
          method: 'POST',
          credentials: 'omit',
          signal: controller.current.signal,
          body: JSON.stringify(parsed.data),
        },
      );
      if (!controller.current.signal.aborted) {
        setAccess(value);
        setCode(parsed.data.inviteCode);
        setStage('editing');
        orient();
      }
    } catch (failure) {
      if (!controller.current.signal.aborted)
        setError(
          failure instanceof RequestError && failure.status === 409
            ? 'Este convite não está disponível. Confirme o código ou solicite outro ao responsável.'
            : failure instanceof Error
              ? failure.message
              : 'Não foi possível acessar a coleta.',
        );
    } finally {
      busy.current = false;
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  function review(event: FormEvent) {
    event.preventDefault();
    if (!access || busy.current) return;
    const missing = access.instrument.questions
      .filter((question) => question.required && !answers[question.id]?.length)
      .map((question) => question.id);
    setInvalid(missing);
    if (missing.length) {
      setError('Responda as perguntas obrigatórias antes de revisar.');
      form.current?.querySelector<HTMLInputElement>(`[name="${missing[0]}"]`)?.focus();
      return;
    }
    setError('');
    setStage('review');
    orient();
  }
  async function submit() {
    if (!access || busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      if (!attempted.current)
        attempted.current = submitAssessmentResponseSchema.parse({
          inviteCode: code,
          instrumentVersionId: access.instrument.id,
          submissionSecret: randomSecret(),
          answers: access.instrument.questions
            .filter((question) => answers[question.id]?.length)
            .map((question) => ({
              questionId: question.id,
              optionIds: [...(answers[question.id] ?? [])],
            })),
        });
      await request('/assessment-participation/submissions', assessmentSubmissionSchema, {
        method: 'POST',
        credentials: 'omit',
        signal: controller.current.signal,
        body: JSON.stringify(attempted.current),
      });
      if (!controller.current.signal.aborted) {
        attempted.current = null;
        setCode('');
        setAnswers({});
        setAccess(null);
        setInvalid([]);
        setStage('accepted');
        orient();
      }
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 400) {
        attempted.current = null;
        setStage('review');
        setError('Confira as respostas e use Corrigir respostas antes de tentar novamente.');
      } else {
        setStage('uncertain');
        setError(
          failure instanceof RequestError && failure.status === 409
            ? 'Não foi possível confirmar este convite. Repita somente a mesma resposta ou solicite orientação ao responsável.'
            : 'Não foi possível confirmar o recebimento. Suas respostas foram mantidas nesta aba. Reenvie a mesma resposta para confirmar sem duplicar o envio.',
        );
      }
    } finally {
      busy.current = false;
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  function reset() {
    if (busy.current) return;
    attempted.current = null;
    setCode('');
    setAccess(null);
    setAnswers({});
    setError('');
    setInvalid([]);
    setStage('entry');
    requestAnimationFrame(() => codeInput.current?.focus());
  }
  return (
    <section className="surface assessment-participation">
      <p className="eyebrow">PARTICIPAÇÃO · ReNR+</p>
      <h1 ref={heading} tabIndex={-1}>
        {stage === 'accepted'
          ? 'Participação concluída'
          : stage === 'review' || stage === 'uncertain'
            ? 'Confira antes de enviar'
            : (access?.cycleName ?? 'Participe da coleta')}
      </h1>
      {stage === 'accepted' ? (
        <StatusMessage tone="success">
          Sua resposta foi recebida. Obrigado por participar.
        </StatusMessage>
      ) : (
        <>
          <p className="input-hint">
            A participação não pede nome, matrícula ou conta administrativa. Evite compartilhar seu
            convite.
          </p>
          {access && (
            <>
              <p className="assessment-notice">
                {access.usageMode === 'DEMONSTRATION'
                  ? 'Demonstração: use somente o cenário fictício.'
                  : 'As informações serão usadas conforme a política de consolidação aprovada para esta coleta.'}
              </p>
              <p className="muted">
                Instrumento: {access.instrument.title} · versão {access.instrument.version}.
                Disponível até {new Date(access.endsAt).toLocaleString('pt-BR')}.
              </p>
            </>
          )}
          {error && <StatusMessage tone="error">{error}</StatusMessage>}
          {stage === 'entry' && (
            <form aria-label="Acessar coleta" onSubmit={(event) => void open(event)} noValidate>
              <label htmlFor="assessment-invite">Código do convite</label>
              <input
                ref={codeInput}
                id="assessment-invite"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={pending}
                autoComplete="off"
                spellCheck={false}
                maxLength={128}
              />
              <Button type="submit" disabled={pending}>
                {pending ? 'Verificando…' : 'Acessar coleta'}
              </Button>
            </form>
          )}
          {stage === 'editing' && access && (
            <form ref={form} aria-label="Responder à coleta" onSubmit={review} noValidate>
              <p className="assessment-preserve-text">{access.instrument.description}</p>
              <p className="assessment-preserve-text">{access.instrument.instructions}</p>
              {access.instrument.questions.map((question, index) => (
                <fieldset
                  className="question"
                  key={question.id}
                  aria-describedby={
                    invalid.includes(question.id) ? `assessment-error-${question.id}` : undefined
                  }
                >
                  <legend>
                    {index + 1}. {question.label}{' '}
                    <span className="muted">
                      ({question.required ? 'obrigatória' : 'opcional'})
                    </span>
                  </legend>
                  <p className="input-hint">
                    {question.type === 'MULTIPLE_CHOICE'
                      ? 'Você pode selecionar mais de uma opção.'
                      : question.type === 'ORDINAL_CHOICE'
                        ? 'Escolha uma opção na sequência apresentada.'
                        : 'Escolha uma opção.'}
                  </p>
                  {question.options.map((option, position) => (
                    <label className="choice" key={option.id}>
                      <input
                        type={question.type === 'MULTIPLE_CHOICE' ? 'checkbox' : 'radio'}
                        name={question.id}
                        value={option.id}
                        checked={(answers[question.id] ?? []).includes(option.id)}
                        onChange={() => {
                          const selected = answers[question.id] ?? [];
                          setAnswers((previous) => ({
                            ...previous,
                            [question.id]:
                              question.type === 'MULTIPLE_CHOICE'
                                ? selected.includes(option.id)
                                  ? selected.filter((id) => id !== option.id)
                                  : [...selected, option.id]
                                : [option.id],
                          }));
                          setInvalid((previous) => previous.filter((id) => id !== question.id));
                        }}
                      />
                      <span>
                        {question.type === 'ORDINAL_CHOICE' ? `${position + 1}. ` : ''}
                        {option.label}
                      </span>
                    </label>
                  ))}
                  {!question.required && !!answers[question.id]?.length && (
                    <Button
                      variant="outline"
                      aria-label={`Limpar resposta da pergunta ${index + 1}`}
                      onClick={() => {
                        setAnswers((previous) => ({ ...previous, [question.id]: [] }));
                        form.current
                          ?.querySelector<HTMLInputElement>(`[name="${question.id}"]`)
                          ?.focus();
                      }}
                    >
                      Limpar resposta
                    </Button>
                  )}
                  {invalid.includes(question.id) && (
                    <p className="field-error" id={`assessment-error-${question.id}`}>
                      Responda esta pergunta obrigatória.
                    </p>
                  )}
                </fieldset>
              ))}
              <Button type="submit">Revisar respostas</Button>
            </form>
          )}
          {(stage === 'review' || stage === 'uncertain') && access && (
            <section aria-label="Revisão das respostas">
              <p>
                Confira suas escolhas. O envio fica vinculado à versão {access.instrument.version}{' '}
                deste instrumento.
              </p>
              <ol className="assessment-review">
                {access.instrument.questions.map((question) => (
                  <li key={question.id}>
                    <h2>{question.label}</h2>
                    {answers[question.id]?.length ? (
                      <ul>
                        {question.options
                          .filter((option) => answers[question.id]?.includes(option.id))
                          .map((option) => (
                            <li key={option.id}>{option.label}</li>
                          ))}
                      </ul>
                    ) : (
                      <p>Não respondida (opcional)</p>
                    )}
                  </li>
                ))}
              </ol>
              <div className="form-actions">
                <Button disabled={pending} onClick={() => void submit()}>
                  {pending
                    ? 'Enviando…'
                    : stage === 'uncertain'
                      ? 'Reenviar a mesma resposta'
                      : 'Confirmar envio'}
                </Button>
                {stage === 'review' && (
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setStage('editing');
                      setError('');
                      orient();
                    }}
                  >
                    Corrigir respostas
                  </Button>
                )}
              </div>
            </section>
          )}
          {access && (
            <Button variant="outline" disabled={pending} onClick={reset}>
              Usar outro convite
            </Button>
          )}
        </>
      )}
    </section>
  );
}
