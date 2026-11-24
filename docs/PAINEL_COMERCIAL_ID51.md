# ID 51 — Painel comercial, alertas e ações rápidas

**Estado:** Implementado e verificado localmente (sem commit, push, PR ou deploy). Operação 100% manual com custo externo R$ 0.

## 1. Cadastro de empresa por CNPJ no catálogo e orientação em grupos

- **Endpoint:** `POST /api/v1/platform/clients` (exige `Origin` válido e concessão global `MANAGE_CLIENTS`, sem criar nova permissão fora da matriz do ID 34).
- **Regras reutilizadas:** mesma validação de CNPJ numérico/alfanumérico (`validCnpj`, módulo 11), `pg_advisory_xact_lock` por CNPJ normalizado, rejeição `409 Conflict` em duplicidade ou classificação `CLIENT` sem CNPJ válido, registro em `OrganizationRegistrationRevision` (v1) e `PlatformAuditEvent` (`CLIENT_REGISTRATION_CREATED`). Não cria `Membership` nominal na empresa.
- **Consulta global somente leitura (`READ_OVERVIEW`):** permanece estritamente leitura (`403` em `POST`/`PATCH /platform/clients`, sem botões de cadastro/correção na interface).
- **Interface:**
  - `#/plataforma` (`PlatformWorkspace.tsx` + `ClientCreator`): botão **Cadastrar empresa** e suporte ao atalho `#/plataforma?action=new-client`.
  - `#/plataforma/grupos` (`CompanyGroupsAdmin.tsx`): explica que a composição de grupos usa empresas já cadastradas e elegíveis no catálogo, oferecendo atalho direto para cadastro por CNPJ.

## 2. Setores ativos em colaboradores e férias fictícias na ReNR Dev Studio

- **Seleção de setores (`WorkforceEditor.tsx` e `ReferenceSelect.tsx`):**
  - Carrega até 100 unidades/setores ativos por página mantendo paginação e busca quando houver mais registros.
  - Diferencia explicitamente lista vazia de setores ativos da falha de carregamento (`503`/rede).
  - Limpa setor ao trocar de unidade e limpa seleções herdadas incompatíveis/inativas em novos cadastros, exibindo erros inline acessíveis (`aria-invalid`/`aria-describedby`).
- **Histórico fictício de férias na ReNR Dev Studio (`scripts/seed-mvp-people-demo.mjs`):**
  - Organização fictícia `ReNR Dev Studio` (CNPJ `45997418000153`, 2 unidades, 3 setores ativos, 25 colaboradores ativos): 5 vencidas (`OVERDUE`), 5 próximas do vencimento (`DUE_SOON`), 10 regulares (`REGULAR`) e 5 com histórico desconhecido (`UNKNOWN`) no setor `Operações e Suporte`.
  - Conta RH `rafael-rh@renr.example` (`READER` + `HR_ANALYTICS_READ` + `HR_PROFILE_READ`, sem acesso salarial).
- **Correção cirúrgica no cálculo (`people-analytics.service.ts`):** quando o recorte tem `vacationKnown === 0` (histórico 100% desconhecido ou sem elegíveis), `vacationOverdue` e `vacationDueSoon` passam a retornar `INSUFFICIENT_DATA` (`value: null`) em vez de `0`, alinhando-se à regra de que desconhecidos não são tratados como zero.

## 3. Painel comercial consolidado, alertas internos e ações rápidas

- **Endpoint:** `GET /api/v1/platform/commercial/dashboard` (`Cache-Control: private, no-store`, transação `RepeatableRead` para reconciliação consistente no mesmo instante).
- **Autorização por domínio:** exige ao menos uma concessão comercial (`READ/MANAGE_COMMERCIAL`, `READ/MANAGE_BILLING` ou `READ/MANAGE_CONTRACT_ACCESS`). Leitor global (`READ_OVERVIEW`) sem concessão comercial recebe `403`.
  - `billing` e alertas `BILLING_*` são retornados **exclusivamente** para `READ_BILLING`/`MANAGE_BILLING` (`null` para os demais perfis).
  - `contracts` e alertas `CONTRACT_*` são retornados exclusivamente para `READ_COMMERCIAL`/`MANAGE_COMMERCIAL`.
  - `contractAccess` e alertas `CONTRACT_ACCESS_*` são retornados exclusivamente para `READ_CONTRACT_ACCESS`/`MANAGE_CONTRACT_ACCESS`.
- **Deduplicação de alertas:** chave determinística por origem (`BILLING_OVERDUE:<orgId>`, `BILLING_DUE_SOON:<orgId>`, `CONTRACT_EXPIRED:<orgId>:<contractId>`, `CONTRACT_EXPIRING_SOON:<orgId>:<contractId>`, `CONTRACT_DOCUMENT_PENDING:<orgId>:<contractId>`, `CONTRACT_ACCESS_SUSPENDED:<orgId>:<accessId>`, `CONTRACT_ACCESS_UNRECORDED:<orgId>:<contractId>`, `CLIENT_FISCAL_PENDING:<orgId>`).
- **Interface:** `#/plataforma/comercial?secao=painel` (ou aba **Painel comercial** em `#/plataforma/comercial`), com filtros de competência e janela de renovação, ações rápidas condicionadas às permissões, lista de alertas com atalho para a origem e tabela semântica reconciliada.
- **Chamados (ID 50):** o painel mostra pendências, prazos e atalhos para o chamado de origem a quem tem concessão de suporte. [Operação de chamados](CHAMADOS_E_AJUDA_ID50.md).

## Pendências registradas

- **Métricas de receita reconhecida / por plano:** permanecem fora desta etapa até fechamento das definições comerciais.
- **Reteste na homologação:** não há alterações na homologação; após aprovação e publicação controlada, registrar o reteste no roteiro do ID 36.
