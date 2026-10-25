# Acessos e ativação — IDs 03 e 04

Estado: implementação local; sem publicação, alteração de contas remotas ou redefinição de senhas.

## Operação

Na empresa ativa, administradores abrem **Acessos**. A área possui membros, convites e histórico paginados. Leitores não têm acesso à gestão; o servidor também verifica tenant, vínculo ativo e papel em cada operação.

Ao gerenciar um membro, perfil/situação e capacidades são operações separadas. Ambas exigem justificativa. Desativar requer confirmação e mantém conta, autoria e vínculos com outras empresas. O último administrador ativo não pode ser removido, inclusive por solicitações concorrentes.

Administrador não recebe permissão técnica automaticamente. `TECHNICAL_DECISIONS` e `EXECUTE_ASSIGNED_ACTIONS` são concessões explícitas. Atribuição persistida e operações de execução delegada serão integradas no ID 13; esta entrega fornece a política, não escrita global de ações ao leitor.

## Convite individual

1. Informar nome, e-mail, perfil inicial, capacidades, validade de 1 a 168 horas e justificativa.
2. Entregar manualmente o link exibido uma única vez. Não há envio de e-mail nem autocadastro sem convite.
3. Conta nova define nome e senha de 12 a 256 caracteres; conta existente entra com sua própria senha antes de aceitar o vínculo. O convite nunca troca uma senha existente.
4. Reemitir invalida o link anterior. Revogar impede aceitação. Convite já utilizado não pode ser reutilizado.
5. Fechar o link ou navegar para outra seção descarta sua exibição. Não há recuperação do segredo; o gestor deve reemitir quando necessário.

O fragmento secreto é removido imediatamente da URL nas variantes com/sem barra. O código fica apenas em memória durante a ativação; não é persistido em localStorage/sessionStorage. Atualizar a página exige reabrir o link ou colar o código. A aplicação não envia o segredo no caminho/query HTTP, nem o inclui em listagens, histórico ou logs.

## Recuperação e consistência

Conflito de versão na edição mantém o rascunho e bloqueia reenvio até recarregar a versão atual. O gestor compara situação, perfil e capacidades antes de confirmar novamente. Não há sobrescrita silenciosa.

Convite indisponível retorna `409 ACCESS_INVITE_UNAVAILABLE`, sem revelar se expirou, foi consumido, revogado ou não existe. A interface descarta segredo/senha e orienta pedir reemissão. Conflito com vínculo já ativo continua `409 CONFLICT`. Sessão expirada remove o conteúdo privado; permissão perdida interrompe a gestão.

O histórico identifica autorizador, operação, justificativa e data. Segredos, senhas e conteúdo de arquivos não fazem parte desse histórico. Datas da interface usam o fuso do navegador; padronização no fuso organizacional pertence ao histórico unificado do ID 22.

## Contratos e segurança

Contrato executável: `packages/contracts/src/access.ts`. Contrato OpenAPI do módulo: `apps/api/src/modules/access/access.openapi.json`. Operação, migração aditiva, rollback e fronteiras de autorização: `apps/api/src/modules/access/README.md`.

As sessões antigas mantêm seu DTO estrito. Capacidades são consultadas separadamente em `GET /api/v1/auth/session-capabilities`. Não migrar autenticação para outro provedor. Cookies, Origin, isolamento e erros sanitizados permanecem no backend.

A migração mantém o schema expandido em um retorno de aplicação. Versão anterior que ignora inativação não é retorno seguro para acessos: preservar os controles desta versão ou suspender acesso autenticado até correção por avanço. Não executar down destrutivo/reset de banco.

## Limites desta entrega

Sem SMTP, recuperação de senha, SSO, diretório global de contas ou poderes técnicos implícitos. Sem mudança em Render, Neon ou Supabase. A correção do storage online permanece no ID 19; acabamento de dashboard/aba nos IDs 24/27; divergências preexistentes de FKs no ID 31. Não foram alterados pacotes de membros ou tutoriais de commit.

Resultados e evidências locais estão em `VERIFICACAO_ID03_ID04.md`.
