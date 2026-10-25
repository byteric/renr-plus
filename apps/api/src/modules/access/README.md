# Acessos por organização — ID03

O módulo administra vínculos ADMIN/READER e capacidades explícitas
`EXECUTE_ASSIGNED_ACTIONS` e `TECHNICAL_DECISIONS`. ADMIN administra acessos e mantém
as escritas operacionais legadas; não recebe autorização técnica automaticamente.
Registrar autorização técnica não comprova habilitação profissional de SST.

O contrato OpenAPI 3.1 está em `access.openapi.json`; a API também publica as rotas
com schemas em `/api/docs-json` fora de produção. Os schemas Zod de
`packages/contracts/src/access.ts` são o contrato executável consumido pela web.
Todas as rotas têm o prefixo `/api/v1`.

| Operação                 | Rota                                                               | Retorno                                         |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------------------------- |
| Listar/consultar vínculo | GET `organizations/:orgId/access-memberships[/:userId]`            | Lista paginada ou vínculo                       |
| Alterar papel/situação   | PATCH `organizations/:orgId/access-memberships/:userId`            | Vínculo atualizado                              |
| Substituir capacidades   | PUT `organizations/:orgId/access-memberships/:userId/capabilities` | Vínculo atualizado                              |
| Consultar histórico      | GET `organizations/:orgId/access-history`                          | Lista paginada                                  |
| Listar/criar convite     | GET/POST `organizations/:orgId/access-invites`                     | Lista sem segredo / `{invite,token}`            |
| Revogar/reemitir         | POST `organizations/:orgId/access-invites/:id/revoke` ou `reissue` | Convite / `{invite,token}`                      |
| Aceitar                  | POST `access-invites/accept`                                       | `{organizationId,userId}`                       |
| Capacidades atuais       | GET `auth/session-capabilities`                                    | `{organizationId,capabilities,canManageAccess}` |

GET, PATCH e PUT retornam 200; POST retorna 201. Listas usam `page` (padrão 1) e
`pageSize` (padrão 50, máximo 100), retornando `{items,total,page,pageSize}`.
Alterações exigem `expectedVersion` e `reason` com 3–1000 caracteres; versão
divergente retorna 409. Alterar somente o papel não altera capacidades existentes.
Concessões e revogações registram um evento por capacidade, autorizador legível,
motivo e data. O histórico não permite atualização pelo banco nem exclusão pela API.

## Autorização e concorrência

Gestão e histórico exigem ADMIN ativo na empresa ativa da sessão. Tenant diferente
retorna 404, leitor retorna 403 e ausência de sessão retorna 401. Escritas validam
o Origin exato da aplicação, incluindo aceitação pública. Não se alteram contas
globais nem vínculos em outra organização. A resposta legada de sessão conserva o
DTO anterior, filtrando vínculos inativos e retornando organização ativa nula
quando aquele acesso deixou de existir.

Cada mutação obtém `SELECT ... FOR UPDATE` na organização antes de consultar o
vínculo do ator, contar administradores ou atualizar o alvo. Isso serializa duas
demissões/desativações concorrentes e impede retirar o último ADMIN ativo. O
controle otimista também cobre alterações de capacidade e estados de convite.
Autoria histórica continua apontando para o mesmo usuário após a desativação.

`IdentityService.requireCapability` reconsulta a sessão e o vínculo persistido em
cada operação. `assignedActionScope` exige capacidade de execução e compara tenant
e usuário atribuído de um recurso confiável carregado pelo servidor. O teste PG
exercita a política real com vínculo/capacidade persistidos e recursos atribuídos,
não atribuídos e estrangeiros. Esses recursos de teste não criam atribuição no
domínio: a persistência de atribuição pertence ao ID13. Até lá, nenhuma rota legada
de ação/evidência é liberada globalmente ao executor. ID13 deverá carregar a
atribuição persistida e aplicar a política às operações de início, acompanhamento
e evidência, revalidando-a dentro da transação de escrita.

## Convites manuais de ativação

Criar convite exige email, nome, papel, capacidades explícitas, motivo e duração
opcional de 1–168 horas (padrão 72). Não há SMTP, autocadastro nem credenciais
administrativas distribuídas. O token tem 32 bytes aleatórios, é entregue uma vez
na criação/reemissão e somente seu SHA256 permanece no banco. Nunca colocar o
token em query string, listagem, histórico ou logs; a UI entrega-o manualmente.
Rotas de acesso retornam `Cache-Control: private, no-store`.

Conta nova exige nome e senha de 12–256 caracteres ao consumir convite válido;
derivação scrypt ocorre fora da transação curta. Conta existente exige sessão da
mesma identidade e rejeita o campo senha; o hash existente permanece intacto.
Aceitar convite para vínculo já ativo retorna 409. Vínculo inativo é reativado
sem apagar autoria. Validade, revogação e consumo são rechecados sob lock antes de
criar usuário/vínculo e consumir o token atomicamente; só uma aceitação concorrente
vence. Reemissão revoga o token anterior e cria outro convite com validade de 72h.
Convite consumido ou revogado não pode ser reemitido; para retomar acesso revogado,
o administrador cria um convite novo. Aceitação limita 60 tentativas por IP/15min
em cada processo, com mapa limitado; persistência/distribuição de rate limit não é
parte desta etapa.

Na aceitação, token inexistente, expirado, revogado ou consumido retorna HTTP409
com `code=ACCESS_INVITE_UNAVAILABLE`, sem revelar qual estado o tornou inválido.
Colisão com vínculo ativo ou identidade mantém `code=CONFLICT`; a forma do objeto
de erro legado permanece igual. A interface pode descartar o segredo indisponível
e orientar a solicitação de outro convite.

## Migração e operação

`20261023000000_organization_access` é aditiva. Vínculos anteriores recebem
`isActive=true`, `version=1`, `capabilities=[]` e timestamp; papéis, usuários,
senhas, sessões, riscos, fichas, ações e revisões não são recriados. As tabelas
`access_invites` e `access_history` preservam autores com FKs restritivas. Índices
atendem listagem por organização/data/ID e consultas de autoria; o token tem
unicidade própria. Não executar reset ou regenerar seeds contra dados reais.

Em rollback de aplicação, conservar schema expandido, convites e histórico. Não
fazer down destrutivo nem remover colunas/tabelas com dados. Uma versão anterior
não conhece a inativação/capacidades: suspender temporariamente todo acesso autenticado
ou manter os controles de acesso desta versão até corrigir por avanço; reverter
somente binários não garante revogação. Migrações posteriores de correção devem
manter a trilha e as autorias. Publicação e rollback operacional exigem coordenação
do responsável pela implantação; este módulo não executa deploy.

## Verificação

`access.http.spec.ts` verifica sessão, Origin, rota individual e a separação de
capacidades; `access.integration.spec.ts` usa PostgreSQL local com dados próprios e
verifica tenant/perfil, revogação, concorrência do último ADMIN e consumo único,
convites expirados/revogados/reemitidos e senha existente preservada.
`scripts/access-migrations.test.mjs` verifica expansão de base preenchida e
compatibilidade de escrita legada, sendo chamado por `verify-migrations.mjs`.
Credenciais ficam apenas no ambiente do processo; testes recusam banco remoto.

Ameaças cobertas: escalada por tenant/perfil (scope e rechecagem transacional),
replay/roubo de convite (entropia, hash, prazo, uso único e identidade existente),
CSRF (cookie SameSite e Origin), perda de último administrador (lock comum),
repúdio (histórico transacional com autorizador) e vazamento de segredo (DTOs
explícitos, no-store e erros sanitizados). Segurança é responsabilidade do backend;
a visibilidade de botões na interface não substitui esses controles.
