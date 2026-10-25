# Verificação dos IDs 09 e 10

Data: 24/10/2026. Estado: concluído e verificado localmente. Este registro documenta a validação anterior à publicação; a disponibilidade online corresponde ao commit ativo no Render.

## Escopo verificado

| Requisito                          | Implementação e evidência                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrumento e grupo por ciclo      | AssessmentCycle referencia versão publicada e um único grupo; API valida organização, estrutura ativa, política e modo de uso. Testes HTTP e PostgreSQL.                                                                  |
| Versão congelada após abertura     | Transições DRAFT → OPEN → CLOSED; edição só em rascunho, concorrência por revisão; proteção adicional por triggers/FKs SQL.                                                                                               |
| Fontes complementares              | OBSERVATION, INTERVIEW, WORKSHOP e DOCUMENT_ANALYSIS com contexto, data civil, síntese e autor da sessão; append-only e validação de data no fuso da organização.                                                         |
| Separação de participação e gestão | Rotas públicas próprias e tabelas próprias; respostas não carregam identificação nominal. DTO gerencial contém somente projeções coletivas.                                                                               |
| Envio incompleto                   | Validação ocorre antes de consumir o convite; falha transacional reverte consumo e inserções. Provas HTTP e SQL.                                                                                                          |
| Repetição idêntica/conflitante     | Recibo segregado sem FK de resposta; hash do segredo e MAC canônico. Replay idêntico concorrente ou após encerramento é aceito; conteúdo ou segredo conflitante gera 409.                                                 |
| Supressão                          | Um engine para resultados e consolidação; protege denominadores, opções, complementos e ancestrais da família inteira antes do recorte. Provas de múltipla 9/10, opcional 7/10 e descendente 8+2.                         |
| Política real                      | Sem limiar padrão; publicação exige limiar salvo, aprovação e TECHNICAL_DECISIONS explícita, inclusive para ADMIN. Versão publicada imutável; fork limpa aprovação.                                                       |
| Formulário público                 | Três tipos de pergunta, revisão antes de enviar, limpeza das opcionais e preservação das demais escolhas. Segredos e respostas somente em RAM; retry exato após rede/503.                                                 |
| Estados de resultados              | NOT_STARTED, COLLECTING, NO_RESPONSES, AVAILABLE e SUPPRESSED separados; ausência de dados não indica ausência de risco.                                                                                                  |
| Recuperação de interface           | Rascunho/revisão original preservados em falhas; cancelamento após conflito busca revisão atual; atualização de referências refaz os seis recursos sem apagar campos.                                                     |
| Compatibilidade                    | Artefato real congelado v0.3 operou no schema ampliado; retorno atual preservou integralmente políticas, ciclos, convites, respostas, respostas por pergunta e fontes. Fixtures e contratos legados não foram reescritos. |

## Verificações

| Gate                                      | Resultado                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Contratos compartilhados                  | 102 testes passaram.                                                                                                       |
| HTTP, PostgreSQL e engine novos           | 9 testes passaram em três suítes.                                                                                          |
| Migração aditiva e banco vazio/preenchido | Passou; inclui rollback após consumo e insert, sem desabilitar constraints/triggers.                                       |
| Retorno ao binário congelado              | Passou com linhas novas preservadas.                                                                                       |
| Revisão independente                      | Três achados P2 corrigidos e reconferidos; nenhum P0/P1 confirmado no recorte revisado.                                    |
| prisma:validate                           | Passou.                                                                                                                    |
| check                                     | Passou: lint, tipagem, 52 testes de scripts, 102 de contratos, 155 de API sem banco, 189 de interface e builds.            |
| format:check                              | Passou.                                                                                                                    |
| test:integration                          | 86 testes passaram em 11 suítes com PostgreSQL real.                                                                       |
| test:migrations                           | Dez migrações aplicadas; deploy e seed repetidos; quatro suítes de expansão e dois testes legados de preservação passaram. |
| test:e2e compilado desktop/mobile         | 158 cenários passaram: 79 em desktop e 79 em mobile, sobre os artefatos finais.                                            |
| test:ui claro/escuro 320–1440 px          | 26 cenários passaram, incluindo oito novos. Espaçamento de resultados e tokens de controles corrigidos com Red e Green.    |

Os testes de navegador não gravam códigos de convite, respostas, senhas ou cookies em traces, vídeos ou capturas de jornadas reais. A inspeção visual usa exclusivamente fixtures sintéticas, nos dois temas e com movimento reduzido.

Os gates de banco executaram em PostgreSQL descartável vinculado a loopback, na porta 55438. Migrações e retorno ao artefato congelado criaram bases temporárias próprias; o PostgreSQL local principal e os serviços remotos foram preservados. Logs de execução ficam em `tmp/id09-id10-*.log`, ignorados pelo Git. O build mantém o aviso preexistente de tamanho do bundle principal; o módulo de coletas é carregado sob demanda, sem adicionar motor de animação ou dependência de produção.

## Limites e continuidade

Aprovação de instrumento/política é referência documental, sem atestar validação metodológica. Não há pontuação, classificação clínica ou certificação automática. Os totais somam envios; não representam pessoas únicas. A futura exportação formal de relatório consumirá a projeção protegida; este recorte entrega seu consumidor gerencial JSON. A continuidade prevista é ID 11, métodos e avaliações técnicas versionadas, e ID 12, sua interface.
