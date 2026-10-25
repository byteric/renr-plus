import { createElement, useState } from 'react';
import type { AssessmentResultNode, AssessmentResults as ResultsData } from '@renr/contracts';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';

const labels = {
  NOT_STARTED: 'A coleta ainda não começou',
  COLLECTING: 'Coleta em andamento',
  NO_RESPONSES: 'Nenhuma resposta recebida',
  AVAILABLE: 'Resultado coletivo disponível',
  SUPPRESSED: 'Resultado suprimido',
};
const notices = {
  NOT_STARTED: 'Abra o ciclo após conferir o instrumento, o grupo e a política.',
  COLLECTING:
    'A consolidação será apresentada após o encerramento. Contagens individuais não são exibidas durante a coleta.',
  NO_RESPONSES:
    'Não há dados de respostas para esta consolidação. Esse estado não permite concluir sobre os fatores de risco.',
  AVAILABLE:
    'Os valores representam envios consolidados. A soma entre ciclos não representa pessoas únicas nem uma classificação de risco.',
  SUPPRESSED:
    'A política protege este recorte e os totais que poderiam revelar seus dados por diferença. Contagens e distribuições permanecem ocultas.',
};
const percentage = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
function ResultNode({ node, depth = 0 }: { node: AssessmentResultNode; depth?: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="assessment-result-node" aria-label={`Consolidação de ${node.name}`}>
      {createElement(`h${Math.min(depth + 3, 6)}`, null, labels[node.availability])}
      <p className="assessment-result-scope">{node.name}</p>
      <StatusMessage tone={node.availability === 'SUPPRESSED' ? 'warning' : 'info'}>
        {notices[node.availability]}
      </StatusMessage>
      {node.availability === 'AVAILABLE' && node.responseCount !== null && (
        <>
          <p className="assessment-result-count">Envios consolidados: {node.responseCount}</p>
          {node.questions.map((question) => (
            <section className="assessment-result-question" key={question.id}>
              {createElement(`h${Math.min(depth + 4, 6)}`, null, question.label)}
              {question.availability === 'SUPPRESSED' ? (
                <p className="assessment-notice">
                  Distribuição protegida pela política de consolidação. O número de respostas desta
                  pergunta também fica oculto.
                </p>
              ) : question.availability === 'NO_RESPONSES' ? (
                <p>Pergunta sem respostas.</p>
              ) : (
                <>
                  <p className="input-hint">
                    Respostas nesta pergunta: {question.answerCount}.{' '}
                    {question.type === 'MULTIPLE_CHOICE'
                      ? 'As opções permitem seleção múltipla; seus percentuais podem somar mais de 100%.'
                      : 'Uma opção por resposta.'}
                  </p>
                  <ul className="assessment-result-options">
                    {question.options.map((option) => (
                      <li key={option.id}>
                        <span>{option.label}</span>
                        <span>
                          {option.count} envios · {percentage.format(option.percentage)}%
                        </span>
                        <meter
                          aria-label={`Percentual de ${option.label}`}
                          min={0}
                          max={100}
                          value={option.percentage}
                        >
                          {percentage.format(option.percentage)}%
                        </meter>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ))}
        </>
      )}
      {node.children.length > 0 && (
        <>
          <Button
            variant="outline"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Ocultar recortes' : `Ver recortes de ${node.name}`}
          </Button>
          {expanded && (
            <div className="assessment-result-children">
              {node.children.map((child) => (
                <ResultNode key={child.id} node={child} depth={depth + 1} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
export function AssessmentResults({ value }: { value: ResultsData }) {
  return (
    <div className="assessment-results">
      <p className="input-hint">
        Limiar desta política: {value.minimumResponses} envios. O limiar, isoladamente, não garante
        anonimato.
      </p>
      <ResultNode node={value.node} />
    </div>
  );
}
