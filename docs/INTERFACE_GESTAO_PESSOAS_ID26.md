# Interface de gestão de pessoas — ID 26

## Integração

`PeopleWorkspace({ organizationId, onExpire })`, exportado de `apps/web/src/components/people/PeopleWorkspace.tsx`, recebe somente a empresa ativa e o callback de sessão encerrada. A integração de rota e navegação pertence ao coordenador. Esta implementação não altera `App`, `Structure`, navegação, schema de banco, contratos ou estilos globais.

A identidade Percurso e o radar consultado no ID 27 foram reutilizados. O painel prioriza população e indicadores; a lista nominal fica em área separada e o cadastro usa o Sheet existente. Os componentes reutilizam Button, Sheet/Dialog, Pagination, StatusMessage e ReferenceSelect. Não foram instalados pacotes.

## Acesso e dados

As capacidades vêm de `GET /auth/session-capabilities`, validadas por `sessionCapabilitiesSchema`. O papel ADMIN e `canManageAccess` não concedem acesso a RH.

| Área                                     | Leitura                                                                                | Escrita                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Overview                                 | `HR_ANALYTICS_READ`                                                                    | Não há escrita                                                   |
| Lista nominal, perfil, vínculos e férias | `HR_PROFILE_READ` ou `HR_PROFILE_MANAGE`                                               | `HR_PROFILE_MANAGE`                                              |
| Remuneração e simulação                  | `HR_COMPENSATION_READ` ou `HR_COMPENSATION_MANAGE`, além do acesso ao cadastro nominal | `HR_COMPENSATION_MANAGE` para remuneração e parâmetros do painel |

Sem grant de RH, a interface mostra bloqueio e não consulta endpoints privados. Revogação detectada por 403 remove o conteúdo privado. Ao retomar a janela, as capacidades são revalidadas; uma mudança no conjunto de grants remonta o contexto privado. A troca de empresa remonta todo o workspace imediatamente. Respostas de outro tenant ou de outro colaborador são rejeitadas antes da renderização. Requisições são canceladas ao desmontar ou trocar o recurso; 401 elimina os dados e chama `onExpire`.

Nomes, salários, datas de nascimento, complementos da simulação e rascunhos ficam apenas em memória. Não são escritos em localStorage, sessionStorage ou URL de navegação. A URL guarda somente área, unidade, setor, situação, competência e página. Filtros inválidos ou duplicados impedem consulta agregada e nominal até correção explícita; não há fallback silencioso para totais gerais. Referências de unidade e setor usam seleção e busca paginadas já existentes.

## Consultas e edições

- Overview: `GET /organizations/:id/people-overview`, usando `peopleOverviewQuerySchema` e `peopleOverviewSchema`. A interface apresenta as nove métricas do DTO, distingue conhecido, insuficiente, suprimido, proibido e não configurado, e não converte ausência em zero. Cada gráfico de distribuição acompanha tabela visível equivalente. O hook GSAP existente recebe os dados efetivamente consultados.
- Lista nominal: `GET /organizations/:id/people/employees`, com `employeeQuerySchema` e `employeeListSchema`, mantendo o shape legado e páginas de 25. A seleção do colaborador permanece em memória.
- Perfil: `GET` e `PUT /organizations/:id/employees/:employeeId/hr-profile`, com `hrProfileSchema` e `updateHrProfileSchema`. A primeira gravação usa versão zero.
- Históricos: `GET`/`POST` em `employment-periods`, `remunerations` e `vacation-periods`, sob o mesmo colaborador, e `PATCH /:id`. Listas paginadas em 25 e schemas próprios de entrada/resultado. Férias permitem até três usos, datas de pagamento e indicação explícita de histórico conhecido. Não há DELETE.
- Simulação: `POST /organizations/:id/employees/:employeeId/settlement-preview`, com `settlementRequestSchema` e `settlementResultSchema`. Salário e admissão vêm exclusivamente dos registros persistidos da API. A interface recebe complementos confirmados de dias, 13º, período aquisitivo, faltas e FGTS, oferece os doze meses do ano de referência e mantém valores desconhecidos em branco. Resultado parcial mostra parcelas conhecidas, pendências e limitações, sem inventar total bruto. Editar qualquer entrada invalida o resultado anterior, inclusive se a requisição anterior ainda estiver em andamento.

Todos os formulários versionados requerem fonte e motivo. Erros recuperáveis preservam o rascunho; conflito 409 bloqueia nova gravação até a pessoa carregar e comparar a versão atual, confirmar a revisão e então salvar explicitamente. Não existe sobrescrita automática nem nova tentativa silenciosa.

## Parâmetros explícitos para o painel

Com `HR_COMPENSATION_MANAGE`, a simulação oferece “Salvar parâmetros para o painel”. A interface consulta `GET /employees/:id/settlement-parameters?referenceDate=YYYY-MM-DD` e grava por `PUT`, usando `settlementParametersSchema` e `writeSettlementParametersSchema`. Ausência de registro é resposta nullable e primeira escrita usa `expectedVersion: 0`.

Os parâmetros persistem somente por essa ação explícita, com fonte, motivo e controle de versão. A simulação isolada não grava dados. O conflito de parâmetros também preserva entradas e exige revisão. A API continua responsável por permissões, auditoria, política de cálculo e regras de agregação; a interface não recalcula rescisão nem infere depósitos ou adiantamentos.

## Verificações

O ciclo TDD começou com um componente de scaffold sem comportamento e quatro testes executados em Red por ausência dos estados e operações esperados. Novos Reds foram observados para invalidação de resultado após edição, persistência de parâmetros, referências legíveis, bloqueio de filtros inválidos/duplicados e rejeição de resposta de outro colaborador.

Comando de suíte focal, a partir do worktree, usando `TEMP` e `TMP` apontados para `tmp`:

```powershell
node --experimental-import-meta-resolve apps/web/node_modules/vitest/vitest.mjs run --config tmp/id27-vitest.config.mjs src/PeopleWorkspace.test.tsx
```

A configuração transitória de Vitest em `tmp` contorna a resolução de módulos no caminho local Windows sem alterar a configuração versionada. Os testes usam somente dados sintéticos e mocks na fronteira HTTP. Cobrem bloqueio sem grants, estados privados das métricas, tabela equivalente, paginação, filtros recuperáveis e inválidos, conflito de perfil, simulação parcial e invalidação, persistência de parâmetros, revogação, troca de tenant, resposta de colaborador incorreto e criação/edição dos três históricos com versões 0 e 1.

Checks complementares:

```powershell
node node_modules/typescript/bin/tsc --noEmit --project apps/web/tsconfig.json
node node_modules/eslint/bin/eslint.js apps/web/src/components/people apps/web/src/PeopleWorkspace.test.tsx --max-warnings 0
node node_modules/prettier/bin/prettier.cjs --check apps/web/src/components/people apps/web/src/PeopleWorkspace.test.tsx docs/INTERFACE_GESTAO_PESSOAS_ID26.md
```

## Limites e gate visual

O CSS local usa os tokens claro/escuro existentes, colunas que refluem, tabelas de largura limitada, controles de 44 px e Sheet rolável. A inspeção visual integrada em 320 px, desktop, zoom e nos dois temas depende do build/preview do coordenador e permanece **não verificada nesta entrega**. Os testes de componente não demonstram ausência de overflow renderizado nem conformidade global de acessibilidade.

| Eixo                  | Evidência                                                                                    | Estado                                                         |
| --------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Identidade e verdade  | Percurso reutilizado; conteúdo vem dos DTOs e ausência não vira zero                         | Verificado por código e testes; visual pendente                |
| Hierarquia e tarefa   | Indicadores separados do cadastro nominal e das permissões de remuneração                    | Fluxo coberto por testes; visual pendente                      |
| Tipografia e voz      | Manrope e papéis tipográficos dos tokens existentes                                          | Inspeção visual pendente                                       |
| Espaço e composição   | Grid local flexível, registros e tabelas delimitados                                         | Inspeção em browser pendente                                   |
| Física e motion       | Hook GSAP existente recebe dados reais, sem novo motor                                       | Comportamento visual/reduced motion pendente                   |
| Acesso e estados      | Rótulos, tabela equivalente, primitiva de diálogo, bloqueio por grants e recuperação de erro | Testes de componente; teclado/contraste renderizados pendentes |
| Responsive e contexto | CSS local prevê reflow e rolagem do Sheet                                                    | 320 px, zoom e ambos os temas pendentes                        |

Não houve commit, push, deploy, instalação de dependências ou geração de nova marca.

## Integração final de Plataforma e Relatórios

A Administração da plataforma separa visão global, catálogo paginado, correção assistida e concessões. A correção exige motivo e versão, preserva o rascunho em conflito e identifica o cliente. O recorte do catálogo fica na URL. A visão global continua independente dos filtros de catálogo. Gestão de Pessoas identifica CNPJ e estado fiscal no resumo e no mapeamento nominal.

Relatórios distinguem o contexto da empresa e o global. A criação exibe o snapshot da resposta POST, enquanto a reabertura valida o escopo e o identificador retornado. A prévia leva o foco ao título, preserva rótulos e limitações da emissão e mantém a tabela acessível por teclado. O PDF usa a mesma emissão. Falhas de escopo, fila e tempo de geração têm mensagens específicas; o cliente admite até 35 segundos para receber o PDF, acima do limite de geração de 30 segundos do serviço. Seções detalhadas e dados financeiros seguem as opções previstas nos contratos de emissão.

O build de produção foi inspecionado com Playwright/Chromium e fixtures sintéticas. A política local bloqueou o tráfego de loopback, então o navegador recebeu os arquivos do build e as respostas de API por interceptação. Login, Pessoas, Plataforma e prévia de relatório foram verificados em 320, 375, 390, 768, 1280 e 1440 px nos dois temas. As quatro áreas passaram no reflow com zoom CSS de 200% e viewport de 640 px. Os cenários também confirmaram a fonte local carregada, o foco na prévia e a mensagem de supressão com categoria protegida sem gráfico. O zoom nativo do navegador e uma sessão contra a API real não fizeram parte dessa prova visual.

SST mantém o recorte por unidade e setor. Situação cadastral, competência e opções de RH são exclusivas de Gestão de Pessoas. As duas emissões da empresa começam com todas as seções do tipo marcadas. Personalizar envia apenas as chaves selecionadas, e uma seleção vazia impede a emissão. Em Relatórios da plataforma, a opção de detalhes acrescenta o catálogo ao resumo global.

Em Pessoas, linhas de distribuição por unidade e setor com contagem divulgada abrem a lista apenas para quem possui leitura ou gestão de perfil de RH. A lista volta à primeira página e preserva os filtros aplicáveis ao recorte. A navegação transfere foco para o título da lista. O cadastro de férias informa os valores aceitos para dias de direito no cenário CLT suportado.
