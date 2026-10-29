# Métodos técnicos e inventário contextual — IDs 11 e 12

Estado: concluído e verificado localmente em 25/10/2026. Base: `18e63dd`.
Sem commit, push ou publicação deste incremento. Resultados e limites no
[relatório de verificação](../VERIFICACAO_ID11_ID12.md).

## Limites e decisões

- Preservar os contratos e as tabelas de fichas preliminares e ações existentes.
- Métodos, versões e avaliações técnicas são recursos próprios, isolados por organização.
- Escritas exigem `TECHNICAL_DECISIONS`, sessão e origem válidas; ADMIN não concede essa capacidade automaticamente.
- Não fornecer escala padrão, fórmula, matriz presumida ou aprovação real fictícia. Catálogo normal começa vazio.
- Definição publicada e avaliação registrada são imutáveis. Nova versão não reclassifica o histórico.
- IDs 13–32, identidade global, eficácia, encerramento e publicação ficam fora desta alteração.

## Contrato do ID 11

Rotas abaixo usam `/api/v1/organizations/:organizationId`.

| Recurso                                          | Operação                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `/evaluation-methods`                            | GET paginado de catálogos; POST cria catálogo e rascunho v1 e retorna a versão                              |
| `/evaluation-methods/:id`                        | GET de catálogo                                                                                             |
| `/evaluation-method-versions`                    | GET paginado, com filtros `methodId` e `status`                                                             |
| `/evaluation-method-versions/:id`                | GET de versão; PUT substitui conteúdo do rascunho com `expectedRevision`                                    |
| `/evaluation-method-versions/:id/publish`        | POST com `expectedRevision` e `approvalReference` obrigatório                                               |
| `/evaluation-method-versions/:id/fork`           | POST cria a próxima versão em rascunho, sem herdar aprovação                                                |
| `/risk-workspaces`                               | GET paginado enriquecido, mantendo filtros e paginação do inventário                                        |
| `/risk-workspaces/matrix`                        | GET com `methodVersionId`, filtros do inventário e contagem sobre o conjunto completo, sem limitar à página |
| `/risk-workspaces/:riskId`                       | GET de risco enriquecido                                                                                    |
| `/risk-workspaces/:riskId/technical-evaluations` | GET paginado de histórico; POST de avaliação técnica com `expectedVersion`                                  |
| `/risk-workspaces/:riskId/source-options`        | GET paginado de referências elegíveis, sem respostas individuais                                            |

### Definição do método

`definition` possui somente `probability`, `severity`, `levels`, `priorities` e `matrix`.
As duas escalas têm `key`, `label`, `description` e `position`. Níveis têm `key` e
`label`; prioridades têm `key`, `label` e `rank`. Uma célula possui
`probabilityKey`, `severityKey`, `levelKey` e `priorityKey`.

Publicar exige escalas e classificações não vazias, chaves/posições únicas,
referências existentes e exatamente uma célula por par de probabilidade e
severidade. Os limites operacionais são 20 itens por escala/classificação e
400 células; não representam um método técnico prescrito.

Versão retornada: `id`, `organizationId`, `method: {id,name}`, `version`,
`revision`, `status`, `title`, `description`, `definition`, `approvalReference`,
`publishedBy`, `publishedAt`, `createdBy`, `createdAt` e `updatedAt`.
Somente uma versão publicada pode sustentar uma avaliação técnica.

### Avaliação e vigência

Criação recebe `expectedVersion`, `methodVersionId`, `probabilityKey`,
`severityKey`, `rationale`, `context` e `sources`. Resultado, autoria, sequência,
snapshot e data são resolvidos no servidor. Fontes têm `kind` e `id`, ou
`kind: DOCUMENT` e `reference`. Tipos de referência: `RISK_RECORD`,
`ASSESSMENT_CYCLE`, `ASSESSMENT_SOURCE` e `DOCUMENT`.

A avaliação congela rótulos, nível, prioridade, método/versão, contexto e fontes.
Referências de coleta/fonte devem pertencer à organização e ao grupo do risco;
não expor respostas, reconstruir valores suprimidos ou promover demonstrações a
aprovações técnicas. Registro e incremento da versão do risco são atômicos.

O resumo técnico contém `id`, `organizationId`, `riskId`, `sequence`,
`riskVersion`, `method: {id,name,versionId,version,approvalReference}`,
`probability: {key,label}`, `severity: {key,label}`, `level: {key,label}`,
`priority: {key,label,rank}`, `author` e `createdAt`. O detalhe acrescenta
`rationale`, `context`, `contextSnapshot` e `sources` congeladas.

`technicalEvaluationState` é `ABSENT`, `CURRENT` ou `CONTEXT_CHANGED`.
Vigência compara os campos técnicos do snapshot; não compara apenas
`risk.version`, que também muda ao registrar uma ficha preliminar. Alterações
de contexto retiram a classificação vigente da matriz, preservando o histórico.

A migração inicial acrescenta três tabelas, referências compostas por organização e
proteções de imutabilidade. A migração corretiva `20261025010000` preserva a anterior:
bloqueia grupo, setor e unidade durante o registro, rejeita escopo inativo e fontes
demonstrativas e confere o SHA-256 do conteúdo técnico congelado. Uma alteração
concorrente dessas referências devolve conflito, sem persistir avaliação parcial.
A referência de aprovação documenta a decisão do responsável; não certifica sua
validade metodológica ou regulatória.

### Workspace e matriz

O workspace estende os campos de `RiskDetail` com `sourceLabel`,
`technicalEvaluationState`, `latestTechnicalEvaluation` (resumo ou null),
`actionSummary: {total,open,overdue}` e `pendingReasons`.
Pendências: `NO_TECHNICAL_EVALUATION`, `CONTEXT_CHANGED`, `NO_ACTIONS` e
`INACTIVE_SCOPE`. Os DTOs legados não recebem esses campos.

A matriz retorna `methodVersion` (definição publicada), `cells` (chaves de
probabilidade/severidade/nível/prioridade e `count`), `totalMatched`,
`classifiedTotal` e `excluded: {unclassified,contextChanged,incompatible,inactiveScope,notRegistered}`.
Compatibilidade exige o mesmo `methodVersionId`, sem inferência por tamanho ou
rótulos. Somar células mais exclusões deve reconciliar com o conjunto filtrado.

## ID 12: interface

- Reutilizar tokens, controles, identidade e fluxo de criação/edição existentes.
- Inventário mostra fonte, avaliação técnica vigente, prioridade, ações e pendências.
- Seleção singular abre contexto lateral a partir de 1100 px; abaixo disso,
  o mesmo endereço oferece detalhe em página inteira.
- Preservar filtros/página/seleção/retorno na URL e a rolagem da listagem.
  Fechar ou voltar devolve foco à origem; em link direto usa o título da lista.
- Matriz tem seletor explícito de versão e alternativa em lista/tabela acessível.
  Sem avaliação não significa risco baixo; contexto desatualizado não mantém classificação atual.
- Não criar aba Mapa. Não anunciar resultado de avaliação antes do servidor.
- Movimento discreto de continuidade, com redução de movimento respeitada e sem capturar rolagem.

## Etapas e verificação

1. Preparar dependências e banco local separado; observar Red HTTP de rota ausente.
2. Alinhar o schema ao DDL já aplicado, sem reescrever migrações antigas e sem DDL destrutivo incidental.
3. Implementar contratos e testes de matriz completa, determinismo e permutação com fast-check existente.
4. Implementar persistência, imutabilidade, autorização, concorrência, fontes e read side enriquecido.
5. Observar Red de interface; integrar inventário, detalhe responsivo, formulário e matriz aos contratos reais.
6. Verificar check, formatação, PostgreSQL, migrações vazia/preenchida, compatibilidade, E2E e UI nos dois temas.
7. Revisar o diff e registrar evidências e limites locais. Aprovação técnica real continua externa ao software.

Responsabilidade de edição: backend, contratos, schema e documentação pelo responsável de integração;
componentes e testes de interface por um único implementador em paralelo. Testes globais executados após integração.
