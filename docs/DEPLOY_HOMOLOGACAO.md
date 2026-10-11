# Publicar a homologação ReNR+ com orçamento zero

## Estado desta preparação

Esta rodada adapta a v0.1 para publicação, sem alterar os cadastros ou substituir a stack.
O código está preparado para revisão; não há commit, push ou publicação desta rodada.
O serviço Render não foi criado: sua criação pode iniciar o primeiro deploy, mesmo com atualizações automáticas desativadas.

O projeto **ReNR+ — Homologação** foi criado no Neon, plano **Free**, PostgreSQL 17,
região AWS Ohio. O banco é `renr_homologation`. IA, Auth, Functions e armazenamento
do Neon não foram ativados. A autenticação existente continua pertencendo à aplicação.

## Pré-requisitos

- Ricardo autoriza os commits e revisa as pull requests.
- Todos os pacotes desta rodada estão integrados e os checks passaram.
- A publicação tem autorização específica, separada da autorização de commit.
- Render e Neon permanecem nos planos Free, sem cartão ou compra de domínio.
- Não há dados reais de colaboradores no ambiente de homologação.

O serviço público será um único container: React compilado e API NestJS na mesma origem.
Não usar `pnpm dev`, `vite preview`, MinIO local ou armazenamento efêmero do container para arquivos permanentes.

## Preparar o banco

Em produção, `apps/api/prisma.config.ts` exige `DATABASE_URL_UNPOOLED`.
Em desenvolvimento e testes, usa somente `DATABASE_URL`, mesmo que exista uma variável online residual.
Isso mantém as migrações na conexão direta e as consultas da API na conexão com pool.
As URLs privadas usam `sslmode=verify-full`. A configuração traduz somente a URL
do Prisma CLI para `sslmode=require&sslaccept=strict`, formato da engine utilizada,
mantendo validação do certificado e do nome do servidor. O driver da API mantém `verify-full`.
O banco não é migrado automaticamente: `RUN_MIGRATIONS=false` por padrão.

1. No Neon, selecionar o projeto ReNR+ — Homologação e copiar a conexão do banco `renr_homologation`.
2. Guardar os valores em `.env.homologation`, incluindo `NODE_ENV=production`. O arquivo é ignorado pelo Git; nunca copiá-lo para os pacotes dos membros.
3. Usar o host direto em `DATABASE_URL_UNPOOLED`, o host com `-pooler` em `DATABASE_URL` e `sslmode=verify-full` nas duas URLs.
4. Na raiz do repositório, executar somente após confirmar o banco de homologação:

```bash
node --env-file=.env.homologation node_modules/pnpm/bin/pnpm.cjs db:deploy
```

Se pnpm estiver disponível no terminal, a alternativa é carregar as mesmas variáveis
no ambiente e executar `pnpm db:deploy`. Não usar `migrate reset` ou `migrate dev` no Neon.

Para preparar contas fictícias, adicionar ao arquivo privado:

```dotenv
ALLOW_HOMOLOGATION_PROVISION=true
HOMOLOGATION_CONFIRM_HOST=ep-little-credit-b4nv0pzr.c-6.us-east-2.aws.neon.tech
HOMOLOGATION_CONFIRM_DATABASE=renr_homologation
# Preencher HOMOLOGATION_PASSWORD com uma senha nova, aleatória, de 16 a 256 caracteres.
```

Depois de compilar a API e aplicar as migrações, executar manualmente:

```bash
node --env-file=.env.homologation scripts/provision-homologation.mjs
```

O provisionamento exige confirmação exata do host e do banco, valida TLS e preserva
registros existentes. Não altera senhas de contas já criadas. Nunca roda no início
do container. `scripts/seed-demo.mjs` continua limitado ao desenvolvimento local.
Remover a autorização e a senha de provisionamento do arquivo após a operação.
Não registrar essas variáveis no Render: o servidor não precisa delas.

## Preparar o serviço Render

O arquivo `render.yaml` declara somente um Web Service Free. Não cria banco Render,
disco persistente, worker ou cron. `autoDeployTrigger: off` e previews desativados
evitam publicação automática de novos commits; não impedem o primeiro deploy.

Após a autorização para publicar e depois do merge dos pacotes:

1. Criar o serviço Docker a partir de `https://github.com/byteric/renr-plus`, branch `main`.
2. Selecionar plano **Free**, região **Ohio**, contexto `.`, Dockerfile `./Dockerfile`.
3. Desativar atualizações automáticas. Não instalar integrações com acesso a outros repositórios.
4. Preencher `DATABASE_URL` e `DATABASE_URL_UNPOOLED` com as conexões privadas do Neon.
5. Preencher `CORS_ORIGIN` com a origem HTTPS exata atribuída ao serviço, sem barra final ou caminho.
6. Confirmar os valores da tabela abaixo antes de iniciar o deploy.

| Variável                | Valor                                             |
| ----------------------- | ------------------------------------------------- |
| `NODE_ENV`              | `production`                                      |
| `HOST`                  | `0.0.0.0`                                         |
| `PORT`                  | `10000`                                           |
| `SERVE_WEB`             | `true`                                            |
| `WEB_DIST_PATH`         | `/app/apps/web/dist`                              |
| `STORAGE_ENABLED`       | `false`                                           |
| `RUN_MIGRATIONS`        | `false`                                           |
| `CORS_ORIGIN`           | Origem HTTPS exata do serviço                     |
| `DATABASE_URL`          | Conexão Neon com pool e TLS verificado            |
| `DATABASE_URL_UNPOOLED` | Conexão Neon direta, mesmo banco e TLS verificado |

Não preencher credenciais S3 falsas. Ao implementar anexos, ativar armazenamento
durável privado e revisar os custos antes de habilitar `STORAGE_ENABLED`.

## Conferir o link antes de entregar

- A página inicial e uma rota da interface recarregam sem o servidor Vite.
- `/api/v1/health` retorna 200; `/api/v1/ready` retorna 200 com PostgreSQL acessível.
- Um endpoint inexistente em `/api/v1` retorna erro JSON, nunca o HTML da interface.
- Login, logout e cadastros funcionam em navegador desktop e mobile pelo HTTPS.
- Administrador pode alterar cadastros; leitor não pode. Empresas não acessam dados umas das outras.
- Cookie de sessão é `HttpOnly` e `Secure`; origem não autorizada recebe rejeição.
- `/api/docs`, arquivos ocultos e credenciais não ficam disponíveis publicamente.
- O serviço continua acessível depois de um reinício, com dados preservados no Neon.

O limite de tentativas de login permanece em memória e o proxy não é confiado
automaticamente. Em uma demonstração pequena, acessos podem compartilhar esse limite.
Antes de ampliar o público, revisar o proxy e um limitador distribuído sem desativar a proteção atual.

## Falha e retorno à versão anterior

Se login, isolamento, persistência ou checks falharem, não liberar o link.
Se o serviço já existir, suspender a entrega e voltar ao último commit publicado
que tenha sido verificado. Não apagar tabelas ou reverter migrações por tentativa.
Nesta rodada, o schema de negócio não muda: apenas a conexão de migração foi adaptada.
No primeiro deploy não há versão pública anterior; manter o serviço sem acesso e corrigir antes da entrega.

## Limites do orçamento

O Render Free suspende por inatividade e tem cotas mensais; o primeiro acesso pode ser lento.
O Neon Free também impõe limites de armazenamento e computação. Não habilitar planos pagos,
cartão, ferramentas para evitar suspensão ou atualizações automáticas de plano.
Ao atingir uma cota, interromper ou reduzir a demonstração em vez de contratar recursos.

Fontes oficiais: [Render Free](https://render.com/docs/free),
[Blueprint Render](https://render.com/docs/blueprint-spec),
[Neon e Prisma](https://neon.com/docs/guides/prisma).
