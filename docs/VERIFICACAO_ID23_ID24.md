# Verificação local dos IDs 23 e 24

Validação em 03 e 04/11/2026 com PostgreSQL e MinIO locais, build compilado e dados sintéticos. O ID 23 acrescenta consultas de leitura sobre os registros existentes. O ID 24 consome essas consultas no Painel e aplica a assinatura Percurso no cabeçalho e no favicon.

A base Git local `823eaac` tem a mesma árvore da revisão de homologação `3de32b1`, conforme `git diff`. Os IDs 21 e 22, já presentes na árvore de trabalho, fornecem a dependência local de auditoria.

## Aceite funcional

| Requisito                                                           | Evidência                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classificados, não classificados e distribuição fecham o inventário | Contrato com invariantes geradas em `management-indicators.test.ts`. Consultas de inventário por ausência de classificação e por versão e nível conferidas com o banco.                                                                                           |
| Atraso é subconjunto das ações abertas e eficácia segue o detalhe   | `actions.integration.spec.ts` reconcilia os atrasos e verifica cancelamento, escopo, leitura e paginação. `risk-continuity.integration.spec.ts` confirma encerramento vigente e retorno à pendência após arquivar a evidência selecionada.                        |
| Série provém de eventos registrados e usa o calendário da empresa   | Avaliações, execução e encerramento conferidos em fluxos reais. Casos de offset ISO e meia-noite repetida por mudança de horário passaram após a correção.                                                                                                        |
| Privacidade                                                         | Endpoints exigem sessão e empresa ativa. Unidades de outro escopo são negadas e leitores não recebem os totais de colaboradores. Os gráficos usam registros operacionais e decisões técnicas. Resultados coletivos continuam sob a projeção protegida em Coletas. |
| Quatro áreas e retorno ao recorte                                   | Jornadas reais de teclado e toque verificam a Visão geral inicial, links para listas filtradas, retorno de ação, recarregamento, filtros e histórico separado.                                                                                                    |
| Falha parcial                                                       | Falha no histórico mantém a distribuição ou o resumo operacional. Testes conferem estado vazio, recuperação, expiração e descarte de resposta após troca de empresa.                                                                                              |
| Reflow B02                                                          | Título, data de referência e link de consulta da seção Ações preventivas têm caixas sem sobreposição. Verificado em 320, 375, 390, 768, 1280 e 1440 px, nos temas claro e escuro. Jornada ampliada a 200% e rolagem nativa verificadas.                           |

## Verificação visual

Filtros organizacionais inválidos ou duplicados são enviados à validação da API e exibem recuperação pela ação Limpar filtros. O painel oculta os totais enquanto o recorte é inválido.

| Eixo              | Resultado no painel                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aderência e dados | Capturas do build mostram indicadores da API e assinatura vetorial Percurso. A composição segue a referência de métricas, evolução e prioridades, com as áreas secundárias separadas. |
| Hierarquia        | Visão geral apresenta empresa, filtros, quatro indicadores e prioridades paginadas. As áreas de risco, ação e estrutura aparecem mediante navegação.                                  |
| Tipografia e voz  | Manrope e escala já adotadas, com estados operacionais, técnicos e históricos nomeados separadamente.                                                                                 |
| Espaço            | Leitura e foco preservados em tela estreita e zoom. Nomes longos têm leitura integral abaixo do seletor quando necessário.                                                            |
| Movimento         | GSAP anima barras e séries de dados. Movimento reduzido mantém os traçados no estado final. A navegação usa a rolagem da página.                                                      |
| Acesso e estados  | Links e controles nativos, estado ativo na navegação, rótulos explícitos e tabelas equivalentes aos gráficos.                                                                         |
| Responsividade    | Capturas reais em claro e escuro verificam o cabeçalho com assinatura ou símbolo, síntese, prioridades e gráficos em desktop e mobile.                                                |

## Testes

- `pnpm check` aprovado. Passaram 60 verificações de scripts, 148 de contratos, 173 da API e 306 do front.
- `pnpm test:integration` aprovado com 235 testes de banco e a jornada de reconciliação do CLI. Verificações focais adicionais comprovaram a segunda página de prioridades e o total por nível.
- `pnpm prisma:validate`, `pnpm format:check` e `git diff --check` aprovados.
- `pnpm test:migrations` aprovado. As 18 migrações da árvore foram aplicadas em base vazia, com repetição de deploy e seed e 13 verificações em bases preenchidas.
- Vinte jornadas focadas no build do painel passaram, dez no desktop e dez no perfil mobile. Três verificações visuais adicionais cobriram nomes extensos, movimento reduzido em 320 px e estabilidade do cabeçalho durante o carregamento da logo.
- A marca passou a usar uma única imagem responsiva com dimensões reservadas. O teste de carregamento reproduziu o salto anterior de 12,47 px e passou após a correção. Os 22 testes React focais do aplicativo e do painel também passaram.
- A verificação focal final do painel passou em oito testes React e dez jornadas reais, cinco no desktop e cinco no perfil mobile, incluindo filtros inválidos e duplicados.
- A regressão completa de 03/11 aprovou 86 cenários desktop. Na rodada mobile de 04/11, 86 cenários passaram e a espera do teste da série capturou uma resposta anterior de 30 dias. A espera passou a identificar o intervalo solicitado de sete dias e foi verificada em ambos os perfis. Os fluxos de login afetados pelo cabeçalho e o cadastro nominal passaram em 34 jornadas focais finais, 17 por perfil.

O build final do front, executado por `pnpm --filter @renr/web build`, mediu 190,09 kB gzip na entrada inicial. A rodada de `check` que herdava `NODE_ENV=development` do arquivo local da API havia medido 256,66 kB. Esses resultados têm configurações diferentes. O aviso sobre chunks acima de 500 kB minificados permanece. A medição de desempenho integrada continua prevista no ID 30.

[Contrato de indicadores](API_INDICADORES.md)
