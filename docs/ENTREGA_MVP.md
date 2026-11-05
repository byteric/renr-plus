# Entrega do MVP ReNR+

## Rastreabilidade do P0

A numeração RF desta matriz segue a seção 14 do PRD completo da residência. Os IDs das evoluções identificam a implementação. Os testes indicados mostram onde verificar os critérios e devem ser executados no mesmo código candidato à entrega.

| Requisito                                 | Evoluções           | Evidência de verificação                                                                                                                             |
| ----------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-01 · Autenticar usuários internos      | Base, 02–04         | Sessão, acesso inválido, expiração e logout em `business.integration.spec.ts` e `structure.spec.ts`.                                                 |
| RF-02 · Autorizar por perfil e escopo     | 03–06, 13, 29       | Troca de empresa, administração, execução e acesso técnico em `access.spec.ts`, `action-assignment.spec.ts` e `people-platform.integration.spec.ts`. |
| RF-03 · Manter estrutura organizacional   | 05–06, 25–26        | Empresas, unidades, setores, colaboradores e grupos em `structure.spec.ts`, `workforce.spec.ts` e `people-platform.integration.spec.ts`.             |
| RF-04 · Criar ciclo de diagnóstico        | 07–10               | Versão, prévia, política e ciclo em `instruments.spec.ts` e `assessments.spec.ts`.                                                                   |
| RF-05 · Coletar respostas anônimas        | 09–10, 29           | Token, participação, validação e repetição em `assessments.spec.ts` e `assessments.integration.spec.ts`.                                             |
| RF-06 · Registrar fontes complementares   | 09–10               | Registro de fonte coletiva em `assessments.spec.ts` e `AssessmentSources.test.tsx`.                                                                  |
| RF-07 · Consolidar resultados protegidos  | 09–10, 29           | Limiar, ausência de resultados e proteção entre recortes em `assessments-projection.spec.ts` e `assessments.spec.ts`.                                |
| RF-08 · Manter item de inventário         | 09–12               | Registro e vínculo à origem no inventário em `risk-registrations.integration.spec.ts` e `risks.spec.ts`.                                             |
| RF-09 · Classificar com método versionado | 11–12               | Método, matriz, histórico e compatibilidade em `technical-risks.spec.ts`.                                                                            |
| RF-10 · Criar plano de ação               | 13–14               | Origem, responsável, prazo e aferição em `actions-evidence.spec.ts` e `actions.integration.spec.ts`.                                                 |
| RF-11 · Registrar execução e histórico    | 13–14, 17–18, 21–22 | Atribuição, transição, concorrência, notas e revisões em `action-assignment.spec.ts`, `actions.integration.spec.ts` e `audit-history.spec.ts`.       |
| RF-12 · Vincular evidência                | 19–20, 29           | Upload, retomada, download privado, integridade e arquivamento em `actions-evidence.spec.ts` e `reconcile-evidence-uploads.integration.test.mjs`.    |
| RF-13 · Verificar eficácia                | 15–16               | Confirmação, autoria, provas e pareceres anteriores em `action-efficacy.spec.ts` e `action-efficacy.integration.spec.ts`.                            |
| RF-14 · Reavaliar risco                   | 17–18               | Predecessor, comparação e condições de encerramento em `risk-continuity.spec.ts` e `risk-continuity.integration.spec.ts`.                            |
| RF-15 · Exibir dashboard                  | 23–24, 25–28, 30    | Contagens e filtros reconciliados em `dashboard-v03.spec.ts` e `management-indicators.http.spec.ts`. [Medições de RH](DESEMPENHO_ID30.md)            |
| RF-16 · Gerar relatório                   | 25–26, 29–30        | Emissão, seleção de seções, snapshot, supressão e download em `reports.integration.spec.ts`, `ReportsWorkspace.test.tsx` e `report-pdf.spec.ts`.     |
| RF-17 · Consultar auditoria               | 21–22, 29           | Consulta administrativa, filtro, cronologia e acesso entre empresas em `audit-history.spec.ts` e `audit.integration.spec.ts`.                        |

Os testes e o roteiro usam instrumentos, métodos, limiares e dados sintéticos. A validação com responsáveis pela operação real inclui método de SST, política de consolidação, autorização, fontes de RH, regras de estimativa e retenção. A avaliação de usabilidade com participantes representativos mede separadamente a meta de 80% das tarefas críticas sem ajuda.

A implementação associa cada medida a um risco de origem. Os estados operacionais são planejada, em andamento, executada e cancelada. O parecer de eficácia e o encerramento técnico têm registros próprios. A relação de uma medida com vários riscos e o estado operacional bloqueado, mencionados no PRD completo, precisam de decisão de produto para o aceite desse recorte.

## Operação

| Assunto                                    | Referência                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Acessos, escopos e convites                | [Acessos e ativação](ACESSOS_E_ATIVACAO.md)                                                                                         |
| Diagnóstico e interpretação dos resultados | [Diagnóstico coletivo](DIAGNOSTICO_V02.md)                                                                                          |
| Ações e anexos privados                    | [Contrato de ações e evidências](API_ACOES_EVIDENCIAS.md) e [recuperação de upload](EVIDENCIAS_RECUPERAVEIS_ID19.md)                |
| RH, CNPJ, concessões globais e relatórios  | [Guia de operação](GESTAO_PESSOAS_PLATAFORMA.md), [indicadores](INDICADORES_RH.md) e [limites dos relatórios](RELATORIOS_LAYOUT.md) |
| Férias, estimativa e elegibilidade         | [Regras e referências](REGRAS_CLT_ESTIMATIVAS.md)                                                                                   |

### Cenário local de Gestão de Pessoas

Prepare um banco PostgreSQL local dedicado chamado `renr_mvp_demo`. Em um arquivo de ambiente privado e ignorado pelo Git, configure `NODE_ENV=development`, `DATABASE_URL` no loopback e senhas distintas em `MVP_DEMO_HR_PASSWORD` e `MVP_DEMO_OPERATOR_PASSWORD`. Use a mesma origem do frontend no `CORS_ORIGIN`.

```powershell
pnpm prisma:generate
pnpm build
node --env-file=apps/api/.env.mvp-demo.local node_modules/pnpm/bin/pnpm.cjs db:deploy
node --env-file=apps/api/.env.mvp-demo.local scripts/seed-mvp-people-demo.mjs
```

O seed pode ser repetido no mesmo banco. Ele prepara Aurora e Horizonte, dois clientes fictícios com CNPJs de teste, e cria as contas `rh-id32@renr.example` e `operador-id32@renr.example` no ambiente local. O RH consulta somente Aurora. O operador consulta o catálogo na classificação **Demonstração** e o resumo global. Os dados fictícios ficam fora dos totais de atendimento. Aurora tem 10 cadastros ativos, um inativo e cobertura salarial de cinco entre 10 ativos em novembro de 2026. Outubro demonstra supressão. Use a data **05/11/2026** na prévia individual para reutilizar os parâmetros da simulação.

Para abrir o build na mesma origem da API, use uma janela PowerShell dedicada.

```powershell
$env:SERVE_WEB = 'true'
$env:WEB_DIST_PATH = (Resolve-Path apps/web/dist).Path
$env:HOST = '127.0.0.1'
$env:PORT = '3032'
$env:CORS_ORIGIN = 'http://127.0.0.1:3032'
node --env-file=apps/api/.env.mvp-demo.local apps/api/dist/main.js
```

Abra [o cenário local de Gestão de Pessoas](http://127.0.0.1:3032).

### Jornada de demonstração

1. Com um perfil autorizado, mostre o instrumento versionado, a coleta e uma participação de uso único. Encerre e apresente a consolidação e uma fonte complementar.
2. Abra o risco relacionado, a versão do método e a ação. Mostre o responsável, a execução e o download autorizado de uma evidência. Em seguida, abra parecer de eficácia, reavaliação e encerramento.
3. Use as quatro áreas do painel para retornar aos registros. Em **Relatórios**, selecione um recorte SST, emita, confira a prévia e baixe o PDF. Abra **Auditoria** e confirme a operação registrada.
4. Em **Gestão de Pessoas**, mostre cadastro fiscal, lista, vínculos, férias e competência salarial com o perfil RH autorizado. Mostre a cobertura dos dados e uma simulação individual elegível.
5. Com a conta de plataforma, apresente catálogo, total global e PDF da plataforma. Demonstre a negação de acesso à ficha nominal. Repita um download após revogação ou logout para confirmar o bloqueio.

## Publicação controlada

### Evidências locais do candidato

Em 05/11/2026, o PostgreSQL local aplicou as 22 migrações e passou 14 testes que cobrem bancos vazios e preenchidos. Os testes verificaram a preservação do histórico, a repetição do seed e a separação das concessões de RH. A inspeção B04 confirmou que as chaves estrangeiras de ações, revisões e evidências correspondem ao schema Prisma.

O gate de integração passou 252 testes da API e um teste do CLI de reconciliação com PostgreSQL e MinIO. A prova de retorno executou o commit publicado `3de32b1` no banco expandido e retomou o candidato com as concessões e o histórico preservados.

No Chromium local, passaram 91 cenários E2E em desktop e os mesmos 91 no perfil mobile, com banco descartável. O zoom nativo de 200% manteve o acesso ao login nos dois temas e ao painel de RH. A aba identificou a marca ReNR+ e carregou o favicon correspondente. As verificações locais usam dados sintéticos.

`pnpm check` e `pnpm format:check` passaram. O primeiro incluiu 62 verificações de scripts, 170 testes de contratos, 237 testes da API e 345 do frontend. O build com `NODE_ENV=production` gerou 177,29 kB gzip de JavaScript inicial.

### Sequência de publicação

O endereço de homologação permanece [ReNR+ no Render](https://renr-plus-homologation.onrender.com). O serviço atual usa a branch `main`, o plano Free e publicação manual. O SHA de referência verificado em 05/11/2026 é [`3de32b1`](https://github.com/byteric/renr-plus/commit/3de32b1cfb2b72dd130b2e9ae73efd246f0eec7c).

1. Na revisão do candidato, confirme `pnpm prisma:validate`, `pnpm check`, `pnpm format:check`, `pnpm test:integration`, `pnpm test:migrations`, `pnpm test:compatibility`, `pnpm test:ui` e `pnpm test:e2e`. Compare o diff da PR com a lista de migrações e confirme a revisão exigida pela proteção da `main`.
2. Com autorização de publicação, registre o SHA da `main` resultante e o deploy anterior. Confira o banco de homologação, o histórico e a conexão direta com TLS. Aplique apenas migrações pendentes com `prisma migrate deploy`, preservando os registros e as migrações anteriores.
3. No Render, dispare manualmente o deploy do SHA aprovado no serviço existente. Confirme o SHA ativo e execute `node scripts/check-hosted.mjs https://renr-plus-homologation.onrender.com`. Em partida fria, registre separadamente o tempo até `/health` e `/ready`.
4. Use acessos demonstrativos vigentes por canal privado. Confira login, logout, perfis, isolamento, gráficos, favicon, temas, cursores, anexo privado, PDF e auditoria. Verifique as duas visões de RH com dados sintéticos autorizados, além da utilização de memória com relatórios volumosos.
5. Se a validação falhar, registre o resultado e retorne à versão anterior verificada. Preserve o schema expandido e os dados do Neon. Confirme novamente o SHA ativo e os checks públicos após o retorno. Enquanto a versão anterior estiver ativa, mantenha em espera convites e mudanças de concessões de RH. Confira os vínculos e convites pendentes ao restaurar a versão atual.

O candidato tem 22 migrações, cinco adicionais em relação ao SHA de referência. A última separa as concessões de RH nos vínculos e convites. A API atual combina as duas famílias na resposta. A versão anterior continua lendo as permissões operacionais pela coluna original, enquanto as de RH permanecem preservadas no banco.

Os recursos permanecem no Render, Neon e armazenamento privado existente. Para a primeira concessão global, siga o procedimento auditado do guia de Gestão de Pessoas. A disponibilidade e a validação de carga dependem da configuração atual do serviço. [Deploys no Render](https://render.com/docs/deploys) · [Limites do plano Free](https://render.com/docs/free)
