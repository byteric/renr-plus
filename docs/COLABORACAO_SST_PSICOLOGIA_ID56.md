# ID 56 — Colaboração Técnica entre SST e Psicologia Organizacional

**Estado — Preparação técnica, correções do RH e ensaio local validados com dados fictícios. Gravação de contribuições permanece DESABILITADA por padrão na homologação (`RISK_COLLABORATION_WRITES_ENABLED=false`) até aprovação formal das decisões de negócio.**

## 1. Correções do RH entregues e verificadas (retorno de 24/11)

1. **Novo ciclo em Diagnóstico demonstrativo (`Diagnostics.tsx`):**
   - Carregamento de **unidades**, **setores** e **instrumento demonstrativo** desacoplado (`Promise.allSettled` / efeitos independentes com `AbortController`).
   - Quando a empresa não possui instrumento demonstrativo v1 publicado (`404` em `/diagnostic-instrument`), as unidades e setores ativos continuam carregando normalmente sem o aviso genérico `"Este registro não está mais disponível"`. O formulário explica o pré-requisito ausente e orienta usar **Coletas** (instrumentos versionados) ou publicar o instrumento demonstrativo.
   - Sem unidades ativas ou sem setores ativos na unidade selecionada, o formulário informa o pré-requisito e o link para **Estrutura**.
   - Ao trocar de empresa, seleções anteriores são descartadas e requisições atrasadas são ignoradas.
   - Permissão vigente preservada: criar ciclos continua exclusivo de `ADMIN` sem restrição de recorte.

2. **Ação preventiva a partir de um risco com o perfil da Camila (`READER` + `TECHNICAL_DECISIONS`):**
   - Em **Ações** (`ActionList.tsx`), o fluxo exibe um seletor direto de **riscos registrados elegíveis** (unidade e setor ativos) com link para o formulário `#/acoes/nova?riskId=...` e atalho para o inventário filtrado por registrados.
   - Em **Inventário → Detalhe do risco** (`RiskDetail.tsx`) e **Nova ação** (`ActionForm.tsx`), estados impeditivos (`DRAFT`, `ARCHIVED`, unidade/setor inativos) e restrições de perfil ou recorte exibem explicação objetiva.
   - Na API (`POST /risks/:riskId/actions`, `POST /risks/:riskId/action-workspaces` e `GET /action-assignees`), `ADMIN` ou `TECHNICAL_DECISIONS` (ambos com `!scopeRestricted`) podem criar ações preventivas a partir de riscos elegíveis. `ADMIN` permanece obrigatório para edição/atribuição/arquivamento de evidências, e `ADMIN + TECHNICAL_DECISIONS` permanece obrigatório para ação corretiva. A conta demonstrativa da Camila mantém menor privilégio (`READER` + `TECHNICAL_DECISIONS`), sem promoção a `ADMIN`.

## 2. Arquitetura da Colaboração Técnica (SST × Psicologia Organizacional)

### 2.1 Matriz de permissões e visibilidade (reutilizando a matriz vigente)

| Perfil / vínculo                                                                              | Ler `RESTRICTED` (própria área) | Ler `RESTRICTED` (outra área) | Ler `SHARED`                                         | Criar / editar / compartilhar / arquivar / anexar                                  | Decisões formais SST (avaliação, eficácia, reavaliação, encerramento) |
| --------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **SST** (`TECHNICAL_DECISIONS`, `!scopeRestricted`)                                           | Sim (SST)                       | **Não (404/oculto)**          | Sim                                                  | Sim, apenas próprias contribuições `SST` (quando flag ativa)                       | **Mantido intacto**                                                   |
| **Psicologia Organizacional** (`PSYCHOLOGY_COLLABORATION`, `!scopeRestricted`)                | Sim (Psicologia)                | **Não (404/oculto)**          | Sim                                                  | Sim, apenas próprias contribuições `PSYCHOLOGY_ORGANIZATIONAL` (quando flag ativa) | **Não (403)**                                                         |
| **`ADMIN` puro** (sem capability técnica)                                                     | **Não (oculto)**                | **Não (oculto)**              | Sim                                                  | **Não (403)**                                                                      | **Não (403)**                                                         |
| **RH (`HR_*`), Gestor (`EXECUTE_ASSIGNED_ACTIONS`), Auditor/Leitor**                          | **Não (oculto)**                | **Não (oculto)**              | Sim, somente no seu recorte de empresa/unidade/setor | **Não (403)**                                                                      | **Não (403)**                                                         |
| **Operador de plataforma sem vínculo / Outra empresa / Vínculo revogado / Contrato suspenso** | **Não (404/403)**               | **Não (404/403)**             | **Não (404/403)**                                    | **Não (404/403)**                                                                  | **Não (404/403)**                                                     |

### 2.2 Garantias de sigilo, histórico, anexos e PDF SST

- **Escopo estrito:** apenas fatores psicossociais do trabalho, organização do trabalho, recomendações preventivas coletivas e próximo passo. Campos clínicos individuais são rejeitados pelo contrato (`.strict()`).
- **Histórico imutável:** `risk_technical_contribution_revisions` possui trigger `BEFORE UPDATE OR DELETE` no PostgreSQL. `risk_technical_contributions` impede `DELETE`, exige incremento estrito de `version` (controle de concorrência otimista) e proíbe reverter `SHARED → RESTRICTED`.
- **Zero vazamento de revisões e anexos pré-compartilhamento:** quando uma contribuição `RESTRICTED` (v1/v2) é promovida para `SHARED` (v3), revisões e anexos criados sob `RESTRICTED` continuam invisíveis para a outra especialidade, `ADMIN`, RH, auditoria e PDF SST (exceto anexos explicitamente marcados com `shareAttachments: true` no ato do compartilhamento).
- **Auditoria neutra (`AuditEvent`):** registra `resourceId = contribution.id` (nunca `riskId`) e `reason = null`, impedindo qualquer vazamento de texto reservado na seção `history` do relatório SST.
- **Anexos privados:** validação de extensão, MIME, magic bytes (PDF/PNG/JPEG), tamanho ≤ 5 MiB, SHA-256, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` e revalidação dupla (pré e pós-stream) de vínculo, capability, visibilidade, recorte e contrato ativo.
- **Relatório PDF SST (`report-sst.ts`):** inclui exclusivamente contribuições `SHARED` e metadados de anexos `SHARED` (sem binários); exclui integralmente registros e anexos `RESTRICTED`.

## 3. Trava obrigatória na homologação (`RISK_COLLABORATION_WRITES_ENABLED`)

- Variável de ambiente em `apps/api/src/config/env.ts`: `RISK_COLLABORATION_WRITES_ENABLED` com padrão **`false`**.
- **Na homologação/produção (`false`):** todas as rotas de escrita (`POST`, `PATCH`, `/share`, `/archive`, `/attachments`) retornam **`403 COLLABORATION_WRITES_DISABLED`**; a interface exibe o aviso de gravação desabilitada aguardando validação.
- **No ensaio local com contas fictícias:** definir `RISK_COLLABORATION_WRITES_ENABLED=true` apenas no processo local de teste/demonstração.

## 4. Onde testar localmente

1. **RH — Novo ciclo:** `#/diagnostico` → **Novo ciclo** (com conta `ADMIN`, testar empresa sem instrumento demonstrativo e empresa com instrumento demonstrativo + troca de empresa).
2. **RH — Ação preventiva (Camila SST):** `#/acoes` (seletor **Risco registrado elegível**) e `#/inventario/<riskId>` (botão **Criar ação preventiva** em risco `REGISTERED` ativo; aviso explicativo em risco `DRAFT`/`ARCHIVED` ou perfil sem permissão).
3. **Colaboração SST × Psicologia:** `#/acessos` (conceder `Colaboração técnica (Psicologia Organizacional)` à conta fictícia de Psicologia) → `#/inventario/<riskId>` → seção **Colaboração · Contribuições interdisciplinares** → testar criação reservada, isolamento entre SST e Psicologia, edição versionada, compartilhamento explícito, anexos privados, revogação imediata e emissão do PDF em `#/relatorios`.

## 5. Decisões de negócio pendentes (bloqueiam ativação na homologação)

| #   | Decisão pendente                                                                                                                                            | Responsáveis                             | Comportamento provisório implementado no ensaio local                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Tipos de contribuição e campos finais** (ex.: se haverá taxonomia adicional de fatores psicossociais ou obrigatoriedade de vínculo com avaliação técnica) | ReTech+, SST e Psicologia Organizacional | 4 tipos coletivos (`PSYCHOSOCIAL_ANALYSIS`, `WORK_ORGANIZATION_NOTE`, `PREVENTIVE_RECOMMENDATION`, `TECHNICAL_FOLLOW_UP`), sem dados clínicos individuais. |
| 2   | **Visibilidade de registros `SHARED` para `ADMIN` puro, RH e gestores na tela do risco**                                                                    | ReTech+, Jurídico/LGPD, SST e Psicologia | `SHARED` segue a visibilidade de leitura do risco na empresa (respeitando recorte de unidade/setor); `RESTRICTED` é exclusivo da especialidade de origem.  |
| 3   | **Inclusão automática de contribuições `SHARED` no PDF SST** vs seleção manual por relatório                                                                | ReTech+ e SST                            | Contribuições `SHARED` entram automaticamente na seção dedicada do PDF SST; registros `RESTRICTED` nunca entram.                                           |
| 4   | **Recorte por unidade/setor (`scopeRestricted`) para Psicologia Organizacional**                                                                            | ReTech+ e Psicologia                     | Mantido o padrão vigente da API: `scopeRestricted` limita a leitura ao recorte delegado e não habilita gravação técnica até definição formal.              |
| 5   | **Termo ético (CRP/NR-01/LGPD) de compartilhamento e prazo de retenção legal**                                                                              | Jurídico/LGPD, SST e Psicologia          | Aviso explícito de transição irreversível `RESTRICTED → SHARED` e vedação a prontuário individual; histórico permanece arquivado sem exclusão física.      |
| 6   | **Abertura de gravação na homologação**                                                                                                                     | ReTech+, SST e Psicologia                | Travada por padrão (`RISK_COLLABORATION_WRITES_ENABLED=false`) até registro de aprovação dos itens 1–5.                                                    |
