# Indicadores gerenciais

O painel usa dois endpoints de leitura privada na organização ativa. A resposta é validada pelos contratos em `packages/contracts/src/management-indicators.ts`. Ambas as rotas exigem sessão, vínculo ativo e escopo da empresa selecionada, com `Cache-Control: private, no-store`.

| Rota                                                   | Parâmetros                                                  | Retorno                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `GET /organizations/:id/management-indicators`         | `unitId`, `sectorId`, `page` opcionais                      | Retrato atual, opções de filtro e cinco prioridades por página |
| `GET /organizations/:id/management-indicators/history` | `unitId` e `sectorId` opcionais, `from` e `to` obrigatórios | Eventos diários em intervalo civil inclusivo de até 90 dias    |

Setor sem unidade implica a unidade à qual ele pertence. Combinação incompatível ou data inválida retorna 400. Uma organização, unidade ou setor fora do escopo retorna 404. Leitores recebem `structure.employees: null`. A API retorna o recorte efetivo, o fuso e o instante de geração. O retrato também informa a data civil usada para verificar prazos.

## Retrato atual

- Inventário contabiliza rascunhos e registros não arquivados. A classificação exige avaliação técnica vigente no contexto atual. A distribuição agrupa por versão do método e nível, com a ausência de classificação contabilizada no total.
- Ações incluem as de riscos arquivados. Abertas somam planejadas e em execução. Atrasadas são ações abertas com prazo anterior à data civil da organização. Canceladas ficam no total operacional.
- Eficácia e encerramento usam as verificações de validade do detalhe. Pendências técnicas do painel são ações implementadas sem encerramento vigente. Uma prova arquivada, um parecer substituído ou uma reavaliação superada pode exigir revisão. Prioridades trazem atrasos primeiro, seguidos das pendências técnicas, em ordem estável por prazo e ID.
- Contagens de estrutura incluem cadastros ativos e inativos. Opções de unidade e setor pertencem à organização ativa. O painel trabalha com riscos e ações já registrados. Resultados e respostas de coletas continuam sujeitos à supressão nas telas próprias, sem números de questionário no painel.

## Série histórica

A série conta avaliações técnicas gravadas, revisões com transição registrada para execução informada e decisões de encerramento técnico. O contexto congelado de cada evento fornece o recorte histórico. Os limites e o agrupamento usam o calendário da organização, inclusive offsets numéricos e regras de horário de verão. Quando há eventos no intervalo, os dias sem evento aparecem com zero. Um intervalo sem eventos retorna uma série vazia.

O painel apresenta os eventos registrados como uma série separada. Uma decisão histórica continua no gráfico quando exige revisão no retrato atual. A série não reconstrói estados passados nem infere classificação pela data de criação de um risco.

## Navegação

A unidade, o setor, a área, o período e a página de prioridades ficam na URL do painel. O inventário aceita `classification=UNCLASSIFIED` ou o par `methodVersionId` e `levelKey`. A lista de ações aceita `openOnly=true` ou `overdue=true`, com os mesmos filtros organizacionais. As prioridades abrem a ação com retorno ao painel no recorte anterior.
