# API de coletas e consolidação — ID09

As rotas usam `/api/v1`. O contrato executável está em `packages/contracts/src/assessment-cycles.ts`; a especificação de comportamento está em `docs/plans/IMPLEMENTACAO_ID09_ID10.md`.

## Administração

Rotas sob `/organizations/:orgId` exigem sessão, organização ativa e vínculo ativo. Escritas exigem Origin confiável. Criar ou alterar políticas, gerir ciclos e acrescentar fontes exige ADMIN. A emissão em ciclo aberto e vigente permite ADMIN ou a capacidade explícita `HR_ASSESSMENT_INVITES_ISSUE` na empresa ativa. Publicação REAL exige a capacidade explícita `TECHNICAL_DECISIONS`, inclusive para ADMIN; READER técnico pode publicar. Publicação DEMONSTRATION exige ADMIN. A organização retornada pelas capacidades deve coincidir com o escopo autorizado.

| Recurso                                 | Operações                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `consolidation-policies`                | GET paginado; POST `{usageMode,minimumResponses}`                                       |
| `consolidation-policies/:id`            | GET; PUT com `expectedRevision`                                                         |
| `consolidation-policies/:id/publish`    | POST `{expectedRevision,approvalReference?}`                                            |
| `consolidation-policies/:id/fork`       | POST `{expectedRevision}`                                                               |
| `assessment-cycles`                     | GET paginado com `status,assessmentGroupId,unitId,sectorId`; POST do contexto e período |
| `assessment-cycles/:id`                 | GET; PUT do contexto e período com `expectedRevision`                                   |
| `assessment-cycles/:id/open` e `/close` | POST `{expectedRevision}`                                                               |
| `assessment-cycles/:id/invites`         | POST `{count}` entre 1 e 20                                                             |
| `assessment-cycles/:id/sources`         | GET paginado; POST `{kind,context,occurredOn,summary}`                                  |
| `assessment-cycles/:id/results`         | GET da projeção protegida                                                               |
| `assessment-consolidation`              | GET exige `instrumentVersionId,policyVersionId`; `unitId` opcional                      |

A listagem de ciclos cruza unidade e setor com o grupo de avaliação da coleta. Qualquer referência desconhecida ou de outra empresa recebe 404. Setor e unidade da mesma empresa que não correspondem recebem 400. Os filtros atingem a listagem e sua contagem. A projeção de respostas continua sendo calculada pela política de cada ciclo.

Paginação: `{items,total,page,pageSize}`. Objetos de entrada são estritos. Conflitos de revisão e transição retornam 409. Ciclos seguem DRAFT → OPEN → CLOSED. A abertura revalida grupo, empresa, setor e unidade ativos, versões publicadas de instrumento/política com modo compatível e período vigente. Após abertura, contexto e período permanecem fixos também por SQL.

DEMONSTRATION exige limiar 5. REAL não recebe limiar padrão: publicação exige inteiro explícito de 2 a 1000 e referência de aprovação. Política publicada é imutável; fork cria nova versão DRAFT e limpa os campos de aprovação/publicação.

Fontes são append-only, com data civil válida, não futura no fuso da organização. A autoria vem da sessão; campos de autoria/participante enviados pelo cliente são rejeitados. O contexto e a síntese devem descrever situações coletivas sem identificar participantes.

## Participação pública

`POST /assessment-participation/access` recebe `{inviteCode}` no corpo. Retorna nome e término do ciclo, modo de uso e instrumento publicado com perguntas/opções. O payload público não inclui organização, grupo, autor ou aprovação. Os códigos são gerados com 32 bytes aleatórios e aparecem apenas na emissão dos convites.

O acesso público também retorna `privacy.minimumResponses` da versão de política congelada. A tela explica a leitura por perfis autorizados, a separação da resposta e os limites de divulgação antes das perguntas.

`POST /assessment-participation/submissions` recebe `{inviteCode,instrumentVersionId,submissionSecret,answers:[{questionId,optionIds}]}` e confirma estritamente `{status:'accepted'}`. O segredo tem 43 caracteres base64url, gerado pelo cliente e mantido somente em RAM. Perguntas opcionais podem ser omitidas ou vazias. Obrigatórias exigem seleção; escolha única/ordinal admite uma opção. Perguntas/opções duplicadas, estranhas à versão ou incompatíveis são rejeitadas antes do consumo do convite.

Consumo, respostas e recibo são gravados numa única transação, com lock do ciclo antes do convite. Repetição exata retorna accepted sem nova resposta, inclusive após encerramento ou expiração. Segredo/conteúdo divergente retorna 409. Recibos guardam somente hash do convite, hash do segredo e MAC do conteúdo canônico; não possuem FK/ID da resposta. Respostas não possuem identidade, fingerprint, convite ou horário de participante.

Cabeçalhos privados incluem `Cache-Control: no-store`. O servidor limita as tentativas públicas por IP; exceder o limite retorna 429. Código e segredo nunca devem ir para URL, storage, logs ou gravações de testes.

## Projeção de privacidade

Resultados e consolidação retornam `{organizationId,instrumentVersionId,policyVersionId,minimumResponses,node}` pelo mesmo engine. Nós contêm identificador/nome, tipo, disponibilidade, contagem protegida, perguntas e filhos. Ciclos abertos não expõem contagens; ciclos fechados sem respostas distinguem ausência de dados; totais abaixo do limiar são suprimidos.

Perguntas verificam respondidas/omitidas e selecionou/não selecionou por opção. Qualquer célula ou complemento positivo abaixo do limiar protege toda a distribuição. Nós protegidos têm `responseCount:null`; perguntas protegidas têm `answerCount:null,options:[]`. Contratos recusam envelopes incompatíveis com essas regras.

A consolidação particiona a família inteira por organização e versões exatas de instrumento/política, antes do recorte de unidade. Descendente protegido protege os ancestrais; pergunta protegida protege a distribuição ancestral. A soma representa envios, sem inferir pessoas únicas. Não são aceitos filtros arbitrários por ciclos ou subconjuntos de respostas.

## Adesão do ciclo

Na abertura, o sistema conta os colaboradores ativos do setor e da unidade do grupo de avaliação. Grava o total com a transição da coleta e preserva a base em mudanças posteriores de cadastro. Não armazena a lista de elegíveis nem liga um colaborador a um convite ou a uma resposta.

O detalhe do ciclo retorna `participation`. Durante a coleta, o estado é `NOT_AVAILABLE`. Ciclos legados e bases com total zero ficam `UNKNOWN_BASE` após o encerramento. Para uma base positiva, a resposta permanece `PROTECTED` enquanto qualquer grupo relevante tiver menos respostas que o mínimo. Isso inclui o complemento entre elegíveis e respostas e o complemento entre códigos emitidos e respostas. Proteção também se aplica se houver mais respostas que elegíveis. Detalhe, consolidação, jornada do painel e novos relatórios SST ocultam a informação protegida.

Em `AVAILABLE`, `eligible` é a base congelada, `issued` conta códigos distintos emitidos no ciclo, `responses` conta envios válidos e `percentage` é `responses ÷ eligible × 100`. Uma repetição aceita de um mesmo envio não acrescenta resposta. Um novo código emitido para substituir outro conta como emissão. A taxa é por ciclo e não soma pessoas entre coletas sobrepostas.

## Entrega manual de convites

Em **Coletas → Convites de participação**, um administrador ou RH com `HR_ASSESSMENT_INVITES_ISSUE` prepara entre 1 e 20 códigos e confirma o lote. Cada código é repassado individualmente pelo responsável e usado em **Responder coleta**. O sistema registra a geração, sem confirmar o recebimento pela pessoa.

As rotas abaixo são relativas a `/organizations/:orgId/assessment-cycles/:cycleId/invite-deliveries`.

| Operação                      | Contrato                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /preview`               | `{channel:'MANUAL_CODE',count,idempotencyKey}`. Persiste a prévia sem gerar códigos. A prévia vale até 15 minutos, limitada pelo fim da coleta. |
| `POST /:operationId/confirm`  | `{}`. Gera os códigos em uma transação após revalidar autorização, estado e prazo. Os códigos aparecem somente na primeira resposta.            |
| `GET /` e `GET /:operationId` | Consultam as últimas 20 operações do emissor ou uma operação específica. O retorno não contém códigos nem contatos.                             |

A confirmação repetida permite conferir se houve emissão, sem gerar outro lote nem recuperar códigos. Se a resposta da primeira tentativa se perder, a interface orienta consultar a operação e conferir o repasse antes de preparar novos convites. Prévia encerrada ou expirada não gera códigos e retorna 409. Os códigos emitidos vencem no fim da coleta e deixam de funcionar ao fechar o ciclo. A rota anterior `/invites` continua compatível. A entrega automatizada por e-mail ou WhatsApp e os lembretes dependem das decisões de canal, orçamento e privacidade com a ReTech+.

## Verificações locais

Os testes HTTP/PG estão em `apps/api/test/assessments.integration.spec.ts`; o engine em `assessments-projection.spec.ts`; os contratos em `packages/contracts/src/assessment-cycles.test.ts`. Os scripts `assessment-migrations.test.mjs` e `compatibility-rollback.test.mjs` criam bancos temporários próprios e preservam o banco principal. A execução exige PostgreSQL local explicitamente configurado; testes de integração usam `RUN_DB_TESTS=1`.

## Comparativo entre períodos

`GET /organizations/:orgId/assessment-comparison` recebe `referenceCycleId`, `currentCycleId` e, opcionalmente, `unitId` e `sectorId`. Exige a empresa ativa. IDs de outra empresa ou fora do filtro retornam 404. Para comparar, as duas coletas precisam estar encerradas, com o mesmo grupo e versões de instrumento e política, em ordem cronológica e sem sobreposição até o fim efetivo de cada coleta.

As taxas mostram a diferença em pontos percentuais. O comparativo oculta os dois pontos e a diferença quando contagens, complementos ou diferenças ficam abaixo do limiar. Uma opção protegida também protege as demais opções da pergunta. As consultas individuais seguem a política de cada coleta. Na emissão conjunta, o resumo e as seções técnicas aplicam a proteção do par.

Os indicadores operacionais usam a revisão ou o parecer registrado até o fim de cada período. As classes de risco são agrupadas por versão do método. Melhora e piora referem-se à mudança de classificação em reavaliação comparável. Quando a avaliação técnica cita uma das coletas ou uma fonte dela, o comparativo permite abrir o risco e a ação relacionados. A interface também disponibiliza os registros do recorte.
