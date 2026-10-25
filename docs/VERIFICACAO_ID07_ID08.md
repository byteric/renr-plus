# Verificação dos IDs 07 e 08

Data: 24/10/2026. Situação: IDs 07 e 08 concluídos e verificados localmente. Este registro não comprova publicação em homologação.

## Escopo e critérios

| Requisito                                | Implementação e evidência                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identidade separada de versões           | `Instrument` e `InstrumentVersion`, com unicidade por instrumento/versão; integração cria dois instrumentos distintos com versão 1.                                                                    |
| Metadados, perguntas e opções            | Contratos estritos com título, descrição, instruções, finalidade, obrigatoriedade e posições contíguas. Escolha única, múltipla e ordinal sem pontuação.                                               |
| Rascunho incompleto e publicação íntegra | Rascunho aceita campos ainda não preenchidos; publicação devolve caminhos de campo. O editor usa as mesmas regras e destaca os campos, incluindo foco na referência de aprovação.                      |
| Aprovação para uso real                  | Capacidade `TECHNICAL_DECISIONS` explícita e referência obrigatória. ADMIN sem capacidade é recusado; READER com capacidade pode publicar uso real.                                                    |
| Escopo e autorização                     | Cookie, Origin e organização ativa; leituras/escritas de outra empresa são recusadas. Teste reproduz troca de organização entre leitura de escopo e capacidades e exige 403 antes de qualquer escrita. |
| Conteúdo publicado preservado            | API nega edição e SQL protege versão, perguntas e opções. Testes com duas conexões comprovam que publicação aguarda edição/inserção de filho em andamento.                                             |
| Nova versão independente                 | Fork mantém o instrumento, incrementa a versão e gera novos IDs de perguntas/opções, sem herdar aprovação. Concorrência é serializada por instrumento.                                                 |
| Histórico de ciclos                      | FKs preservam referências anteriores. Ciclos não migram automaticamente de versão; interface apresenta sua contagem e o impacto da publicação/fork.                                                    |
| Prévia fiel                              | Derivada diretamente do rascunho local: metadados, tipos, obrigatoriedade, ordem e opções. Seleções ficam somente em memória; nenhuma resposta é enviada ou armazenada.                                |
| Recuperação de falhas                    | Testes de 503 e 409 mantêm conteúdo local e revisão original. Salvar antes de publicar utiliza a revisão retornada pelo servidor.                                                                      |
| Navegação e acessibilidade               | Catálogo e versões paginados, busca e seleção na URL; botões de reordenação mantêm foco e anunciam posição. Controles nativos, ação por teclado e movimento reduzido.                                  |
| Layout                                   | Editor e prévia responsivos, sem rolagem horizontal nos casos testados. Dois temas, larguras de 320 a 1440 px e conteúdo extenso.                                                                      |

## Verificações executadas

Os comandos usaram o runtime e as dependências fixados no projeto, PostgreSQL descartável em loopback e MinIO local. Nenhum teste foi executado em banco remoto.

| Gate                       | Resultado                                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm prisma:validate`     | Aprovado.                                                                                                                                                |
| `pnpm check`               | Aprovado: geração Prisma, lint, tipagem, 52 testes de scripts, 98 de contratos, 150 da API, 157 da interface e builds.                                   |
| `pnpm test:integration`    | Aprovado: 82 testes em 10 suítes, incluindo concorrência na publicação e o documento máximo em UTF-8 e escapes Unicode.                                  |
| `pnpm test:migrations`     | Aprovado: nove migrações, deploy/seed repetidos e cinco provas de preservação em bases preenchidas.                                                      |
| `pnpm test:ui --workers=1` | Aprovado: 18 cenários, incluindo os quatro de instrumentos; temas claro/escuro, larguras de 320 a 1440 px, foco, controles e prévia.                     |
| `pnpm test:e2e`            | Aprovado: 154 cenários contra o build final, 77 desktop e 77 mobile; uma API nova por projeto, um worker e zero retries.                                 |
| `pnpm test:compatibility`  | Aprovado: consumidor e artefato v0.3 congelados funcionaram no schema expandido; retorno ao artefato atual preservou os históricos e os catálogos novos. |
| `pnpm format:check`        | Aprovado, incluindo a documentação final.                                                                                                                |

A revisão independente dos contratos, autorização, SQL e interface terminou sem achados concretos restantes. A revisão leu a cobertura correspondente; as execuções dos gates estão registradas separadamente acima. As capturas de editor desktop claro e mobile escuro foram inspecionadas após corrigir os controles nativos.

## Correções verificadas

Na revisão de segurança, o teste de publicação reproduziu o uso de capacidades de outra organização após uma troca concorrente de contexto. A operação agora confere que ambas as leituras pertencem à mesma organização antes de publicar.

No PostgreSQL, duas transações reproduziram edição/inserção de opções que terminavam depois da publicação. Os triggers de filhos agora mantêm lock compartilhado sobre a versão pai; os dois cenários passaram, e alterações posteriores à publicação continuam recusadas.

A inspeção de telas reproduziu rádios e checkboxes herdando largura de campos de texto, comprimindo os rótulos da prévia. O CSS do módulo limita esses controles a 20 px e preserva a largura disponível para os textos. O teste visual passou após a correção. Outro teste reproduziu falta de foco na referência de aprovação inválida; o editor agora procura o primeiro campo inválido habilitado em toda a área da edição, incluindo a publicação.

O teste antigo de provisionamento usava um double de `upsert`, enquanto a projeção legada passou a ser encontrada explicitamente por organização/versão/`isDemo`. O double foi adaptado à consulta/criação atuais; as asserções de idempotência e preservação de credenciais permaneceram.

Uma prova com 100 perguntas e 20 opções de tamanho máximo reproduziu recusa de JSON válido quando o cliente usava escapes Unicode. O limite foi ajustado de 2 para 4 MiB. Outro teste HTTP reproduziu resposta 500 para corpo excessivo; o filtro agora reconhece o erro do parser e devolve 413 com correlação, sem incluir dados enviados. Os limites de campos e quantidade de elementos continuam sendo validados pelo contrato.

## Compatibilidade e limites

`usageMode` distingue demonstração e uso real. A coluna legada `isDemo` é uma projeção de compatibilidade exclusiva do instrumento demonstrativo original v1. Novos catálogos e forks não assumem essa projeção, mesmo quando demonstrativos. Os DTOs e consumidores congelados de diagnóstico permanecem inalterados.

A aprovação registrada é uma referência informada por uma pessoa autorizada; o sistema não certifica a qualidade de um instrumento nem inventa interpretação clínica. Não há resposta aberta ou pontuação. A aplicação dos instrumentos novos em ciclos pertence aos IDs 09 e 10.

Não há DELETE na API. Manutenção SQL por proprietário pode remover uma versão sem ciclos, pai antes dos filhos; versões referenciadas permanecem protegidas por FK RESTRICT. A limpeza E2E exige banco loopback e ID/nome exatos da organização sintética; referências históricas abortam a transação.

O editor utiliza os tokens existentes. A identidade Percurso permanece planejada para o ID 27 e o nome do produto continua ReNR+. O bundle inicial medido foi de 249,23 kB gzip; a meta de 200 kB continua no ID 30. Zoom CSS de 200% verifica reflow do conteúdo; não substitui o zoom nativo e a revisão global previstos no ID 27.

Não houve commit, push, PR, publicação, alteração de credenciais ou migração remota nesta execução. Os bancos de desenvolvimento existentes foram preservados.
