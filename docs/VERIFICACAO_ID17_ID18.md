# Reavaliação e encerramento técnico — IDs 17 e 18

Estado em 27/10/2026: concluído e verificado localmente. Não confirma publicação.

## Comportamento entregue

A reavaliação cria uma nova avaliação técnica e preserva o vínculo com a avaliação
imediatamente anterior, as medidas consideradas e os pareceres correspondentes.
As duas avaliações mantêm método, entradas, classificação, prioridade, fontes,
contexto, justificativa e autoria. Somente versões idênticas de método permitem
comparação direta; mudar o método ou sua versão é sinalizado como incompatível.
O sistema não calcula redução percentual nem presume melhora a partir dessa mudança.

O encerramento técnico é um registro próprio e imutável. Exige capacidade explícita
`TECHNICAL_DECISIONS`, origem ativa, ação IMPLEMENTED, parecer EFFECTIVE vigente e
reavaliação ligada à última avaliação do risco que considere a mesma medida e o
mesmo parecer. Não altera o status nem a versão operacional da ação. Não eficaz e
inconclusivo não encerram. Não é obrigatório reduzir numericamente uma classificação
nem repetir o método para registrar uma decisão fundamentada.

A interface permite preparar, revisar e confirmar a reavaliação, o encerramento e
a nova ação corretiva. A corretiva exige também ADMIN operacional, cria outro
registro PLANNED e um vínculo com a ação anterior; não reabre nem sobrescreve a
origem. Responsabilidade nominal não concede acesso. O histórico permite consultar
qualquer avaliação e encerramento anterior.

## Integridade e concorrência

A migração aditiva `20261027000000_risk_continuity` acrescenta quatro tabelas:
`risk_reassessments`, `reassessment_measures`, `action_technical_closures` e
`action_corrective_links`. As referências compostas limitam organização e recurso;
as decisões e os vínculos são append-only. Avaliação, medidas, vínculo e auditoria
são gravados na mesma transação de sua operação. Falha de auditoria reverte toda
a operação, incluindo versões do risco e revisões das ações quando aplicável.

Os locks seguem organização, vínculo de acesso, risco, ações em ordem, hierarquia
e provas. Reavaliar serializa as ações do risco; um trigger aditivo aplica a mesma
ordem ao fluxo anterior de avaliações. Precondições de versão, predecessor,
parecer e contexto são conferidas novamente sob lock. Mudança relevante antes da
confirmação retorna 409; revogação de capacidade ou papel impede a gravação.

Encerramentos são consultados como CURRENT, SUPERSEDED ou REVIEW_REQUIRED, com
motivos explícitos. Nova avaliação, parecer substituído, mudança técnica ou prova
selecionada retirada/alterada exige revisão sem apagar referências ou o pacote de
provas preservado. Notas comuns, prazo, atribuição e anexos não selecionados não
invalidam a decisão por si. Renovar uma decisão exige nova confirmação e preserva
a sucessão anterior.

Contrato dos endpoints, payloads e permissões:
[plano de implementação](plans/IMPLEMENTACAO_ID17_ID18.md).

## Evidências de validação

| Verificação                         | Resultado atual                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos e propriedades            | 6 testes focais aprovados; comparação, referências únicas e precondições                                                                                          |
| HTTP focal                          | 22 testes aprovados; permissões, cadeia, encerramento, corretiva, prova retirada, concorrência e rollback de auditoria                                            |
| SQL focal                           | 16 testes aprovados; autoridade, integridade, imutabilidade, 20 medidas, provas e corridas com duas conexões                                                      |
| Integração e persistência completas | 19 suítes e 200 testes aprovados, sem ignorados                                                                                                                   |
| Migrações                           | 16 migrações aplicadas em banco vazio; deploy/seed repetidos; preservação de bases preenchidas aprovada, incluindo decisões e auditoria anteriores ao ID 17       |
| Prisma                              | Schema válido; comparação sem divergência nova. Permanecem dois defaults anteriores de instrument_versions, fora deste incremento                                 |
| Frontend focal                      | 37 testes aprovados: reavaliação, encerramento, corretiva, confirmação, rascunhos e perda de acesso                                                               |
| Compatibilidade e retorno           | Consumidores congelados v0.3 e aplicação anterior aprovados sobre o schema ampliado; retorno à API atual com históricos preservados                               |
| Apresentação com fixtures           | 38 testes aprovados nos dois temas; inclui reflow, teclado, comparação, confirmação, corretiva e contraste dos textos/controles principais                        |
| Check geral                         | Aprovado: geração Prisma, lint, tipos, 52 testes de scripts, 126 de contratos, 155 de API, 279 de frontend e build de produção                                    |
| E2E real focal                      | 4 cenários aprovados: reavaliação, encerramento, corretiva e permissão em desktop/mobile, com API, PostgreSQL e MinIO reais                                       |
| E2E completo em lotes               | 166 cenários aprovados: 83 desktop e 83 mobile, sem retries; o arquivo de acessos também passou novamente nos dois perfis após sincronização da troca de contexto |
| Formatação e diff                   | Aprovados; index vazio e base Git preservada, sem commit ou publicação                                                                                            |

As verificações de preservação usam um banco temporário, os fluxos HTTP legados
da API compilada sobre o schema anterior ao ID 17 e comparação de contagens e
hashes das tabelas legadas.
Não desativam triggers nem inferem reavaliações/encerramentos para registros antigos.

Red foi observado nas novas rotas inexistentes e nas proteções SQL antes da
implementação. As revisões encontraram perda de rascunho ao atualizar
o risco e descarte silencioso de uma resposta de criação após atualização paralela
do contexto. Os dois casos foram corrigidos com regressivos aprovados. A revisão
independente do delta não encontrou novo defeito confirmado.

Os lotes E2E usam o mesmo build compilado, Chromium desktop e emulação Pixel 7,
com uma API nova por lote. O desktop completo passou antes da última alteração
exclusiva de teste: aguardar a rota de unidades antes de abrir o menu após trocar
de empresa. O arquivo de acessos modificado passou novamente em desktop e mobile,
e o lote mobile completo final passou com os 83 cenários. Nenhuma alteração de
produção ocorreu entre esses lotes. Os testes de cadastro também passaram a usar
a busca real da lista paginada, preservando o percurso por teclado e as asserções.
Não foram ampliados timeouts, limites de login ou retries.

Logs locais: `tmp/id17-check-green.log`, `tmp/id17-integration.log`,
`tmp/id17-migrations.log`, `tmp/id17-compatibility-final.log`,
`tmp/id17-ui-green.log`, `tmp/id17-e2e-green.log`,
`tmp/id17-access-transition.log` e `tmp/id17-e2e-mobile-final.log`.

## Inspeção visual delimitada

Foram inspecionadas capturas da comparação no celular, nos temas claro e escuro,
e da revisão de encerramento em desktop. A leitura distingue anterior/atual,
método, entradas, classificação, autoria e fontes. No detalhe da ação, execução,
eficácia e encerramento mantêm estados e controles distintos. Os artefatos
sintéticos permanecem locais em `tmp/id17-ui-evidence`.

| Eixo                | Estado e evidência                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anti-slop e verdade | Aprovado no recorte: dados provêm dos contratos; método incompatível é explicado e nenhum percentual de redução é inventado                                                                                      |
| Hierarquia e tarefa | Aprovado: preparação, revisão e confirmação explícitas; comparações rotuladas e versões antigas consultáveis; requisitos pendentes explicados                                                                    |
| Tipografia e voz    | Aprovado nas capturas: tokens existentes, títulos e metadados com papéis distintos, textos funcionais e estado também por escrito                                                                                |
| Espaço e composição | Aprovado no recorte: comparação adapta colunas à largura disponível; conteúdo e identificadores extensos quebram linha e continuam consultáveis                                                                  |
| Física e movimento  | Aprovado no recorte de continuidade: foco após revisão, navegação nativa e reduced motion preservados; nenhum motor ou animação contínua acrescentado. Taxa de quadros não medida                                |
| Acesso e estados    | Aprovado no recorte: rascunhos, erros, conflito, confirmação e descarte privado cobertos. Contraste dos textos de revisão, campo e botões principais ≥4,5 nos dois temas. Não equivale a auditoria WCAG integral |
| Responsividade      | Aprovado nas fixtures de 320, 375, 390, 768, 1280 e 1440 px e zoom CSS de 200%, com teclado; zoom nativo e dispositivo físico não verificados                                                                    |

## Limites

Dados, métodos e provas dos testes são sintéticos. As verificações usam PostgreSQL
e MinIO locais; não alteram Neon, Supabase ou Render. Não houve commit, push ou
publicação. Uploads online recuperáveis permanecem no ID 19; identidade global,
dashboard e orçamento de desempenho continuam nos IDs correspondentes do plano.

Uma decisão registrada não certifica habilitação profissional, metodologia ou
conformidade legal. Uso real depende das validações dos responsáveis.

O build preserva o aviso do chunk principal acima de 500 kB minificados:
586,57 kB, ou 188,14 kB gzip. O limite do aviso não foi aumentado. Medições de
desempenho e divisão adicional do bundle permanecem no ID 30. Os testes também
emitem os avisos existentes de módulos experimentais do Jest/Node e de consultas
concorrentes no cliente PostgreSQL; não foram tratados como resultados de sucesso
nem ocultados dos logs.
