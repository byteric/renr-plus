# Verificação local da v0.3

Data: 17/10/2026. Base de comparação: `main` em `fc299b1fe60ae72c07e194cfd3c44f59491f9952`.
As verificações abrangem alterações locais ainda sem commit; não comprovam publicação no ambiente online.

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

## Liberação

Este incremento é uma versão candidata local, ainda não publicada.
A futura promoção exige composição das contribuições, gates completos, PR revisada e autorização de publicação.
A licença continua pendente de decisão conjunta da ReTech+ e dos estudantes.
