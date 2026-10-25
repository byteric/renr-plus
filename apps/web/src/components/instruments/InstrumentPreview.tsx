import { useState } from 'react';
import type { UpdateInstrumentDraft } from '@renr/contracts';

type Content = Omit<UpdateInstrumentDraft, 'expectedRevision'>;
export function InstrumentPreview({ draft }: { draft: Content }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  return (
    <section
      className="surface instrument-preview"
      role="region"
      aria-labelledby="instrument-preview-heading"
    >
      <p className="panel-label">ANTES DA APLICAÇÃO</p>
      <h3 id="instrument-preview-heading">Prévia do participante</h3>
      <p className="input-hint">
        Mostra o rascunho atual, inclusive alterações não salvas. As respostas desta prévia não são
        enviadas nem armazenadas.
      </p>
      <h4>{draft.title || 'Título ainda não informado'}</h4>
      {draft.description && <p className="instrument-preserve-text">{draft.description}</p>}
      {draft.instructions && <p className="instrument-preserve-text">{draft.instructions}</p>}
      <p className="instrument-demo-note">
        {draft.usageMode === 'DEMONSTRATION'
          ? 'Demonstração: use somente dados fictícios.'
          : 'Prévia: a aplicação para uso real depende da aprovação técnica registrada.'}
      </p>
      {!draft.questions.length && <p>Nenhuma pergunta adicionada.</p>}
      {draft.questions.map((question, index) => {
        const multiple = question.type === 'MULTIPLE_CHOICE';
        const valid = (answers[question.id] ?? []).filter((id) =>
          question.options.some((option) => option.id === id),
        );
        const selected = multiple ? valid : valid.slice(0, 1);
        return (
          <fieldset key={question.id} className="instrument-preview-question">
            <legend>
              {index + 1}. {question.label || 'Enunciado ainda não informado'}{' '}
              <span>{question.required ? '(obrigatória)' : '(opcional)'}</span>
            </legend>
            <p className="input-hint">
              {multiple
                ? 'Você pode selecionar mais de uma opção.'
                : question.type === 'ORDINAL_CHOICE'
                  ? 'Selecione uma opção na sequência apresentada.'
                  : 'Selecione uma opção.'}
            </p>
            {question.options.map((option, position) => (
              <label key={option.id} className="instrument-preview-option">
                <input
                  type={multiple ? 'checkbox' : 'radio'}
                  name={`preview-${question.id}`}
                  value={option.id}
                  checked={selected.includes(option.id)}
                  onChange={() =>
                    setAnswers({
                      ...answers,
                      [question.id]: multiple
                        ? selected.includes(option.id)
                          ? selected.filter((id) => id !== option.id)
                          : [...selected, option.id]
                        : [option.id],
                    })
                  }
                />
                <span>
                  {question.type === 'ORDINAL_CHOICE' ? `${position + 1}. ` : ''}
                  {option.label || 'Opção ainda não informada'}
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </section>
  );
}
