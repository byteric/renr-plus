# API de coletas e consolidação — ID09

As rotas usam `/api/v1`. O contrato executável está em `packages/contracts/src/assessment-cycles.ts`; a especificação de comportamento está em `docs/plans/IMPLEMENTACAO_ID09_ID10.md`.

## Administração

Rotas sob `/organizations/:orgId` exigem sessão, organização ativa e vínculo ativo. Escritas exigem Origin confiável. Criar/editar políticas, criar/editar/abrir/encerrar ciclos, emitir convites e acrescentar fontes exige ADMIN. Publicação REAL exige a capacidade explícita `TECHNICAL_DECISIONS`, inclusive para ADMIN; READER técnico pode publicar. Publicação DEMONSTRATION exige ADMIN. A organização retornada pelas capacidades deve coincidir com o escopo autorizado.

| Recurso                                 | Operações                                                               |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `consolidation-policies`                | GET paginado; POST `{usageMode,minimumResponses}`                       |
| `consolidation-policies/:id`            | GET; PUT com `expectedRevision`                                         |
| `consolidation-policies/:id/publish`    | POST `{expectedRevision,approvalReference?}`                            |
| `consolidation-policies/:id/fork`       | POST `{expectedRevision}`                                               |
| `assessment-cycles`                     | GET paginado com `status,assessmentGroupId`; POST do contexto e período |
| `assessment-cycles/:id`                 | GET; PUT do contexto e período com `expectedRevision`                   |
| `assessment-cycles/:id/open` e `/close` | POST `{expectedRevision}`                                               |
| `assessment-cycles/:id/invites`         | POST `{count}` entre 1 e 20                                             |
| `assessment-cycles/:id/sources`         | GET paginado; POST `{kind,context,occurredOn,summary}`                  |
| `assessment-cycles/:id/results`         | GET da projeção protegida                                               |
| `assessment-consolidation`              | GET exige `instrumentVersionId,policyVersionId`; `unitId` opcional      |

Paginação: `{items,total,page,pageSize}`. Objetos de entrada são estritos. Conflitos de revisão e transição retornam 409. Ciclos seguem DRAFT → OPEN → CLOSED. A abertura revalida grupo, empresa, setor e unidade ativos, versões publicadas de instrumento/política com modo compatível e período vigente. Após abertura, contexto e período permanecem fixos também por SQL.

DEMONSTRATION exige limiar 5. REAL não recebe limiar padrão: publicação exige inteiro explícito de 2 a 1000 e referência de aprovação. Política publicada é imutável; fork cria nova versão DRAFT e limpa os campos de aprovação/publicação.

Fontes são append-only, com data civil válida, não futura no fuso da organização. A autoria vem da sessão; campos de autoria/participante enviados pelo cliente são rejeitados. O contexto e a síntese devem descrever situações coletivas sem identificar participantes.

## Participação pública

`POST /assessment-participation/access` recebe `{inviteCode}` no corpo. Retorna nome e término do ciclo, modo de uso e instrumento publicado com perguntas/opções. O payload público não inclui organização, grupo, autor ou aprovação. Os códigos são gerados com 32 bytes aleatórios e aparecem apenas na emissão dos convites.

`POST /assessment-participation/submissions` recebe `{inviteCode,instrumentVersionId,submissionSecret,answers:[{questionId,optionIds}]}` e confirma estritamente `{status:'accepted'}`. O segredo tem 43 caracteres base64url, gerado pelo cliente e mantido somente em RAM. Perguntas opcionais podem ser omitidas ou vazias. Obrigatórias exigem seleção; escolha única/ordinal admite uma opção. Perguntas/opções duplicadas, estranhas à versão ou incompatíveis são rejeitadas antes do consumo do convite.

Consumo, respostas e recibo são gravados numa única transação, com lock do ciclo antes do convite. Repetição exata retorna accepted sem nova resposta, inclusive após encerramento ou expiração. Segredo/conteúdo divergente retorna 409. Recibos guardam somente hash do convite, hash do segredo e MAC do conteúdo canônico; não possuem FK/ID da resposta. Respostas não possuem identidade, fingerprint, convite ou horário de participante.

Cabeçalhos privados incluem `Cache-Control: no-store`. O servidor limita as tentativas públicas por IP; exceder o limite retorna 429. Código e segredo nunca devem ir para URL, storage, logs ou gravações de testes.

## Projeção de privacidade

Resultados e consolidação retornam `{organizationId,instrumentVersionId,policyVersionId,minimumResponses,node}` pelo mesmo engine. Nós contêm identificador/nome, tipo, disponibilidade, contagem protegida, perguntas e filhos. Ciclos abertos não expõem contagens; ciclos fechados sem respostas distinguem ausência de dados; totais abaixo do limiar são suprimidos.

Perguntas verificam respondidas/omitidas e selecionou/não selecionou por opção. Qualquer célula ou complemento positivo abaixo do limiar protege toda a distribuição. Nós protegidos têm `responseCount:null`; perguntas protegidas têm `answerCount:null,options:[]`. Contratos recusam envelopes incompatíveis com essas regras.

A consolidação particiona a família inteira por organização e versões exatas de instrumento/política, antes do recorte de unidade. Descendente protegido protege os ancestrais; pergunta protegida protege a distribuição ancestral. A soma representa envios, sem inferir pessoas únicas. Não são aceitos filtros arbitrários por ciclos ou subconjuntos de respostas.

## Verificações locais

Os testes HTTP/PG estão em `apps/api/test/assessments.integration.spec.ts`; o engine em `assessments-projection.spec.ts`; os contratos em `packages/contracts/src/assessment-cycles.test.ts`. Os scripts `assessment-migrations.test.mjs` e `compatibility-rollback.test.mjs` criam bancos temporários próprios e preservam o banco principal. A execução exige PostgreSQL local explicitamente configurado; testes de integração usam `RUN_DB_TESTS=1`.
