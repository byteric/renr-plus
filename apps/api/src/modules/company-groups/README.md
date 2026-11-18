# Grupos de empresas

O grupo é uma associação explícita entre empresas cadastradas no ReNR+. Uma concessão de leitura do grupo permite consultar somente indicadores agregados dos CNPJs associados. A mesma conta pode ter vínculos operacionais próprios, que continuam sujeitos ao contexto da empresa e à delegação de unidades e setores. O acesso global da plataforma, por si só, fica restrito às capacidades administrativas já concedidas.

## API v1

| Rota                                            | Acesso e resultado                                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /company-groups`                           | Sessão autenticada. Lista nome e identificador dos grupos com concessão ativa.                                                                                                           |
| `GET /company-groups/:id`                       | Concessão ativa ao grupo. Retorna consolidação e linhas por empresa. `organizationId` é opcional e limita a resposta a um único CNPJ do grupo. Grupo ou CNPJ fora do acesso retorna 404. |
| `GET /platform/company-groups`                  | `MANAGE_CLIENTS` ou `MANAGE_GRANTS`. Lista grupos paginados, com composição e versão.                                                                                                    |
| `GET /platform/company-groups/eligible-clients` | `MANAGE_CLIENTS`. Pesquisa paginada por nome ou CNPJ.                                                                                                                                    |
| `POST /platform/company-groups`                 | `MANAGE_CLIENTS`. Cria um grupo com nome, identificadores das empresas e motivo.                                                                                                         |
| `PATCH /platform/company-groups/:id`            | `MANAGE_CLIENTS`. Substitui nome e composição com a versão atual e um motivo. Uma lista vazia retira todas as empresas.                                                                  |
| `GET /platform/company-groups/:id/grants`       | `MANAGE_GRANTS`. Lista concessões por e-mail, incluindo as revogadas.                                                                                                                    |
| `PUT /platform/company-groups/:id/grants`       | `MANAGE_GRANTS`. Concede ou revoga por e-mail de uma conta cadastrada, com estado, versão e motivo. A primeira concessão usa versão zero.                                                |

O catálogo aceita clientes ativos com CNPJ validado e empresas fictícias ativas com CNPJ validado ou ausente. Uma empresa que deixar de atender aos critérios sai do consolidado na consulta seguinte. As alterações passam pela mesma trava transacional da administração da plataforma, registram motivo na auditoria e rejeitam versões defasadas com 409. As leituras do painel e da administração são privadas e têm `Cache-Control: private, no-store`.

## Indicadores e proteção

- **Colaboradores:** cadastros ativos nos CNPJs selecionados. A soma representa registros, pois uma pessoa pode ter vínculo em mais de um CNPJ.
- **Riscos e ações:** riscos registrados e distribuição das ações pelo estado operacional atual. A resposta contém contagens agregadas.
- **Adesão:** respostas válidas divididas pela base congelada de elegíveis da última coleta encerrada em cada setor. O consolidado usa a soma dos numeradores e denominadores dos setores, respeitando o limiar de cada coleta e os complementos na base e nos convites. Um recorte protegido protege seu total correspondente. Uma coleta sem base mensurável deixa indisponível a taxa daquele total.
- **Evolução da adesão:** compara as duas últimas coletas encerradas de cada setor, com intervalos independentes, grupo de avaliação, versão de instrumento e política iguais. O cálculo pondera os dois períodos por suas respectivas bases congeladas. O resultado também protege diferenças pequenas entre respostas, elegíveis e complementos.

O consolidado consulta a concessão, a composição e os indicadores no mesmo retrato transacional. Uma revogação vale para a próxima requisição, inclusive em uma sessão já iniciada. Cadastros, decisões técnicas, históricos, anexos e relatórios continuam nas rotas de empresa e exigem a autorização correspondente.
