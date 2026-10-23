# ReNR+

Plataforma de apoio à gestão preventiva da NR-01 e de fatores de risco psicossociais
relacionados ao trabalho, no Programa de Residência Tecnológica do Porto Digital / ReTech+.

## Estado atual

**v0.4 + v0.5:** ações preventivas ligadas ao inventário,
responsáveis nominais, prazos civis, acompanhamento versionado e evidências privadas
por adaptador S3: MinIO privado no ambiente local/CI e Supabase privado na homologação.
Veja [critérios](docs/CRITERIOS_ACOES_EVIDENCIAS_V04_V05.md),
[API](docs/API_ACOES_EVIDENCIAS.md), [guia de uso](docs/USO_V04_V05.md)
e [verificação](docs/VERIFICACAO_V04_V05.md).

**Base v0.3:** inventário persistido, fichas preliminares com histórico imutável,
painel com dados reais e navegação por gráficos, temas claro/escuro e movimento opcional.
O fluxo conecta diagnóstico coletivo, origem do risco e contexto de cada ficha.
Veja [recorte da v0.3](docs/IMPLEMENTACAO_V03.md), [guia de uso](docs/USO_V03.md)
e [verificações](docs/VERIFICACAO_V03.md).

A liberação de cada versão exige composição na integração,
PR revisada para `main`, CI aprovada, migração aditiva e publicação manual do commit aprovado.
O [diagnóstico da v0.2](docs/DIAGNOSTICO_V02.md) permanece demonstrativo:
cinco perguntas fictícias, convites de uso único e consolidação coletiva protegida.

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

Esta base não é o MVP completo. O diagnóstico implementado é demonstrativo, sem editor de instrumentos,
texto livre ou metodologia validada. Colaboradores, eficácia técnica, matriz técnica validada
e relatórios regulamentares permanecem nos próximos incrementos. O painel mede registros e preenchimento,
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
Na homologação, PostgreSQL permanece no Neon e os anexos usam um bucket privado do Supabase.
As credenciais S3 ficam somente no backend, nas variáveis privadas do Render.
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
Ações preventivas e evidências integram esta versão. Avaliação de eficácia, reavaliação e
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
Veja [resultados e limites de verificação](docs/VERIFICACAO_V04_V05.md).

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
React e API usam a mesma origem. Nesta release, os anexos usam S3 privado no Supabase
e são acessados somente pela API autenticada, sem depender do MinIO local.
Veja [publicação, verificações e limites](docs/DEPLOY_HOMOLOGACAO.md).
Novos commits e publicações exigem autorização de Ricardo. Atualizações automáticas
estão desativadas, e nenhuma credencial online faz parte do repositório.

### Promoção da v0.4/v0.5

A sequência é `integracao/v04-v05` → PR revisada para `main` → deploy manual da `main`.
O serviço existente acompanha `main`, com `autoDeploy` desligado. Um merge não publica automaticamente.
As integrações anteriores pertencem ao histórico das versões já promovidas.

Aplicar somente a migração versionada com `prisma migrate deploy`, usando a conexão direta
do banco de homologação e TLS verificado. Não executar seed local, `migrate reset` ou `migrate dev`
no Neon. O provisionamento demonstrativo é manual, preserva registros/senhas existentes e só deve
rodar após confirmar host e banco; o container inclui suas dependências de diagnóstico.

Antes de liberar a versão, validar o commit ativo no Render, os oito checks de
`node scripts/check-hosted.mjs https://renr-plus-homologation.onrender.com` e as jornadas HTTPS de
login, painel, inventário, diagnóstico, ações, evidências privadas, isolamento, permissões e logout. Esses resultados só valem
para o commit publicado em que foram executados; testes locais ou CI não substituem essa verificação.

Se a publicação falhar, retornar ao último deploy verificado, sem resetar o Neon.
Esta release acrescenta duas migrações aditivas de ações e evidências, sem reescrever as anteriores.
Mantenha os planos Free e o bucket privado. A configuração de armazenamento não dispensa a autorização por empresa e perfil na API.

## Equipe e contribuição

Consulte [equipe, perfis e branches](docs/README.md#equipe) e [PRD](docs/PRD.md).
Ricardo coordena a integração; Thomaz/Diogo cuidam de frontend/UX, Bruno de backend,
Pedro de dados, Luiz de qualidade/ambiente, Júlia de requisitos e Eliziane de documentação.
Cada integrante trabalha na sua branch. A composição desta release tem destino
`integracao/v04-v05`; as integrações anteriores estão encerradas.
Submeta a contribuição para a integração conjunta,
com revisão de `@Byteric`. A `main` recebe o incremento completo por uma PR final,
após CI e revisão válidas. Commits e publicação dependem de autorização de Ricardo.

## Licença

A licença permanece a definir em decisão conjunta da ReTech+ e dos integrantes estudantes.
Nenhuma licença de código aberto foi aplicada enquanto essa decisão está pendente.
