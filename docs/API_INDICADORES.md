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

### Conferência com o relatório SST

Use a mesma empresa, unidade, setor e data de referência. O relatório registra o instante de emissão. Para comparar o inventário com o painel atual, emita o relatório sem alterações de cadastro entre as duas consultas. O relatório preserva os riscos arquivados no histórico e separa essa quantidade da contagem de não arquivados que o painel usa. O plano de ação do relatório e o total operacional do painel incluem medidas ligadas a riscos arquivados. A série histórica do painel conta eventos no período e segue um recorte próprio.

## Série histórica

A série conta avaliações técnicas gravadas, revisões com transição registrada para execução informada e decisões de encerramento técnico. O contexto congelado de cada evento fornece o recorte histórico. Os limites e o agrupamento usam o calendário da organização, inclusive offsets numéricos e regras de horário de verão. Quando há eventos no intervalo, os dias sem evento aparecem com zero. Um intervalo sem eventos retorna uma série vazia.

O painel apresenta os eventos registrados como uma série separada. Uma decisão histórica continua no gráfico quando exige revisão no retrato atual. A série não reconstrói estados passados nem infere classificação pela data de criação de um risco.

## Navegação

A unidade, o setor, a área, o período e a página de prioridades ficam na URL do painel. O inventário aceita `classification=UNCLASSIFIED` ou o par `methodVersionId` e `levelKey`. A lista de ações aceita `openOnly=true` ou `overdue=true`, com os mesmos filtros organizacionais. As prioridades abrem a ação com retorno ao painel no recorte anterior.

Na área Riscos, o atalho **Consultar resultados por coleta** abre as coletas encerradas da empresa ativa (`#/coletas?status=CLOSED`). A seleção de um ciclo consulta os resultados protegidos da própria coleta. Os filtros de unidade e setor do painel continuam valendo para riscos e ações. A coleta versionada tem recorte próprio e não estabelece um vínculo direto com os registros operacionais do inventário.

## Decisões para o aceite

Registre versão, data, responsável, regra aprovada, exemplos e impactos em painel, listas e PDF. Use empresas fictícias na reunião. Qualquer massa oficial exige autorização e um ambiente isolado.

Na visão de plataforma, os totais de clientes atendidos e o catálogo padrão usam empresas classificadas como clientes com CNPJ válido. O catálogo também permite consultar outras classificações de forma explícita. A concessão global dá acesso aos totais e ao catálogo. O painel de cada empresa exige vínculo ativo naquela empresa. Na verificação com dois clientes fictícios, o operador global consultou os dois no catálogo. Cada administrador consultou o próprio painel e recebeu 404 ao abrir o painel da outra empresa.

| Decisão pendente                 | Exemplo para validar com Produto, ReTech+ e RH                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recorte por ciclo                | Uma empresa tem duas coletas e um risco sem coleta associada. Confirmar se a consulta separada atende. Se o filtro precisar cruzar coletas, riscos e ações, definir o vínculo e o destino dos registros sem ciclo.    |
| Ação que atende a vários riscos  | Uma única medida pode tratar dois riscos. Confirmar se um risco de origem por ação atende. Se houver associação múltipla, definir contagem, filtros, atribuição e histórico.                                          |
| Estado Bloqueado                 | Uma ação em execução depende de uma compra. Definir se deve ficar em execução com registro da dependência ou se precisa de estado próprio. Nesse caso, aprovar transições, efeito no prazo e exibição nos relatórios. |
| Indicadores globais e do cliente | A ReTech+ vê totais e catálogo por empresa. Cada cliente consulta o próprio painel. Confirmar quais contagens precisam aparecer em cada visão, a fonte e a permissão de acesso.                                       |

Na conferência, selecione a mesma unidade e setor no Painel, no Inventário, em Ações e na emissão SST. Compare os registros e a nota de arquivamento na prévia e no PDF. Repita com a segunda empresa fictícia para conferir o isolamento. O teste volumoso é executado em ambiente local isolado.
