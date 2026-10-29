# Pareceres de eficácia — IDs 15 e 16

Estado: concluído e verificado localmente em 26/10/2026 sobre a base `18e63dd`,
com os IDs 11–14 preservados. Check, integração/persistência (162), migrações,
compatibilidade, UI e jornadas completas desktop/mobile (164) aprovados.
Consulte as [evidências e os limites](../VERIFICACAO_ID15_ID16.md).
Sem commit, push, deploy, alteração de provedor ou Trello.

## Contrato e limites

Parecer técnico append-only, separado da ação e das revisões operacionais legadas.
ADMIN não recebe capacidade técnica automaticamente. Registrar exige vínculo e
organização ativos, `TECHNICAL_DECISIONS`, ação IMPLEMENTED, risco REGISTERED e
hierarquia ativa. Não exigir método/avaliação técnica anterior como nova condição.
Não implementar encerramento ou reavaliação (IDs 17/18).

Prefixo `/api/v1/organizations/:orgId`:

- GET `/actions/:id/efficacy`: contexto atual, revisão, fingerprints, último parecer,
  estado de vigência, permissões e impedimentos.
- GET/POST `/actions/:id/efficacy-opinions`: histórico paginado / registro técnico.
- GET `/actions/:id/efficacy-opinions/:opinionId`: parecer e provas preservadas.

POST estrito: `expectedVersion`, `expectedLatestOpinionId` UUID/null,
`expectedContextFingerprint` SHA-256, `result` EFFECTIVE/NOT_EFFECTIVE/INCONCLUSIVE,
`verifiedOn` data civil válida não futura no fuso da empresa, `observation` e
`rationale` (20–4000), `evidenceIds` (até 20 únicos), `textualEvidence` (até 10
referências únicas com reference 5–200, description 20–4000, rationale 10–2000).
Exigir ao menos uma prova. `nextSteps` (10–2000) obrigatório para NOT_EFFECTIVE ou
INCONCLUSIVE; opcional para EFFECTIVE. Autor, snapshots, critério, IDs de prova
textual e hashes são definidos pelo servidor, nunca aceitos como resultado do cliente.

## Persistência e validade

`ActionEfficacyOpinion`: empresa/ação/risco, sequência, predecessor, revisão
operacional por actionId/actionVersion, resultado/data/textos, snapshots da ação e
do risco, fingerprints, cópia do critério e pacote JSON imutável de provas, autor e
criação. Sem UPDATE/DELETE. Sequência e predecessor são da mesma ação, imediatos e
únicos; inserir parecer e auditoria é atômico, sem mudar Action.version/status.

Pacote: `{files:[{id,fileName,description,mimeType,size,sha256}],texts:[{id,reference,
description,rationale,sha256}]}`. Arquivos pertencem à mesma ação/empresa e devem
estar ativos na gravação; metadados/hash conferidos no banco. Evidência textual é
identificada, descrita e justificada, com hash do conteúdo calculado no servidor.
O JSON inteiro fica congelado com o parecer, evitando inclusão posterior de provas.

Fingerprint técnico da ação: title, description, expectedResult,
verificationCriterion, status, implementationNote e implementedAt ISO UTC. Excluir
notas, prazo/responsável/atribuição administrativos e anexos não selecionados.
Fingerprint do risco reutiliza `technicalContextFingerprint` do ID 11. SHA-256
com JSON escalar de chaves em ordem de código-ponto, sem espaços de separação,
compatível com SQL e TypeScript; contexto combinado usa actionFingerprint e
riskContextFingerprint. Testar acentos, escapes e quebras de linha.

Vigência deriva do conteúdo atual e das provas selecionadas, não de Action.version.
Contexto atual: ABSENT/CURRENT/REVIEW_REQUIRED. Histórico: CURRENT/SUPERSEDED/
REVIEW_REQUIRED com motivos explícitos. Arquivar prova selecionada sinaliza revisão;
anexo não selecionado ou nota comum não invalidam. Novo parecer substitui o anterior
sem apagá-lo; um inconclusivo/não eficaz nunca reativa um eficaz anterior.

Concorrência: validar versão, predecessor e fingerprint esperado dentro da transação.
Ordem: organização SHARE → vínculo SHARE → risco SHARE → ação UPDATE → hierarquia
SHARE → provas selecionadas SHARE em ordem estável. Uma edição do risco também
conflita, mesmo sem incrementar Action.version. SQL aplica invariantes de autorização,
escopo, sequência, revisão, snapshots e provas, além dos checks da API.

## Interface

Seção de eficácia no detalhe da ação, com critério esperado e execução informada,
provas escolhidas, data/observação/justificativa/conclusão e histórico legível.
Preparação local → revisão do resumo → confirmação explícita → sucesso somente após
resposta validada do servidor. Sem gravação técnica ao apenas preparar/fechar revisão.
Operacional pode consultar, mas não encontra controles técnicos utilizáveis.

Falha recuperável conserva rascunho; 409/resultado incerto exige consulta e revisão
antes de reenviar. 401/403/404 na revalidação remove dados/rascunhos privados. Manter
retorno, filtros, foco, mobile, temas e reduced motion. Resultado não eficaz ou
inconclusivo orienta o próximo acompanhamento; eficaz não anuncia encerramento.

## Etapas e provas

1. Red HTTP real para contexto inexistente (404 observado); contratos e invariantes.
2. Schema/migração aditiva e Red/Green de proteções SQL em banco local isolado.
3. API: autorização, concorrência, supersessão, vigência e provas; HTTP/SQL reais.
4. UI: Red/Green de preparação/confirmação, permissões, rascunhos e histórico.
5. Gates: check, format, Prisma, integração, migrações, compatibilidade, UI e E2E.
6. Revisão independente e evidências; atualizar README/plano canônico/relatório.

Skills: backend-dev, api-design, database-schema-designer, security-engineer,
property-based-testing e TDD no domínio; frontend-design, react-development,
motion-design e anti-slop-design no fluxo; executing-plans na integração.
