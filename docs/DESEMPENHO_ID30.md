# ID 30 — Desempenho de Gestão de Pessoas, plataforma e PDF

Benchmark local de 5 de novembro de 2026, com dados sintéticos. Os números são uma linha de base do código integrado sobre o HEAD `823eaac`, com alterações do lote ainda no worktree. A comparação mantém o ambiente e varia permissões, filtros e distribuição. O escopo desta evidência é a execução local dos serviços, as consultas e a renderização do PDF.

## Reprodução

A partir da raiz do repositório, com as dependências instaladas e o PostgreSQL do Compose local iniciado, crie o banco dedicado uma vez e aplique as migrações correntes. O .env local é o gerado por pnpm setup:local. O trecho PowerShell usa as credenciais locais sem exibi-las.

```powershell
docker exec renr-local-postgres-1 sh -lc 'createdb -U "$POSTGRES_USER" renr_id30_benchmark'
$benchmarkConfig = node -e "process.stdout.write(JSON.stringify(require('dotenv').parse(require('node:fs').readFileSync('.env'))))" | ConvertFrom-Json
$benchmarkUser = [Uri]::EscapeDataString($benchmarkConfig.POSTGRES_USER)
$benchmarkPassword = [Uri]::EscapeDataString($benchmarkConfig.POSTGRES_PASSWORD)
$env:ID30_BENCHMARK_DATABASE_URL = "postgresql://$($benchmarkUser):$($benchmarkPassword)@127.0.0.1:5432/renr_id30_benchmark"
$env:DATABASE_URL = $env:ID30_BENCHMARK_DATABASE_URL
$env:NODE_ENV = 'development'

pnpm --filter @renr/api prisma:deploy
pnpm --filter @renr/api prisma:generate
pnpm --filter @renr/contracts build
pnpm --filter @renr/api build
node scripts/benchmark-people.mjs
node scripts/benchmark-people.mjs --pdf-only
```

O runner valida protocolo PostgreSQL, host loopback, banco literal e ausência de parâmetros. Confere `current_database()` e exige que os clientes e usuários preexistentes pertençam à fixture antes de substituir os dados sintéticos. Um lock de sessão serializa execuções simultâneas. As saídas locais ficam em `tmp/id30-benchmark.json`, `tmp/id30-sql-plans.json` e `tmp/id30-pdf.json`. A variável `ID30_BENCHMARK_ROUNDS` altera as 20 amostras aquecidas de cada caso de banco.

## Método

- Windows 11, Intel Core i5-12450H, 12 processadores lógicos disponíveis, 15,7 GiB de RAM, Node v24.14.0 e PostgreSQL 17.11 em Docker local. As 20 migrações do lote foram aplicadas ao banco dedicado.
- O runner chama PeopleAnalyticsService e PlatformService compilados, com PrismaPg, pool de até cinco conexões, statement_timeout e query_timeout de 2 s. O serviço de RH abre a própria transação RepeatableRead com 10 s. A plataforma usa RepeatableRead com o timeout padrão do Prisma. As chamadas são sequenciais e usam apenas uma conexão de trabalho por transação.
- Cada fase tem 10.000 Employee sem login. A fase distribuída contém 100 clientes com CNPJ sintético válido, incluindo um inativo, um vazio e dois empatados em 99, mais uma demonstração e um cadastro sem CNPJ. Os dois excluídos têm 100 Employee cada. Na fase concentrada, os mesmos clientes são mantidos e um único cliente concentra os 10.000. A fixture contém perfis, salários, férias e parâmetros de rescisão com lacunas deliberadas.
- O primeiro tempo de cada caso é separado das 20 chamadas seguintes. O banco já passou por carga e ANALYZE, então a primeira chamada do caso mede aquecimento do caminho no processo, sem simular partida fria do PostgreSQL ou da aplicação. A primeira conexão inclui uma leitura das configurações do banco. Percentis usam o posto mais próximo. O p99 coincide com o máximo em amostras de 20.
- A contagem de leituras vem dos eventos de query do Prisma em uma chamada adicional de cada caso, fora da amostra de latência. `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` reapresenta a primeira ocorrência de cada forma de SQL e registra quantas vezes apareceu. As três sondas explícitas de índices ficam identificadas por `sonda-` no JSON. O carregamento da fixture, a medição do banco e o PDF usam processos separados. O RSS inclui Node, Prisma e buffers no modo banco. O pico do sistema é cumulativo por processo.

## Serviços e consultas

| Distribuição | Caso                       | 1ª (ms) | p50 (ms) | p75 (ms) | p95 (ms) | p99 (ms) | Leituras SQL |
| ------------ | -------------------------- | ------: | -------: | -------: | -------: | -------: | -----------: |
| Distribuída  | Resumo da plataforma       |  168,74 |    14,71 |    15,90 |    21,07 |    22,62 |            5 |
| Distribuída  | Catálogo, página 1         |   18,81 |    12,70 |    14,52 |    16,33 |    16,98 |            4 |
| Distribuída  | Catálogo, página 5         |   25,96 |    15,09 |    16,05 |    16,71 |    16,90 |            4 |
| Distribuída  | Busca por CNPJ no catálogo |   20,59 |     9,96 |    10,61 |    13,05 |    19,27 |            4 |
| Distribuída  | RH, cliente vazio          |   28,78 |    14,78 |    15,91 |    18,37 |    18,76 |            3 |
| Distribuída  | RH sem finanças            |   19,61 |    19,00 |    20,00 |    21,90 |    23,41 |            3 |
| Distribuída  | RH sem finanças, filtrado  |   23,21 |    20,84 |    22,62 |    24,70 |    27,87 |            5 |
| Distribuída  | RH com finanças            |   39,97 |    31,35 |    34,15 |    36,53 |    39,89 |            5 |
| Distribuída  | RH com finanças, filtrado  |   28,39 |    25,17 |    27,03 |    30,05 |    30,48 |            7 |
| Concentrada  | RH sem finanças            |  213,70 |   132,51 |   137,89 |   142,55 |   143,14 |            3 |
| Concentrada  | RH sem finanças, filtrado  |   23,96 |    25,27 |    26,92 |    32,01 |    32,85 |            5 |
| Concentrada  | RH com finanças            |  486,05 |   445,08 |   454,63 |   559,03 |   624,21 |           32 |
| Concentrada  | RH com finanças, filtrado  |   94,10 |   102,61 |   107,77 |   111,87 |   118,48 |           10 |

A primeira conexão com leitura das configurações levou 31,27 ms. O pico de RSS do processo foi de 254,8 MiB, com a carga sintética fora do processo de medição.

O catálogo retorna 20 itens nas páginas 1 e 5 e total estável de 100. Os primeiros três clientes têm 0, 99 e 99 cadastros. O resumo soma 9.800 registros dos 100 clientes elegíveis, excluindo os 200 da demonstração e do cadastro sem CNPJ. O cliente concentrado fecha em 9.000 ativos e 1.000 inativos. O filtro por unidade, setor e situação reduz o mesmo cliente a 1.250 ativos. As leituras de remuneração e rescisão ficam fora do caminho sem a capacidade financeira. O caminho financeiro percorre dados reais da fixture e o resultado da rescisão fica em cobertura insuficiente ou suprimido conforme o recorte.

O catálogo usa uma única agregação de empregados para os clientes da página. A busca do catálogo por CNPJ usa `contains` em conjunto com a busca por nome. Em 102 organizações, a busca parcial e a sonda de igualdade sobre CNPJ normalizado e situação escolheram varredura sequencial, mesmo com índice único normalizado. O agregado do cliente concentrado varre `employees` para o conjunto amplo e usa o índice de organização, unidade e setor no filtro seletivo. O `LATERAL` de vínculos faz buscas indexadas por empregado dentro do SQL. A sonda de competência usou a chave de organização, empregado e competência. A sonda de férias usou o índice de organização, prazo e empregado. Os planos completos mostram estimativas, cardinalidades observadas e buffers.

A estimativa financeira é o maior custo da leitura. Após o filtro de registros com insumos, foram 28 consultas em lotes de até 200 para o recorte de 9.000 ativos, além das quatro consultas fixas. O recorte de 1.250 usa quatro lotes e seis consultas fixas. A paginação limita o volume em memória e evita uma chamada de aplicação por empregado. Os planos dos lotes confirmam que há trabalho por empregado dentro do banco, incluindo vínculos e férias, e que o plano filtrado pode processar mais linhas do que devolve por lote.

## PDF

| Perfil        |    Entrada JSON | 1ª (ms) | p50 (ms) | p95 (ms) | Pico RSS (MiB) | Resultado                      |
| ------------- | --------------: | ------: | -------: | -------: | -------------: | ------------------------------ |
| Texto curto   |   289.534 bytes |  464,38 |   392,06 |   398,24 |          299,9 | 188 páginas, 503.426 bytes     |
| Texto extremo | 1.536.834 bytes |  237,16 |   232,57 |   234,81 |          402,2 | `REPORT_PDF_LIMIT` por páginas |

As amostras chamam renderReportPdf, PDFKit e os assets reais de fontes e marca. O snapshot sintético tem 300 riscos, 1.000 ações e duas tabelas com quatro colunas. O runner mede uma primeira renderização e três aquecidas por perfil no mesmo processo de PDF. O p95 de três amostras equivale ao máximo. O perfil extremo usa dez repetições das células descritivas para pressionar a paginação. A geração usa prazo de 30 s, 250 páginas, 25 MiB de saída e limite de 4 MiB para texto de entrada. A recusa é medida até a exceção do renderer, que não retorna conteúdo parcial. A cobertura inclui apenas o renderer e o snapshot sintético, sem captura do snapshot no banco ou anexos.

As medições terminaram sem falta de memória no ambiente local. O pico de RSS do processo de PDF inclui renderizações anteriores. A validação de memória e concorrência na homologação, assim como o desempenho de ponta a ponta e o orçamento de JS inicial, depende de evidência separada.
