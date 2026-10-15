# Referência HTTP — diagnóstico demonstrativo

Prefixo `/api/v1`. JSON em camelCase; UUIDs em texto; datas ISO 8601 UTC. Contratos de entrada e saída
estão em `packages/contracts/src/diagnostics.ts`. OpenAPI local apresenta rotas e os corpos de criação,
convites, acesso e envio. Sessão administrativa permanece em cookie HttpOnly; não há mudança para Bearer.

## Gestão

Nas rotas abaixo, `base` representa `/organizations/:orgId/diagnostic-cycles`. O contexto autorizado
é obtido da sessão; informar outra organização não concede acesso. Mutações validam a origem.

| Método/rota                                       | Entrada                                                       | Sucesso                                     | Perfil       |
| ------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------- | ------------ |
| GET `/organizations/:orgId/diagnostic-instrument` | UUID da organização                                           | 200: instrumento, versão, perguntas/opções  | ADMIN/READER |
| GET `base`                                        | `page` e `pageSize`, padrão 1/50, máximo 100 por página       | 200: items/total/page/pageSize              | ADMIN/READER |
| POST `base`                                       | name (3–120), sectorId, instrumentVersionId, startsAt, endsAt | 201: ciclo DRAFT                            | ADMIN        |
| GET `base/:id`                                    | UUID do ciclo                                                 | 200: ciclo, setor/unidade, estado/período   | ADMIN/READER |
| POST `base/:id/open`                              | Sem corpo                                                     | 201: ciclo OPEN                             | ADMIN        |
| POST `base/:id/close`                             | Sem corpo                                                     | 201: ciclo CLOSED                           | ADMIN        |
| POST `base/:id/participation-invites`             | count inteiro 1–20, padrão 1                                  | 201: cycleId, participationPath, invites    | ADMIN        |
| GET `base/:id/results`                            | Sem filtros                                                   | 200: disponibilidade e agregados permitidos | ADMIN/READER |

Erros: 400 para UUID/payload/query inválidos; 401 sem sessão; 403 escrita por leitor/origem indevida;
404 recurso fora do escopo ou inexistente; 409 estado, período ou cadastro inativo incompatível;
503 dependência indisponível; 500 erro inesperado sanitizado. Não expor stack, SQL, códigos de convite
ou respostas individuais. Respostas diagnósticas usam `Cache-Control: private, no-store`.

## Participação

| Método/rota                      | Corpo                                          | Sucesso                              |
| -------------------------------- | ---------------------------------------------- | ------------------------------------ |
| POST `/participation/instrument` | `{ inviteCode }`                               | 201: cycleName, endsAt e instrumento |
| POST `/participation/responses`  | `{ inviteCode, instrumentVersionId, answers }` | 201: `{ "status": "accepted" }`      |

`inviteCode` possui 43 caracteres base64url, guardado somente como hash. Não aceitá-lo em query ou path.
Não enviar cookie administrativo no cliente de participação. A API não exige identificação individual.
Cada answer contém `questionId` e `optionIds` (UUIDs distintos). Escolha única exige exatamente uma opção;
múltipla exige uma ou mais. Todas as cinco perguntas devem estar presentes na versão correta.

400 inclui `details` de campos inválidos quando aplicável. Convite indisponível retorna 409 com código
`INVITE_UNAVAILABLE`, sem distinguir o conteúdo de um envio anterior. Excesso de tentativas retorna 429;
dependência indisponível retorna 503. Não fazer retry automático de submissão.

O consumo do convite e a gravação pertencem à mesma transação. Falha desfaz ambos. Concorrência com o
mesmo código aceita um único envio. Não existe endpoint para recuperar resposta individual.

## Resultados

`availability` é `CYCLE_OPEN`, `INSUFFICIENT_RESPONSES` ou `AVAILABLE`. Nos dois primeiros estados,
`responseCount` é null e questions é vazio. A disponibilidade de resultados requer encerramento e
no mínimo cinco envios. `minimumResponses` é 5 neste recorte demonstrativo.

Pergunta suprimida mantém o enunciado/tipo, `suppressed: true` e options vazio. Caso contrário, options
possui id, label, count e percentage. Uma contagem positiva menor que cinco suprime toda a pergunta;
zero não provoca supressão. Percentual usa o número de envios como denominador. Múltipla escolha
pode somar mais de 100%. Sem filtros, exportação, pontuação técnica ou interpretação clínica.

O vínculo é `response_answer → diagnostic_response → ciclo/versão`; pergunta e envio devem compartilhar
a versão. Convite não aponta para a resposta. Isso reduz vínculo direto, mas não elimina riscos de
correlação por contexto, data ou acesso privilegiado ao banco. Somente dados fictícios nesta etapa.
