# ReNR+

Plataforma de apoio à gestão preventiva da NR-01 e de fatores de risco psicossociais
relacionados ao trabalho, no Programa de Residência Tecnológica do Porto Digital / ReTech+.

## Estado atual

**Base v0.4 + v0.5:** ações preventivas ligadas ao inventário,
responsáveis nominais, prazos civis, acompanhamento versionado e evidências privadas
com MinIO local e armazenamento privado Supabase na homologação.
Veja [critérios](docs/CRITERIOS_ACOES_EVIDENCIAS_V04_V05.md),
[API](docs/API_ACOES_EVIDENCIAS.md), [guia de uso](docs/USO_V04_V05.md)
e [verificação](docs/VERIFICACAO_V04_V05.md).

**Base v0.3:** inventário persistido, fichas preliminares com histórico imutável,
painel com dados reais e navegação por gráficos, temas claro/escuro e movimento opcional.
O fluxo conecta diagnóstico coletivo, origem do risco e contexto de cada ficha.
Veja [recorte da v0.3](docs/IMPLEMENTACAO_V03.md), [guia de uso](docs/USO_V03.md)
e [verificações](docs/VERIFICACAO_V03.md).

**Evoluções dos IDs 01–10:** fundação visual, gestão de acessos, colaboradores e grupos,
instrumentos versionados, coletas e consolidação protegida. A publicação segue PR revisada
para `main`, CI aprovada, migrações aditivas e deploy manual do commit aprovado.
O [diagnóstico da v0.2](docs/DIAGNOSTICO_V02.md) permanece demonstrativo:
cinco perguntas fictícias, convites de uso único e consolidação coletiva protegida.

**IDs 11 e 12:** métodos e avaliações técnicas versionadas,
inventário enriquecido, detalhe contextual responsivo e matriz por versão exata.
Os métodos precisam ser configurados por responsável com capacidade técnica e referência
de aprovação; o seed normal não fornece método aprovado. Consulte o
[contrato de implementação](docs/plans/IMPLEMENTACAO_ID11_ID12.md) e as
[verificações locais](docs/VERIFICACAO_ID11_ID12.md). A disponibilidade online depende da promoção validada.

**IDs 13 e 14:** atribuição opcional de ações a membros ativos,
“Minhas ações” pela sessão, execução restrita por capacidade e histórico de atribuição.
A lista e o detalhe apresentam contexto, pendências, prioridade técnica compatível e
evidências, preservando responsável nominal externo e os contratos legados.
Execução informada continua distinta de eficácia e encerramento técnico. Consulte o
[contrato](docs/plans/IMPLEMENTACAO_ID13_ID14.md) e as
[verificações locais](docs/VERIFICACAO_ID13_ID14.md); a disponibilidade online depende da promoção validada.

**IDs 15 e 16:** pareceres técnicos de eficácia com autoria, revisão
operacional, critério e provas preservadas. A interface permite preparar, revisar e
confirmar a análise; o histórico mantém decisões anteriores e sinaliza quando o
contexto ou uma prova selecionada exige revisão. Registrar exige capacidade técnica
explícita. Eficácia não encerra automaticamente a ação; reavaliação e fechamento
são decisões próprias dos IDs 17/18.
Consulte o [contrato](docs/plans/IMPLEMENTACAO_ID15_ID16.md) e as
[verificações locais](docs/VERIFICACAO_ID15_ID16.md); a disponibilidade online depende da promoção validada.

**IDs 17 e 18:** reavaliação ligada à avaliação anterior,
às medidas consideradas e aos pareceres preservados; comparação por versão exata
do método e consulta histórica completa. Encerramento técnico exige parecer eficaz
vigente, reavaliação atual que considere a medida e provas válidas, sem substituir
o estado operacional. Nova ação corretiva depende de confirmação e fica vinculada
à anterior. Consulte o [contrato](docs/plans/IMPLEMENTACAO_ID17_ID18.md) e as
[verificações locais](docs/VERIFICACAO_ID17_ID18.md). A disponibilidade online depende da promoção validada.

**IDs 19 e 20:** evidências com chave idempotente,
tentativa durável, lease e recuperação explícita, com transferência fora da transação
e revalidação antes da finalização. A central preserva arquivo e descrição durante
falhas recuperáveis, distingue transmissão de confirmação e consulta o uso técnico
antes de arquivar. Consulte o [guia de operação](docs/EVIDENCIAS_RECUPERAVEIS_ID19.md),
o [contrato](docs/plans/IMPLEMENTACAO_ID19_ID20.md) e a
[verificação](docs/VERIFICACAO_ID19_ID20.md). A promoção segue o [procedimento de release](docs/RELEASE_IDS11_20.md).

[Acessar a homologação ReNR+](https://renr-plus-homologation.onrender.com).
O ambiente usa somente dados sintéticos e requer acesso autorizado para gestão.
A versão disponível corresponde ao commit ativo verificado no Render. Cada funcionalidade só fica disponível online após os checks do novo deploy;
um merge no GitHub não atualiza o serviço automaticamente. O primeiro acesso após inatividade
pode demorar enquanto o serviço gratuito inicia.

**Base v0.1:** login, sessão, criação/consulta/edição/inativação de empresas,
unidades e setores, com frontend integrado à API e persistência no PostgreSQL.
Administrador altera cadastros; leitor consulta. A autorização limita cada operação
ao contexto de empresa permitido. A interface adapta-se a desktop e celular e oferece
modos claro e escuro.

Esta base não é o MVP completo. O diagnóstico legado permanece demonstrativo;
o catálogo/editor e as coletas aplicam versões publicadas com políticas de consolidação próprias.
Texto livre e relatórios regulamentares permanecem nos próximos incrementos.
Métodos configurados e decisões técnicas locais dependem das permissões e das
referências de validação descritas acima. O painel mede registros e preenchimento,
não grau de risco. Veja [base v0.1](docs/IMPLEMENTACAO_V01.md).

ReNR+ não realiza diagnóstico clínico nem certifica automaticamente conformidade legal.
IA permanece fora do MVP; o código de domínio não deverá depender de provedores externos.

## Começar

Pré-requisitos: **Node.js 24.9 ou superior da série 24**, **pnpm 11** e, para banco/arquivos, **Docker Desktop** com
engine Linux e Compose V2. Na pasta `renr-plus`:

```powershell
pnpm install --frozen-lockfile
pnpm setup:local
pnpm prisma:generate
pnpm infra:up
pnpm infra:verify
pnpm db:deploy
pnpm build
pnpm db:seed
pnpm dev
```

- Interface: <http://127.0.0.1:5173>
- Liveness da API: <http://127.0.0.1:3000/api/v1/health>
- Prontidão do banco: <http://127.0.0.1:3000/api/v1/ready>
- OpenAPI local: <http://127.0.0.1:3000/api/docs>

Para anexos locais, configure `STORAGE_ENABLED=true` em `apps/api/.env` antes de
iniciar a API. Confira endpoint/bucket e credenciais S3 preparados pelo setup;
não altere as configurações da homologação. [Passo a passo](docs/USO_V04_V05.md).

Frontend e liveness funcionam sem banco, mas login e cadastros precisam de PostgreSQL.
Sem o banco, `ready` devolve 503; isso não equivale a falha na instalação do código.
`pnpm setup:local` cria configurações locais
com senhas aleatórias, sem sobrescrever arquivos existentes ou exibir credenciais.

### Acesso de demonstração

Contas fictícias: `admin1@renr.example`, `admin2@renr.example` e `reader@renr.example`.
As duas contas de administrador pertencem a empresas diferentes; o leitor pertence
à primeira. A senha aleatória está no campo `DEMO_PASSWORD` de `apps/api/.env`, criado
localmente. Não envie esse arquivo ao Git, Trello ou apresentação.

`db:seed` exige banco local e ambiente de desenvolvimento. É idempotente: não substitui
senhas, cadastros ou vínculos existentes. Não há cadastro público de contas nesta versão.

## Banco e armazenamento

```powershell
pnpm infra:up
pnpm infra:verify
pnpm db:deploy
pnpm infra:status
pnpm db:studio
```

PostgreSQL e MinIO usam volumes persistentes e portas restritas ao computador local.
Veja [infra/README.md](infra/README.md). MinIO é compilado de fonte oficial fixada.
Na homologação, PostgreSQL permanece no Neon e o backend usa armazenamento privado
no Supabase. Credenciais de infraestrutura ficam somente nas variáveis privadas do Render.
O schema contém a base organizacional, instrumento, pergunta/opção, grupo, ciclo,
convite, envio, resposta, risco, ficha preliminar, ação, revisão e metadados de evidência.
As migrações são aditivas e preservam registros existentes.
O consumo do convite e a persistência do envio ocorrem na mesma transação. A identidade administrativa
não é ligada à resposta do participante. Isso não representa garantia absoluta de anonimato.

`db:deploy` aplica migrações já versionadas, sem resetar o banco. Ao modificar o schema,
use `pnpm db:migrate --name nome_da_alteracao` para criar uma nova migração em desenvolvimento.
Os comandos `infra:*` localizam Docker instalado por usuário ou para toda a máquina no Windows,
inclusive quando o terminal ainda não recebeu a atualização de PATH.
`infra:verify` prepara o bucket privado configurado em `S3_BUCKET` e verifica upload,
leitura e exclusão de um arquivo sintético, sem tocar em objetos existentes.

## Estrutura

```text
apps/
  web/                 React + Vite + Tailwind; componentes locais padrão shadcn/ui
  api/                 NestJS + Prisma; módulos do monólito
packages/
  contracts/           Tipos e validações HTTP compartilhados, sem acesso ao banco
infra/                 PostgreSQL + MinIO em Docker Compose
tests/e2e/             Testes reais de integração web/API em desktop e mobile
scripts/               Preparação segura do ambiente
docs/                  Documentação do produto e equipe
```

Identidade, estrutura organizacional, painel, diagnóstico demonstrativo e auditoria das ações
administrativas possuem implementação, assim como inventário de riscos e fichas preliminares.
Ações preventivas e evidências integram a base v0.5. Avaliação de eficácia, reavaliação e
relatórios de prevenção continuam nos próximos incrementos.

## Qualidade

```powershell
pnpm check
pnpm format:check
pnpm prisma:validate
pnpm test:integration
pnpm test:migrations
pnpm exec playwright install chromium
pnpm test:e2e
```

`check` gera Prisma e executa lint, tipos, testes e builds. E2E usa os builds e sobe
web/API automaticamente. O workflow GitHub Actions executa essas verificações nas PRs e nos pushes
da `main`, com PostgreSQL e MinIO privados de teste. A versão composta deve passar novamente nos checks antes
da publicação. `test:integration` exige banco local migrado; E2E exige build e seed.
Os testes removem ou arquivam apenas seus próprios dados fictícios identificados, sem limpar tabelas
ou reinicializar volumes. Fichas imutáveis e suas origens sintéticas permanecem na base local.

`test:migrations` cria um banco local temporário exclusivo, verifica migrações e
seed duas vezes, comprova preservação de dados anteriores até a v0.3 e remove somente suas bases temporárias. Requer permissão local de criação de
banco e preserva a base de desenvolvimento.

Para novas dependências, atualizar o lockfile usando pnpm. Não editar o lockfile à mão.
Não publicar `.env`, dados pessoais, respostas reais de colaboradores ou credenciais.
Veja [resultados e limites da preparação local](docs/VERIFICACAO_V04_V05.md).

## Diagnóstico demonstrativo

Administrador acessa **Diagnóstico**, cria ciclo com setor e período, abre e emite convites.
O participante informa o código em `/#/participar`, sem conta administrativa. Link e código são
compartilhados separadamente; códigos não entram na URL ou no armazenamento do navegador.

Após encerramento, resultados usam exclusivamente respostas persistidas. Abaixo de cinco envios,
contagens e distribuições ficam ocultas. Uma opção com contagem positiva inferior a cinco suprime
toda a distribuição daquela pergunta. O limiar é demonstrativo e precisa de validação antes de coleta real.
Não existe leitura individual, exportação de respostas ou pontuação de riscos.

- [Critérios específicos](docs/CRITERIOS_DIAGNOSTICO_V02.md)
- [Contrato HTTP](docs/API_DIAGNOSTICO_V02.md)
- [Navegação e identidade visual](docs/UX_DIAGNOSTICO_V02.md)
- [Roteiro de apresentação](docs/APRESENTACAO_V02.md)

## Homologação online

O serviço [ReNR+ em homologação](https://renr-plus-homologation.onrender.com) executa no
Render Free, com banco persistente no Neon Free, sem depender do computador de desenvolvimento.
React e API usam a mesma origem. A falha B03 de upload foi corrigida em 28/10/2026:
o storage estava desabilitado na configuração do Render. Upload, download privado,
hash e persistência após republicação do mesmo commit foram verificados no Supabase.
Isso não publica o protocolo de recuperação dos IDs 19/20, cuja publicação segue a promoção deste incremento.
Veja [publicação, verificações e limites](docs/DEPLOY_HOMOLOGACAO.md).
Novos commits e publicações exigem autorização de Ricardo. Atualizações automáticas
estão desativadas, e nenhuma credencial online faz parte do repositório.

### Fluxo histórico de promoção da v0.3

A sequência é `integracao/v03` → PR revisada para `main` → deploy manual da `main`.
O serviço existente acompanha `main`, com `autoDeploy` desligado. Um merge não publica automaticamente.
A integração anterior pertence ao histórico da v0.2.

Aplicar somente a migração versionada com `prisma migrate deploy`, usando a conexão direta
do banco de homologação e TLS verificado. Não executar seed local, `migrate reset` ou `migrate dev`
no Neon. O provisionamento demonstrativo é manual, preserva registros/senhas existentes e só deve
rodar após confirmar host e banco; o container inclui suas dependências de diagnóstico.

Antes de liberar a versão, validar o commit ativo no Render, os oito checks de
`node scripts/check-hosted.mjs https://renr-plus-homologation.onrender.com` e as jornadas HTTPS de
login, painel, inventário, diagnóstico, isolamento, permissões e logout. Esses resultados só valem
para o commit publicado em que foram executados; testes locais ou CI não substituem essa verificação.

Se a publicação falhar, retornar ao último deploy verificado, sem resetar o Neon.
O diagnóstico acrescentou uma migração aditiva; a descrição histórica de ausência de mudança de schema
no guia inicial não se aplica a ele. Manter plano Free. Alterações futuras de armazenamento exigem
verificação do fluxo privado no ambiente publicado; testes locais não a substituem.

## Fundação das próximas evoluções

Os IDs 01 e 02 consolidam a base visual e a política de compatibilidade, sem
introduzir as funcionalidades seguintes nem mudar o contrato dos módulos atuais.
Consulte a [fundação visual](docs/FUNDACAO_VISUAL.md), o
[mapa de contratos e migrações](docs/CONTRATOS_E_COMPATIBILIDADE.md) e a
[verificação incremental](docs/VERIFICACAO_ID01_ID02.md).
`pnpm test:ui` verifica apresentação com dados sintéticos; `pnpm test:compatibility`
ensaia consumidores congelados e retorno de aplicação em PostgreSQL local isolado.
O segundo comando exige o build atual pronto, Git com o histórico da base v0.3 e
`DATABASE_URL` local explicitamente fornecida. Não executa contra a nuvem.

## Gestão de acessos — IDs 03 e 04

Implementação local de membros, convites individuais de ativação, capacidades explícitas,
desativação por empresa e histórico com justificativa. ADMIN não recebe poder técnico automaticamente.
A atribuição persistida às ações pertence ao ID 13; esta entrega não libera escrita global ao executor.

Consulte [operação e limites](docs/ACESSOS_E_ATIVACAO.md),
[contrato da API](apps/api/src/modules/access/README.md) e
[verificação local](docs/VERIFICACAO_ID03_ID04.md).
A disponibilidade desses módulos na homologação depende do commit ativo no Render.

O comando `pnpm test:e2e` usa o build atual e executa desktop/mobile em lotes separados,
com uma API nova por lote e um worker. Execute build, migração e seed locais antes;
pare os servidores de desenvolvimento nas portas 3000/5173. Nenhum limite de login é reduzido.
Filtros e seleção de projeto continuam disponíveis, por exemplo:

```powershell
pnpm test:e2e tests/e2e/access.spec.ts --project=desktop
```

O perfil compilado evita o grande número de módulos/requests do servidor Vite de desenvolvimento.
O perfil antigo permanece disponível com `--config=playwright.config.ts` para diagnóstico específico.

## Cadastros organizacionais — IDs 05 e 06

Cadastro mínimo de colaboradores, vínculo opcional com usuário e gestão dos grupos de avaliação
existentes, restritos ao administrador da empresa ativa. Busca, filtros e paginação permanecem
na URL; formulários preservam o rascunho em falhas recuperáveis. Desativação mantém o histórico,
sem revogar automaticamente acessos nem identificar participantes dos diagnósticos.

Consulte [operações e critérios de aceite](docs/API_CADASTRO_GRUPOS_ID05.md) e
[verificação local](docs/VERIFICACAO_ID05_ID06.md). A atribuição de responsáveis a ações
permanece no ID 13. Consulte o commit ativo no Render para confirmar a disponibilidade online.

## Instrumentos e versões — IDs 07 e 08

Catálogo por empresa em `#/instrumentos`, com rascunhos, perguntas de escolha única,
múltipla ou ordinal, opções ordenadas e prévia imediata do conteúdo ainda não salvo.
Reordenação funciona por botões acessíveis; falhas recuperáveis e conflitos preservam
o rascunho em memória. A prévia não envia nem armazena respostas.

Publicação demonstrativa exige ADMIN; uso real exige capacidade técnica explícita
e referência de aprovação. Publicações preservam o conteúdo; alterações seguem em
nova versão com IDs próprios de perguntas/opções. Os ciclos antigos mantêm a versão original.
O editor não atribui pontuação nem comprova validação metodológica.

Consulte o [contrato e os limites](docs/API_INSTRUMENTOS_ID07.md) e a
[verificação local](docs/VERIFICACAO_ID07_ID08.md). Os IDs 09 e 10 acrescentam o fluxo
de coletas descrito a seguir. A publicação é confirmada pelo commit ativo no Render.

## Coletas e consolidação protegida — IDs 09 e 10

Em `#/coletas`, organize ciclos com um grupo, uma versão publicada de instrumento,
uma política publicada e um período. O rascunho permite edição; abrir fixa o contexto.
Encerrar exige confirmação e impede novos envios. O fluxo legado de diagnóstico
continua separado e mantém seus contratos anteriores.

ADMIN prepara ciclos e registra observação, entrevista, oficina ou análise documental
com contexto coletivo, data, síntese e autoria da sessão. As fontes não contêm campos
para identificar participantes e podem ser acrescentadas após o encerramento.
Política real exige limiar explícito, referência de aprovação e capacidade técnica;
ADMIN, por si só, não concede essa capacidade.

Distribua o endereço `/#/responder` e o código do convite separadamente. O formulário
público dispensa conta, permite revisão e correção e conserva respostas apenas na memória
da aba. Após falha de confirmação, o reenvio exato não duplica a resposta. Não coloque
códigos em URLs, documentos públicos ou capturas.

Resultados e consolidação gerencial distinguem coleta em andamento, ausência de dados,
resultado disponível e supressão. A mesma política protege ciclos, grupos, unidades e
totais superiores contra inferência por diferença; contagens representam envios, não
pessoas únicas. O limiar de demonstração não garante anonimato nem valida uso real.
Relatórios formais permanecem nos incrementos seguintes. O incremento local dos IDs 11 e 12
acrescenta avaliação técnica versionada, separada da consolidação e das fichas preliminares.

Consulte [contratos, segurança e limites](docs/API_COLETAS_ID09.md) e
[evidências de verificação](docs/VERIFICACAO_ID09_ID10.md).

## Equipe e contribuição

Consulte [equipe, perfis e branches](docs/README.md#equipe) e [PRD](docs/PRD.md).
Ricardo coordena a integração; Thomaz/Diogo cuidam de frontend/UX, Bruno de backend,
Pedro de dados, Luiz de qualidade/ambiente, Júlia de requisitos e Eliziane de documentação.
Cada integrante trabalha na sua branch. Contribuições passam por pull request e revisão;
a `main` recebe somente o conjunto aprovado, após CI e a aprovação independente exigida
pelo repositório. Ricardo coordena a composição e a publicação manual da homologação.

## Licença

A licença permanece a definir em decisão conjunta da ReTech+ e dos integrantes estudantes.
Nenhuma licença de código aberto foi aplicada enquanto essa decisão está pendente.
