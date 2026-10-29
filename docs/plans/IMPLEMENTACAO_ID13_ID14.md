# Atribuição e acompanhamento operacional — IDs 13 e 14

Estado: concluído e verificado localmente em 26/10/2026, preservando os IDs 11/12 e a base `18e63dd`.
Sem commit, push, publicação, alteração de provedor ou Trello.

Resultados e limites: [verificação dos IDs 13/14](../VERIFICACAO_ID13_ID14.md).

## Contrato fixado

- Preservar integralmente DTOs e enums legados de ações, revisões e evidências.
  `responsibleName` continua obrigatório e pode identificar responsável externo.
- `Action.assignedUserId` opcional referencia Membership por usuário/organização.
  Guardar nome na atribuição e mudança anterior/próxima em coluna própria da revisão,
  sem reescrever snapshots ou eventos legados. Ausência histórica é null, nunca inferida.
- ADMIN gerencia; atribuição isolada não concede acesso nem permissão técnica.
  READER com `EXECUTE_ASSIGNED_ACTIONS` e atribuição persistida pode iniciar/informar
  execução, registrar nota e anexar. Não edita gestão, cancela, reatribui ou arquiva anexo.
- Revalidar organização, vínculo, capacidade e atribuição dentro da transação.
  Ordem: organização SHARE, vínculo(s) em ordem estável, ação UPDATE, evidência.
  Revogação/desativação/reatribuição concorrente não pode permitir escrita indevida.
- Manter PLANNED → IN_PROGRESS → IMPLEMENTED e cancelamento administrativo não terminal.
  IMPLEMENTED é execução informada; eficácia e encerramento técnico ficam para IDs posteriores.

## Rotas e respostas

Prefixo `/api/v1/organizations/:organizationId`.

| Rota                                     | Contrato                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GET `/action-workspaces`                 | Filtros legados e `assignedTo=me`; usuário pessoal obtido da sessão. Lista enriquecida paginada                         |
| GET `/action-workspaces/:id`             | Detalhe enriquecido, atribuição, contexto, prioridade, pendências e permissões calculadas                               |
| GET `/action-workspaces/:id/history`     | Revisões paginadas com `assignmentChange` separado do snapshot legado                                                   |
| GET `/action-assignees`                  | ADMIN; membros ativos paginados, identificador, nome e possibilidade operacional                                        |
| POST `/risks/:riskId/action-workspaces`  | Conteúdo legado + `assignedUserId` opcional; criação e atribuição atômicas; retorna ActionDetail legado                 |
| PATCH `/actions/:id/assignment`          | expectedVersion, assignedUserId UUID/null, changeReason; retorna ActionDetail legado                                    |
| PATCH `/action-workspaces/:id/execution` | expectedVersion, status IN_PROGRESS/IMPLEMENTED, changeReason e relato quando implementada; retorna ActionDetail legado |
| POST `/action-workspaces/:id/notes`      | Nota operacional autorizada; retorna ActionRevision legado                                                              |
| POST `/actions/:id/evidence`             | Preservar contrato multipart; permitir executor explícito atribuído com revalidação transacional                        |

Gestão geral continua nas rotas legadas administrativas. Leitura/evidência permanecem
isoladas por organização. Filtros repetidos ou usuário pessoal arbitrário são inválidos.

## Projeções da interface

`assignedUser` é null ou `{userId,name,currentName,isActive}`: nome registrado e atual
distintos. `riskContext` contém unidade/setor, `technicalEvaluationState`,
`contextMatches` e prioridade null ou `{key,label,rank,methodVersionId,methodName,methodVersion}`.
A prioridade é do risco técnico vigente no contexto compatível; nunca da ficha preliminar,
nunca comparada por rank entre métodos diferentes.

`evidenceSummary` contém active/archived. `pendingReasons` usa códigos
ASSIGNEE_INACTIVE, OVERDUE, NO_EVIDENCE, ORIGIN_INACTIVE, ORIGIN_CONTEXT_CHANGED e
NO_CURRENT_TECHNICAL_EVALUATION. Responsável externo válido não é pendência de cadastro.
`permissions` contém canManage, canExecute, canNote, canUploadEvidence e canArchiveEvidence.
As respostas são validadas na fronteira; esses controles não substituem autorização no servidor.

## ID 14

Listagem com filtros persistidos, “Minhas ações”, prioridade contextual e pendências.
Detalhe com conteúdo operacional principal e coluna contextual no desktop, empilhado
no mobile. Atribuição e criação permitem escolher membro ativo sem perder responsável nominal.
Preservar rascunhos em falha, 409 e recarga recuperável; reenvio incerto exige releitura.
Preservar endereço de retorno, filtros, paginação e foco; nenhum sucesso antecipado.
Execução, eficácia e encerramento aparecem como conceitos distintos, somente com operações reais.

Reutilizar tokens/identidade existentes e a imagem canônica do plano. Movimento apenas
para feedback e orientação, sem capturar scroll ou instalar motor. Respeitar reduced motion.
Skills: frontend-design, react-development, genjutsu, motion-design e anti-slop-design;
backend-dev, api-design, database-schema-designer, segurança e TDD no servidor.

## Execução e aceite

1. Red de contratos, HTTP/SQL e interface; migrations aditivas preservam dados preenchidos.
2. Green de atribuição, histórico, filtro pessoal, concorrência e executor restrito.
3. Green de lista/detalhe, rascunhos, recarga, filtros/retorno e temas responsivos.
4. Gates do projeto: check, format, Prisma, integração, migrações, compatibilidade, UI e E2E.
5. Revisão independente, evidências renderizadas e documentação; nada remoto.

Responsabilidade: principal nos contratos/API/integração/documentação. Desenvolvedor de dados
exclusivo no schema/migração/testes SQL. Desenvolvedor frontend exclusivo nos componentes/testes
de ações. Nenhum editor reverte alterações alheias; interfaces são fixadas antes do paralelismo.
