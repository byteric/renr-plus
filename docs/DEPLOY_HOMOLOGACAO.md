# Publicar a homologação ReNR+ com orçamento zero

## Ambiente e fluxo de publicação

Os incrementos v0.4/v0.5 acrescentam ações preventivas e evidências privadas, sem substituir a stack.
Promova a integração completa para `main` por PR com CI e revisão independente válidas.
Publique manualmente o SHA resultante e confira o commit ativo antes de liberar o link.

- Aplicação: <https://renr-plus-homologation.onrender.com>.
- Serviço Render: `renr-plus-homologation`, plano **Free**, região **Ohio**.
- Branch do serviço: `main`; confirme o SHA ativo no histórico de deploys do Render.
- Atualizações automáticas e previews desativados; health check em `/api/v1/health`.
- A `main` permanece protegida; não use force push nem bypass das aprovações.

## Histórico de validação da v0.2

A homologação inicial foi publicada em **12/10/2026**, após revisão e CI aprovada na
[PR #21](https://github.com/byteric/renr-plus/pull/21), no commit `5e39aeb`.

Os oito checks públicos passaram: liveness, prontidão do PostgreSQL, HTML da interface,
erro JSON para API inexistente, dois endpoints protegidos sem sessão e bloqueio de arquivos
privados e Swagger. Doze checks autenticados também passaram, cobrindo cookies protegidos,
sessão, empresas, painel, unidades, isolamento entre empresas, permissões de leitor,
rejeição de origem indevida e logout. Nenhum cadastro de negócio foi alterado nessa verificação.
O painel e os temas foram conferidos no navegador; no tamanho de celular não houve rolagem horizontal.

Na primeira checagem, a prontidão retornou 503; na repetição retornou 200.
Se esse comportamento reaparecer, revisar a disponibilidade do banco antes de apresentar.
Estas são verificações de homologação, não certificação de conformidade ou teste de carga.

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
Depois de publicado, o código executa no Render e os dados persistem no Neon, inclusive com o PC de desenvolvimento desligado.
Não é necessário instalar o projeto nos dispositivos da mentoria: basta o link HTTPS e um acesso autorizado.

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

1. Use o serviço Docker existente, ligado a `https://github.com/byteric/renr-plus`, branch `main`. Não crie outro serviço para esta atualização.
2. Selecionar plano **Free**, região **Ohio**, contexto `.`, Dockerfile `./Dockerfile`.
3. Desativar atualizações automáticas. Não instalar integrações com acesso a outros repositórios.
4. Preencher `DATABASE_URL` e `DATABASE_URL_UNPOOLED` com as conexões privadas do Neon.
5. O primeiro deploy pode derivar a origem HTTPS de `RENDER_EXTERNAL_URL`, fornecida pelo Render. Depois, preencher `CORS_ORIGIN` com a origem HTTPS exata do serviço, sem barra final ou caminho.
6. Confirmar os valores da tabela abaixo antes de iniciar o deploy.

| Variável                | Valor                                             |
| ----------------------- | ------------------------------------------------- |
| `NODE_ENV`              | `production`                                      |
| `HOST`                  | `0.0.0.0`                                         |
| `PORT`                  | `10000`                                           |
| `SERVE_WEB`             | `true`                                            |
| `WEB_DIST_PATH`         | `/app/apps/web/dist`                              |
| `STORAGE_ENABLED`       | `true`                                            |
| `RUN_MIGRATIONS`        | `true`                                            |
| `CORS_ORIGIN`           | Origem HTTPS exata do serviço                     |
| `DATABASE_URL`          | Conexão Neon com pool e TLS verificado            |
| `DATABASE_URL_UNPOOLED` | Conexão Neon direta, mesmo banco e TLS verificado |

Configure `S3_ENDPOINT`, `S3_REGION` e `S3_BUCKET` a partir do projeto Supabase dedicado,
com bucket `renr-evidence` privado e região `us-east-2`. Guarde `S3_ACCESS_KEY` e
`S3_SECRET_KEY` somente nas variáveis privadas do Render. Nunca use credenciais fictícias
na homologação nem publique esses valores no repositório ou frontend.
Com `RUN_MIGRATIONS=true`, o startup executa as migrações aditivas pela conexão direta
antes de iniciar a API. Não execute seed, reset ou testes automatizados no banco remoto.
Para preparar variáveis antes da liberação, use **Environment → Save only** no Dashboard.
Atualizações por integrações podem iniciar um build mesmo com auto-deploy desativado;
nesse caso, cancele o build antecipado e preserve a última versão verificada.
O fallback de origem só funciona com `RENDER=true` e uma origem HTTPS oficial `onrender.com`.
Uma origem explícita sempre prevalece. Ausência, HTTP, caminho ou URL inválida impedem o início do serviço.
A origem do serviço permanece em `main`; a promoção da integração ocorre por PR aprovada.

## Conferir o link antes de entregar

Substituir a origem abaixo pela origem real do serviço, sem caminho ou barra final:

```bash
node scripts/check-hosted.mjs https://renr-plus-homologation.onrender.com
```

Esse é o endereço real da homologação. O script recusa HTTP,
origens fora de `onrender.com` e URLs com credenciais. Não envia senhas nem autentica;
confere liveness, PostgreSQL, HTML, API inexistente, endpoints protegidos e arquivos privados.
Se o primeiro acesso falhar por suspensão do plano gratuito, aguardar o serviço iniciar e repetir.
Qualquer saída `FALHOU` impede a liberação do link até revisão.

- A página inicial e uma rota da interface recarregam sem o servidor Vite.
- `/api/v1/health` retorna 200; `/api/v1/ready` retorna 200 com PostgreSQL acessível.
- Um endpoint inexistente em `/api/v1` retorna erro JSON, nunca o HTML da interface.
- Login, logout e cadastros funcionam em navegador desktop e mobile pelo HTTPS.
- O painel representa a empresa selecionada, permite nova tentativa e não recupera dados de outras empresas.
- Administrador pode alterar cadastros; leitor não pode. Empresas não acessam dados umas das outras.
- Cookie de sessão é `HttpOnly` e `Secure`; origem não autorizada recebe rejeição.
- `/api/docs`, arquivos ocultos e credenciais não ficam disponíveis publicamente.
- O serviço continua acessível depois de um reinício, com dados preservados no Neon.
- A demonstração funciona em outro dispositivo, com o computador de desenvolvimento desligado.

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
