# Incremento v0.2 — painel e preparação de homologação

## Recorte

Esta versão acrescenta um painel organizacional integrado à API da estrutura cadastrada.
Também reúne a preparação de publicação em Render e Neon, sem dependência de serviços do computador pessoal.
A aprovação e a publicação dependem da integração dos pacotes, dos testes e da autorização de Ricardo.

## Funcionalidade

- Totais de unidades e setores, separados por status ativo e inativo.
- Identificação de unidades sem nenhum setor cadastrado.
- Consulta na empresa autorizada e selecionada na sessão, para administrador e leitor.
- Carregamento, falha recuperável, nova tentativa e troca de contexto sem manter dados anteriores.
- Interface responsiva dentro dos temas claro e escuro existentes.
- Contrato validado na API e na fronteira do frontend.

O painel usa cadastros persistidos. Não gera pontuação de riscos, diagnóstico clínico ou certificação de conformidade.

## API

`GET /api/v1/organizations/:id/overview`, com cookie de sessão.
UUID inválido: 400. Sem sessão: 401. Empresa fora do contexto permitido: 404.
Falha interna: erro seguro do filtro global, sem expor dados do banco.
Resposta privada, sem cache compartilhado ou dados de colaboradores.

Campos: `organization`, `units`, `sectors`, `unitsWithoutSectors`, `generatedAt`.
As contagens incluem todos os cadastros da empresa, independentemente da paginação.
Cada total equivale à soma de ativos e inativos. A consulta usa snapshot consistente.

## Execução externa

Frontend e API são compilados e executados em um único container no Render Free.
Dados e sessões persistem no Neon Free. Docker local e MinIO não sustentam o serviço online.
Não há mudança de schema neste incremento, nem necessidade de segundo banco no Supabase.
Anexos permanecem desativados até implementação de armazenamento durável.

`scripts/check-hosted.mjs` confere oito endpoints públicos e proteções básicas sem autenticar ou alterar dados.
As credenciais remotas ficam fora do Git e dos pacotes distribuídos.

## Revisão

- [Critérios de aceite](CRITERIOS_PAINEL.md)
- [Cenários de validação](CENARIOS_PAINEL.md)
- [Experiência e acessibilidade](UX_PAINEL.md)
- [Publicação e recuperação](DEPLOY_HOMOLOGACAO.md)
- [Checklist de release](CHECKLIST_RELEASE.md)

Diagnósticos/questionários, colaboradores, inventário, ações, evidências e IA continuam fora deste recorte.
