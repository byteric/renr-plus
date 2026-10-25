# Execução dos IDs 07 e 08

Estado: concluído e verificado localmente em 24/10/2026. Provas e limites em `docs/VERIFICACAO_ID07_ID08.md`. Os IDs 01–06 permanecem preservados; esta verificação documenta o ambiente local. Os IDs 09 e 10 acrescentam a aplicação dos instrumentos aos ciclos.

## Contrato e decisões

Criar identidade `Instrument` e evoluir `InstrumentVersion`, conservando os IDs históricos. Cada instrumento possui sua própria sequência de versões; `revision` controla concorrência do rascunho. Catálogos novos usam `usageMode: DEMONSTRATION | REAL`. A coluna anterior `isDemo` fica reservada à projeção compatível `LEGACY_DEMO`, versão 1, consumida pelos endpoints antigos. Os DTOs novos não expõem essa coluna. Assim, o artefato anterior continua selecionando o instrumento demonstrativo original mesmo com novos catálogos presentes.

Rascunhos podem ficar sem título, perguntas ou opções completas, dentro dos limites de tamanho/identidade/ordenação. Publicação exige título e pelo menos uma pergunta íntegra, com pelo menos duas opções rotuladas. Tipos: escolha única, múltipla e ordinal de seleção única; sem pontuação ou campo aberto. Uso real exige referência de aprovação e capacidade técnica explícita. ADMIN não recebe essa capacidade automaticamente.

Versões publicadas não podem ter conteúdo alterado. Fork cria novos IDs de perguntas/opções, próxima versão e nenhuma aprovação herdada. Ciclos conservam sua referência original. Não há DELETE na API. Manutenção SQL de versões não referenciadas é operação de proprietário; FKs preservam versões usadas em ciclos. Triggers impedem edição de versão/filhos publicados e inserção posterior de filhos. Não adicionar bypass na API ou desabilitar triggers em testes.

## HTTP e exports acordados

Prefixo `/api/v1/organizations/:orgId/instruments`. Cookie, organização ativa, Origin nas mutações e envelope de erro existentes. Leitura por vínculo ativo; criação/edição/fork e publicação demonstrativa por ADMIN; publicação REAL por capacidade `TECHNICAL_DECISIONS`, inclusive técnico READER.

| Rota                           | Resultado                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| GET/POST `/`                   | Lista paginada de identidades; criar `{name}` retorna `{instrument, version}` com rascunho v1.               |
| GET `/:id`                     | Identidade.                                                                                                  |
| GET `/:id/versions`            | Lista paginada de resumos de versões, mais recentes primeiro.                                                |
| GET `/:id/versions/:versionId` | Versão completa.                                                                                             |
| PUT `/:id/versions/:versionId` | `{expectedRevision,title,description,instructions,usageMode,questions}`; somente rascunho, retorno completo. |
| POST `.../:versionId/publish`  | `{expectedRevision,approvalReference?}`; retorno completo.                                                   |
| POST `.../:versionId/fork`     | `{expectedRevision}`; fonte publicada, retorno do novo rascunho.                                             |

Identidade: `id, organizationId, name, isLegacy, createdAt`. Resumo de versão: `id, organizationId, instrumentId, title, version, revision, status, usageMode, questionCount, approvalReference, publishedAt, publishedById, createdAt, updatedAt, cycleCount`. Detalhe acrescenta `description, instructions, questions`. Campos de aprovação/publicação são nulos em rascunhos. Datas ISO; IDs UUID; listas `{items,total,page,pageSize}`.

Pergunta: `{id,label,type,required,position,options:[{id,label,position}]}`. IDs fornecidos pelo editor são aceitos somente se novos ou pertencentes à mesma versão/pergunta; jamais reutilizar IDs de outra versão. Arrays têm posições contíguas a partir de 1. Limites: 100 perguntas, 20 opções/pergunta, título 160, enunciado 400, opção 200, descrição 2000, instruções 4000, referência 1000 caracteres. Limite HTTP deve comportar um documento válido dentro dessas restrições.

Exports: `instrumentSchema`, `instrumentListSchema`, `instrumentVersionSummarySchema`, `instrumentVersionListSchema`, `instrumentVersionSchema`, `createdInstrumentSchema`, `createInstrumentSchema`, `updateInstrumentDraftSchema`, `publishInstrumentSchema`, `forkInstrumentVersionSchema`, `instrumentQuerySchema`, `instrumentPublicationIssues`; tipos `Instrument`, `InstrumentVersion`, `InstrumentVersionSummary`, `InstrumentQuestion`, `UpdateInstrumentDraft`. Issues usam `{field,message}`, com caminhos como `questions.0.options.1.label`.

Os contratos estritos de `diagnostics.ts` permanecem inalterados. Aplicação dos instrumentos novos aos ciclos pertence ao ID 09; endpoints antigos rejeitam versões incompatíveis com erro de campo, preservando o fluxo anterior e evitando erro de serialização.

## Interface e etapas

1. Backend/contratos/migração: teste Red HTTP real, contratos e integridade; implementação mínima e provas PostgreSQL.
2. Frontend: rota `#/instrumentos`, catálogo, versões e editor com metadados, perguntas, opções e aprovação. Usar os tokens, componentes e navegação existentes; novo módulo carregado sob demanda.
3. Prévia deriva diretamente do rascunho, incluindo alterações não salvas. Botões de reordenação mantêm foco e anunciam posição; feedback breve sem atraso e sem animação obrigatória em reduced motion. Erros apontam campos; falha/conflito mantém o rascunho em memória.
4. Salvar antes de publicar quando houver edição local, utilizando a revisão retornada. Versão publicada fica somente leitura com criação de nova versão. Exibir impacto real pelos ciclos associados e a permanência da versão original.
5. Gates: check, formatação, Prisma, migrações vazias/populadas, seed idempotente, integração, compatibilidade congelada com catálogos novos, E2E desktop/mobile e inspeção visual. Sem alterar contratos congelados, pacotes de membros, credenciais, nuvem ou Git.
