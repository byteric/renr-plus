# Cobranças, vencimentos e pagamentos — ID 47

O controle financeiro manual do ID 47 estende a área **Plataforma → Comercial** sobre os planos versionados (ID 45) e contratos comerciais (ID 46), sem gateway externo e com custo zero em novas contratações.

## Acessos e isolamento

Em **Plataforma → Administração da plataforma → Concessões globais**, quem administra concessões libera permissões financeiras dedicadas e revogáveis:

- **Consultar cobranças e pagamentos (`READ_BILLING`):** consulta contratos faturáveis (sem dados privados do cadastro comercial, termos jurídicos ou PDFs), listagem paginada de cobranças, resumo reconciliado do período e trilha histórica de revisões.
- **Gerenciar cobranças e pagamentos (`MANAGE_BILLING`):** inclui a consulta financeira e permite registrar cobranças manuais, confirmar recebimentos e registrar correções com histórico.

Perfis empresariais, leitores globais (`READ_OVERVIEW`) e operadores comerciais (`READ_COMMERCIAL` / `MANAGE_COMMERCIAL`) sem concessão financeira recebem `403` em todas as rotas de cobrança e não visualizam a aba financeira. A revogação da concessão bloqueia imediatamente as próximas requisições.

## Regras de situação e reconciliação

A data civil de referência segue `America/Sao_Paulo`:

- **Em aberto (`OPEN`):** sem data de recebimento (`paidOn = null`) e com vencimento igual ou posterior à data de referência (`dueOn >= referenceDate`).
- **Vencida (`OVERDUE`):** sem data de recebimento (`paidOn = null`) e com vencimento estritamente anterior à data de referência (`dueOn < referenceDate`).
- **Paga (`PAID`):** com data de recebimento confirmada (`paidOn != null`, nunca futura) e referência opcional do comprovante (`receiptReference`).

No mesmo recorte (empresa/contrato e intervalo de competências), o resumo do período reconcilia obrigatoriamente:

- `billedCents = openCents + overdueCents + receivedCents`
- `counts.total = counts.open + counts.overdue + counts.paid`

Cada cobrança vincula-se ao contrato da empresa, ao termo contratual faturável (`contractRevisionId`, limitado antes de revisões futuras substitutivas como emendas, renovações ou cancelamentos) e ao retrato imutável da versão do plano contratado (`planVersionId`). Termos futuros agendados com cobranças vinculadas não podem ser retirados via `WITHDRAW_SCHEDULED`.

## Correções com histórico e prevenção de duplicidade

- Toda criação (`CREATED`), confirmação de recebimento (`PAYMENT_CONFIRMED`) e correção (`CORRECTION`, inclusive estorno de baixa) grava uma revisão imutável em `commercial_billing_charge_revisions` com autor, instante, motivo e retrato completo. Triggers no PostgreSQL impedem alteração/exclusão da trilha e exclusão ou sobrescrita sem incremento de versão no cabeçalho.
- A prevenção de gravações concorrentes ou repetidas combina bloqueio transacional (`pg_advisory_xact_lock`), controle otimista por `expectedVersion`, restrição única por `(organization_id, contract_id, competence)`, índice único parcial por `(organization_id, idempotency_key)` e verificação de estado (`paid_on IS NULL` na confirmação de recebimento), recusando duplicidades e corridas paralelas com `409 Conflict`.

## API

Prefixo: `/api/v1/platform/commercial/billing`. Todas as respostas retornam `Cache-Control: private, no-store`; escritas exigem cabeçalho `Origin` configurado e aceitam `Idempotency-Key` (UUID).

| Método e caminho                                     | Permissão        | Resultado                                                                  |
| ---------------------------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `GET /contracts`                                     | `READ_BILLING`   | Lista paginada de empresas contratadas e termos faturáveis (mínimo acesso) |
| `GET /charges`                                       | `READ_BILLING`   | Lista paginada de cobranças + resumo reconciliado do período               |
| `GET /clients/:orgId/charges/:chargeId`              | `READ_BILLING`   | Detalhe da cobrança com histórico imutável de revisões                     |
| `POST /clients/:orgId/contracts/:contractId/charges` | `MANAGE_BILLING` | Lançamento manual de cobrança (em aberto ou já recebida)                   |
| `POST /clients/:orgId/charges/:chargeId/payment`     | `MANAGE_BILLING` | Confirmação manual de recebimento e referência opcional do comprovante     |
| `POST /clients/:orgId/charges/:chargeId/corrections` | `MANAGE_BILLING` | Correção versionada preservando revisões anteriores                        |

## Roteiro rápido de teste na interface

1. Conceda `MANAGE_BILLING` em **Plataforma → Administração da plataforma → Concessões globais**.
2. Acesse **Plataforma → Comercial → Cobranças e pagamentos** (`#/plataforma/comercial`).
3. Confira os indicadores **Total cobrado**, **Em aberto**, **Vencido** e **Recebido**, filtre por empresa, competência (`AAAA-MM`) ou situação.
4. Clique em **Registrar cobrança** para lançar uma competência fictícia vinculada ao termo contratual e versão do plano.
5. Abra **Detalhes** de uma cobrança em aberto ou vencida, execute **Confirmar recebimento** (com referência opcional de comprovante) e depois **Registrar correção** para confirmar que o **Histórico da cobrança** preserva todas as revisões anteriores.
