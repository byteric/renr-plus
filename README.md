# ReNR+

Plataforma de apoio à gestão preventiva da NR-01 e de fatores de risco psicossociais
relacionados ao trabalho, no Programa de Residência Tecnológica do Porto Digital / ReTech+.

## O que o ReNR+ faz

O ReNR+ reúne o diagnóstico coletivo, o inventário de riscos e o acompanhamento das
medidas preventivas. O histórico liga cada decisão à coleta, ao método ou à evidência
que a fundamentou. O acesso a cada área depende da empresa e das permissões do perfil.

| Área                    | O que é possível fazer                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Diagnóstico             | Configurar instrumentos, abrir coletas por convite e consultar resultados coletivos com regras de proteção.                    |
| Riscos e ações          | Registrar riscos e avaliações, acompanhar responsáveis e prazos, anexar evidências, revisar eficácia e registrar reavaliações. |
| Painel e auditoria      | Navegar por indicadores, filtrar prioridades e consultar o histórico de registros e alterações.                                |
| Gestão de Pessoas       | Consultar indicadores e estimativas demonstrativas conforme as permissões de RH.                                               |
| Plataforma e relatórios | Acompanhar a cobertura por empresa com acesso administrativo e gerar PDFs com os recortes autorizados.                         |

[Acessar a homologação ReNR+](https://renr-plus-homologation.onrender.com).
O ambiente usa dados fictícios. O acesso às áreas de gestão é autorizado por perfil.
O primeiro acesso após inatividade pode demorar enquanto o serviço inicia.

O produto apoia o trabalho de prevenção. Diagnósticos clínicos e certificação de
conformidade ficam fora do escopo. As estimativas trabalhistas são demonstrativas e
o uso de dados reais de RH depende das validações descritas no guia de operação.

## Documentação

- [Entrega do MVP, critérios P0 e roteiro de demonstração](docs/ENTREGA_MVP.md)
- [Requisitos do produto](docs/PRD.md)
- [Gestão de Pessoas, administração da plataforma e relatórios](docs/GESTAO_PESSOAS_PLATAFORMA.md)
- [Contratos de auditoria](docs/API_AUDITORIA.md) e [indicadores](docs/API_INDICADORES.md)
- [Guia de ações e evidências](docs/USO_V04_V05.md)
- [Operação da homologação](docs/DEPLOY_HOMOLOGACAO.md)

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

Os testes de navegador que inspecionam os PDFs usam Python com `pypdf==6.14.2`.
Instale o pacote no ambiente Python utilizado pelos testes.

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

O Render serve o frontend e a API na mesma origem. O PostgreSQL fica no Neon e as
evidências usam armazenamento privado no Supabase. O serviço acompanha a `main` e
a publicação é manual, com o SHA aprovado no GitHub.

Antes de publicar, confirme os checks obrigatórios e aplique somente as migrações
versionadas pendentes pela conexão direta do Neon com TLS verificado. Depois,
confirme o SHA ativo e faça as verificações públicas e autenticadas do
[procedimento de entrega](docs/ENTREGA_MVP.md#publicação-controlada). Em caso de falha,
volte ao último deploy verificado e preserve o banco.

## Referências de implementação

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

Gestão de membros, convites individuais de ativação, capacidades explícitas,
desativação por empresa e histórico com justificativa. ADMIN não recebe poder técnico automaticamente.
A atribuição de ações a executores é limitada pelas permissões da empresa.

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
