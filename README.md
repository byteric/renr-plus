# ReNR+

Plataforma de apoio à gestão preventiva da NR-01 e de fatores de risco psicossociais
relacionados ao trabalho, no Programa de Residência Tecnológica do Porto Digital / ReTech+.

## Estado atual

**Incremento v0.1:** login, sessão, criação/consulta/edição/inativação de empresas,
unidades e setores, com frontend integrado à API e persistência no PostgreSQL.
Administrador altera cadastros; leitor consulta. A autorização limita cada operação
ao contexto de empresa permitido. A interface adapta-se a desktop e celular e oferece
modos claro e escuro.

Este é o recorte planejado para revisão em **08/10/2026**, não o MVP completo.
Diagnósticos, colaboradores, inventário, planos de ação, evidências e indicadores
ainda não têm fluxos implementados. Veja [entrega e demonstração da v0.1](docs/IMPLEMENTACAO_V01.md).

ReNR+ não realiza diagnóstico clínico nem certifica automaticamente conformidade legal.
IA permanece fora do MVP; o código de domínio não deverá depender de provedores externos.

## Começar

Nesta cópia já preparada, abra `INICIAR_AMBIENTE_COMPLETO.cmd` para iniciar Docker,
PostgreSQL, MinIO, aplicar migrações existentes, compilar, preparar dados sintéticos e iniciar web/API. Para trabalhar somente
na interface/API, `INICIAR_DEV.cmd` continua disponível. O pnpm está instalado localmente,
sem alterar as ferramentas globais do computador.

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
O schema desta versão contém organização, usuário, vínculo/perfil, sessão, unidade,
setor e evento de auditoria. A migração da v0.1 é aditiva à migração inicial; a modelagem
dos próximos módulos será incorporada por novas migrações, sem reset do banco.

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

Identidade, estrutura organizacional e auditoria básica estão implementadas.
Diagnósticos, riscos, ações, evidências e relatórios são somente pontos de organização
para os próximos incrementos.

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
web/API automaticamente. O workflow GitHub Actions está preparado para essas mesmas
verificações com PostgreSQL de teste, mas sua execução no GitHub depende de publicação
autorizada. `test:integration` exige banco local migrado; E2E exige build e seed.
Os testes removem apenas seus próprios dados fictícios identificados, sem limpar tabelas
ou reinicializar volumes.

`test:migrations` cria um banco local temporário exclusivo, verifica migrações e
seed duas vezes e remove somente esse banco. Requer permissão local de criação de
banco e preserva a base de desenvolvimento.

Para novas dependências, atualizar o lockfile usando pnpm. Não editar o lockfile à mão.
Não publicar `.env`, dados pessoais, respostas reais de colaboradores ou credenciais.

## Equipe e contribuição

Consulte [equipe, perfis e branches](docs/README.md#equipe) e [PRD](docs/PRD.md).
Ricardo coordena a integração; Thomaz/Diogo cuidam de frontend/UX, Bruno de backend,
Pedro de dados, Luiz de qualidade/ambiente, Júlia de requisitos e Eliziane de documentação.
Cada integrante trabalha na sua branch e submete pull request para revisão de `@Byteric`.
Commits e publicação dependem de autorização de Ricardo. Licença do projeto: a definir.
