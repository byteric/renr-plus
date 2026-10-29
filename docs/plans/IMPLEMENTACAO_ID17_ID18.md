# Reavaliação e encerramento técnico — IDs 17 e 18

Estado em 27/10/2026: concluído e verificado localmente. IDs 11–16, DTOs estritos
antigos e base Git 18e63dd preservados. Sem commit, push, deploy ou alteração de
provedores/Trello. Resultados e limites estão no relatório de verificação.

## Contrato e decisões

Reavaliação cria uma TechnicalRiskEvaluation pelo fluxo técnico existente e,
atomicamente, RiskReassessment ligada ao predecessor e ReassessmentMeasure para
cada ação/parecer considerado. Não reutilizar Action.evaluationId: sua FK permanece
na avaliação preliminar legada. Não alterar ActionStatus para representar fechamento.

Prefixo /api/v1/organizations/:orgId:

- GET /risk-workspaces/:riskId/reassessment-context: avaliação atual, versão do risco,
  reavaliação atual e permissões/impedimentos.
- GET/POST /risk-workspaces/:riskId/reassessments; GET /reassessments/:id no mesmo prefixo do risco.
- GET /risk-workspaces/:riskId/technical-evaluations/:evaluationId: consulta histórica individual.
- GET /actions/:actionId/closure-context; GET/POST /actions/:actionId/technical-closures;
  GET /actions/:actionId/technical-closures/:closureId.
- GET/POST /actions/:actionId/corrective-actions: novo registro e vínculo explícito,
  sem reabrir nem sobrescrever a ação anterior.

POST reavaliação: evaluation (CreateTechnicalRiskEvaluationInput),
expectedPreviousEvaluationId UUID, measures (1–20 ações distintas): actionId,
expectedVersion, opinionId, expectedContextFingerprint, consideration (20–4000).
Predecessor deve ser a última avaliação do mesmo risco; os pareceres devem ser os
atuais/vigentes, de qualquer resultado. Fontes e método publicado seguem ID11.

Comparação: COMPARABLE somente com a mesma method.versionId; versão ou método
diferente é METHOD_VERSION_CHANGED. Sem predecessor é NO_BASELINE. Exibir entradas,
classificação e prioridade, fontes, autoria e justificativas; não inventar percentual
de redução nem ordenação dos níveis que o método não define.

POST encerramento: expectedVersion, expectedRiskVersion, expectedLatestEvaluationId,
expectedLatestClosureId UUID/null, expectedContextFingerprint, reassessmentId,
opinionId e rationale (20–4000). Exigir TECHNICAL_DECISIONS ativa, ação IMPLEMENTED,
origem ativa, parecer EFFECTIVE CURRENT, reavaliação ligada à última avaliação
vigente contendo a mesma ação/parecer e provas válidas. Não exigir redução numérica
ou método igual para encerrar. Novo encerramento somente se o anterior exigir revisão.

POST corretiva: expectedVersion, opinionId, expectedContextFingerprint,
reason (20–4000), action (CreateActionInput). Exigir ADMIN operacional e capacidade
técnica, parecer atual e ação anterior IMPLEMENTED; criação e vínculo são atômicos.
Responsável nominal não concede acesso. Não criar corretivas automaticamente.

## Persistência, vigência e concorrência

RiskReassessment: id/organizationId/riskId/evaluationId(unique)/previousEvaluationId/
authorId/createdAt. ReassessmentMeasure: id/organizationId/riskId/reassessmentId/
actionId/opinionId/actionVersion/actionFingerprint/riskContextFingerprint/
contextFingerprint/consideration; unique(reassessmentId,actionId).

ActionTechnicalClosure: id/organizationId/riskId/actionId/sequence/supersedesId(unique)/
reassessmentId/opinionId/actionVersion/riskVersion/actionFingerprint/
riskContextFingerprint/contextFingerprint/proofPackage/rationale/authorId/createdAt.
ActionCorrectiveLink: id/organizationId/riskId/previousActionId/newActionId(unique)/
opinionId/reason/authorId/createdAt. FKs compostas garantem organização e dono.
Todas as novas decisões e vínculos são append-only. Auditoria na mesma transação.

Locks: organização SHARE → vínculo SHARE → risco UPDATE para reavaliar/corretiva,
SHARE para fechar → ações UPDATE ordenadas → hierarquia SHARE → provas SHARE
ordenadas. Reavaliações bloqueiam todas as ações do risco antes da hierarquia,
incluindo a garantia SQL aditiva no fluxo de avaliações técnicas legado. Isso
serializa decisões por risco; não altera o conteúdo dos registros anteriores.
Revalidar todas as precondições após locks. Alteração concorrente gera 409.
Extrair operações que aceitem tx nos serviços existentes; nenhuma transação aninhada.

Encerramento atual: CURRENT, SUPERSEDED ou REVIEW_REQUIRED com motivos explícitos.
Nova avaliação/parecer, alteração técnica ou prova selecionada arquivada/ausente/
alterada exigem revisão. Preservar referências e pacote de provas; GET não altera
dados. Nota comum, atribuição/prazo e anexo não selecionado não invalidam por si.

## Interface e responsabilidades

Reutilizar tokens, dois temas, controles, foco, retorno e motion existentes. No risco:
comparação lado a lado/empilhada, fontes, medidas, justificativa e linha do tempo com
qualquer versão consultável. Na ação: requisitos de encerramento explicados, preparação
→ revisão → confirmação; consulta da decisão e corretiva explícita. Sem sucesso antes
de resposta validada. 503 preserva rascunho; 0/409/502 exigem consulta/revisão;
401/403/404 removem dados privados. Nenhuma identidade global ou dashboard refeito.

Coordenação técnica: contratos, serviços/controllers, integração e documentação.
Dados: schema, migração e testes SQL. Frontend: componentes, integrações e testes
de interface após a definição dos contratos. Mudanças relevantes passam por
revisão independente e preservam os fluxos já existentes.

## Portões

1. Red HTTP e invariantes SQL observados antes da implementação correspondente.
2. Contratos e propriedades: comparabilidade, precondições e referências únicas.
3. HTTP/SQL reais: autoridade, escopo, sucessão, imutabilidade, snapshots/provas,
   atomicidade, alteração concorrente e revisão após retirada de prova.
4. Front Red/Green: comparação, permissões, elegibilidade, confirmação, continuidade,
   conflitos/resultado incerto, perda de acesso, foco e reflow.
5. Check, format, Prisma, migrações em banco vazio/preenchido, compatibilidade,
   integração/persistência, UI e E2E desktop/mobile. Inspeção visual dos sete eixos.
6. Atualizar README, relatório e plano canônico somente após provas; sem publicação.

Skills pertinentes: executing-plans, TDD, backend-dev, api-design,
database-schema-designer, security-engineer, frontend-design, react-development,
motion-design/genjutsu para continuidade contextual, anti-slop-design e e2e-testing.

## Rastreabilidade de verificação

| Critério                                                                                   | Evidência executável                                                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Avaliação sucessora e referência imediata, medidas distintas, histórico imutável           | `risk-continuity.integration.spec.ts`, `risk-continuity.persistence.spec.ts`                                |
| Comparação por versão exata, método incompatível e ausência de redução inventada           | `risk-continuity.test.ts`, `RiskReassessment.test.tsx`, teste HTTP de mudança de método                     |
| Encerramento separado, eficaz vigente, mesma medida/parecer na reavaliação atual           | Casos HTTP/SQL de elegibilidade, versão operacional preservada e pareceres NOT_EFFECTIVE/INCONCLUSIVE       |
| Permissão técnica explícita, tenant, papel operacional da corretiva e revogação            | Casos HTTP/SQL de autoridade, contexto preparado e capacidade/papel revogados                               |
| Concorrência e prova retirada, preservação dos snapshots e sucessão                        | Casos HTTP/SQL com duas conexões, fechamento concorrente, arquivo arquivado e renovação de decisão          |
| Atomicidade de reavaliação, encerramento e corretiva                                       | Três casos HTTP de auditoria falhando; nenhuma decisão ou revisão parcial persistida                        |
| Revisão e confirmação, rascunho, resultado incerto, privacidade e atualização durante POST | `RiskReassessment.test.tsx`, `ActionTechnicalClosure.test.tsx`, regressivos do pai real                     |
| Comparação, fontes, autoria, decisão e corretiva no navegador                              | `tests/ui/risk-continuity.spec.ts` com fixtures; `tests/e2e/risk-continuity.spec.ts` com API/PG/MinIO reais |
| Compatibilidade e preservação de bases preenchidas                                         | `scripts/risk-continuity-migrations.test.mjs` e `pnpm test:compatibility`                                   |

Resultados e limites de cada execução estão no
[relatório de verificação](../VERIFICACAO_ID17_ID18.md). A existência do teste não
substitui sua execução aprovada no estado atual.
