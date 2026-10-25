# Contratos, dados e compatibilidade — ID 02

## 1. Escopo e fontes

**Estado em 24/10/2026:** este documento conserva o mapa e o planejamento registrados no ID 02 para comparar a base anterior. A gestão de acessos dos IDs 03/04 e os cadastros dos IDs 05/06 já foram implementados e verificados localmente. Seus contratos novos estão em [acessos](ACESSOS_E_ATIVACAO.md) e [colaboradores/grupos](API_CADASTRO_GRUPOS_ID05.md); os DTOs estritos anteriores continuam preservados. Nas tabelas históricas abaixo, a indicação de evolução futura descreve a situação no ID 02; o estado de execução vigente está no plano canônico e nos relatórios incrementais.

Fundação para evoluir o MVP sem recriar a base v0.5 preparada localmente. Este ID
documenta os limites, fixa a política de compatibilidade e acrescenta provas de
regressão. Não cria as funcionalidades dos IDs seguintes nem publica migrações.

Fontes executáveis: `packages/contracts/src/`, controladores/serviços em
`apps/api/src/modules/`, `apps/api/prisma/schema.prisma` e SQL versionado em
`apps/api/prisma/migrations/`. O SQL também contém checks e triggers não expressos
integralmente no modelo Prisma. A interface valida as respostas em
`apps/web/src/lib/api.ts`; não recebe modelos Prisma diretamente.

O consumidor atual é o navegador React, pela API REST `/api/v1`, no mesmo monólito
modular NestJS. PostgreSQL, UUIDs, nomes JSON em camelCase, paginação existente e
cookie de sessão são preservados. Não há troca para GraphQL, JWT, outro banco ou
outro provedor nesta etapa.

## 2. Modelo existente e relações

| Entidades Prisma / tabelas                                                       | Relação e significado atuais                                                                                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization / `organizations`                                                   | Raiz do escopo empresarial; nome, identificação fiscal opcional, fuso e situação                                                                        |
| User / `users`; Membership / `memberships`                                       | Usuário pode ter vínculos em empresas distintas; PK do vínculo é `(userId, organizationId)` e o papel atual é ADMIN ou READER                           |
| Session / `sessions`                                                             | Hash do token, usuário, organização ativa e expiração; mudar contexto não concede vínculo                                                               |
| Unit / `units`; Sector / `sectors`                                               | Empresa → unidades → setores; nomes normalizados únicos na empresa/unidade, com inativação lógica                                                       |
| InstrumentVersion / `instrument_versions`                                        | Versão publicada demonstrativa por empresa; unicidade atual `(organizationId, version)` permite apenas um catálogo demonstrativo por empresa            |
| DiagnosticQuestion / `diagnostic_questions`; QuestionOption / `question_options` | Perguntas pertencem à versão; opções pertencem à pergunta/versão; posição única no pai                                                                  |
| AssessmentGroup / `assessment_groups`; CycleGroup / `cycle_groups`               | Grupo atual é único por setor/empresa; CycleGroup liga ciclo a grupo da mesma empresa, sem duplicar esse vínculo                                        |
| DiagnosticCycle / `diagnostic_cycles`                                            | Empresa, versão, período e estado DRAFT/OPEN/CLOSED; grupos, convites e respostas preservam o escopo                                                    |
| ParticipationInvite / `participation_invites`                                    | Hash de convite, ciclo, expiração, consumo e revogação; não aponta para resposta individual                                                             |
| DiagnosticResponse / `diagnostic_responses`; ResponseAnswer / `response_answers` | Envio identifica ciclo/versão e período; cada resposta de pergunta identifica envio/pergunta/versão; uma pergunta por envio                             |
| Risk / `risks`                                                                   | Fator, contexto, grupo/setor, origem opcional, autor/último editor, versão e estado DRAFT/REGISTERED/ARCHIVED                                           |
| RiskEvaluation / `risk_evaluations`                                              | Ficha imutável PRELIMINARY, sequência por risco, versão e snapshot do contexto, método textual, justificativa e autor; não é avaliação técnica validada |
| Action / `actions`                                                               | Medida ligada ao risco, ficha opcional e snapshot da origem; responsável nominal em texto, prazo civil, critério, estado e controle de versão           |
| ActionRevision / `action_revisions`                                              | Histórico imutável por versão da ação; autor, evento, snapshot, motivo/texto e referência opcional à evidência                                          |
| ActionEvidence / `action_evidence`                                               | Metadados, hash e referência interna a objeto privado; autor, versão da ação, inclusão/arquivamento; não equivale a parecer                             |
| AuditEvent / `audit_events`                                                      | Registro de operação com ator, empresa, recurso e instante; não substitui os snapshots históricos de domínio                                            |

### Vínculo das respostas e privacidade

```text
ResponseAnswer → DiagnosticResponse → DiagnosticCycle → InstrumentVersion
       └──────→ DiagnosticQuestion ───────────────────→ InstrumentVersion

DiagnosticCycle → CycleGroup → AssessmentGroup → Sector → Unit → Organization
Risk → AssessmentGroup / DiagnosticCycle (origem opcional)
Risk → RiskEvaluation → Action (vínculo opcional à ficha)
Risk → Action → ActionRevision / ActionEvidence
```

Não existe `userId` ou `employeeId` em DiagnosticResponse/ResponseAnswer. Não
inferir autoria por convite, nome, setor ou horário. Novos colaboradores não serão
vinculados às respostas. A consolidação demonstrativa mantém limiar de cinco e
supressão de distribuições pequenas; isso não comprova anonimato irreversível nem
valida instrumento para uso real.

### Integridade existente

- Relações compostas de diagnóstico, risco, ficha, ação e evidência carregam o
  escopo empresarial; o servidor também verifica organização ativa e permissões.
- Unicidades de sequência da ficha, versão da revisão, pergunta por envio e
  nomes/posições impedem duplicações de suas respectivas entidades.
- SQL protege versões positivas, snapshot/origem, ficha PRELIMINARY, formato e
  arquivamento de evidências e imutabilidade dos históricos.
- Índices existentes atendem recortes por empresa, estado, prazo/data e IDs.
  Não criar índices especulativos; futuras consultas deverão indicar seu filtro,
  ordenação e prova com plano de execução quando houver volume representativo.

## 3. Conceitos que não podem ser misturados

| Conceito          | Base atual                                                                                       | Evolução contratada, ainda não implementada                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Autoria           | `createdBy`, `updatedBy`, autor da ficha/revisão/evidência e AuditEvent, definidos pelo servidor | Preservar identidade e histórico após desativação; nunca atribuir autoria ao responsável só por constar seu nome                           |
| Atribuição        | `responsibleName` é texto; não concede conta ou acesso                                           | ID 13: vínculo explícito opcional com usuário ativo da mesma organização; responsável externo nominal permanece possível                   |
| Permissão técnica | ADMIN é permissão operacional; não comprova habilitação                                          | ID 03: concessão/revogação separada, identificando autorizador; sem concessão automática ao administrador                                  |
| Decisão técnica   | A ficha atual é somente preliminar                                                               | ID 11: método aprovado/versionado, entradas, resultado determinístico, fontes e profissional autorizado                                    |
| Execução          | PLANNED → IN_PROGRESS → IMPLEMENTED, com CANCELLED conforme transições permitidas                | IMPLEMENTED continua sendo execução informada, não eficácia; atraso continua condição derivada de prazo/fuso                               |
| Eficácia          | Não existe parecer persistido na base                                                            | ID 15: parecer append-only, revisão operacional e pacote de provas; EFFECTIVE/NOT_EFFECTIVE/INCONCLUSIVE são resultados técnicos separados |
| Encerramento      | Não há fechamento técnico da medida ou risco                                                     | ID 17: registro próprio ligado a parecer vigente e reavaliação; não acrescentar CLOSED ao enum operacional existente                       |

## 4. Mapa dos contratos HTTP atuais

Todos os caminhos abaixo são relativos a `/api/v1`. `O` significa
`/organizations/:orgId`; IDs são UUIDs. As referências abaixo indicam os schemas
de entrada/saída; limites, campos obrigatórios e refinamentos estão nesses arquivos,
não em modelos de persistência.

| Família / rota e métodos                                                                    | Entradas e saídas                                                                                                             | Consumidor / política                                                                                            |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| GET `/health`, `/ready`                                                                     | `healthResponseSchema`; ready pode retornar 503                                                                               | Público; liveness não prova disponibilidade do banco ou storage                                                  |
| POST `/auth/sessions`; GET/DELETE `/auth/session`; PUT `/auth/session/organization`         | `loginSchema`, `activeOrganizationSchema` → `sessionResponseSchema`; DELETE é 204                                             | App/login; cookie HttpOnly `renr_session`, SameSite=Lax e Secure em produção; escritas validam Origin            |
| GET/POST `/organizations`; PATCH `/organizations/:id`                                       | Paginação e schemas create/update de organização → `organizationSchema` / `organizationListSchema`                            | Estrutura organizacional; retorno mantém fuso, situação e datas; escrita administrativa                          |
| GET/POST `O/units`; PATCH `/units/:id`; GET/POST `/units/:id/sectors`; PATCH `/sectors/:id` | Schemas create/update, paginação → `unitSchema`, `sectorSchema` e listas                                                      | Estrutura e filtros; cada cadastro conserva seu contrato específico                                              |
| GET `O/overview`                                                                            | `organizationOverviewSchema`: organização, totais de unidades/setores, unidades sem setor, generatedAt                        | Painel legado de estrutura; nunca acrescentar totais de riscos/ações neste objeto                                |
| GET `O/diagnostic-instrument`                                                               | `diagnosticInstrumentSchema`                                                                                                  | Gestão/participação demonstrativa; exatamente cinco perguntas, escolha única/múltipla, `isDemo: true`, PUBLISHED |
| GET/POST `O/diagnostic-cycles`; GET `.../:id`; POST `.../:id/open`, `close`                 | `createDiagnosticCycleSchema`, paginação → ciclo ou `diagnosticCycleListSchema`                                               | Diagnóstico; criar exige nome, setor, versão, início e término válido; abrir/fechar conserva transições          |
| POST `O/diagnostic-cycles/:id/participation-invites`; GET `.../:id/results`                 | `createParticipationInvitesSchema` → `participationInvitesSchema`; `diagnosticResultsSchema`                                  | Convites são segredo de uso único; resultados somente coletivos permitidos                                       |
| POST `/participation/instrument`, `/participation/responses`                                | `participationAccessSchema`, `submitDiagnosticResponseSchema` → `participationInstrumentSchema`, `diagnosticSubmissionSchema` | Fluxo sem sessão administrativa; código só no corpo, nunca URL/log; submissão não tem retry automático           |
| GET/POST `O/risks`; GET/PATCH `O/risks/:id`                                                 | `riskListQuerySchema`, `createRiskSchema`, `updateRiskSchema` → `riskListSchema`, `riskDetailSchema`                          | Inventário; `expectedVersion` em edição, registro completo validado e arquivamento lógico                        |
| GET/POST `O/risks/:id/evaluations`                                                          | Paginação, `createPreliminaryEvaluationSchema` → `preliminaryEvaluationListSchema`, `preliminaryEvaluationSchema`             | Ficha preliminar; sequência/snapshot no servidor, sem score técnico                                              |
| GET `O/risk-overview`, `O/risk-registrations`                                               | `riskOverviewSchema`; `riskRegistrationsQuerySchema` → `riskRegistrationsSchema`                                              | Painel de risco; série de cadastros de 7/30/90 dias não mede exposição ou redução de risco                       |
| POST `O/risks/:riskId/actions`; GET `O/actions`, `O/actions/:id`; PATCH `O/actions/:id`     | `createActionSchema`, `actionListQuerySchema`, `updateActionSchema` → `actionDetailSchema`, `actionListSchema`                | Ações; versão da origem na criação e versão esperada/motivo em edição                                            |
| POST `O/actions/:id/notes`; GET `.../:id/revisions`; GET `O/action-overview`                | `addActionNoteSchema`, paginação → revisão/lista; `actionOverviewSchema`                                                      | Histórico e indicadores operacionais separados dos indicadores de risco                                          |
| POST/GET `O/actions/:actionId/evidence`; PATCH `.../evidence/:id`; GET `.../:id/download`   | `uploadEvidenceSchema` + arquivo multipart, `archiveEvidenceSchema` → `evidenceSchema` / lista; download é binário            | Lista/histórico independentes; bytes privados, sem object key/URL pública no JSON                                |

Schemas de estrutura, sessão e erro estão em `packages/contracts/src/index.ts`;
demais arquivos: `overview.ts`, `diagnostics.ts`, `risks.ts`, `risk-overview.ts`,
`risk-registrations.ts`, `actions.ts`, `action-overview.ts` e `evidence.ts`.
Detalhes de negócio permanecem em [diagnóstico](API_DIAGNOSTICO_V02.md),
[riscos](CRITERIOS_V03.md) e [ações/evidências](API_ACOES_EVIDENCIAS.md).

### Regras transversais que permanecem

Listas: `{items,total,page,pageSize}`, página a partir de 1, padrão 50 e máximo 100.
Filtros são validados por família, não um objeto genérico para qualquer cadastro.
Riscos ordenam por criação/ID; ações por prazo/ID; históricos mantêm sua sequência
ou data/ID. Data de evento é ISO UTC; `dueDate` é data civil real interpretada no
fuso da empresa, não timestamp convertido pelo navegador.

Erros JSON usam `statusCode`, `code`, `message`, `requestId`, `timestamp` e
`details?: [{field,message}]`. O cabeçalho `X-Request-Id` permite correlação sem
expor SQL, stack, token ou credencial. Não mudar para outro envelope. A interface
mostra texto seguro por status/código e valida a resposta antes de usá-la.

| HTTP      | Tratamento preservado                                                                           |
| --------- | ----------------------------------------------------------------------------------------------- |
| 400       | Campo, query, UUID ou corpo inválido; detalhes de campo quando disponíveis                      |
| 401       | Ausência/expiração de sessão; retornar ao acesso sem expor conteúdo privado                     |
| 403       | Operação sem permissão ou Origin indevido; não contornar no frontend                            |
| 404       | Recurso inexistente/fora do contexto; não revelar sua existência externa                        |
| 409       | Versão vencida, transição ou estado incompatível; reler e comparar sem sobrescrita automática   |
| 413 / 429 | Limite de carga / tentativas; não reexecutar mutação em loop                                    |
| 500 / 503 | Falha sanitizada / dependência indisponível; preservar rascunho e oferecer recuperação adequada |

Nem todo endpoint aplica todos esses códigos. Os critérios e testes de cada
família prevalecem. POST não é idempotente por padrão: resposta perdida exige
conferência do registro antes de nova tentativa. Downloads não passam por parser
JSON. OpenAPI local é apoio; refinamentos de negócio em Zod/serviços também devem
ser conferidos. Documentação interativa permanece indisponível em produção.

## 5. Política de compatibilidade e novas representações

### Regras obrigatórias

1. **Não alterar respostas legadas em conjunto com o consumidor para fazer o teste
   passar.** Diagnóstico, riscos, overview e ações contêm objetos Zod estritos.
   Até um novo campo opcional pode quebrar um cliente antigo.
2. Há exceções históricas: alguns objetos de estrutura/sessão/erro não usam
   `.strict()`. Isso não é autorização para mudar seus nomes, tipos, enums,
   significado, status HTTP ou requisitos de autenticação silenciosamente.
3. As representações completas de trabalho terão rotas e schemas próprios. Não
   substituir o instrumento demonstrativo de cinco perguntas por um catálogo novo
   no mesmo endpoint nem acrescentar estados técnicos ao enum das ações.
4. Publicar dados de domínio por DTO explícito; não devolver `...prismaRecord` ou
   incluir relações automaticamente. IDs existentes e referências de histórico
   continuam válidos.
5. Retirada de contratos exige inventário de consumidores, transição documentada e
   aprovação de compatibilidade. Nenhuma rota é removida pelo ID 02.

### Superfícies de evolução reservadas

Os caminhos abaixo são decisões de desenho para os IDs indicados, **não endpoints
já disponíveis**. Cada implementação deverá especificar o schema completo e seus
testes antes de ativar a rota. O prefixo `O` continua sendo o mesmo da tabela anterior.

| ID    | Nova superfície proposta                                                                 | Contrato mínimo e fronteira                                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 03–04 | `GET /auth/session-capabilities`; recursos `O/access-memberships` e `O/technical-grants` | Capacidades e concessões fora do `sessionResponseSchema` legado; papel ADMIN/READER não recebe novos valores automaticamente                                         |
| 05–06 | Recursos `O/employees` e consultas/gestão de grupos existentes                           | Identificação interna opcional, unidade/setor compatíveis, situação e usuário opcional explícito; sem campos clínicos/CPF/folha                                      |
| 07–10 | Recursos `O/instrument-catalogs`, versões subordinadas e `O/diagnostic-workspaces`       | Catálogo tem ID próprio; número da versão é único no catálogo, não em toda a empresa; publicações imutáveis e demo preservada                                        |
| 11–12 | Recursos `O/evaluation-methods`, versões e `O/risk-workspaces/:id`                       | Método aprovado, escalas rotuladas e matriz explícita; contexto/snapshot/justificativa; fichas PRELIMINARY continuam preliminares                                    |
| 13–14 | `O/actions/:id/assignment`; `O/action-workspaces/:id`                                    | Vínculo `(userId,organizationId)` opcional e responsável nominal; contexto completo fora do ActionDetail legado; `assignedTo=me` somente em consulta nova autorizada |
| 15–18 | Recursos subordinados de eficácia, reavaliações e encerramentos                          | Parecer e pacote de provas imutáveis, método/versão, autoridade técnica e vínculo causal; não sobrescrever estado operacional                                        |
| 19–20 | Recursos novos de intenção/confirmação de upload                                         | Identificador de operação, verificação de bytes e recuperação de confirmação; download privado e contrato de metadados legado preservados                            |
| 21–26 | Consultas próprias de auditoria, dashboard e relatório                                   | Filtros autorizados, snapshot, agregados reconciliáveis e metadados de geração; nunca expor resposta individual ou segredo de storage                                |

Não criar essas tabelas, rotas ou permissões nesta fundação. Uma alteração que
necessite mudar um campo legado deverá propor rota/versão distinta antes do código.

## 6. Mapa de migrações e preservação

### Migrações existentes, em ordem

| Diretório em `apps/api/prisma/migrations/`  | Expansão                                                                                 | Invariantes a conservar                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `20261003000000_bootstrap`                  | Schema público e organização inicial                                                     | IDs e nomes de organizações                                                         |
| `20261004162547_identity_organizations_v01` | Identidade, vínculos, sessão, unidades/setores, auditoria e campos adicionais da empresa | Usuários, hashes, sessões e estrutura anteriores                                    |
| `20261012000000_diagnostics_v02`            | Instrumentos, perguntas/opções, grupos, ciclos, convites, envios e respostas             | Isolamento por empresa/versão; nenhum vínculo nominal à resposta                    |
| `20261017000000_risk_inventory`             | Riscos e fichas preliminares com checks, índices e histórico imutável                    | Diagnóstico intacto; sequência e snapshot da ficha                                  |
| `20261021000000_actions_v04`                | Ações, revisões, contexto da origem e transições operacionais                            | Riscos/fichas intactos; autoria e histórico da ação                                 |
| `20261021010000_action_evidence_v05`        | Evidências, vínculo opcional `evidence_id` e ampliação de eventos de revisão             | Revisões existentes recebem campo opcional nulo, sem reescrever snapshot ou autoria |

Nenhuma dessas migrações é reescrita pelo ID 02. Migrações futuras receberão novos
arquivos imutáveis apenas no ID funcional correspondente.

### Expansões futuras e pré-condições

| Frente                            | Sequência aditiva obrigatória                                                                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acesso/atribuição                 | Acrescentar situação/capacidades e relações opcionais; vínculos existentes preservados; não deduzir executor pelo nome ou autor nem conceder poder técnico por backfill                                         |
| Instrumentos/métodos              | Criar identidade do catálogo/método e versões próprias; ligar legado explicitamente; remover unicidade por empresa/versão somente quando a nova chave estiver preenchida e clientes antigos continuarem seguros |
| Eficácia/reavaliação/encerramento | Tabelas append-only com escopo empresarial e referências a provas/versões; estado desconhecido fica pendente, nunca eficaz ou encerrado por padrão                                                              |
| Evidências recuperáveis           | Relações de operação e estados opcionais primeiro; manter metadados/hashes/bytes referenciados; retorno da aplicação não implica apagar objetos                                                                 |
| Indicadores/relatórios/auditoria  | Novas consultas/representações; índices derivados de padrões de leitura; sem reclassificar registros históricos ou reinterpretar demonstração como validação técnica                                            |

Em cada frente: expandir → aplicar código compatível → preencher dados em lotes
controlados quando necessário → verificar integridade → mudar leitura → só avaliar
contração em entrega futura aprovada. Não introduzir NOT NULL sem plano para linhas
anteriores, renomear coluna em um passo ou presumir ausência de lock em ALTER TABLE.

Em ambiente local, os testes usam bancos descartáveis com nomes aleatórios e
dados sintéticos. Em homologação, uma migração exige autorização, backup verificado,
conexão apropriada, limites de lock/tempo e observação; não é executada pelo ID 02.

## 7. Retorno seguro da aplicação

Rollback significa retornar ao artefato anterior compatível, **mantendo o schema
expandido e os dados**. Não existe migração down destrutiva neste fluxo. Um retorno
não inclui `migrate reset`, apagar tabelas, recriar banco, restaurar seed sobre dados
existentes ou redefinir credenciais.

Protocolo:

1. Registrar o artefato de aplicação e a sequência de migrações, bloquear novas
   escritas incompatíveis e conferir as condições de compatibilidade.
2. Voltar somente ao artefato verificado, sem migration down; validar login,
   consultas legadas, edição compatível, isolamento e indicadores.
3. Confirmar IDs, contagens e snapshots de ações, revisões, fichas e evidências.
   Dados que a aplicação anterior não mostra continuam persistidos.
4. Retomar o artefato novo e validar novamente leitura, histórico e versões.
   Uma versão incapaz de coexistir com o schema não é candidata a esse retorno.
5. Diante de corrupção/incompatibilidade, interromper a promoção e planejar
   correção forward; restauração de backup é operação separada e autorizada.

O ensaio local compara o artefato v0.3 congelado com a implementação atual contra
base sintética expandida. Ele não demonstra que qualquer versão futura será
compatível: cada alteração deverá repetir a prova correspondente. Para publicar
apenas a fundação visual/contratual deste ID, não há nova migração a reverter.

## 8. Aceite e provas

| Requisito do ID 02                                                | Evidência exigida                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entidades, relações e separação de responsabilidades documentadas | Seções 2 e 3, confrontadas com schema/controladores atuais                                                                                       |
| Mapa de contratos e migrações                                     | Seções 4–6; cada família aponta schema e consumidor; novos caminhos identificados como futuros                                                   |
| Respostas atuais aceitas por consumidor anterior                  | Contratos congelados da base anterior, aplicados às respostas reais atuais, incluindo objetos estritos; controle negativo com campo incompatível |
| Base preenchida preservada                                        | Testes de migração com fixtures de diagnóstico, risco, ficha, ação, revisão e evidência, comparando conteúdo e IDs, não somente contagens        |
| Retorno sem destruição                                            | Artefato anterior executado no schema expandido, consulta/edição compatível e retorno atual, com preservação dos registros novos                 |
| Limites respeitados                                               | Sem nova migração, mudança de schema/DTO de produção, commit, publicação, troca de provedor ou modificação dos pacotes existentes                |

Comandos e resultados executados estão em
[Verificação dos IDs 01 e 02](VERIFICACAO_ID01_ID02.md). Uma tabela de intenção não
substitui a execução das provas; este documento não afirma aprovação técnica de SST
nem certificação normativa.
