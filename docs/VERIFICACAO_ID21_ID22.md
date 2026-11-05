# Auditoria e histórico unificado — IDs 21 e 22

Implementação local em 29/10/2026. Concluídos e verificados localmente. Sem publicação, commit ou alteração de serviços externos.

## Comportamento entregue

A consulta administrativa permite filtrar eventos por período civil inclusivo, recurso, operação e autor. As datas seguem o fuso da organização, inclusive em mudanças de horário de verão. Itens e contagem pertencem ao mesmo snapshot; a ordenação usa data e ID para desempate. Cada requisição de página consulta um novo snapshot, portanto novas operações podem deslocar páginas posteriores.

O histórico do risco inclui suas alterações, avaliações e ações relacionadas. O histórico da ação reúne revisões operacionais, atribuições, notas, evidências, pareceres, encerramentos e a ligação com uma nova ação corretiva. A revisão de criação aparece uma vez; a avaliação produzida por uma reavaliação é apresentada na entrada correspondente, evitando duplicação.

Decisões e revisões abrem pelo identificador exato, inclusive fora da primeira página. Os detalhes têm campos explícitos e limitados. Registros diretos de risco e ação mostram seu cadastro atual e não afirmam reconstruir versões antigas. Eventos legados sem referência explícita continuam visíveis, sem vínculo de revisão inventado.

ADMIN consulta a auditoria administrativa; membros com leitura da origem consultam seu histórico. Vínculo e papel são revalidados no snapshot. Alterações de acesso não entram no histórico operacional. Não são retornados senhas, tokens, hashes, respostas individuais, binários ou JSON arbitrário de snapshots.

Na interface, filtros, página e seleção ficam na URL. Abrir e fechar um registro preserva o recorte e devolve o foco. Operações rápidas mesclam a URL atual, evitando perder filtros antes do evento de navegação. Negação de acesso no histórico ou registro remove também os dados anteriores do detalhe pai. O menu maior mantém o seletor de empresa acessível por rolagem nativa.

## Evidências

| Requisito           | Prova executada                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos e erros   | 12 testes específicos de auditoria; filtros estritos, referências discriminadas e fuso IANA válido.                                                                                                     |
| Auditoria com banco | 23 testes focais de HTTP/PostgreSQL, incluindo período/DST, empate de data, paginação, tenant, autorização, registros exatos e fontes técnicas.                                                         |
| Atomicidade         | Falha injetada no append de auditoria reverte a alteração da ação e sua revisão. Consulta e contagem mantêm o snapshot durante append concorrente.                                                      |
| Continuidade        | Criação corretiva filtrável pelo ID da nova ação e encontrada também no histórico da ação anterior, uma vez no histórico do risco.                                                                      |
| Componentes         | Check completo: 311 testes do frontend, 146 de contratos, 171 de API sem banco e 60 dos scripts.                                                                                                        |
| Integração geral    | 231 testes de integração/persistência e um teste do CLI de conciliação aprovados.                                                                                                                       |
| Migração            | 13 verificações aprovadas: banco vazio, repetição de deploy/seed e migrações preenchidas. O teste novo compara contagens e hashes de todas as projeções anteriores; metadados legados permanecem nulos. |
| Interface           | 43 cenários aprovados. Auditoria nos dois temas em 320, 390, 768 e 1440 px; teclado, foco, URL, nomes extensos, justificativas longas e contraste de texto/botão.                                       |
| Jornada real nova   | Aprovada em desktop e mobile: 22 notas, abertura de revisão antiga, filtros, leitor, isolamento e logout. Regressão geral: 86 jornadas desktop e 86 mobile aprovadas.                                   |

Testes de comportamento falharam antes das correções de rota ausente, propagação de negação, URL concorrente e referência/continuidade de corretiva. O teste visual existente também reproduziu a inacessibilidade do seletor com o menu ampliado.

A revisão independente não encontrou defeitos remanescentes após os ajustes de autorização, referência corretiva, URL e rolagem. Essa revisão por código é distinta das execuções listadas acima.

## Gate visual no escopo do histórico e da auditoria

| Eixo                  | Estado             | Evidência                                                                                                                                                                    |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verdade e identidade  | Aprovado           | Eventos e datas vêm dos contratos; legados sem revisão não recebem destino inventado; sistema visual atual preservado.                                                       |
| Hierarquia e tarefa   | Aprovado           | Filtros precedem a linha do tempo; recurso, autoria e justificativa separados; identificadores técnicos em expansão opcional.                                                |
| Tipografia e voz      | Aprovado           | Papéis do sistema mantidos; operações conhecidas em português; nomes e justificativas extensos inspecionados nas capturas.                                                   |
| Espaço e composição   | Aprovado           | Reflow em uma coluna no mobile, sem overflow horizontal; registro em diálogo com rolagem própria.                                                                            |
| Movimento             | Aprovado no escopo | Sem motor ou movimento decorativo novo; navegação e scroll nativo preservados; reduced motion exercitado. Taxa de quadros global não medida.                                 |
| Acesso e estados      | Aprovado no escopo | Teclado, foco, carregamento, vazio, erro e perda de acesso testados; data e botão com contraste mínimo de 4,5:1 nos dois temas.                                              |
| Responsive e contexto | Aprovado no escopo | Capturas reais de viewport em desktop/mobile e ambos os temas; filtros e seleção preservados; revisão antiga aberta em jornada real. Aparelho físico/Safari não verificados. |

## Migrações e limites

A migração `20261029090000_audit_history_references` acrescenta campos opcionais, constraints de referência em par/versão positiva e índices. Não substitui dados, não infere revisões passadas e não cria endpoints de edição/exclusão da auditoria.

O teste histórico da migração de continuidade prepara registros com a projeção de auditoria anterior ao ID 21. Essa adaptação mantém o cenário de schema antigo; não afirma que a aplicação nova funciona antes de suas migrações obrigatórias.

O build mantém o aviso de chunk acima de 500 kB; a entrada medida é 826,84 kB, 255,79 kB gzip. A otimização e seu orçamento continuam na frente de desempenho do ID 30. Não houve aumento do limite para esconder o aviso.

Inspeção visual e emulação Chromium não equivalem a teste em aparelho físico/Safari nem a uma auditoria WCAG global. Dados e contas de teste são sintéticos. A homologação permanece na versão publicada anterior até promoção autorizada.

## Referências

- [Contrato HTTP e permissões](API_AUDITORIA.md)
- [Plano de implementação](plans/IMPLEMENTACAO_ID21_ID22.md)
- [Contratos compartilhados](../packages/contracts/src/audit.ts)
- [Teste de preservação da migração](../scripts/audit-migrations.test.mjs)
