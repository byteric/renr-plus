# Pareceres e análise de eficácia — IDs 15 e 16

Estado em 26/10/2026: concluído e verificado localmente.
Não confirma disponibilidade em homologação.

## Entrega funcional

O parecer é um registro técnico próprio, append-only, com conclusão EFFECTIVE,
NOT_EFFECTIVE ou INCONCLUSIVE, data da verificação, observação, justificativa e
critério esperado preservado. Ele referencia a revisão operacional da ação, autor,
predecessor e pacote imutável de provas com identificadores e SHA-256.

Arquivos selecionados precisam pertencer à mesma ação e empresa e estar ativos
na gravação. Prova textual pode fundamentar a análise quando identificada,
descrita e justificada. Não é obrigatório anexar arquivo; nenhuma prova transforma
automaticamente uma execução informada em eficácia.

Registrar exige capacidade explícita `TECHNICAL_DECISIONS`, vínculo e contexto
ativos e ação IMPLEMENTED. ADMIN sozinho não basta. Um técnico com papel READER
e capacidade explícita pode registrar. Usuários operacionais consultam o histórico,
sem controles técnicos de gravação.

O detalhe apresenta preparação local, seleção de provas, revisão do resumo e
confirmação explícita. Só mostra sucesso depois da resposta válida do servidor.
Não eficaz e inconclusivo exigem próximos passos; eficaz não encerra a ação.
O parecer atual aparece completo; o histórico apresenta resumos paginados e uma
consulta explícita ao conteúdo preservado de cada versão, sem repetir todos os
textos na página mobile.

## Integridade, concorrência e vigência

- Migração aditiva `20261026000000_action_efficacy_opinions`, aplicada somente no
  banco local isolado de verificação. Sem reescrever migrações anteriores.
- Parecer e auditoria são atômicos. Não alteram Action.version, estado ou revisões
  operacionais legadas. Não há endpoint de edição/exclusão do parecer; SQL também
  bloqueia alterações retroativas.
- Registro exige versão da ação, identificador do último parecer e fingerprint
  técnico do contexto. O risco é bloqueado antes da ação; organização, vínculo,
  hierarquia e provas são revalidados dentro da transação.
- Nota comum, alteração administrativa ou arquivo não selecionado não invalidam
  parecer. Mudança técnica, origem inativa ou arquivamento de prova utilizada
  sinalizam revisão; as provas históricas continuam preservadas.
- Parecer novo substitui o anterior sem apagá-lo. Um resultado inconclusivo ou
  não eficaz nunca reativa um parecer eficaz antigo.

Contrato, rotas e critérios estão no
[plano de implementação](plans/IMPLEMENTACAO_ID15_ID16.md).

## Evidências

| Verificação                         | Resultado                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos e propriedades            | 8 testes aprovados; referências, prova mínima, limites, vigência e supersessão                                                               |
| HTTP específico                     | 14 testes aprovados; inclui permissões, isolamento, auditoria atômica, hashes, seleção de provas e concorrência                              |
| SQL específico                      | 13 testes aprovados; autorização, snapshots reais, provas, imutabilidade e corridas com duas conexões                                        |
| UI focal                            | 23 testes do painel aprovados; inclui histórico compacto, consulta completa e regressões de seleção, vigência e privacidade                  |
| Check geral                         | Aprovado: geração Prisma, lint, tipos, 52 testes de scripts, 120 de contratos, 155 de API, 241 de frontend e build de produção               |
| Integração e persistência completas | 17 suítes, 162 testes aprovados, sem ignorados                                                                                               |
| Migrações                           | Aprovadas em banco vazio, deploy/seed repetidos e bases preenchidas; ações, revisões e evidências antigas preservadas, sem inferir pareceres |
| Compatibilidade e rollback          | API ampliada aceita os consumidores congelados v0.3; aplicação antiga lê/edita dados e a atual retoma com históricos preservados             |
| Prisma                              | Schema válido; sem divergência nova do ID 15. Permanecem dois defaults preexistentes de instrument_versions, não alterados neste incremento  |
| UI com fixtures sintéticas          | 34 testes aprovados nos dois temas; após o refinamento do histórico, 4 testes de ações/eficácia aprovados novamente                          |
| Jornada compilada focal             | Aprovada em desktop e mobile: registro confirmado, sucessão, arquivo privado, revisão necessária, permissão e logout                         |
| E2E completo                        | 164 cenários únicos aprovados em lotes completos: 82 desktop e 82 mobile; sem retries automáticos                                            |
| Formatação e diff                   | Aprovados; nenhum arquivo preparado para commit e base Git preservada                                                                        |

O refinamento final do histórico foi seguido por 23 testes focais do painel,
checagem de tipos/lint/formatação do frontend, 4 testes de interface e novo build
de produção. A suíte geral de 241 testes do frontend foi executada antes desse
refinamento; os números não devem ser somados como uma única execução.

Red foi observado antes das correções: rota nova inexistente; candidato SQL sem
proteções aceitava escritas indevidas; consulta após arquivar risco retornava 500;
seleção arquivada ficava presa no rascunho; parecer aberto mantinha vigência antiga.
Os regressivos passaram após as correções e os três achados da revisão independente
foram relidos sem novo defeito confirmado no recorte.

As primeiras tentativas da jornada nova corrigiram duas premissas do próprio
teste: a seleção usa o nome seguro retornado pela API e a consulta após sair
aguarda a tela de login. Não houve redução de permissões, espera fixa, aumento
de retries ou mudança da aplicação para contornar essas falhas.
O E2E de execução do ID 14 passou a verificar consulta sem capacidade técnica,
ausência de controles de registro e encerramento ainda indisponível, substituindo
a expectativa histórica de que toda análise de eficácia estivesse indisponível.
No lote completo, os 82 cenários desktop passaram. No mobile ocorreu uma falha
isolada de conexão durante a seleção da empresa; sua causa não foi inferida como
defeito de produto. O helper de riscos passou a conferir HTTP 200 e empresa ativa
antes de avançar, e os seis cenários focais de riscos passaram em desktop/mobile.
O lote mobile completo final passou com os 82 cenários. A cobertura completa
combina o lote desktop aprovado e o lote mobile final; o helper alterado também
passou em ambos os projetos. Logs das tentativas anteriores foram preservados.

## Inspeção visual delimitada

Capturas com dados sintéticos foram inspecionadas nos temas existentes, incluindo
revisão clara em desktop e histórico escuro em mobile. O histórico compacto mantém
a consulta completa por versão e evita duplicar observações e provas extensas.
As capturas e os logs permanecem locais em `tmp/id15-ui-evidence` e `tmp/id15-*.log`.

| Eixo                | Estado e evidência                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Anti-slop e verdade | Aprovado no recorte: execução, eficácia e encerramento separados; sucesso depende de resposta validada; nenhum resultado técnico inferido de um upload                   |
| Hierarquia e tarefa | Aprovado: critério e execução precedem a análise; preparação, revisão, confirmação e histórico têm funções distintas; versões anteriores aparecem em resumo              |
| Tipografia e voz    | Aprovado nas capturas: tokens existentes e rótulos funcionais; conclusão, autoria, data e vigência legíveis sem depender só da cor                                       |
| Espaço e composição | Aprovado nas larguras verificadas: campos e provas se reorganizam; histórico evita a repetição integral dos pareceres; conteúdo extenso continua rolável                 |
| Física e movimento  | Verificação parcial: foco, teclado e reduced motion cobertos; desempenho de quadros não medido; nenhum motor novo adicionado                                             |
| Acesso e estados    | Aprovado no recorte funcional: permissões, revalidação, conflitos e descarte privado cobertos. Contraste numérico integral do painel e certificação WCAG não verificados |
| Responsividade      | Aprovado nas fixtures de 320, 375, 390, 768, 1280 e 1440 px e zoom CSS 200%, nos dois temas; zoom nativo e aparelho físico não verificados                               |

## Limites

Eficácia é uma decisão registrada por usuário autorizado; o sistema não certifica
habilitação profissional ou metodologia. Eficácia, execução e encerramento são
conceitos separados. Reavaliação e encerramento técnico continuam nos IDs 17/18.

Verificações usam dados sintéticos, PostgreSQL e MinIO locais. Não alteram Neon,
Supabase ou Render, e não comprovam disponibilidade dos arquivos no ambiente remoto.
Não houve commit, push ou publicação deste incremento.

O build mantém o aviso de chunk inicial de 581,12 kB minificado (186,99 kB gzip),
sem aumentar o limite do aviso. A divisão ampla do bundle e a medição de
desempenho continuam no ID 30. Identidade global e reorganização do painel
continuam nos IDs 27 e 24, respectivamente.
