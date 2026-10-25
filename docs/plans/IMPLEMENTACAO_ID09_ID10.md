# Execução dos IDs 09 e 10

Estado: concluído e verificado localmente em 24/10/2026. Base dos IDs 01–08 preservada. Este registro descreve a implementação e sua validação local. Evidências e limites em [VERIFICACAO_ID09_ID10.md](../VERIFICACAO_ID09_ID10.md).

## Decisões e responsabilidade

O fluxo ampliado usa `AssessmentCycle`, `AssessmentInvite`, `AssessmentResponse` e `AssessmentAnswer` próprios. Reutiliza `InstrumentVersion`, `AssessmentGroup` e acrescenta `ConsolidationPolicyVersion`. Separar a persistência é necessário para que o binário anterior continue operando sem ler ciclos de catálogo que desconhece. Os DTOs, as tabelas e os consumidores congelados de diagnóstico permanecem intactos. Um grupo por ciclo é expresso por FK direta. `cycleCount` do instrumento passa a somar as referências dos dois fluxos; FKs RESTRICT preservam ambas.

## Contrato HTTP e exports

Todas as rotas abaixo usam `/api/v1`. Novos schemas ficam em `packages/contracts/src/assessment-cycles.ts`, sem alterar `diagnostics.ts`. IDs UUID, datas ISO, datas civis YYYY-MM-DD, objetos estritos e paginação `{items,total,page,pageSize}`. Instantes são absolutos; o formulário identifica o horário local do navegador.

| Rota                                             | Operação                                                                                                                                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/organizations/:orgId/consolidation-policies`   | GET paginado; POST `{usageMode,minimumResponses}` cria próxima versão em DRAFT.                                                                                                    |
| `.../consolidation-policies/:id`                 | GET; PUT `{expectedRevision,usageMode,minimumResponses}` somente rascunho.                                                                                                         |
| `.../consolidation-policies/:id/publish`         | POST `{expectedRevision,approvalReference?}`.                                                                                                                                      |
| `.../consolidation-policies/:id/fork`            | POST `{expectedRevision}` da versão publicada, sem herdar aprovação.                                                                                                               |
| `/organizations/:orgId/assessment-cycles`        | GET paginado com filtros limitados `status,assessmentGroupId`; POST `{name,assessmentGroupId,instrumentVersionId,policyVersionId,startsAt,endsAt}`.                                |
| `.../assessment-cycles/:id`                      | GET; PUT do mesmo conteúdo de criação mais `expectedRevision`, somente DRAFT.                                                                                                      |
| `.../assessment-cycles/:id/open` e `/close`      | POST `{expectedRevision}`; transições DRAFT → OPEN → CLOSED, sem reabertura.                                                                                                       |
| `.../assessment-cycles/:id/invites`              | POST `{count}` entre 1 e 20; retorno `{cycleId,participationPath:'/#/responder',invites:[{code,expiresAt}]}`. Segredos apenas na resposta de emissão.                              |
| `.../assessment-cycles/:id/sources`              | GET paginado; POST `{kind,context,occurredOn,summary}` append-only.                                                                                                                |
| `.../assessment-cycles/:id/results`              | GET da projeção protegida do ciclo.                                                                                                                                                |
| `/organizations/:orgId/assessment-consolidation` | GET exige `instrumentVersionId,policyVersionId`; `unitId` opcional escolhe um nó já protegido da família completa. Sem filtros arbitrários de respostas ou subconjuntos de ciclos. |
| `/assessment-participation/access`               | POST público `{inviteCode}` no corpo.                                                                                                                                              |
| `/assessment-participation/submissions`          | POST público `{inviteCode,instrumentVersionId,submissionSecret,answers:[{questionId,optionIds}]}`.                                                                                 |

Administração exige ADMIN, sessão, organização ativa e Origin confiável. Publicar política REAL exige TECHNICAL_DECISIONS explícita, inclusive para READER técnico; comparar organização do escopo e das capacidades. Demonstração pode ser publicada por ADMIN. Consultas gerenciais exigem vínculo ativo. Participação omite credenciais, usa código somente no corpo, cabeçalhos no-store e limitação real de tentativas.

Exports obrigatórios: `consolidationPolicySchema`, `consolidationPolicyListSchema`, `createConsolidationPolicySchema`, `updateConsolidationPolicySchema`, `publishConsolidationPolicySchema`, `forkConsolidationPolicySchema`, `assessmentCycleSchema`, `assessmentCycleListSchema`, `createAssessmentCycleSchema`, `updateAssessmentCycleSchema`, `assessmentCycleQuerySchema`, `assessmentTransitionSchema`, `assessmentInvitesSchema`, `assessmentParticipationSchema`, `submitAssessmentResponseSchema`, `assessmentSubmissionSchema`, `createAssessmentSourceSchema`, `assessmentSourceSchema`, `assessmentSourceListSchema`, `assessmentResultsSchema`, `assessmentConsolidationSchema`. Exportar os tipos inferidos correspondentes usados pelo cliente.

Política DTO: `id,organizationId,version,revision,status,usageMode,minimumResponses,algorithmVersion,approvalReference,publishedById,publishedAt,createdAt,updatedAt`. Algoritmo `CONSERVATIVE_V1`. Rascunho REAL admite limiar nulo, mas publicação exige inteiro explícito entre 2 e 1000 e referência de aprovação. DEMONSTRATION usa exatamente 5. Não fornecer limiar REAL padrão. Publicação imutável; fork incrementa versão e limpa aprovação. Campos de publicação nulos em DRAFT.

Ciclo DTO: `id,organizationId,name,assessmentGroupId,assessmentGroupName,sectorId,sectorName,unitId,unitName,instrumentId,instrumentTitle,instrumentVersionId,instrumentVersion,usageMode,policyVersionId,policyVersion,minimumResponses,status,revision,startsAt,endsAt,createdAt,updatedAt,closedAt`. Nome de 3–160 caracteres. Grupo, empresa/unidade/setor ativos; instrumento e política publicados e do mesmo modo de uso. Abertura revalida todas essas condições e o período. Instrumento/política/grupo/período não mudam após abertura, também por SQL.

Fonte DTO: `id,organizationId,cycleId,kind,context,occurredOn,summary,createdAt,createdBy:{id,name}`. Tipos `OBSERVATION | INTERVIEW | WORKSHOP | DOCUMENT_ANALYSIS`; contexto de 3–1000 e síntese de 3–4000 caracteres. Data civil válida e não futura no fuso da organização. Autor é a sessão. Não criar campo de participante/entrevistado nem inferir pessoa pelo texto. UI orienta registrar contexto coletivo sem dados identificáveis. Fonte pode ser acrescentada ao ciclo sem reabrir ou modificar suas respostas.

Participação DTO: `{cycleName,endsAt,usageMode,instrument:{id,title,version,description,instructions,questions}}`. Perguntas/opções reaproveitam o contrato do catálogo; sem organização, grupo, autor ou aprovação privados no payload público. Confirmação estrita `{status:'accepted'}`. Perguntas opcionais podem ser omitidas ou ter seleção vazia; as obrigatórias precisam de resposta. Escolha única/ordinal exigem uma opção quando respondidas. Nenhuma opção de outra pergunta/versão é aceita. Arrays duplicados são recusados antes da normalização.

## Privacidade e projeção comum

Resultados e consolidação usam o mesmo engine e a mesma forma externa:

`{organizationId,instrumentVersionId,policyVersionId,minimumResponses,node}`.

Nó: `{id,name,nodeType,availability,responseCount,questions,children}`. `nodeType` é `ORGANIZATION | UNIT | GROUP | CYCLE`. Estados: `NOT_STARTED | COLLECTING | NO_RESPONSES | AVAILABLE | SUPPRESSED`. `responseCount` é número somente em AVAILABLE; nos demais casos, null. Pergunta projetada: `{id,label,type,required,availability,answerCount,options}`; disponibilidade `AVAILABLE | NO_RESPONSES | SUPPRESSED`. Opção disponível: `{id,label,count,percentage}`. Pergunta protegida tem denominador nulo e opções vazias. Não há IDs de resposta, convites, fingerprints, nomes ou horários de participantes em DTO gerencial.

O ciclo aberto não divulga contagens/distribuições. Fechado com zero envios distingue ausência de dados; abaixo do limiar suprime tudo. Cada pergunta verifica respondidas/omitidas e cada opção verifica selecionou/não selecionou. Qualquer célula/complemento positivo abaixo do limiar protege a pergunta inteira. Provas obrigatórias: selecionaram 9 de 10 em múltipla escolha; responderam 7 de 10 em pergunta opcional; opção pequena com total suficiente. Zero respostas nunca significa zero risco.

A família é organização + versão exata de instrumento + versão exata da política. A hierarquia particiona ciclos em grupo/setor, unidade e organização; soma envios, nunca pessoas únicas. Calcular proteção sobre a família inteira ANTES do recorte de unidade. Qualquer ciclo protegido suprime a contagem e as distribuições de seus ancestrais; uma pergunta protegida também protege essa distribuição ancestral. Não totalizar somente os descendentes visíveis. Exemplo: A=8 e B protegido=2 não autoriza expor total 10. A futura geração de relatório consumirá esta projeção; a rota JSON gerencial já prova o uso do engine por um segundo consumidor real. Exportação PDF formal pertence ao incremento de relatórios.

## Repetição e transações

O cliente gera `submissionSecret` aleatório de 32 bytes, base64url de 43 caracteres, e o conserva apenas em RAM. O servidor guarda no recibo segregado somente hash do segredo e MAC do conteúdo canônico usando esse segredo; nunca a chave bruta. Nenhum recibo aponta para uma resposta. A representação canônica ordena perguntas/opções válidas e considera perguntas opcionais vazias como omitidas, sem deduplicar entrada inválida.

Lock do ciclo antes do convite. Na mesma transação: validar instrumento/respostas; consumir convite; gravar resposta sem identidade ou vínculo nominal; persistir recibo sem ID/FK da resposta. Falha reverte tudo. Retry com mesmo código, segredo e conteúdo retorna accepted sem nova escrita, inclusive após fechamento/expiração; segredo ou conteúdo divergente retorna 409. Não criar endpoint para consultar recibo ou resposta por fingerprint.

Após envio incerto (rede/503), frontend conserva e congela o payload efetivamente enviado e oferece repetição exata. Erro de validação permite corrigir sem consumir convite. Sucesso limpa código, respostas e segredo. Segredos nunca vão a URL, logs, storage do navegador, traces ou vídeos. Troca deliberada de convite limpa toda a memória da participação.

## Etapas e provas

1. Backend observa Red HTTP real e testes de domínio/contrato; implementa schemas e disponibiliza exports para o frontend.
2. Migração aditiva, FKs compostas e proteção SQL: provas em base vazia/preenchida e falhas transacionais; arquivos antigos de migração não são reescritos.
3. Motor protegido com propriedades e integração dos dois consumidores; preservar convite incompleto, replay concorrente e separação física de identidades.
4. Frontend observa Red de rota, formulário e recuperação; implementa fluxo navegável e usa contratos reais. Fixtures só na fronteira HTTP dos testes.
5. Testes E2E reais nos dois perfis: criação/edição/abertura, versão congelada, convite, formulário opcional/ordinal, replay após resposta perdida, encerramento, consolidação e fontes com autoria.
6. Gates finais: check, format:check, prisma:validate, migrações, integração, retorno frozen com ciclo/convite/resposta novos preservados, E2E completo e inspeção visual nos dois temas de 320 a 1440 px.

## Direção do frontend

Rota `#/coletas`, com seleção/filtros/página/edição na URL; `#/responder` pública e separada do fluxo demonstrativo anterior. Conceito: cada coleta mostra preparação, participação e resultado protegido sem confundir estado operacional com avaliação técnica.

Hierarquia: contexto da empresa → ciclo/versão/situação → próxima ação → resultados/fontes. Cards usam os tokens existentes; resultados agrupam informações por seção e preservam mensagens explícitas de supressão. Detalhe empilhado no mobile e regiões complementares no desktop. Ação primária por etapa, confirmação para encerramento e aviso de que o período/versão ficam fixados ao abrir. Nada de contadores animados de risco ou indicadores de conformidade inventados. Movimento apenas nos controles já existentes, com reduced motion.
