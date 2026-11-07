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

## Termos da jornada preventiva

| Termo                | Como aparece no ReNR+                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coleta               | Aplicação de uma versão publicada do instrumento a um grupo, em um período definido. A política vinculada determina como os resultados podem ser apresentados.                       |
| Diagnóstico coletivo | Leitura preventiva dos resultados agregados de uma coleta. **Diagnóstico demonstrativo** é a área do instrumento fixo para dados fictícios.                                          |
| Fonte complementar   | Registro que contextualiza um fator de risco, com origem e data. Pode acompanhar a leitura agregada da coleta.                                                                       |
| Fator de risco       | Condição do trabalho registrada como origem de uma possível exposição, como a concentração de demandas em parte de uma equipe.                                                       |
| Registro de risco    | Item do inventário que documenta o fator, o contexto de exposição, os possíveis agravos e as medidas de controle existentes.                                                         |
| Criticidade          | Nível atribuído conforme uma avaliação técnica e a versão da matriz usada. O painel separa os registros sem classificação vigente.                                                   |
| Ação ou medida       | Trabalho preventivo ligado a um risco de origem, com responsável, prazo, resultado esperado e critério de verificação.                                                               |
| Evidência            | Anexo privado vinculado à ação para documentar execução ou acompanhamento. O acesso depende do perfil e da empresa.                                                                  |
| Parecer de eficácia  | Decisão registrada por perfil técnico autorizado sobre os resultados da medida diante do critério de verificação. A execução informada é uma etapa anterior.                         |
| Resultado protegido  | Estado em que a política de privacidade restringe a exibição do resultado, por exemplo, quando o grupo é pequeno. O estado é apresentado separadamente de uma contagem igual a zero. |

## Operação

| Assunto                                    | Referência                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Acessos, escopos e convites                | [Matriz de perfis, exemplos de autorização e ativação](ACESSOS_E_ATIVACAO.md)                                                       |
| Acessos por persona para o piloto          | [Emissão, isolamento e revogação dos acessos demonstrativos](ACESSOS_PILOTO_ID37.md)                                                |
| Diagnóstico e interpretação dos resultados | [Diagnóstico demonstrativo](DIAGNOSTICO_V02.md)                                                                                     |
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

### Preparação do cenário de coleta e SST

Esta jornada usa o ambiente local da raiz do projeto e fica separada do banco `renr_mvp_demo` e dos dados de Gestão de Pessoas descritos acima. Siga [README — instalação e seed local](../README.md), [Diagnóstico demonstrativo](DIAGNOSTICO_V02.md), [Matriz de acessos](ACESSOS_E_ATIVACAO.md) e [Uso de ações e evidências](USO_V04_V05.md). Execute `pnpm db:seed` somente em PostgreSQL local isolado.

O seed da raiz prepara duas empresas fictícias com grupos, unidades, setores, riscos e ações. `admin1@renr.example` e `reader@renr.example` pertencem à primeira empresa. `admin2@renr.example` administra a segunda. O seed também fornece o instrumento fixo de **Diagnóstico demonstrativo**. Para **Coletas**, crie um instrumento no catálogo versionado.

1. Entre como `admin1@renr.example`, selecione a primeira empresa fictícia e abra **Coletas**. Em **Políticas de consolidação**, crie uma política `DEMONSTRATION` com mínimo de cinco respostas e publique a versão. O teste executável `tests/e2e/assessments.spec.ts` demonstra a sequência de política, instrumento versionado, ciclo, convite, resposta, fonte e encerramento; ele cria e remove sua própria organização temporária.
2. Em **Instrumentos**, crie e publique uma versão de demonstração com perguntas e alternativas fictícias. Use a preparação do teste de referência como exemplo. Em **Coletas**, crie um ciclo com o grupo fictício, a versão publicada do instrumento, a versão publicada da política, o início anterior ao momento atual e o término futuro. Revise e abra o ciclo.
3. Emita pelo menos cinco convites. Cada código de uso único é apresentado uma única vez; entregue cada um individualmente pelo canal aprovado. O respondente abre `/#/responder`, informa o código individual e conclui o questionário. A tela pública apresenta o formulário correspondente ao código; ela não apresenta uma lista de coletas. Para resposta coletiva visível, confirme que o ciclo recebeu pelo menos cinco envios válidos antes de encerrá-lo. Com menos respostas, o resultado fica protegido.
4. Antes de encerrar, registre na coleta uma fonte `OBSERVATION`, com data válida e síntese de contexto coletivo fictício, sem nomes ou detalhes que identifiquem participantes. Encerre o ciclo e confira a disponibilidade agregada ou o estado protegido conforme a contagem.
5. Prepare um segundo ciclo aberto com convites ainda válidos para o ensaio. Em uma ação fictícia do seed, use a seção **Evidências** do guia, `STORAGE_ENABLED=true` e MinIO local privado. Envie um PDF, PNG ou JPEG sintético de até 5 MiB com descrição de 10–1.000 caracteres. Guarde a referência e compare o download autorizado. A ação tem contexto próprio e aparece no relatório no recorte da empresa.
6. Para validar o papel de leitura, saia da sessão ADMIN e entre como `reader@renr.example`. Confirme consulta permitida a coletas, resultados, inventário, ações, evidências e relatório SST; tente registrar a fonte somente na sessão ADMIN. O respondente participa pelo convite e não usa conta ADMIN/READER.

O instrumento e os envios de demonstração são sintéticos. Cada código de convite autoriza um envio. A participação humana no piloto requer autorização, consentimento e instruções de uso dos dados aprovadas pela equipe.

### Jornada de demonstração

1. Com um perfil autorizado, mostre o instrumento versionado, a coleta e uma participação de uso único. Encerre e apresente a consolidação e uma fonte complementar.
2. Abra o risco e a ação do cenário operacional. Mostre a origem registrada, o responsável, a execução e o download autorizado de uma evidência. Use registros com histórico preenchido para demonstrar parecer de eficácia, reavaliação e encerramento.
3. Use as quatro áreas do painel para retornar aos registros. Em **Relatórios**, selecione um recorte SST, emita, confira a prévia e baixe o PDF. Abra **Auditoria** e confirme a operação registrada.
4. Em **Gestão de Pessoas**, mostre cadastro fiscal, lista, vínculos, férias e competência salarial com o perfil RH autorizado. Mostre a cobertura dos dados e uma simulação individual elegível.
5. Com a conta de plataforma, apresente catálogo, total global e PDF da plataforma. Demonstre a negação de acesso à ficha nominal. Repita um download após revogação ou logout para confirmar o bloqueio.

### Ensaio reproduzível e piloto de usabilidade

O roteiro abaixo documenta ensaio e avaliação em ambiente local com dados sintéticos. Aceitação do cliente, validação de método por RH/SST e publicação exigem registros próprios. Convide pessoas representativas autorizadas que tenham consentido. Evidências devem registrar resultados redigidos, sem nomes, respostas pessoais ou dados reais de trabalhadores.

#### Preparação e ensaio de 8–12 minutos

1. Use a preparação acima e confirme `/api/v1/ready`, empresa e perfil. Confira um ciclo aberto com convite válido, um ciclo encerrado com resultado coletivo, uma fonte, uma ação com anexo e um relatório. Registre versão/SHA, navegador, viewport e data. Mantenha o ensaio em ambiente local isolado.
2. Cronometre uma passagem demonstrativa de 8–12 minutos: coleta e resposta individual por convite, resultado agregado, fonte coletiva, risco fictício, ação com anexo autorizado, relatório SST e evento correspondente na auditoria. Mantenha credenciais demonstrativas em arquivo privado.
3. Confira o escopo de empresa e o papel em cada etapa, o rótulo dos dados sintéticos, o estado do ciclo e a correspondência entre prévia do relatório e PDF. Anote duração e obstáculos.
4. Reinicie a aplicação e repita a passagem no mesmo ambiente isolado. Compare dados de origem e destino, contagens, estados, histórico, relatório e hash do anexo. Registre diferenças observadas.
5. Faça o piloto separadamente: leia a cada participante somente a tarefa neutra correspondente ao seu papel e não indique onde clicar. Registre qualquer ajuda solicitada ou dada como tentativa sem sucesso no indicador principal.

#### Tarefas do piloto sem ajuda

Prepare o escopo e os dados pela seção acima. Observe cada papel em sessão separada: `ADMIN` administra ciclo e fonte, `READER` consulta dados permitidos, e Respondente usa o convite individual em `/#/responder`. Dê somente o objetivo, sem instrução de navegação. Cada tarefa crítica conta como tentativa válida depois que seus pré-requisitos e a sessão apropriada funcionam. Registre falha, abandono, ajuda, impedimento de acesso ou incidente de privacidade. Se infraestrutura ou preparação impedir a tentativa, marque-a inválida, justifique e agende nova tentativa separadamente.

| ID  | Tarefa neutra a apresentar                                                                            | Sucesso observável                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Papel Respondente: “Abra o questionário do convite que recebeu e envie sua resposta.”                 | A pessoa abre `/#/responder`, fornece o convite individual, responde ao formulário vinculado e recebe confirmação de envio.               |
| P2  | Papel ADMIN/READER: “Encontre o resultado da coleta encerrada e explique o que ele permite concluir.” | Abre o ciclo correto e interpreta o resultado agregado ou seu estado protegido, preservando a leitura coletiva.                           |
| P3  | Papel ADMIN: “Localize a fonte complementar da coleta e explique que contexto ela registra.”          | Abre a fonte `OBSERVATION` e identifica sua data e síntese de contexto coletivo.                                                          |
| P4  | Papel ADMIN/READER: “Encontre a ação fictícia e consulte a evidência disponível.”                     | Abre a ação preparada e consulta/baixa o anexo somente no escopo e com perfil autorizados; reconhece que o anexo pertence à ação do seed. |
| P5  | Papel ADMIN: “Gere o relatório SST do recorte e confira se corresponde à prévia.”                     | Seleciona um recorte autorizado, emite o relatório e confirma correspondência entre a prévia e o PDF.                                     |
| P6  | Papel READER: “Abra o relatório disponível para sua empresa e confira o conteúdo autorizado.”         | Abre o relatório previamente emitido e consulta/baixa somente o recorte SST da empresa ativa.                                             |

Considere uma tarefa bem-sucedida somente se o resultado observável foi alcançado sem dica, correção do facilitador ou intervenção. Calcule `tarefas críticas bem-sucedidas sem ajuda ÷ tentativas críticas válidas × 100`. O critério planejado é **≥ 80%** no conjunto de tentativas válidas. Mostre também o resultado por tarefa; um total agregado não deve esconder falha de privacidade, acesso indevido ou tarefa crítica que ninguém conseguiu concluir. Não há resultado preenchido até o piloto ocorrer.

#### Tarefa específica de auditoria

Após as tarefas críticas, usando perfil `ADMIN`, peça: “Localize na auditoria o evento recente que corresponde à operação demonstrada e confirme sua data/período.” Registre se o administrador encontrou o evento com filtros de operação e período, sem depender de identificador técnico. Esta tarefa é uma verificação exploratória separada do limiar de 80%, salvo se a equipe definir formalmente que ela integra o conjunto crítico antes de coletar resultados. Gere a operação de teste na sessão e confirme que aparece no mesmo escopo.

#### Ficha de ensaio e registro de evidências

O integrante que reproduzir o README registra o SHA retornado por `git rev-parse HEAD`, as versões de Node, pnpm e Docker e os resultados de `/api/v1/health` e `/api/v1/ready`. Registre também a duração do ensaio e o primeiro passo que exigiu ajuda ou ajuste.

Copie a tabela e preencha uma linha por tentativa. Use um código sem vínculo nominal para cada sessão. Guarde evidências redigidas em local privado e autorizado. A coluna de evidência recebe apenas referência ou hash.

| Sessão | Perfil | Tarefa             | Tentativa | Válida? | Sem ajuda? | Duração | Observado, ajuda ou motivo de invalidação | Evidência |
| ------ | ------ | ------------------ | --------- | ------- | ---------- | ------- | ----------------------------------------- | --------- |
| —      | —      | P1–P6 ou auditoria | —         | —       | —          | —       | —                                         | —         |

Feche a rodada com os totais por tarefa e o percentual geral das tarefas críticas. Com zero tentativas críticas válidas, registre o percentual como pendente. Vincule cada correção à tentativa original e lance o reteste em uma linha própria.

| Campo                                                         | Registro                                      |
| ------------------------------------------------------------- | --------------------------------------------- |
| Build/commit (SHA), data, navegador e viewport                | Pendente de preenchimento                     |
| Cenário e empresa fictícia; perfil usado (sem credencial)     | Pendente de preenchimento                     |
| Duração do ensaio guiado e resultado de cada etapa            | Pendente de execução                          |
| Auditoria: operação, período, encontrada?; perfil autorizado? | Pendente de execução                          |
| Incidente de privacidade/acesso, severidade e encaminhamento  | Pendente de verificação                       |
| Total de tentativas válidas / sucessos sem ajuda / percentual | Pendente de cálculo                           |
| Correção, responsável, nova tentativa e resultado             | Pendente de ação                              |
| Aceite de produto/cliente e limitações reconhecidas           | Pendente de manifestação; não presumir aceite |

#### Critério de saída para entrega

O ensaio deve caber em 8–12 minutos, com a duração real registrada. A aprovação de usabilidade requer o limiar de pelo menos 80% alcançado em dados observados, análise por tarefa e ausência de incidente crítico de privacidade ou escopo; caso contrário, documente limitações, encaminhe correção e repita as tarefas afetadas. A aceitação do cliente e de responsáveis técnicos é um registro separado, com autor, data, escopo e ressalvas explícitos; permanece pendente até ser obtida. Antes de qualquer release, preencha o registro de versão/SHA, evidências dos gates, decisão de aceite, responsável pela autorização, estado do deploy e verificações pós-publicação da seção **Sequência de publicação**. Não marque entrega publicada enquanto a autorização e a validação do SHA ativo não estiverem registradas.

### Contingência com dados fictícios

Use o build da demonstração, PostgreSQL e MinIO em loopback. Separe um banco e um bucket privados para a origem e outros vazios para a restauração. Confira os nomes e as conexões antes de iniciar. Use credenciais temporárias em arquivo privado ou no processo, fora do Git.

1. Prepare a origem com as migrações e o seed. Em uma ação fictícia, envie uma evidência e registre seu SHA-256. Emita um relatório SST e guarde a referência da ação, do histórico e do relatório.
2. Encerre a sessão e pare a API da origem antes de copiar o banco e os objetos. Gere um dump PostgreSQL em formato custom com `pg_dump --format=custom --no-owner --no-acl`. Copie os objetos privados do MinIO preservando a chave, o tipo de conteúdo e o arquivo. Guarde o SHA-256 do dump e dos arquivos no manifesto.
3. Confira os hashes. Restaure o dump no banco vazio com `pg_restore --exit-on-error --no-owner --no-acl` e grave os objetos no bucket privado vazio com as chaves originais. Os nomes das bases e buckets temporários devem ser distintos dos usados pela aplicação em operação.
4. Aponte outra instância local para o banco e o bucket restaurados. Confira `/api/v1/ready`, entre com a conta fictícia e abra o histórico da ação, o anexo e a prévia do relatório. Compare o histórico e a prévia com a origem. Confira o SHA-256 do anexo baixado, o PDF e a recusa de acesso sem sessão e com conta de outra empresa.

Em 06/11/2026, um ensaio técnico local repetido no build integrado restaurou um dump de 303.887 bytes e um anexo sintético de 70 bytes, com hash preservado e três eventos de histórico. A API devolveu a mesma prévia e um PDF válido. As tentativas sem sessão e com conta de outra empresa retornaram 401 e 404, respectivamente. O resultado foi PASS em 16 segundos, contados do preparo via API até a conferência da restauração. Esse ensaio local não valida recuperação do serviço hospedado; esta segue o procedimento aprovado de operação da organização.

## Publicação controlada

### Evidências locais do candidato

Em 05/11/2026, uma instância PostgreSQL local isolada aplicou 22 migrações e passou 14 testes em bancos vazios e preenchidos. Os testes verificaram a preservação do histórico, a repetição do seed e a separação das concessões de RH. A inspeção B04 confirmou que as chaves estrangeiras de ações, revisões e evidências correspondem ao schema Prisma. O volume de teste e restauração foi exercitado somente em ambientes locais isolados, com banco descartável e MinIO local.

O gate de integração passou 252 testes da API e um teste do CLI de reconciliação com PostgreSQL e MinIO. Como evidência histórica, a prova de retorno executou o commit `3de32b1` no banco expandido e retomou o candidato com as concessões e o histórico preservados.

No Chromium local, passaram 91 cenários E2E em desktop e os mesmos 91 no perfil mobile, com banco descartável. O zoom nativo de 200% manteve o acesso ao login nos dois temas e ao painel de RH. A aba identificou a marca ReNR+ e carregou o favicon correspondente. As verificações locais usam dados sintéticos.

`pnpm check` e `pnpm format:check` passaram. O primeiro incluiu 62 verificações de scripts, 170 testes de contratos, 237 testes da API e 345 do frontend. O build com `NODE_ENV=production` gerou 177,29 kB gzip de JavaScript inicial.

### Sequência de publicação

O endereço registrado para homologação é [ReNR+ no Render](https://renr-plus-homologation.onrender.com). O registro de publicação aponta [`5e8f4ca11625580ae7522ae5a80b175281c3408a`](https://github.com/byteric/renr-plus/commit/5e8f4ca11625580ae7522ae5a80b175281c3408a) como último SHA publicado e verificado. O commit [`3de32b1`](https://github.com/byteric/renr-plus/commit/3de32b1cfb2b72dd130b2e9ae73efd246f0eec7c) é histórico e consta na prova de retorno. O SHA do novo candidato e a configuração atual do serviço permanecem pendentes de conferência antes da publicação.

1. Na revisão do candidato, confirme `pnpm prisma:validate`, `pnpm check`, `pnpm format:check`, `pnpm test:integration`, `pnpm test:migrations`, `pnpm test:compatibility`, `pnpm test:ui` e `pnpm test:e2e`. Compare o diff da PR com a lista de migrações e confirme a revisão exigida pela proteção da `main`. Os IDs 35 e 36 não acrescentam migrações; confirme esse estado no diff do candidato.
2. Com autorização de publicação, registre o SHA da `main` resultante e o último deploy verificado. Confira a configuração do serviço, o banco de homologação, o histórico e a conexão direta com TLS antes de prosseguir. Aplique somente migrações pendentes com `prisma migrate deploy`, preservando registros e migrações anteriores.
3. No Render, publique manualmente o SHA aprovado conforme a configuração confirmada nessa ocasião. Confirme o SHA ativo e execute `node scripts/check-hosted.mjs https://renr-plus-homologation.onrender.com`. Em partida fria, registre separadamente o tempo até `/health` e `/ready`.
4. Use acessos demonstrativos vigentes por canal privado. Confira login, logout, perfis, isolamento, gráficos, favicon, temas, anexo privado, PDF representativo e auditoria. Verifique as duas visões de RH com dados sintéticos autorizados. Execute ensaios de volume e memória em ambiente local isolado.
5. Se a validação falhar, registre o resultado e retorne à versão anterior verificada. Preserve o schema expandido e os dados do Neon. Confirme novamente o SHA ativo e os checks públicos após o retorno. Enquanto a versão anterior estiver ativa, mantenha em espera convites e mudanças de concessões de RH. Confira os vínculos e convites pendentes ao restaurar a versão atual.

O registro técnico anterior contabiliza 22 migrações no conjunto validado em 05/11/2026. Compare a lista versionada de migrações do novo candidato com a base publicada durante a revisão. A alteração anterior separa concessões de RH em vínculos e convites; a API correspondente combina as duas famílias na resposta. A versão anterior lê as permissões operacionais pela coluna original e preserva as concessões de RH no banco.

Registre a configuração confirmada no momento da revisão e da publicação. Para a primeira concessão global, siga o procedimento auditado do guia de Gestão de Pessoas. [Deploys no Render](https://render.com/docs/deploys) · [Limites do plano Free](https://render.com/docs/free)
