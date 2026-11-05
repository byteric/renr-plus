# Auditoria e histórico

As rotas usam o prefixo existente `/api/v1`, sessão em cookie e organização ativa. Todas respondem com `Cache-Control: private, no-store`, inclusive em erros.

| GET sob `/organizations/:orgId` | Acesso                                         |
| ------------------------------- | ---------------------------------------------- |
| `/audit-events`                 | ADMIN ativo da organização                     |
| `/risks/:id/history`            | Membro ativo com a mesma leitura do inventário |
| `/actions/:id/history`          | Membro ativo com a mesma leitura de ações      |
| `/history-records/:kind/:id`    | Leitura do domínio; `access` exige ADMIN       |

O vínculo e o papel são revalidados dentro de uma transação `RepeatableRead`. Organização fora da sessão ativa, recurso de outro tenant, vínculo revogado e registro inexistente retornam 404; ausência de sessão retorna 401; leitor na auditoria administrativa ou em registro de acesso retorna 403. Identificador ou filtro inválido retorna 400. Tipo de registro desconhecido retorna 404.

## Listas e filtros

`{ items, total, page, pageSize, timeZone }` é o envelope compartilhado. Cada item contém:

```ts
{
  id: string; // Prefixo da fonte e seu UUID; não é um ID intercambiável entre fontes.
  operation: string;
  label: string; // Rótulo legível em português.
  actor: { id: string; name: string } | null;
  createdAt: string; // ISO 8601 UTC.
  reason: string | null; // Até 4000 caracteres.
  resource: { type: string; id: string; label: string };
  target: { kind: string; id: string; parentId?: string; revision?: number } | null;
}
```

Todas as listas aceitam `from` e `to` como datas civis reais `YYYY-MM-DD`, inclusivas no fuso IANA da organização. O backend compara o início de `from` e o início exclusivo do dia seguinte a `to`; a conversão usa PostgreSQL `AT TIME ZONE` e considera dias de 23 ou 25 horas. O armazenamento Prisma é timestamp UTC. `from > to` é inválido.

`page` tem padrão 1 e máximo 1.000.000. `pageSize` tem padrão 50 e intervalo 1–100. A auditoria administrativa também aceita `resourceType`, `resourceId`, `operation` e `actorId`, sendo os dois IDs UUIDs. Filtros desconhecidos são rejeitados. A ordenação é `createdAt DESC, id DESC`. Itens e contagem pertencem ao mesmo snapshot transacional; cada requisição de página abre um novo snapshot, portanto eventos novos podem deslocar páginas de requisições posteriores.

Tipos de recurso conhecidos: `risk`, `action`, `preliminary-evaluation`, `technical-evaluation`, `efficacy-opinion`, `reassessment`, `technical-closure`, `corrective-action`, `access`, `instrument-version`, `evaluation-method`, `organization`, `unit`, `sector`, `employee`, `assessment-group`, `assessment-cycle`, `assessment-policy`, `assessment-source` e `diagnostic-cycle`. Eventos não classificados permanecem consultáveis como `unknown`.

## Registros e vínculos exatos

`target.kind` aceita `risk`, `action`, `action-revision`, `preliminary-evaluation`, `technical-evaluation`, `efficacy-opinion`, `reassessment`, `technical-closure`, `instrument-version` e `access`. Subrecursos exigem `parentId`; versões/sequências podem preencher `revision`. O contrato não aceita URL arbitrária.

`GET /history-records/:kind/:id` devolve `{ event, timeZone, details: [{ label, value }] }`, com até 30 detalhes e 4000 caracteres por valor. Uma revisão é consultada por seu UUID exato, mesmo fora da primeira página. Seus detalhes incluem os campos operacionais preservados da ação, evento, versão, nota e justificativa. Risco e ação diretos representam seu cadastro atual; o histórico não fabrica snapshots antigos desses cadastros.

Eventos novos guardam referência explícita à revisão ou registro criado e motivo pertinente na mesma transação da alteração. Notas usam seu texto quando não há motivo de alteração. Eventos legados `ACTION_*` sem referência explícita não recebem vínculo de revisão: `target: null`. Nenhuma associação usa proximidade de data ou autor.

O histórico operacional reúne revisões imutáveis, avaliações preliminares e técnicas, pareceres, reavaliações, encerramentos e mudanças de risco. O histórico de risco também inclui ações ligadas ao risco. Uma criação de ação aparece pela revisão CREATED; a avaliação técnica produzida por reavaliação aparece na entrada da reavaliação, evitando duplicação. Eventos administrativos de acesso nunca entram nessas listas.

## Dados e persistência

Auditoria administrativa lê `AuditEvent`; fontes do domínio enriquecem apenas a página selecionada, agrupadas e restritas ao tenant. Autores são resolvidos em uma consulta com projeção de ID e nome. A resposta tem campos explícitos: não inclui hashes, tokens, segredos, respostas individuais, binários, pacotes de prova ou JSON de snapshots.

A migração `20261029090000_audit_history_references` é aditiva: campos opcionais `resourceType`, `reason`, `referenceType`, `referenceId` e `version`; referências devem formar par e a versão, quando preenchida, deve ser positiva. Índices suportam organização/data/ID e filtros por operação, recurso e autor, além do histórico de revisões por ação.

Não há endpoint de edição ou exclusão de auditoria. A migração preserva a política de manutenção de dados já existente e não adiciona trigger de imutabilidade ao legado `AuditEvent`.

## Verificação local

Os contratos estão em `packages/contracts/src/audit.ts`. A suíte `apps/api/test/audit.http.spec.ts` verifica autenticação e cache; `audit.integration.spec.ts` verifica autorização, filtros, paginação, fuso/DST, registros exatos, ausência de segredos, vínculos técnicos, revogação, consistência de snapshot e rollback de alteração/revisão quando o append de auditoria falha.

Execute no workspace local, com PostgreSQL de testes e variáveis existentes:

```powershell
node node_modules/pnpm/bin/pnpm.cjs --filter @renr/contracts test
$env:RUN_DB_TESTS='1'
node --env-file=apps/api/.env node_modules/pnpm/bin/pnpm.cjs --filter @renr/api test --runTestsByPath test/audit.http.spec.ts test/audit.integration.spec.ts
```

As fixtures são sintéticas e ficam no banco local descartável, respeitando a imutabilidade dos registros de domínio.
