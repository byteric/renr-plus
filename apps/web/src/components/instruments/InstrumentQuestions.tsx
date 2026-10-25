import type { InstrumentQuestion } from '@renr/contracts';
import { Button } from '../ui/button';

type Issue = { field: string; message: string };
const focus = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());
const normalize = (questions: InstrumentQuestion[]) =>
  questions.map((question, index) => ({
    ...question,
    position: index + 1,
    options: question.options.map((option, index) => ({ ...option, position: index + 1 })),
  }));
export function InstrumentQuestions({
  questions,
  onChange,
  issues,
  disabled,
  announce,
}: {
  questions: InstrumentQuestion[];
  onChange: (questions: InstrumentQuestion[]) => void;
  issues: Issue[];
  disabled: boolean;
  announce: (text: string) => void;
}) {
  function update(index: number, change: Partial<InstrumentQuestion>) {
    onChange(normalize(questions.map((q, i) => (i === index ? { ...q, ...change } : q))));
  }
  function move(index: number, direction: number) {
    const question = questions[index];
    if (!question || index + direction < 0 || index + direction >= questions.length) return;
    const next = [...questions];
    next.splice(index, 1);
    next.splice(index + direction, 0, question);
    onChange(normalize(next));
    announce(`Pergunta movida para a posição ${index + direction + 1}.`);
    focus(`instrument-question-${question.id}`);
  }
  function optionMove(index: number, position: number, direction: number) {
    const question = questions[index];
    const option = question?.options[position];
    if (
      !question ||
      !option ||
      position + direction < 0 ||
      position + direction >= question.options.length
    )
      return;
    const options = [...question.options];
    options.splice(position, 1);
    options.splice(position + direction, 0, option);
    update(index, { options });
    announce(`Opção movida para a posição ${position + direction + 1}.`);
    focus(`instrument-option-${option.id}`);
  }
  const issue = (path: string) => issues.find((value) => value.field === path);
  return (
    <section className="instrument-questions" aria-labelledby="instrument-questions-heading">
      <div className="instrument-toolbar">
        <h3 id="instrument-questions-heading">Perguntas e opções</h3>
        <span>{questions.length}/100 perguntas</span>
      </div>
      {issue('questions') && <p className="field-error">{issue('questions')?.message}</p>}
      {questions.map((question, index) => {
        const prefix = `questions.${index}`;
        const labelError = issue(`${prefix}.label`);
        return (
          <fieldset className="instrument-question" key={question.id} disabled={disabled}>
            <legend>Pergunta {index + 1}</legend>
            <div className="instrument-reorder">
              <Button
                variant="outline"
                disabled={index === 0}
                aria-label={`Mover pergunta ${index + 1} para cima`}
                onClick={() => move(index, -1)}
              >
                Subir
              </Button>
              <Button
                variant="outline"
                disabled={index === questions.length - 1}
                aria-label={`Mover pergunta ${index + 1} para baixo`}
                onClick={() => move(index, 1)}
              >
                Descer
              </Button>
              <Button
                variant="outline"
                aria-label={`Remover pergunta ${index + 1}`}
                onClick={() => {
                  onChange(normalize(questions.filter((q) => q.id !== question.id)));
                  announce(`Pergunta ${index + 1} removida.`);
                  const neighbor = questions[index + 1] ?? questions[index - 1];
                  focus(
                    neighbor ? `instrument-question-${neighbor.id}` : 'instrument-add-question',
                  );
                }}
              >
                Remover pergunta
              </Button>
            </div>
            <label htmlFor={`instrument-question-${question.id}`}>
              Enunciado da pergunta {index + 1}
            </label>
            <textarea
              id={`instrument-question-${question.id}`}
              maxLength={400}
              rows={2}
              value={question.label}
              aria-invalid={!!labelError}
              aria-describedby={labelError ? `instrument-error-${question.id}` : undefined}
              onChange={(event) => update(index, { label: event.target.value })}
            />
            {labelError && (
              <p id={`instrument-error-${question.id}`} className="field-error">
                {labelError.message}
              </p>
            )}
            <label htmlFor={`instrument-type-${question.id}`}>Tipo da pergunta {index + 1}</label>
            <select
              id={`instrument-type-${question.id}`}
              value={question.type}
              onChange={(event) =>
                update(index, { type: event.target.value as InstrumentQuestion['type'] })
              }
            >
              <option value="SINGLE_CHOICE">Escolha única</option>
              <option value="MULTIPLE_CHOICE">Múltipla escolha</option>
              <option value="ORDINAL_CHOICE">Ordinal: escolha única em sequência</option>
            </select>
            <label className="instrument-checkbox">
              <input
                type="checkbox"
                checked={question.required}
                onChange={(event) => update(index, { required: event.target.checked })}
              />
              Pergunta {index + 1} obrigatória
            </label>
            <p className="input-hint">
              {question.type === 'ORDINAL_CHOICE'
                ? 'A ordem das opções é apresentada ao participante. Não há pontuação automática.'
                : 'Defina opções claras; respostas abertas não fazem parte deste instrumento.'}
            </p>
            {issue(`${prefix}.options`) && (
              <p className="field-error">{issue(`${prefix}.options`)?.message}</p>
            )}
            <ol className="instrument-options">
              {question.options.map((option, position) => {
                const error = issue(`${prefix}.options.${position}.label`);
                return (
                  <li key={option.id}>
                    <label htmlFor={`instrument-option-${option.id}`}>
                      Opção {position + 1} da pergunta {index + 1}
                    </label>
                    <input
                      id={`instrument-option-${option.id}`}
                      maxLength={200}
                      value={option.label}
                      aria-invalid={!!error}
                      aria-describedby={error ? `instrument-error-${option.id}` : undefined}
                      onChange={(event) =>
                        update(index, {
                          options: question.options.map((value) =>
                            value.id === option.id
                              ? { ...value, label: event.target.value }
                              : value,
                          ),
                        })
                      }
                    />
                    {error && (
                      <p className="field-error" id={`instrument-error-${option.id}`}>
                        {error.message}
                      </p>
                    )}
                    <div className="instrument-reorder">
                      <Button
                        variant="outline"
                        disabled={position === 0}
                        aria-label={`Mover opção ${position + 1} da pergunta ${index + 1} para cima`}
                        onClick={() => optionMove(index, position, -1)}
                      >
                        Subir opção
                      </Button>
                      <Button
                        variant="outline"
                        disabled={position === question.options.length - 1}
                        aria-label={`Mover opção ${position + 1} da pergunta ${index + 1} para baixo`}
                        onClick={() => optionMove(index, position, 1)}
                      >
                        Descer opção
                      </Button>
                      <Button
                        variant="outline"
                        aria-label={`Remover opção ${position + 1} da pergunta ${index + 1}`}
                        onClick={() => {
                          update(index, {
                            options: question.options.filter((value) => value.id !== option.id),
                          });
                          announce(`Opção ${position + 1} removida.`);
                          const neighbor =
                            question.options[position + 1] ?? question.options[position - 1];
                          focus(
                            neighbor
                              ? `instrument-option-${neighbor.id}`
                              : `instrument-add-option-${question.id}`,
                          );
                        }}
                      >
                        Remover opção
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <Button
              id={`instrument-add-option-${question.id}`}
              variant="outline"
              disabled={question.options.length >= 20}
              aria-label={`Adicionar opção à pergunta ${index + 1}`}
              onClick={() => {
                const id = crypto.randomUUID();
                update(index, {
                  options: [
                    ...question.options,
                    { id, label: '', position: question.options.length + 1 },
                  ],
                });
                announce('Opção adicionada.');
                focus(`instrument-option-${id}`);
              }}
            >
              Adicionar opção
            </Button>
          </fieldset>
        );
      })}
      {!disabled && (
        <Button
          id="instrument-add-question"
          variant="outline"
          disabled={questions.length >= 100}
          onClick={() => {
            const id = crypto.randomUUID();
            onChange([
              ...questions,
              {
                id,
                label: '',
                type: 'SINGLE_CHOICE',
                required: true,
                position: questions.length + 1,
                options: [
                  { id: crypto.randomUUID(), label: '', position: 1 },
                  { id: crypto.randomUUID(), label: '', position: 2 },
                ],
              },
            ]);
            announce(`Pergunta ${questions.length + 1} adicionada.`);
            focus(`instrument-question-${id}`);
          }}
        >
          Adicionar pergunta
        </Button>
      )}
    </section>
  );
}
