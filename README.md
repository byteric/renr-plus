# ReNR+

Plataforma web de apoio à gestão preventiva da **NR-01** e de fatores de risco psicossociais relacionados ao trabalho, desenvolvida no Programa de Residência Tecnológica do **Porto Digital** em parceria com a **ReTech+**.

O ReNR+ resolve a fragmentação entre coleta, avaliação de riscos e plano de ação ao conectar toda a jornada preventiva em um único histórico rastreável — com controle de acesso por empresa, escopo organizacional e capacidades explícitas.

> **Ambiente de demonstração:** [Acessar a homologação do ReNR+](https://renr-plus-homologation.onrender.com)
>
> A homologação utiliza apenas dados fictícios e exige login autorizado por perfil. Por rodar no plano gratuito do Render, o primeiro acesso após um período de inatividade pode levar alguns segundos enquanto o serviço inicia.

**Limites de escopo:** o ReNR+ apoia o gerenciamento de condições de trabalho. Não realiza diagnóstico clínico, não funciona como prontuário, não expõe respostas individuais de participantes e não certifica automaticamente conformidade legal. Indicadores e estimativas trabalhistas de Gestão de Pessoas são demonstrativos.

---

## O que o MVP entrega

### Jornada preventiva ponta a ponta

```text
Cadastros → Instrumentos e coletas → Inventário e avaliações → Ações e evidências → Eficácia, reavaliação e indicadores
```

| Área                             | O que está disponível hoje                                                                                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Estrutura e cadastros**        | Gestão de empresas, unidades, setores, grupos de avaliação por setor e colaboradores, incluindo atualização em lote com histórico e preservação de registros desativados.                                                                                                   |
| **Instrumentos e coletas**       | Catálogo versionado de instrumentos, abertura e encerramento de ciclos com política de consolidação, entrega controlada de convites, resposta pública sem conta (`/#/responder` e fluxo legado `/#/participar`) e consolidação coletiva com supressão para grupos pequenos. |
| **Inventário e avaliações**      | Inventário de riscos ligado à coleta ou origem, métodos e avaliações técnicas versionadas, consulta de colaboração técnica entre SST e Psicologia e histórico contínuo de decisões.                                                                                         |
| **Ações, evidências e eficácia** | Plano de ação com atribuição a executores autorizados, prazos, anexos privados recuperáveis, pareceres de verificação de eficácia, encerramento técnico e reavaliações sem perda do histórico.                                                                              |
| **Painel, relatórios e suporte** | Painel gerencial com pendências NR-01, trilha de auditoria, relatórios em PDF no recorte autorizado, chamados internos de atendimento e ajuda contextual (**?**) nas telas operacionais.                                                                                    |
| **Gestão de Pessoas (RH)**       | Indicadores agregados (perfil, vínculo, férias e estimativas demonstrativas) filtrados por unidade, setor e competência, protegidos por regras de supressão e concessões específicas de RH.                                                                                 |
| **Plataforma e operação**        | Cadastro fiscal de organizações (CNPJ), grupos de empresas e consolidado multiempresa, catálogo de planos/serviços e contratos versionados, cobranças e pagamentos manuais, controle manual de acesso contratual, painel comercial com alertas e fila global de chamados.   |

### Perfis e visões

O acesso é separado por contexto e verificado no servidor em cada requisição:

- **Visão por empresa:** distingue administrador empresarial (`ADMIN`, integral ou delegado por unidade/setor) e leitor (`READER`). O papel `ADMIN` não concede automaticamente permissões técnicas ou de RH — capacidades como `TECHNICAL_DECISIONS`, `EXECUTE_ASSIGNED_ACTIONS`, `PSYCHOLOGY_COLLABORATION` e permissões granulares de Gestão de Pessoas (`HR_*`) são concedidas explicitamente.
- **Consulta de grupos de empresas (`#/consolidado`):** visão consolidada somente leitura entre empresas vinculadas a um grupo, liberada mediante concessão específica.
- **Visão de plataforma (`#/plataforma` e áreas associadas):** escopo global reservado à operação da ReTech+, segmentado por concessões independentes (visão geral, cadastro de clientes/grupos, concessões globais, comercial/contratos, cobranças financeiras, acesso contratual, suporte e recuperação assistida).
- **Segurança da conta (`#/seguranca-da-conta`):** área individual para gerenciar a verificação em duas etapas quando habilitada no ambiente.

### Recursos condicionados a configuração ou ativação

Os recursos abaixo já estão implementados na `main`, mas permanecem desligados por padrão até configuração de ambiente ou aprovação operacional:

- **Armazenamento privado de evidências e anexos (`STORAGE_ENABLED=true`):** requer endpoint, bucket e credenciais S3 configurados no servidor (`S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`). Desligado por padrão em `apps/api/.env.example` e habilitado na homologação com bucket privado no Supabase.
- **Verificação em duas etapas — 2FA/TOTP ([guia](docs/SEGURANCA_DA_CONTA_ID53.md)):** o cadastro voluntário de autenticador e a recuperação assistida de MFA só ficam disponíveis com `MFA_ENCRYPTION_KEY` (chave privada estável de 32 bytes em Base64URL) configurada no servidor. A exigência obrigatória para administradores globais (`MANAGE_GRANTS`) começa desativada (`MFA_REQUIRE_GLOBAL_ADMINS=false`) e exige `MFA_ENCRYPTION_KEY` definida.
- **Recuperação assistida de senha ([guia](docs/RECUPERACAO_DE_ACESSO_ID52.md)):** controlada por `PASSWORD_RECOVERY_ASSISTED_ENABLED=false` por padrão, exigindo aprovação do procedimento de validação de identidade e designação explícita de responsáveis (`ASSIST_COMPANY_PASSWORD_RECOVERY` ou `MANAGE_PASSWORD_RECOVERY`).
- **Gravação na colaboração técnica SST/Psicologia ([guia](docs/COLABORACAO_SST_PSICOLOGIA_ID56.md)):** a escrita de contribuições permanece desabilitada por padrão (`RISK_COLLABORATION_WRITES_ENABLED=false`) até validação formal das decisões de negócio.
- **Uso de dados reais de RH em produção:** controlado por `HR_REAL_DATA_ENABLED=false` (com `HR_DEMO_ORGANIZATION_IDS` opcional para recortes demonstrativos) e sujeito às validações descritas em [docs/GESTAO_PESSOAS_PLATAFORMA.md](docs/GESTAO_PESSOAS_PLATAFORMA.md) e [docs/VALIDACAO_SST_RH.md](docs/VALIDACAO_SST_RH.md).

### Fora do MVP e evoluções futuras

Permanecem fora do escopo atual do MVP e planejados apenas como eventuais evoluções futuras:

- diagnóstico clínico, prontuário ocupacional, exposição de respostas individuais e certificação automática de conformidade;
- cobrança automatizada, gateways de pagamento, bloqueio automático por inadimplência e disparo automático de e-mails transacionais;
- integrações externas (SSO corporativo, ERP/folha de pagamento), aplicativo nativo e recursos de IA decisória (eventuais integrações futuras de apoio deverão permanecer desacopladas do fluxo manual).

---

## Como rodar localmente

### Pré-requisitos

- **Node.js `24.9.0` ou superior da série 24** (`>=24.9.0 <25`)
- **pnpm `11.x`** (`packageManager`: `pnpm@11.25.0`)
- **Docker Desktop** com engine Linux e Compose V2 (para PostgreSQL 17 e MinIO locais)

### Arquivos de ambiente

O repositório fornece três arquivos de exemplo:

- [.env.example](.env.example): credenciais locais do PostgreSQL e do MinIO (`POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`).
- [apps/api/.env.example](apps/api/.env.example): porta e host da API (`HOST`, `PORT`), origem permitida (`CORS_ORIGIN`), banco (`DATABASE_URL`), armazenamento S3 (`STORAGE_ENABLED`, `S3_*`), flags de ativação (`PASSWORD_RECOVERY_ASSISTED_ENABLED`, `MFA_REQUIRE_GLOBAL_ADMINS`, `MFA_ENCRYPTION_KEY`) e senha do seed local (`DEMO_PASSWORD`).
- [apps/web/.env.example](apps/web/.env.example): base da API (`VITE_API_BASE_URL=/api/v1`) e destino do proxy Vite (`API_PROXY_TARGET=http://127.0.0.1:3000`).

O comando `pnpm setup:local` gera `.env`, `apps/api/.env` e `apps/web/.env` a partir desses exemplos com senhas aleatórias, sem sobrescrever arquivos já existentes nem exibir credenciais no terminal.

### Passo a passo

Na raiz do repositório, execute nesta ordem:

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

| Serviço                     | Endereço local                        | Observação                                   |
| --------------------------- | ------------------------------------- | -------------------------------------------- |
| Interface web (Vite)        | `http://127.0.0.1:5173`               | Faz proxy de `/api` para `API_PROXY_TARGET`. |
| API — liveness              | `http://127.0.0.1:3000/api/v1/health` | Responde mesmo sem banco ativo.              |
| API — prontidão             | `http://127.0.0.1:3000/api/v1/ready`  | Retorna `503` sem PostgreSQL acessível.      |
| API — OpenAPI local         | `http://127.0.0.1:3000/api/docs`      | Disponível apenas fora de produção.          |
| PostgreSQL 17 (Docker)      | `127.0.0.1:5432`                      | Volume persistente restrito ao host local.   |
| MinIO S3 / Console (Docker) | `127.0.0.1:9000` / `127.0.0.1:9001`   | Emula o bucket privado `renr-evidence`.      |

- **Anexos e evidências locais:** altere `STORAGE_ENABLED=true` em `apps/api/.env` antes de iniciar a API (as credenciais S3 e o bucket `renr-evidence` já são preparados por `pnpm setup:local` e `pnpm infra:verify`).
- **Contas de demonstração local:** `pnpm db:seed` cria de forma idempotente `admin1@renr.example`, `admin2@renr.example` (empresas distintas) e `reader@renr.example`, usando a senha aleatória gravada em `DEMO_PASSWORD` dentro de `apps/api/.env`. O seed exige banco local e ambiente de desenvolvimento. Nunca versione arquivos `.env`.
- **Banco e migrações:** use `pnpm db:deploy` para aplicar migrações versionadas sem apagar dados, `pnpm db:migrate --name nome_da_alteracao` para novas migrações em desenvolvimento, `pnpm db:studio` para inspeção local e `pnpm infra:status` / `pnpm infra:down` para controlar os containers.

### Verificações de qualidade

```powershell
pnpm check
pnpm format:check
pnpm prisma:validate
pnpm test:integration
pnpm test:migrations
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm check` gera o cliente Prisma e executa lint, verificação de tipos, testes unitários/HTTP e builds. Os testes da API que inspecionam PDFs exigem Python com `pypdf==6.14.2` (opcionalmente apontado por `PDF_TEST_PYTHON`). `pnpm test:integration` e `pnpm test:migrations` usam PostgreSQL local; `pnpm test:e2e` executa os fluxos desktop e mobile sobre os builds compilados (pare servidores em execução nas portas `3000` e `5173` antes de rodar).

---

## Arquitetura

O ReNR+ adota um **monólito modular** em monorepo pnpm:

```text
apps/
  web/         Interface React + TypeScript + Vite + Tailwind CSS + shadcn/ui
  api/         API REST NestJS + TypeScript + Prisma ORM (22 módulos de domínio)
packages/
  contracts/   Esquemas Zod e tipos HTTP compartilhados entre web e API
infra/         PostgreSQL 17 e MinIO via Docker Compose para desenvolvimento local
scripts/       Setup local, seed, verificações de migrações, E2E e startup de produção
tests/e2e/     Jornadas automatizadas em navegador (desktop e mobile)
docs/          Especificações, contratos, critérios e guias operacionais
```

| Camada             | Tecnologia / Serviço                      | Papel no projeto                                                                                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**       | React, Vite, Tailwind CSS (`apps/web`)    | Interface responsiva com tema claro/escuro e rotas por contexto; em produção é compilada em `apps/web/dist` e servida pela própria API na mesma origem (`SERVE_WEB=true`).                                                                                                                                                  |
| **API**            | NestJS, TypeScript, Prisma (`apps/api`)   | Regras de negócio, sessões por cookie protegido (`HttpOnly`, `Secure` em produção), controle de acesso por empresa/capacidade, geração de PDFs e API REST em `/api/v1`.                                                                                                                                                     |
| **Banco de dados** | PostgreSQL 17 no **Neon**                 | Persistência relacional de todo o domínio (38 migrações aditivas em `apps/api/prisma/migrations`). Em produção separa `DATABASE_URL` (conexão com pool para a API) e `DATABASE_URL_UNPOOLED` (conexão direta com `sslmode=verify-full` para `prisma migrate deploy`), com `RUN_MIGRATIONS=false` para aplicação controlada. |
| **Armazenamento**  | Bucket privado S3 no **Supabase**         | Armazena anexos privados (evidências de ações, documentos contratuais e anexos técnicos) acessados exclusivamente pelo backend via cliente S3 (`STORAGE_ENABLED=true`, `S3_BUCKET=renr-evidence`). Localmente é substituído pelo MinIO em `infra/compose.yaml`.                                                             |
| **Hospedagem**     | **Render** (`render.yaml` + `Dockerfile`) | Web Service Docker único (`renr-plus-homologation`, plano Free, porta `10000`, health check em `/api/v1/health`), acompanhando a `main` com `autoDeployTrigger: off`, previews desativados e publicação manual do commit aprovado.                                                                                          |

---

## Documentação

### Produto e operação

- [Entrega do MVP, critérios e roteiro de demonstração](docs/ENTREGA_MVP.md)
- [Requisitos do produto (PRD)](docs/PRD.md)
- [Decisões de SST e RH para validação](docs/VALIDACAO_SST_RH.md)
- [Guia de ações preventivas e evidências](docs/USO_V04_V05.md)
- [Gestão de Pessoas, plataforma e relatórios](docs/GESTAO_PESSOAS_PLATAFORMA.md)
- [Índice completo da documentação](docs/README.md)

### Segurança da conta e acessos

- [Verificação em duas etapas (2FA/TOTP)](docs/SEGURANCA_DA_CONTA_ID53.md)
- [Recuperação assistida de acesso](docs/RECUPERACAO_DE_ACESSO_ID52.md)
- [Gestão de acessos, convites e capacidades](docs/ACESSOS_E_ATIVACAO.md)
- [Acessos do piloto por persona, validade e revogação](docs/ACESSOS_PILOTO_ID37.md)

### Módulos e contratos

- [Instrumentos versionados](docs/API_INSTRUMENTOS_ID07.md) e [coletas com consolidação protegida](docs/API_COLETAS_ID09.md)
- [Painel de pendências NR-01](docs/PAINEL_PENDENCIAS_NR01_ID55.md) e [colaboração técnica SST/Psicologia](docs/COLABORACAO_SST_PSICOLOGIA_ID56.md)
- [Atualização em lote de colaboradores](docs/ATUALIZACAO_COLABORADORES_ID54.md)
- [Operação comercial (planos e contratos)](docs/API_COMERCIAL_ID45_ID46.md), [cobranças manuais](docs/API_COBRANCAS_ID47.md), [acesso contratual](docs/API_ACESSO_CONTRATUAL_ID48.md) e [painel comercial](docs/PAINEL_COMERCIAL_ID51.md)
- [Chamados internos e ajuda contextual](docs/CHAMADOS_E_AJUDA_ID50.md)
- [Contratos de auditoria](docs/API_AUDITORIA.md) e [indicadores](docs/API_INDICADORES.md)

### Infraestrutura e homologação

- [Operação e deploy da homologação (Render, Neon e Supabase)](docs/DEPLOY_HOMOLOGACAO.md)
- [Infraestrutura local com PostgreSQL e MinIO](infra/README.md)
- [Contratos e compatibilidade de migrações](docs/CONTRATOS_E_COMPATIBILIDADE.md)

---

## Equipe, governança e licença

Projeto desenvolvido no Programa de Residência Tecnológica do **Porto Digital** com acompanhamento da **ReTech+**. Veja a lista detalhada de perfis em [docs/README.md#equipe](docs/README.md#equipe):

- **Coordenação e integração:** Ricardo Severiano de Souza Filho
- **Produto e requisitos:** Júlia Oliveira Veríssimo
- **UX/UI e Figma:** Diogo Silas Woolley do Carmo
- **Frontend:** Thomaz Barros Costa
- **Backend e API:** Bruno Sotomayor Martin
- **Banco de dados e indicadores:** Pedro Iranildo dos Santos Monteiro
- **Qualidade e DevOps:** Luiz Henrique Rocha Silva
- **Documentação e validação:** Eliziane Mota de Souza

Cada integrante desenvolve em sua branch. Alterações seguem por pull request com CI e revisão independente válidas; a `main` recebe apenas o conjunto aprovado, com publicação manual controlada na homologação.

**Licença:** permanece a definir em decisão conjunta da ReTech+ e dos integrantes estudantes. Nenhuma licença de código aberto foi aplicada enquanto essa decisão está pendente.
