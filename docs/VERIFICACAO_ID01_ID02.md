# Verificação incremental — IDs 01 e 02

Data: 22/10/2026. Base: implementação local v0.5, com funcionalidades v0.4/v0.5
preexistentes preservadas. Publicação online não faz parte desta verificação.

Status: IDs 01 e 02 concluídos e validados, nessa ordem. Os demais IDs não foram
iniciados. O `pnpm check` integral foi repetido ao final e terminou com código 0.

## ID 01 — Fundação visual

Entregas: tokens da identidade nos dois temas, escala tipográfica, espaçamento,
superfícies e primitivas reutilizadas em riscos e ações. Especificação em
[Fundação visual](FUNDACAO_VISUAL.md).

| Prova                       | Resultado executado                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Red antes da implementação  | Regressões de navegação da paginação por teclado e recuperação da lista de ações falharam antes das primitivas; verificação de hierarquia no navegador falhou em ambos os temas antes dos tokens (36px em vez de 30px) |
| `pnpm check`                | Passou: geração Prisma, lint, tipos, 49 testes de scripts, 88 de contratos, 131 de API, 118 de frontend e builds                                                                                                       |
| `pnpm format:check`         | Passou                                                                                                                                                                                                                 |
| `pnpm test:ui --workers=1`  | 8 cenários passaram: temas, hierarquia, nomes extensos, foco, limites de paginação, recuperação de erro, contraste e reflow                                                                                            |
| `pnpm test:integration`     | 56 testes passaram, com PostgreSQL e MinIO locais e armazenamento habilitado                                                                                                                                           |
| `pnpm test:migrations`      | Banco vazio, repetição de deploy/seed e 2 testes sobre base preenchida passaram                                                                                                                                        |
| `pnpm test:e2e --workers=2` | 124 cenários passaram nos projetos desktop e mobile                                                                                                                                                                    |
| Inspeção visual             | Empresas, ações e inventário inspecionados; capturas e testes cobrem ambos os temas, nomes extensos e larguras de 320 a 1440 CSS pixels                                                                                |

Os testes de API que dependem de banco ficam desabilitados na execução unitária.
Na execução do ID 01, a suíte de integração selecionou os 56 casos com nome
`integration`. O caso adicional `actions.persistence.spec.ts` não entrava nesse
filtro; sua inclusão e verificação pertencem ao ID 02, abaixo.

A primeira execução concorrente de `check` encontrou dois timeouts de importação
lazy no frontend. A execução integral seguinte, sem navegador concorrente, passou
sem alterar testes, tempos limite ou código de negócio para ocultar a falha.

Foi utilizado banco sintético criado exclusivamente para a execução e bucket
privado igualmente temporário. Apenas esses recursos de teste foram removidos ao
final; bancos existentes e serviços em nuvem não foram alterados.

Avisos existentes: chunk inicial de aproximadamente 180kB gzip (aviso de arquivo
minificado acima de 500kB), VM Modules experimental e depreciação de chamadas
concorrentes do pg. Não impediram os gates; não são declaração de otimização global
ou prontidão para operação empresarial.

## ID 02 — Contratos e compatibilidade

Iniciado após os gates do ID 01. Mapa de entidades, contratos, responsabilidades e
migrações em [Contratos e compatibilidade](CONTRATOS_E_COMPATIBILIDADE.md).

O seletor da suíte de banco foi ampliado para incluir o teste de persistência
existente, sem remover casos. O ensaio de compatibilidade é executado separadamente
por `pnpm test:compatibility`, com consumidores e artefato v0.3 congelados no commit
`c301caae569442a4aa5ccef34111ffaf32f05982`.

| Prova                                                        | Resultado                                                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Mapa de entidades, relações, contratos e migrações           | Documentado e confrontado com Prisma, SQL, controladores e schemas Zod; separa base atual de rotas/entidades futuras                          |
| Separação de responsabilidades                               | Autoria, atribuição, permissão técnica, execução, parecer e encerramento documentados sem acrescentar privilégios ou estados ao produto atual |
| `pnpm prisma:validate`                                       | Passou; nenhuma migração ou alteração de schema criada no ID 02                                                                               |
| `pnpm test:integration` com seletor completo                 | 7 suítes e 57 testes passaram, com armazenamento privado local habilitado                                                                     |
| Lint e formatação após documentação/infraestrutura de testes | Passaram                                                                                                                                      |
| Ensaio de compatibilidade congelado                          | Passou: 1 cenário, 0 falhas, 0 skips, aproximadamente 119 segundos; artefato atual → v0.3 → atual                                             |

O ensaio reconstrói o artefato v0.3 em diretório temporário a partir do commit fixo,
com instalação offline congelada e sem scripts de instalação. Seis arquivos de
contratos de teste são conferidos contra a fonte histórica, não atualizados a
partir do provedor novo. Respostas reais de ambas as aplicações passam pelos
parsers antigos. Controles negativos incluem campo adicional em objeto estrito e
remoção de ID obrigatório.

O retorno é de aplicação, não de banco. A execução final preservou integralmente
8 ações, 16 revisões, 1 metadado de evidência e 2 fichas, comparando conteúdo e IDs.
Foram verificados health/ready, erro 401, sessão, empresas, unidades, setores,
overview, instrumento, ciclo/detalhe/resultados, inventário/detalhe/edição,
indicadores de risco, série de sete dias e histórico de fichas não vazio, usando
os contratos congelados. Resultados do diagnóstico foram lidos nas três etapas:
aplicação atual, anterior e retomada.

A evidência deste ensaio é metadado sintético: não prova download de bytes, coberto
separadamente nos E2E do ID 01.

## Limites desta entrega

IDs 03 e seguintes não foram implementados. O ID 02 não muda contratos ou regras
de produção. Não houve commit, push, PR, deploy, alteração de serviço em nuvem ou
modificação dos pacotes de contribuição já preparados para a equipe. CI foi
configurada localmente para executar as novas provas; isso não é resultado de uma
execução remota do GitHub Actions.
