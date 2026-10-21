# Verificação da v0.3

Data: 17/10/2026. Base de comparação: `main` em `fc299b1fe60ae72c07e194cfd3c44f59491f9952`.
Os registros abaixo preservam as verificações por data. A rodada final de 21/10 está ao fim deste documento.
Testes locais e CI não comprovam publicação no ambiente online.

## Execuções registradas

| Verificação                                  | Resultado observado                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Scripts de configuração, segurança e fixture | 48 testes passaram.                                                                                                                            |
| Contratos compartilhados                     | 73 testes passaram, incluindo série diária e validação de fuso.                                                                                |
| API unitária e HTTP                          | 116 testes passaram; 42 casos de banco ficam separados nessa execução.                                                                         |
| Integração PostgreSQL                        | 42 testes passaram em cinco suítes, inclusive a agregação diária em banco real.                                                                |
| Migrações e seed                             | Banco vazio, repetição de deploy/seed e preservação de dados v0.2 passaram em bases temporárias exclusivas.                                    |
| Prisma                                       | Schema validado e cliente gerado.                                                                                                              |
| React                                        | 84 testes passaram, incluindo filtros, origens paginadas, concorrência, navegação, troca de empresa e série diária.                            |
| Composição e build                           | `pnpm check` passou: testes, typecheck, lint e builds dos pacotes.                                                                             |
| Formatação                                   | `pnpm format:check` passou.                                                                                                                    |
| Suíte completa de navegador                  | 52 testes passaram em Chromium nos perfis desktop e celular, com API e PostgreSQL locais reais.                                                |
| Reprodução dos pacotes                       | Aplicação das oito partes, em ordem, sobre a base limpa: contratos, typecheck e lint passaram em cada etapa; composição final passou no check. |

As falhas negativas de autorização, validação e indisponibilidade são exercitadas de propósito.
Uma linha de erro simulada no log não significa que uma suíte falhou; o resultado final do comando determina o gate.

## Cobertura funcional e privacidade

O fluxo real exercita criação, recarga, duas fichas, cópias de contexto, conflito de versão,
origem coletiva, arquivo lógico e consulta filtrada.
O leitor não recebe ações de escrita e suas tentativas diretas retornam 403.
Uma organização diferente não recebe um risco alheio nem seu histórico.
Os testes verificam também ausência de sessão, Origin exata, schemas strict e respostas privadas.
O painel, a série por período, os atalhos de filtros, os dois temas e o favicon fazem parte da suíte de navegador.
Os testes de rolagem verificam PageDown, retorno do drawer, movimento reduzido,
barra compacta de filtros fixa no desktop e âncoras não encobertas pelo cabeçalho.

Regressões corrigidas e protegidas por testes: resposta atrasada após alternar empresas,
setor mantido na URL, filtros duplicados, origem fora da primeira página,
recarga do ciclo selecionado, conflito de arquivo e restauração da posição da lista.
A navegação ativa mantém as seções ainda visíveis entre callbacks parciais do observador, inclusive na rolagem reversa.
A série preserva a compatibilidade com fusos IANA e offsets válidos já aceitos no cadastro,
com conversão correta de sinais, minutos e limites dos períodos de 7, 30 e 90 dias.

Nenhuma ficha aceita autoria ou snapshot informados pelo cliente.
O banco bloqueia alteração/exclusão do histórico e vínculos cruzados entre empresas.
O diagnóstico preserva supressão coletiva e não liga convite/participante à resposta individual.
Credenciais e códigos de participação ficam fora de traces, vídeos e capturas de autenticação.

Os E2E arquivam somente seus riscos identificados por UUID e prefixo próprio.
Fichas e suas origens sintéticas ficam preservadas no banco local por serem históricas.
As verificações de migração removem somente as bases temporárias que elas próprias criaram.
Não há reset de dados, limpeza geral de tabelas ou operação em banco remoto.

## Desempenho e apresentação

Build de referência desta composição: JavaScript inicial 178,71 KB gzip;
dashboard sob demanda aproximadamente 5,21 KB gzip; inventário sob demanda aproximadamente 9,72 KB gzip.
O módulo compartilhado de leitura de dados representa aproximadamente 0,60 KB gzip.
A meta proposta de 200 KB gzip inicial foi atendida nessa amostra.
Permanece o aviso do bundler para chunk minificado acima de 500 KB; não foi ocultado aumentando o limite.

A agregação de 2.000 riscos fictícios foi executada no PostgreSQL local com EXPLAIN ANALYZE.
As amostras ficaram na ordem de milissegundos em banco aquecido; não são SLO nem estimativa de latência no Render Free.
LCP, INP e CLS de produção não foram medidos. Não há alegação de nota Lighthouse ou desempenho de usuários reais.

Capturas de diagnóstico, painel e risco usam exclusivamente dados fictícios.
Foram verificadas as larguras 320, 375, 768 e 1440 px, nos temas claro e escuro.
O ensaio de leitura ampliada usa CSS zoom de 200% em viewport de 1440 × 1000 px;
confere ausência de transbordamento e funcionamento dos filtros. Não equivale à certificação de zoom nativo de todos os navegadores.

Ensaio de interação: Chromium headless, Vite local, CPU reduzida em 4×,
troca de tema e PageDown, três amostras por perfil. Ambos usam viewport de 1440 × 1000 px nesse ensaio.
Os intervalos entre frames observados tiveram P50 de 16,7 ms e P95/P99 entre 16,7 e 16,8 ms.
A duração total por amostra ficou entre 807,6 e 980,6 ms e inclui a espera deliberada por 30 frames;
não é tempo de resposta da interface nem medida de INP.
O perfil móvel é emulação, não medição em smartphone físico. Não há promessa de desempenho em produção.

## Situação em 17/10/2026

Este incremento é uma versão candidata local, ainda não publicada.
A futura promoção exige composição das contribuições, gates completos, PR revisada e autorização de publicação.
A licença continua pendente de decisão conjunta da ReTech+ e dos estudantes.

## Ajustes do login — 19/10/2026

Esta validação complementa os resultados de 17/10 e não comprova publicação no ambiente online.
O formulário passou a preceder a apresentação institucional no DOM e no layout. O acesso usa
título de primeiro nível e a apresentação complementar usa título de segundo nível.
A identidade visual e a lógica de autenticação foram preservadas.

### Composição e comportamento

| Viewport                | Resultado observado no estado inicial                                      |
| ----------------------- | -------------------------------------------------------------------------- |
| 320 × 640               | Campos e botão Entrar dentro da primeira tela.                             |
| 375 × 812               | Campos e Entrar dentro da primeira tela; botão com altura mínima de 44 px. |
| 390 × 844               | Campos e Entrar dentro da primeira tela.                                   |
| 768 × 1024              | Formulário acima da apresentação complementar.                             |
| 1280 × 720 e 1366 × 768 | Campos e Entrar visíveis inicialmente; o restante pode exigir rolagem.     |
| 1440 × 900              | Conteúdo e rodapé cabem sem rolagem vertical inicial.                      |

As medições consideram zoom padrão, formulário vazio, API disponível e ausência de avisos
ou mensagens de erro. Os dois temas foram verificados. Até 900 px de largura, o conteúdo
complementar aparece abaixo do formulário; acima disso, fica ao lado, após o formulário
na ordem de leitura. No celular, a rolagem até esse conteúdo é intencional.

Janelas baixas, mensagens de erro e leitura ampliada mantêm rolagem nativa.
Não se utiliza bloqueio de altura ou ocultação de conteúdo para eliminar barras de rolagem.
Os ajustes de espaçamento e ilustração foram limitados ao login; não houve mudança
de API, banco, contratos, credenciais, cookies ou permissões.

### Testes da correção e revisão

| Verificação                                       | Resultado observado                                                                                                                                                         |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nova suíte de layout do login                     | 64 casos passaram: sete tamanhos, temas claro/escuro e perfis Desktop Chrome/Pixel 7.                                                                                       |
| Suíte React completa                              | 84 testes em 15 arquivos passaram.                                                                                                                                          |
| Regressão de painel, rolagem e apresentação       | 14 casos passaram na validação inicial da correção. Na conferência seguinte, 13 passaram e um caso móvel de PageDown falhou; esse caso passou ao ser repetido isoladamente. |
| Lint, tipos, build do frontend, formatação e diff | Passaram na conferência posterior à correção.                                                                                                                               |
| Inspeção visual                                   | Login conferido no navegador em 375 × 812 e 1440 × 900, além das capturas claro/escuro da validação inicial.                                                                |

A suíte nova confirma o topo da página e os limites geométricos dos campos e de Entrar
antes de qualquer foco, clique ou rolagem automática. Também cobre ordem de teclado,
foco perceptível, validação sem envio, associação dos erros aos campos, respostas
401/503, resposta inválida, preservação dos valores e bloqueio de envio duplicado.
Os testes negativos interceptam a rede exclusivamente no navegador de teste.

A repetição isolada não elimina a instabilidade observada no ensaio de PageDown.
Essa ocorrência permanece como ponto de acompanhamento para o gate final; não se afirma
que a rodada conjunta de regressão passou integralmente.

### Limites e liberação

Rolagem e acesso aos controles foram exercitados com movimento reduzido, janela
de 375 × 360 e CSS zoom de 200%. A janela baixa aproxima o espaço ocupado por um
teclado virtual, mas não substitui testes em aparelhos físicos. CSS zoom também
não comprova o comportamento de todos os navegadores com zoom nativo.

Não foram certificados Safari, Firefox ou aparelhos físicos, nem realizada auditoria
completa de acessibilidade. Não se declara compatibilidade universal.
A revisão desta correção não repetiu a suíte E2E integral, seed ou migrações.

A correção será incluída por Ricardo na composição final da v0.3, após as contribuições
anteriores. A promoção depende dos gates da composição final, CI e revisão válida;
a publicação em homologação deve ser verificada separadamente.

## Composição final — 21/10/2026

As contribuições foram compostas com o ajuste do login e a correção dos erros de seleção de empresa.
Esta rodada substitui, para o gate local, os resultados anteriores de execução parcial.
Não representa verificação do serviço online nem aprovação técnica dos critérios de SST.

| Verificação           | Resultado observado                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`          | Passou: geração Prisma, lint, tipos, testes e builds.                                                                         |
| Scripts               | 48 testes passaram.                                                                                                           |
| Contratos             | 73 testes passaram.                                                                                                           |
| API unitária e HTTP   | 116 testes passaram; os 44 casos de banco foram executados separadamente.                                                     |
| Integração PostgreSQL | 44 testes passaram em cinco suítes.                                                                                           |
| React                 | 87 testes passaram em 16 arquivos.                                                                                            |
| Prisma                | Schema validado.                                                                                                              |
| Formatação            | `pnpm format:check` passou.                                                                                                   |
| Migrações             | Banco vazio, repetição de deploy/seed e preservação dos dados v0.2 passaram; a proteção do histórico de riscos também passou. |
| Navegação completa    | 116 casos passaram em Chromium, desktop e celular, na mesma rodada, incluindo 64 casos do login e os cenários de PageDown.    |

O erro de seleção de empresa agora aparece também fora da lista de cadastros. Três testes
reproduziram inicialmente a ausência do aviso e passaram após a correção: falha 503, contexto
indisponível (404) e indisponibilidade de rede. A empresa anterior permanece selecionada e
a rota não muda quando a troca falha.

Um teste de leitura do inventário concorria com outro teste que alterava o mesmo registro.
O leitor passou a usar um registro sintético estável, sem alterar as verificações de permissão.
O caso passou em oito repetições entre desktop e celular, e depois na suíte completa.

O build final produziu JavaScript inicial de aproximadamente 178,72 KB gzip,
dashboard sob demanda de 5,21 KB gzip e inventário sob demanda de 9,73 KB gzip.
Permanece o aviso de chunk minificado acima de 500 KB. Não foram medidos Web Vitals em produção.

As validações utilizaram PostgreSQL local isolado e dados sintéticos. Não houve reset do Neon
nem alteração de credenciais. Os limites anteriores de navegadores, aparelhos físicos e
auditoria de acessibilidade permanecem válidos.

A promoção depende de CI e revisão válidas. A publicação exige confirmar o SHA ativo no Render,
aplicar somente a migração aditiva versionada e repetir os checks públicos e as jornadas HTTPS.
