# Referência HTTP — ações e evidências

Prefixo: `/api/v1`. Todas as rotas exigem cookie de sessão, vínculo com a empresa
e contexto ativo correspondente. Escritas exigem ADMIN e `Origin` igual ao configurado.
Consultas e erros privados usam `Cache-Control: private, no-store`.
O OpenAPI completo permanece disponível em `/api/docs` somente em desenvolvimento/teste.

## Rotas

| Método | Caminho relativo                                                | Corpo/consulta                               | Sucesso                                     |
| ------ | --------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------- |
| POST   | `/organizations/:orgId/risks/:riskId/actions`                   | Criação abaixo                               | 201, ação                                   |
| GET    | `/organizations/:orgId/actions`                                 | Filtros abaixo                               | 200, página de ações                        |
| GET    | `/organizations/:orgId/actions/:id`                             | —                                            | 200, ação com origem e versão               |
| PATCH  | `/organizations/:orgId/actions/:id`                             | Edição/transição abaixo                      | 200, ação atualizada                        |
| POST   | `/organizations/:orgId/actions/:id/notes`                       | `expectedVersion`, `text` (10–2.000)         | 201, revisão                                |
| GET    | `/organizations/:orgId/actions/:id/revisions`                   | `page`, `pageSize`                           | 200, revisões da mais recente à mais antiga |
| GET    | `/organizations/:orgId/action-overview`                         | Sem filtros                                  | 200, totais e referência temporal           |
| POST   | `/organizations/:orgId/actions/:actionId/evidence`              | Multipart abaixo                             | 201, metadados                              |
| GET    | `/organizations/:orgId/actions/:actionId/evidence`              | `page`, `pageSize`                           | 200, metadados ativos e arquivados          |
| GET    | `/organizations/:orgId/actions/:actionId/evidence/:id/download` | —                                            | 200, bytes privados como anexo              |
| PATCH  | `/organizations/:orgId/actions/:actionId/evidence/:id`          | `expectedVersion`, `changeReason` (10–1.000) | 200, metadados arquivados                   |

Identificadores são UUIDs. Listas devolvem `{items,total,page,pageSize}`; página inicia
em 1, tamanho padrão 50 e máximo 100. Consultas desconhecidas, repetidas ou malformadas
são recusadas. Histórico e evidências mantêm paginação independente do detalhe.

## Criar uma medida

Campos obrigatórios: `title` (3–160), `description` (10–2.000), `responsibleName`
(3–120), `dueDate` (data civil real YYYY-MM-DD, anos 0001–9999), `expectedResult`
e `verificationCriterion` (10–2.000 caracteres), `expectedRiskVersion` (inteiro positivo).
`evaluationId` é opcional e deve identificar ficha do mesmo risco/empresa.

```json
{
  "title": "Organizar a distribuição de demandas",
  "description": "Revisar a distribuição de atividades da equipe fictícia.",
  "responsibleName": "Responsável fictício",
  "dueDate": "2026-11-20",
  "expectedResult": "Distribuição registrada para acompanhamento posterior.",
  "verificationCriterion": "Comparar o registro planejado com a execução informada.",
  "expectedRiskVersion": 2
}
```

O servidor define autoria, datas, versão inicial, estado PLANNED e snapshot da origem.
O risco deve estar REGISTERED e sua empresa/unidade/setor ativos. A criação não altera
a versão do risco. O nome do responsável não cria conta nem concede permissão.

## Editar e acompanhar

PATCH exige `expectedVersion` e `changeReason`. Aceita os seis campos operacionais
da criação e transição opcional `status`. Campos desconhecidos e mutação vazia são rejeitados.
Origem, ficha vinculada e autoria original não são editáveis.

```json
{
  "expectedVersion": 1,
  "changeReason": "Início da medida registrado para acompanhamento.",
  "status": "IN_PROGRESS"
}
```

PLANNED permite IN_PROGRESS ou CANCELLED; IN_PROGRESS permite IMPLEMENTED ou CANCELLED.
IMPLEMENTED exige `implementationNote` de 20–2.000 caracteres. Não existe salto direto,
reabertura, exclusão ou encerramento técnico. Estados terminais ainda recebem notas/evidências.
Toda mutação aceita incrementa a versão e grava revisão imutável e auditoria na mesma transação.
Dois escritores com a mesma versão geram um sucesso e um conflito, sem sobrescrever o primeiro.
Após 409, o cliente deve reler os dados atuais antes de decidir por um novo envio.
Não basta trocar `expectedVersion` e reenviar um snapshot antigo. A interface mostra
os dados consultados e incorpora campos não modificados ao rascunho após revisão explícita.
Alterações deliberadas são preservadas; diferenças no mesmo campo exigem conferência.
A API não realiza mesclagem automática de conteúdo nem reaplica a requisição recusada.

## Consultar e medir

Filtros de ações: `riskId`, `unitId`, `sectorId`, `status`, `q` (título/responsável),
`openOnly`, `overdue`, `page`, `pageSize`. Booleanos aceitam somente `true`/`false`.
Setor precisa corresponder à unidade. Ordenação: prazo crescente e UUID crescente.
Combinação de estado terminal com abertas/atrasadas resulta em lista vazia.

A ação devolve `referenceDate`, `timeZone` e `isOverdue`. Vencimento hoje não é atraso;
apenas PLANNED/IN_PROGRESS vencidas antes da data local da empresa são atrasadas.
O painel conta a organização inteira, não apenas a primeira página, e informa
`planned`, `inProgress`, `implemented`, `cancelled`, `open`, `total` e `overdue`.
As atrasadas são subconjunto das abertas, não um quinto estado.

## Evidências privadas

Multipart: um `file`, `description` (10–1.000) e `expectedVersion` como texto de inteiro
positivo. PDF, PNG ou JPEG até 5 MiB; extensão, MIME e assinatura binária precisam concordar.
O servidor limita a 20 evidências ativas por ação e gera UUID/nome de arquivo seguro.
Resposta contém identificadores, descrição, MIME, tamanho, SHA-256, autoria/datas,
versão da ação na inclusão e campos de arquivamento. Não contém object key, URL pública ou credencial.

Download revalida acesso e devolve `Content-Disposition: attachment`, `nosniff` e `no-store`.
Não há preview inline. Arquivamento exige motivo e versão; preserva arquivo e metadados.
Ação pode estar terminal. Evidência arquivada continua consultável/baixável por usuário autorizado.
Uma falha de banco após upload tenta compensar somente o objeto novo, depois de confirmar
que não existe metadado persistido. Resultado de commit incerto nunca autoriza apagar bytes referenciados.

## Erros e recuperação

Erros seguem `ApiError`: `statusCode`, `code`, `message`, `requestId`, `timestamp`
e detalhes de campo quando aplicáveis. Não incluem SQL, stack ou diagnósticos do provedor.

| HTTP | Situação                                                                                    |
| ---- | ------------------------------------------------------------------------------------------- |
| 400  | Campo inválido, filtro inválido, falta de relato, arquivo incompatível                      |
| 401  | Sessão ausente/expirada                                                                     |
| 403  | Perfil somente leitura ou Origin inválido em escrita                                        |
| 404  | Recurso fora do contexto permitido ou inexistente                                           |
| 409  | Versão vencida, transição vedada, origem inativa/arquivada, limite ou arquivamento repetido |
| 413  | Arquivo acima de 5 MiB ou limite de upload                                                  |
| 500  | Falha interna de persistência, sem gravação parcial da transação                            |
| 503  | Armazenamento desativado/indisponível; ações e notas continuam independentes                |

Após 409, releia a versão e compare o texto preservado antes de reaplicar. Em perda de
conexão ou resposta incompatível, consulte a lista/histórico: POST não possui idempotência
e não deve ser repetido automaticamente. Arquivos passam por validação básica, não antivírus.
Evidência e execução informada não comprovam eficácia nem conformidade normativa.
