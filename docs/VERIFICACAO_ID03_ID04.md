# Verificação incremental — IDs 03 e 04

Data: 23/10/2026. Base: árvore local v0.5, preservando o trabalho preexistente de ações, evidências e IDs 01/02.

Estado: IDs 03 e 04 concluídos e verificados localmente, dentro dos limites descritos. Nenhum commit, push, PR ou deploy faz parte desta execução.

## Entregas verificadas

ID 03: vínculos por organização, capacidades explícitas, consulta de permissões da sessão, histórico com autorizador, desativação sem apagar autoria, convite individual de uso único e proteção concorrente do último administrador.

ID 04: navegação para Acessos, membros/convites/histórico paginados, formulários com justificativa, confirmação de desativação, recarregamento após conflito, emissão/reemissão/revogação e ativação de conta nova ou existente. Temas e componentes da fundação foram reaproveitados.

ADMIN não recebe capacidade técnica automaticamente. A política de execução exige capacidade mais atribuição, mas a persistência e integração de responsáveis individuais continuam no ID 13. Não foi concedida escrita global como substituto.

## Red e Green

| Comportamento ausente/defeituoso | Red observado                                                                              | Green observado                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Navegação e gestão               | Link e rota de Acessos ausentes; 9 falhas de comportamento antes da implementação frontend | Navegação, bloqueio de leitor, gestão, confirmação, histórico e convite passaram |
| API de acessos                   | Rotas retornavam 404 onde eram esperados sessão/permissão/resultado                        | HTTP e integração real passaram, incluindo consulta individual                   |
| Revogação por empresa            | Limpeza persistida de contexto retornava contagem 0 em vez de 1                            | Sessão perde contexto revogado, preservando outros vínculos                      |
| Convite indisponível             | API retornava `CONFLICT` onde o cliente precisava distinguir indisponibilidade             | `409 ACCESS_INVITE_UNAVAILABLE` validado em PostgreSQL e pela interface          |
| Código manual                    | Campo desaparecia ao digitar o primeiro caractere                                          | Código completo permanece editável sem persistência                              |
| StrictMode                       | Sinal de requisição já estava abortado antes da mutação                                    | Sinal válido no início e cancelamento no desmontar                               |
| Link sem barra                   | Variante `#ativar/<segredo>` permanecia na URL                                             | Variantes com e sem barra removem o segredo                                      |

O teste de convite utiliza o objeto de erro real e HTTP 409; não simula 404 como substituto. As verificações de StrictMode observam o sinal no início da requisição, não depois de um desmontar legítimo.

## Gates executados

Ambiente: Node 24.14.0 e pnpm 11.25.0 do projeto. PostgreSQL 17 temporário em loopback e MinIO local. Não foram usados Neon, Render ou Supabase para essas mutações de teste.

| Gate                       | Resultado                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm prisma:validate`     | Passou                                                                                                                       |
| `pnpm check`               | Passou: geração, lint, tipos, testes e builds                                                                                |
| Testes de scripts no check | 49 passaram                                                                                                                  |
| Contratos                  | 92 passaram                                                                                                                  |
| API sem banco no check     | 138 passaram; 64 dependentes de banco ficaram desabilitados nessa modalidade                                                 |
| Frontend                   | 131 passaram                                                                                                                 |
| `pnpm test:integration`    | Os 64 casos dependentes de banco passaram, com storage local habilitado                                                      |
| `pnpm test:migrations`     | Sete migrações em banco vazio, repetição de deploy/seed e provas de dados preenchidos passaram                               |
| `pnpm format:check`        | Passou, incluindo documentação final                                                                                         |
| E2E específicos de acessos | 10 cenários passaram, distribuídos entre desktop e mobile                                                                    |
| Interface de acessos       | Dois cenários passaram, um por tema, percorrendo seis larguras para membros e convite, edição por teclado e zoom CSS de 200% |
| Regressão E2E geral        | 134 cenários passaram: 67 desktop + 67 mobile, contra o build compilado, com API nova por lote, um worker e zero retries     |
| Revisão independente       | Dois achados corrigidos e revalidados; sem achados pendentes no escopo                                                       |

O OpenAPI 3.1 do módulo foi validado contra os schemas Zod. Migração de acessos e modelos Prisma não apresentam divergência de FKs/índices na comparação com PostgreSQL.

Os três testes do planejador de lotes E2E também passaram. O comando padrão conserva todas as jornadas e inicia uma API por projeto. A execução conjunta anterior ultrapassou o limite real de login e apresentou interferência em um snapshot com dados compartilhados. Na tentativa serial pelo servidor de desenvolvimento, o trace registrou `net::ERR_NO_BUFFER_SPACE` em `/src/main.tsx`; não foi tratado como defeito de credencial ou corrigido reduzindo segurança. O perfil compilado eliminou essa carga de módulos de desenvolvimento e os dois lotes completos passaram. A melhoria de isolamento de fixtures para paralelismo futuro permanece no ID 31.

## Provas de jornada

Em ambiente real local, o gestor emitiu convite pela interface; a pessoa ativou a conta, entrou e teve a gestão negada por ser leitora. Outra jornada concedeu capacidade técnica explicitamente, consultou autorizador/justificativa no histórico e desativou o vínculo mantendo o registro.

Reemissão invalidou o token anterior. Revogação fez a interface orientar novo convite, sem repetir automaticamente nem manter o segredo/senha. Conta já existente autenticou-se com sua própria senha, aceitou outra empresa e não recebeu formulário de troca de senha. Troca de empresa removeu os registros anteriores e a API negou a consulta ao contexto antigo.

Não foram retidos cookies, senhas ou links reais em traces/vídeos. As capturas inspecionadas usam somente dados sintéticos. Fixtures próprias são removidas com validação de banco local, ID/nome exatos e namespace de teste; históricos do projeto não são apagados.

## Limitações e próximos IDs

As correções do título de aba, sobreposição no painel e falha de upload online estão no plano canônico, respectivamente IDs 27, 24/27 e 19/20. A conferência privada de acessos vigentes pertence ao ID 32. Não foram transferidas para IDs 01/02 concluídos.

A comparação com o banco encontrou divergências preexistentes de `ON UPDATE` em 11 FKs de ações/revisões/evidências; sua correção está no ID 31. Não foram reescritas migrações aplicadas nem alterados esses módulos para absorver essa ocorrência.

Build final: entrada principal de 247,21 kB gzip; ativação e gestão de acessos carregadas sob demanda. O aviso de chunk grande permanece visível e a meta de até 200 kB será tratada no ID 30; não é apresentada como atingida.

Esta verificação não comprova publicação, funcionamento do storage remoto, disponibilidade contínua ou validação técnica para dados reais. Publicação posterior exige autorização e os controles de revisão habituais.
