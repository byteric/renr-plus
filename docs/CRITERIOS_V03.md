# Contratos e critérios observáveis da v0.3

Este documento registra o recorte implementado localmente. Não certifica revisão SST, publicação ou conformidade normativa.

## Inventário

Prefixo: `/api/v1/organizations/:orgId`. ADMIN escreve; ADMIN e READER leem dentro da empresa ativa da sessão. Escritas exigem Origin exata; respostas novas, inclusive erros das rotas, usam `Cache-Control: private, no-store`. O corpo não aceita empresa, autoria, datas, versão gerada ou snapshot fornecidos pelo cliente.

| Operação                      | Contrato e resultado                                                                                                                                                                                                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /risks`                  | `RiskList`: `{items,total,page,pageSize}`. Filtros `unitId`, `sectorId`, `status`, `evaluationPresence` (`WITH` ou `WITHOUT`), `q` até 120, `page` ≥1, `pageSize` 1–100 (padrão 50). Sem status, somente DRAFT e REGISTERED. Ordem criação descendente/id ascendente. |
| `POST /risks`                 | `CreateRiskInput` → 201 `RiskDetail`. Setor ativo da empresa/unidade ativa; grupo criado/reutilizado pela unicidade empresa/setor.                                                                                                                                    |
| `GET /risks/:id`              | 200 `RiskDetail`, inclusive arquivos lógicos e escopos inativos no histórico.                                                                                                                                                                                         |
| `PATCH /risks/:id`            | `UpdateRiskInput` com `expectedVersion` → 200 `RiskDetail`. Versão é incrementada. Conflito →409 sem auditoria de sucesso.                                                                                                                                            |
| `GET /risks/:id/evaluations`  | Histórico paginado por sequência descendente, sem convite, trabalhador ou resposta individual.                                                                                                                                                                        |
| `POST /risks/:id/evaluations` | `CreatePreliminaryEvaluationInput` →201 `PreliminaryEvaluation`. Somente REGISTERED, com versão atual.                                                                                                                                                                |
| `GET /risk-overview`          | 200 `RiskOverview`; contrato novo, independente do `/overview` v0.2.                                                                                                                                                                                                  |

Campos de conteúdo: `factor` (3–160), `description` e `exposureDescription` (10–2.000 em REGISTERED), `exposedGroupDescription` (3–2.000), `possibleHarms` e `existingControls` (5–2.000), `sourceKind` (`DIAGNOSTIC_CYCLE` ou `TECHNICAL_RECORD`), `sourceNote` (10–1.000 em REGISTERED), `diagnosticCycleId` UUID ou null. Strings são trimadas; campos pendentes vazios do rascunho viram null. DRAFT exige somente fator e setor válido; os máximos continuam aplicados. `expectedVersion`: inteiro 1–2.147.483.647.

Transições: criação DRAFT/REGISTERED; DRAFT→REGISTERED; DRAFT/REGISTERED→ARCHIVED. ARCHIVED é somente leitura, sem restauração ou exclusão física na API. Setor/grupo são imutáveis; REGISTERED congela tipo de origem e ciclo e mantém os campos completos em edições futuras. Uma referência de ciclo, mesmo em rascunho, exige ciclo CLOSED, no mesmo grupo e empresa, com disponibilidade AVAILABLE (mínimo demonstrativo existente). TECHNICAL_RECORD não aceita vínculo a ciclo.

`RiskDetail` contém conteúdo, `id`, `organizationId`, `assessmentGroupId`, `sectorId`, `unit` e `sector` (`{id,name,isActive}`), `status`, `version`, `createdBy`/`updatedBy` (`{id,name}`), datas ISO e `latestEvaluation` (ficha completa ou null). Schemas de resposta são strict.

## Ficha preliminar e integridade

Entrada: `methodReference` (3–200), `methodVersion` (1–40), `observation` e `rationale` (10–2.000), `expectedVersion`. A resposta acrescenta `id`, `organizationId`, `riskId`, `sequence`, `riskVersion`, `contextSnapshot`, `label: PRELIMINARY`, `author: {id,name}` e `createdAt`. O snapshot contém o conteúdo e escopo do risco antes do incremento de versão. Duas escritas com a mesma versão não persistem duas fichas. Não existem endpoints de alteração/apagamento de ficha; o PostgreSQL também bloqueia UPDATE/DELETE do histórico.

Relações compostas impedem vínculos entre empresas e a sequência é única por risco. Auditoria registra somente autor, empresa, recurso, operação e horário. A ficha não calcula probabilidade, severidade, score, prioridade normativa ou aprovação técnica. O papel ADMIN não comprova habilitação SST.

Migração aditiva: `20261017000000_risk_inventory`. Preserva as tabelas anteriores, adiciona riscos/fichas/índices e proteção do histórico. Recuperação prevista: voltar ao binário anterior compatível e preservar as tabelas aditivas; sem reset ou rollback destrutivo.

## Painel operacional

`RiskOverview` contém `organizationId`, `generatedAt`, `totals: {total,draft,registered,withEvaluation,withoutEvaluation}` e `units`. Totais excluem ARCHIVED; a existência de várias fichas conta o risco uma vez. WITH/WITHOUT são filtros reais de existência de ficha, independentes do status. O anel usa `withEvaluation/total`; zero registros não significa 100% de conclusão nem ausência de risco.

Até oito unidades por contagem descendente/nome/id; inclui unidades inativas identificadas. Itens UNIT têm `unitId`, `name`, `isActive`, `total`, `draft`, `registered`. Se necessário, o último item é `{kind:'OTHERS',name:'Outras unidades',total,draft,registered}`, sem unitId fictício. A soma das categorias confere com os totais do mesmo snapshot RepeatableRead. Não há resultados pessoais.

## Série diária de cadastros

`GET /api/v1/organizations/:orgId/risk-registrations?days=30` exige sessão e empresa ativa autorizada.
`days` aceita somente 7, 30 ou 90; padrão 30. Parâmetros extras são recusados.
Resposta strict: `organizationId`, `generatedAt`, `timeZone`, `fromDate`, `toDate`, `days`, `total`, `points`.
Cada ponto contém `date` (YYYY-MM-DD) e `count` inteiro não negativo.

O período é inclusivo e termina hoje no fuso configurado da empresa.
São preservados fusos IANA e offsets válidos aceitos no cadastro organizacional, sem trocar o fuso por uma cidade aproximada.
Existem exatamente 7, 30 ou 90 pontos consecutivos, inclusive zeros, e sua soma equivale a `total`.
O servidor agrupa `created_at`, interpretado em UTC, no fuso organizacional.
Rascunhos, registrados e arquivados são contados pela criação; não representa quantidade ativa ou evolução de exposição.
A agregação é parametrizada e usa snapshot consistente, sem consultar respostas diagnósticas ou fichas.
Sem sessão retorna 401; empresa externa, 404; consulta inválida, 400. Respostas são privadas e sem cache compartilhado.

## Verificação e limites

Os testes cobrem normalização, estado, autoria, concorrência, histórico imutável, integridade entre empresas,
origem coletiva, filtros, arquivo, agregações e compatibilidade do painel anterior.
Resultados e condições das execuções estão no [relatório de verificação](VERIFICACAO_V03.md).
O caráter preliminar e os limiares demonstrativos exigem validação técnica antes de coleta real.
POST não oferece idempotência após falha de transporte; reconsulte inventário/histórico antes de reenviar.
