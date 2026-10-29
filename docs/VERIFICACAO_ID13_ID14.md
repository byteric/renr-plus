# Atribuição e acompanhamento de ações — IDs 13 e 14

Estado em 26/10/2026: implementação local concluída e verificada.
Este relatório não confirma publicação em homologação.

## Comportamento entregue

A ação preserva o responsável nominal, inclusive externo, e admite uma atribuição
opcional ao vínculo ativo de um usuário da mesma empresa. Criar a medida com essa
atribuição é uma única operação atômica. “Minhas ações” utiliza a identidade da
sessão e aplica o filtro antes da paginação; nomes não determinam acesso.

ADMIN gerencia ações e atribuições. O executor precisa de vínculo ativo, capacidade
explícita `EXECUTE_ASSIGNED_ACTIONS` e atribuição persistida. Pode iniciar execução,
informar implementação, registrar acompanhamento e anexar evidências. Não pode
editar os campos de gestão, cancelar, reatribuir, arquivar anexos ou decidir
tecnicamente. A autorização é conferida novamente dentro da transação.

Continuam válidos os estados PLANNED, IN_PROGRESS, IMPLEMENTED e CANCELLED.
Atraso é uma condição calculada pelo prazo civil e pelo fuso da empresa.
IMPLEMENTED registra execução informada; não comprova eficácia nem encerra a medida.

A interface oferece lista filtrável, contexto e pendências, detalhe com resumo,
resultado esperado, critério de aferição, acompanhamento e histórico. A composição
usa conteúdo operacional principal e coluna contextual no desktop, empilhados no
mobile. A prioridade é exibida somente quando a avaliação técnica está vigente e
o contexto da ação permanece compatível. Métodos distintos não são comparados.

## Persistência e compatibilidade

- Migrações aditivas `20261025020000_action_assignments` e
  `20261025030000_action_assignment_history_integrity`, aplicadas somente no banco
  local isolado de verificação. Nenhuma migração anterior foi reescrita.
- Atribuição usa a chave composta usuário/organização do vínculo. O nome registrado
  é preservado e pode ser distinguido do nome atual; desativar não apaga histórico.
- Mudança de atribuição exige versão, justificativa e revisão correspondente na
  mesma transação. O SQL verifica os valores anterior/próximo e rejeita histórico
  inventado, vínculo estrangeiro/inativo e reatribuição terminal.
- Os DTOs estritos legados, snapshots e eventos de ação/revisão/evidência permanecem
  preservados. Projeções aditivas usam `action-workspaces`; `assignmentChange` fica
  separado do snapshot legado. Registros anteriores permanecem sem atribuição inferida.
- A ordem de bloqueio é organização, vínculos em ordem estável, ação e evidência.
  Reatribuição, revogação e envio concorrentes mantêm a verificação de autoridade.

Rotas, payloads e projeções estão no
[contrato de implementação](plans/IMPLEMENTACAO_ID13_ID14.md).

## Evidências executadas

| Verificação                                | Resultado                                                                                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos focais                           | 5 testes aprovados: compatibilidade, filtro pessoal, campos permitidos e transições                                                            |
| HTTP específico                            | 11 testes aprovados com aplicação Nest, PostgreSQL e MinIO locais; incluem upload privado, download idêntico, conflito e revogação concorrente |
| Integridade SQL                            | 15 testes aprovados, incluindo ausência de alteração retroativa ao renomear e rejeição de atribuição anterior fictícia                         |
| Migrações                                  | Aprovadas em banco vazio, deploy/seed repetidos e expansões sobre registros preenchidos; nenhum responsável inferido para ações antigas        |
| Schema Prisma                              | Válido                                                                                                                                         |
| Check geral                                | Aprovado: geração Prisma, lint, tipos, 52 testes de scripts, 112 de contratos, 155 de API, 219 de frontend e build de produção                 |
| Integração e persistência completas        | 15 suítes aprovadas; 135 testes aprovados, sem ignorados                                                                                       |
| Compatibilidade e rollback                 | Consumidores congelados v0.3 aceitos pela API ampliada; aplicação antiga leu/editou dados e a atual retomou com histórico preservado           |
| UI com fixtures sintéticas                 | 32 testes aprovados nos temas claro/escuro, incluindo contraste dos estados de erro/execução, foco, retorno, reflow e recuperação              |
| Jornada E2E compilada e regressão completa | 162 cenários aprovados: 81 desktop e 81 mobile, sem retries; inclui criação, atribuição, execução, nota, anexo privado, isolamento e logout    |

Houve Red observado antes das correções: rota inexistente, aceitação SQL de
histórico anterior falso e envio de evidência habilitado durante atualização da
versão. O formulário preserva texto e arquivo em falha recuperável e aguarda a
versão autoritativa. Resposta 401/403/404 na revalidação deve ocultar o detalhe e
descartar os rascunhos; falha temporária 503 permite recuperação. Conflito 409
exige consultar e revisar o registro antes de reenviar, sem sucesso antecipado.

A revisão independente encontrou uma negação de leitura não propagada pela consulta
de atribuição e cabeçalhos de tabela invertidos. Ambos foram corrigidos, com Red/Green
e releitura independente. Os testes também cobrem a negação tardia: uma resposta de
sucesso iniciada anteriormente não pode restaurar o detalhe; é necessária nova
consulta explícita bem-sucedida. Duas fixtures antigas de recuperação foram adaptadas
à projeção `action-workspaces`, mantendo suas asserções de erro e recuperação.

Os cenários E2E legados de evidência, diagnóstico e rolagem passaram a selecionar
explicitamente a organização de suas fixtures. A sessão de um usuário com vários
vínculos não pode ser tratada como se sempre escolhesse a primeira empresa do seed.
As asserções de isolamento, integridade e navegação foram mantidas.

## Inspeção visual delimitada

As jornadas compiladas executaram em Chromium, com desktop e Pixel 7 emulado,
PostgreSQL e MinIO locais. Não houve teste em aparelho físico.

Os testes de interface usam dados sintéticos e os temas existentes, sem trocar
identidade global nem instalar motor de animação. Capturas locais ficam em
`tmp/id13-ui-evidence`; logs de verificação ficam em `tmp/id13-*.log`.

| Eixo                | Estado e evidência                                                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anti-slop e verdade | Aprovado no recorte: prioridade e pendências vêm de projeções validadas; ausência de avaliação não vira risco baixo; eficácia/encerramento indisponíveis são explícitos                                          |
| Hierarquia e tarefa | Aprovado no recorte: medida e execução no conteúdo principal; origem, prioridade e pendências na coluna contextual                                                                                               |
| Tipografia e voz    | Aprovado nas capturas: tokens existentes, rótulos funcionais e textos extensos legíveis                                                                                                                          |
| Espaço e composição | Aprovado nas larguras verificadas: conteúdo empilhado no mobile e tabela com rolagem local                                                                                                                       |
| Física e movimento  | Verificação parcial: foco, retorno e redução de movimento cobertos; desempenho de quadros não medido                                                                                                             |
| Acesso e estados    | Aprovado no recorte: cabeçalhos alinhados, nomes/foco/recuperação e descarte ao perder acesso cobertos; contraste de erro/execução medido nos dois temas. Contraste integral e certificação WCAG não verificados |
| Responsividade      | Aprovado nas fixtures de 320, 375, 390, 768, 1280 e 1440 px e zoom CSS 200%; zoom nativo e todas as condições de rede não verificados                                                                            |

## Limites

Este incremento não implementa parecer de eficácia, encerramento técnico, relatório
regulamentar ou upload recuperável online. A verificação de arquivos usa MinIO
local, sem modificar Neon, Supabase ou Render. A validação dos métodos para uso real
continua dependendo do responsável técnico; o seed normal não cria aprovação.

Uma evidência anexada, um prazo cumprido ou uma execução informada não substituem
análise técnica. Não se declara conformidade jurídica, auditoria completa de
acessibilidade, desempenho de produção ou disponibilidade no ambiente remoto.

O build mantém o aviso de um chunk principal de aproximadamente 577 kB minificado
(186 kB gzip). O desmembramento amplo e a medição de desempenho permanecem no ID 30;
o limite do aviso foi preservado.
