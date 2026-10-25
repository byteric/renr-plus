# Verificação dos IDs 05 e 06

Implementação e verificação: 23–24/10/2026. Base: integração local v0.4/v0.5, preservando os IDs 01–04. Situação: IDs 05 e 06 concluídos e verificados localmente. Este registro não comprova publicação em homologação.

## Escopo entregue

O ID 05 acrescenta o cadastro mínimo de colaboradores e evolui o `AssessmentGroup` existente. O ID 06 integra esses cadastros à navegação de empresas, unidades e setores. As histórias e os contratos estão em [Cadastro nominal e grupos de avaliação](API_CADASTRO_GRUPOS_ID05.md).

| Requisito                                           | Implementação e prova correspondente                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nome, matrícula opcional, unidade, setor e situação | DTOs estritos em `packages/contracts/src/workforce.ts`; rotas de criação, consulta e edição; formulário específico de colaborador.                                             |
| Vínculo de usuário opcional e explícito             | Checkbox e seletor separado; validação da membership ativa na mesma empresa; nenhum vínculo implícito criado pelo nome.                                                        |
| Integridade entre empresa, unidade, setor e usuário | FKs compostas, validação de associações e testes de PostgreSQL com referências de outra organização/unidade.                                                                   |
| Matrícula única por empresa                         | Normalização NFKC, comparação em minúsculas e índice único; testes de duplicidade e expansão Unicode. Valores ausentes podem coexistir.                                        |
| Preservação após desativação                        | Mesmo ID, versão incrementada e histórico consultável; desativar colaborador não revoga acesso. Desativar grupo bloqueia novos ciclos/riscos, preservando referências antigas. |
| Grupo existente sem entidade paralela               | Migração aditiva sobre `AssessmentGroup`, backfill pelo setor e teste com ciclo/risco previamente preenchidos.                                                                 |
| Privacidade do diagnóstico                          | Employee não possui FK para resposta, resposta de questão ou convite de participação. DTOs gerenciais novos não retornam respostas individuais.                                |
| Restrição administrativa                            | ADMIN na empresa ativa, cookie de sessão e Origin confiável nas mutações; leitor e acesso entre organizações recusados também pela API.                                        |
| Busca, filtros, paginação e retorno                 | URL conserva busca, situação, unidade, setor, página e edição; testes de cancelar, voltar e recarregar. Listas e seletores possuem consultas limitadas.                        |
| Rascunho em falha recuperável                       | Testes de 503 e revalidação por visibilidade; versão original preservada; cancelar e reabrir após conflito consulta a versão atual.                                            |
| Setor compatível com unidade                        | Seletores dependentes; trocar unidade limpa o setor; servidor repete a validação.                                                                                              |
| Teclado, mobile e nomes extensos                    | Jornadas de navegador percorrem os cinco formulários por Tab e teclas; testes visuais verificam temas, larguras e zoom. Resultados finais registrados abaixo.                  |

## Correções verificadas durante a implementação

Testes comportamentais reproduziram perda de rascunho em atualização por visibilidade e reaproveitamento de versão antiga ao cancelar/reabrir. As correções mantêm o formulário durante revalidação recuperável e invalidam o detalhe ao sair da edição. Os 14 testes focais passaram após as correções, inclusive na revisão independente.

No backend, testes reproduziram aceitação de grupo inativo em novas operações, ordem incorreta do lock e expansão Unicode além da coluna normalizada. As correções bloqueiam novas associações ao grupo inativo, serializam criação/desativação e mantêm somente o identificador normalizado em TEXT. O identificador informado continua limitado a 64 caracteres.

A execução automática inicial de frontend apresentou dez falhas sob concorrência irrestrita. Os mesmos 145 testes passaram com um worker. A configuração limita os workers e preserva isolamento, asserções e timeouts.

O teste visual reproduziu rolagem horizontal nos cartões de grupos com zoom de 200% em 1280 px: a linha de ações herdava `flex-shrink: 0`. O link para colaboradores ultrapassava o cartão. A correção limita a largura dessa linha e permite quebra de ações somente nos cartões de colaboradores/grupos, preservando os demais módulos.

## Verificações finais

As verificações de 23–24/10/2026 usaram dados sintéticos, PostgreSQL temporário e MinIO locais. A regressão de navegador executou contra o build final compilado, com uma API nova por projeto, um worker e zero retries.

| Comando/prova              | Resultado                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm prisma:validate`     | Aprovado.                                                                                                                                                                                                                                |
| `pnpm check`               | Aprovado após a correção visual: geração Prisma, lint, tipos, 52 testes de scripts, 95 de contratos, 146 da API, 145 da interface e builds.                                                                                              |
| `pnpm test:integration`    | Aprovado: os 71 testes dependentes de banco passaram em nove suítes, com armazenamento local habilitado. Eles ficam desabilitados no check unitário.                                                                                     |
| `pnpm test:migrations`     | Aprovado: oito migrações em banco vazio, deploy e seed repetidos e quatro testes de preservação em banco populado.                                                                                                                       |
| `pnpm format:check`        | Aprovado, incluindo a documentação final. Conferência executada diretamente pelo mesmo Prettier local, sem dependência de banco.                                                                                                         |
| `pnpm test:e2e`            | Aprovado: 144 cenários, sendo 72 desktop e 72 mobile, incluindo as dez novas jornadas dos cadastros.                                                                                                                                     |
| `pnpm test:ui --workers=1` | Aprovado: 14 cenários, com os dois temas, larguras de 320 a 1440 px, nomes extensos/inativos, ações e diálogos. Zoom CSS de 200% em 640 e 1280 px, equivalentes a áreas úteis de 320 e 640 px.                                           |
| Inspeção das capturas      | Formulários de colaboradores em desktop claro/mobile escuro e lista de grupos ampliada inspecionados; campos e ações contidos no layout.                                                                                                 |
| Revisão independente       | Cadastro, contratos, autorização e recuperação de rascunhos revisados sem defeitos abertos. A lacuna de prova de teclado foi atendida pelas jornadas novas. A correção adicional de CSS foi conferida na integração e pela suíte visual. |

A versão mantém o aviso de chunk: entrada principal de 248,40 kB gzip. A meta de até 200 kB permanece no ID 30 e não é apresentada como alcançada. As capturas utilizam somente dados sintéticos; nenhum cookie, senha ou link de ativação real foi retido em traces ou vídeos.

## Limites

A atribuição de responsáveis a ações pertence ao ID 13. Instrumentos e versões serão tratados nos IDs 07 e 08. Esta evolução não coleta CPF, folha ou dados clínicos, não identifica participantes dos diagnósticos e não implementa classificação técnica automática.

A identidade Percurso continua planejada para o ID 27; a interface atual utiliza os tokens existentes nos dois temas. A meta de bundle do ID 30 e a revisão global de responsividade do ID 27 permanecem no plano. Zoom CSS é uma prova de reflow, sem substituir a verificação de zoom nativo prevista nessa revisão global.

Não houve commit, push, publicação, alteração de credenciais ou migração em banco remoto. A verificação usa dados sintéticos e banco local temporário, sem redefinir o banco de desenvolvimento existente.
