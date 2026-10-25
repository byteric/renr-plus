# Catálogo de instrumentos — ID07

As rotas ficam em `/api/v1/organizations/:orgId/instruments`, usam sessão por cookie e organização ativa, e retornam `Cache-Control: private, no-store`. Mutações exigem Origin confiável. O contrato executável está em `packages/contracts/src/instruments.ts`; OpenAPI versionado em `apps/api/src/modules/instruments/instruments.openapi.json`, além do Swagger da aplicação.

| Método e complemento                                 | Permissão e resultado                                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GET `/` e GET `/:id`                                 | Vínculo ativo; lista paginada de identidades ou identidade individual. Lista aceita search, page e pageSize.            |
| POST `/`                                             | ADMIN; `{name}` cria identidade e rascunho v1 incompleto.                                                               |
| GET `/:id/versions` e GET `/:id/versions/:versionId` | Vínculo ativo; resumos paginados em ordem decrescente de versão ou detalhe completo.                                    |
| PUT `/:id/versions/:versionId`                       | ADMIN; substitui o conteúdo do rascunho com expectedRevision.                                                           |
| POST `/:id/versions/:versionId/publish`              | DEMONSTRATION exige ADMIN; REAL exige TECHNICAL_DECISIONS e referência de aprovação. Técnico READER pode publicar REAL. |
| POST `/:id/versions/:versionId/fork`                 | ADMIN; fonte publicada e expectedRevision. Novo rascunho com próxima versão e IDs novos de perguntas/opções.            |

Não há DELETE na API. Revisão desatualizada, edição de publicação e fork de rascunho retornam 409. Entradas estritas inválidas e publicação incompleta retornam 400 com caminhos de campo em `details`. Recursos de outra organização retornam 404.

Rascunhos permitem texto vazio e perguntas/opções incompletas. Cada documento admite 100 perguntas e 20 opções por pergunta; título de até 160, enunciado de 400, opção de 200, descrição de 2000, instruções de 4000 e referência de aprovação de 1000 caracteres. IDs são únicos no documento e não podem ser emprestados de outra versão ou pergunta; posições são contíguas desde 1. O parser HTTP aceita até 4 MiB para comportar o documento máximo também quando o cliente serializa caracteres Unicode como escapes JSON. Documentos acima desse limite recebem 413 com envelope público, sem conteúdo do corpo.

Tipos: `SINGLE_CHOICE`, `MULTIPLE_CHOICE` e `ORDINAL_CHOICE`. O último permite selecionar uma única opção na sequência rotulada apresentada; não define pontuação. Não há campo livre nas respostas. Publicação exige título, pelo menos uma pergunta completa e pelo menos duas opções rotuladas por pergunta. `instrumentPublicationIssues` é compartilhado por backend e editor, com mensagens em português. Aprovação não é herdada no fork. Publicação incrementa a revisão e registra autor/data.

Triggers SQL impedem alteração de conteúdo publicado e inserção posterior de perguntas/opções. Edições dos filhos bloqueiam a versão pai até terminar a transação, serializando sua conclusão com a publicação. A API também serializa operações por instrumento e verifica `expectedRevision`; uma revisão conflitante não sobrescreve o conteúdo.

`Instrument` é a identidade; `InstrumentVersion` mantém os IDs anteriores e sua sequência passa a ser por instrumento. `usageMode` tem somente `DEMONSTRATION` e `REAL`. O `systemKey` interno `LEGACY_DEMO` identifica a projeção demonstrativa reservada, e `isLegacy` a sinaliza no DTO. O `isDemo` anterior permanece verdadeiro exclusivamente nessa projeção v1; novos instrumentos e forks usam false independentemente do modo. Um índice parcial garante uma projeção reservada por organização. As rotas antigas continuam fixadas nela e devolvem erro de campo ao receber outra versão. A aplicação dos catálogos aos ciclos pertence ao ID 09. Os contratos congelados de diagnóstico não foram alterados.

A migração `20261024000000_instrument_catalog` expande o catálogo, preserva versões/perguntas/opções/ciclos/respostas existentes e usa `lock_timeout` de 5 s. A unicidade antiga por organização/versão é substituída por instrumento/versão após preencher a nova identidade. Fixtures legadas criadas sem `instrumentId` recebem a identidade reservada por trigger; filhos da projeção publicada só podem ser inseridos na mesma transação de criação, com validação deferida. Não há bypass na API nem desativação de triggers.

Manutenção de proprietário sobre versão sem ciclos usa DELETE do pai primeiro e cascata dos filhos. Uma versão referenciada continua protegida por FK RESTRICT. Helpers E2E usam apenas banco loopback, prefixo e ID/nome exatos; referência histórica aborta a limpeza inteira. Contas reutilizadas permanecem.
