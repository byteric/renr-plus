# API de Acesso Contratual — ID 48 (Ativação, Suspensão e Reativação)

Controle manual de acesso contratual por contrato comercial no ReNR+, mantendo separação estrita entre:

1. **Situação cadastral e fiscal da empresa** (`Organization.isActive`, `fiscalState`, `clientClassification`);
2. **Vínculos e concessões individuais** (`Membership.isActive`, `role`, `capabilities`, `hrCapabilities`, `scopeRestricted`, `MembershipScope`);
3. **Situação de acesso contratual** (`CommercialContractAccess` e histórico imutável `CommercialContractAccessTransition`).

## Permissões dedicadas (menor privilégio)

- `READ_CONTRACT_ACCESS`: consulta lista, resumo e histórico imutável em `/api/v1/platform/commercial/access/*`.
- `MANAGE_CONTRACT_ACCESS`: consulta e registra transições manuais (`ACTIVATION`, `SUSPENSION`, `REACTIVATION`) com validação de cabeçalho `Origin`, controle otimista de versão (`expectedVersion`) e chave de idempotência (`Idempotency-Key` ou `idempotencyKey`).
- Perfis `READ_OVERVIEW`, `READ_COMMERCIAL`, `MANAGE_COMMERCIAL`, `READ_BILLING`, `MANAGE_BILLING` e administradores empresariais recebem `403 Forbidden` nas rotas de gestão contratual.

## Rotas

Todas as respostas incluem `Cache-Control: private, no-store` e exigem sessão autenticada (`renr_session`).

- `GET /api/v1/platform/commercial/access/clients`
  - Query: `page`, `pageSize`, `organizationId?`, `search?`, `status?` (`UNRECORDED` | `ACTIVE` | `SUSPENDED`), `classification?`.
  - Retorna resumo reconciliado (`total = unrecorded + active + suspended`) e empresas contratadas paginadas.
- `GET /api/v1/platform/commercial/access/clients/:orgId`
  - Retorna situação cadastral (independente), situação contratual atual, versão de controle e histórico ordenado e imutável `transitions[]`.
- `POST /api/v1/platform/commercial/access/clients/:orgId/transitions`
  - Requer `MANAGE_CONTRACT_ACCESS` e `Origin` igual ao `CORS_ORIGIN`.
  - Payload: `expectedVersion` (`>= 0`), `kind` (`ACTIVATION` | `SUSPENSION` | `REACTIVATION`), `effectiveOn` (`YYYY-MM-DD`, não futura em `America/Sao_Paulo`), `reason` (3–1000), `nextStep` (3–500), `confirmed: true`, `idempotencyKey?`.
  - Máquina de estados:
    - `ACTIVATION`: `UNRECORDED -> ACTIVE` (`MANUAL_CONTRACT_ACTIVATION`), bloqueada para contrato `CANCELLED`.
    - `SUSPENSION`: `UNRECORDED | ACTIVE -> SUSPENDED` (`MANUAL_CONTRACT_SUSPENSION`).
    - `REACTIVATION`: `SUSPENDED -> ACTIVE` (`MANUAL_CONTRACT_REACTIVATION`), bloqueada para contrato `CANCELLED`.
  - Conflito de versão, transição inválida ou reutilização de `idempotencyKey` retornam `409 Conflict`.

## Aplicação no servidor e exposição do motivo/próximo passo

- Ao suspender, todas as sessões abertas com `active_organization_id = orgId` têm o contexto limpo na mesma transação (`active_organization_id = null`), sem alterar `organizations` ou `memberships`.
- Todas as operações protegidas da empresa (`IdentityService.scope`, `activate`, `login`, `capabilities`, `OrganizationsService.organizations`, downloads em `EvidenceService.download` e `ReportsService.member`, convites em `AccessService.accept`, coletas em `AssessmentsService` e `DiagnosticsService`, além de guardas transacionais) bloqueiam a empresa suspensa no servidor com `403` e código `CONTRACT_ACCESS_SUSPENDED` (sem vazar motivo ou próximo passo no corpo do erro).
- Na resposta de sessão (`GET /api/v1/auth/session` / `POST /api/v1/auth/sessions`), `suspendedOrganizations` inclui `reason` e `nextStep` **somente** quando o usuário possui vínculo ativo irrestrito de `ADMIN` na empresa suspensa; perfis `READER` ou delegados (`scopeRestricted`) recebem `reason: null` e `nextStep: null`; usuários revogados (`isActive: false`) não visualizam a empresa e recebem `404` nas rotas da organização.
- Dados, anexos, histórico e vínculos são preservados; ao reativar, somente vínculos que permanecem `isActive: true` retomam acesso.
- Operação 100% manual, sem bloqueio automático por atraso ou integrações externas.
