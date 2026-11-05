# IDs 21 e 22 — Auditoria e histórico unificado

Escopo local, sem publicação ou alteração de dados de homologação.

1. **Contrato e persistência (ID 21):** reutilizar eventos transacionais, acrescentar referências opcionais exatas para eventos novos e índices de consulta. Eventos legados sem referência não podem ser associados por aproximação de horário. Consultas administrativas exigem ADMIN; históricos preservam a autorização da origem. Não retornar segredos, respostas individuais ou JSON arbitrário.
2. **Consulta (ID 21):** filtros estritos por período civil inclusivo no fuso da organização, recurso, operação e autor; paginação global estável e limitada. Histórico de risco/ação reúne fontes imutáveis e permite consultar o registro exato. Testes Red–Green para filtros, isolamento, perfis, empate de data, transação revertida e vínculo de revisão.
3. **Interface (ID 22):** rota administrativa `#/auditoria`, filtros e seleção na URL, linha do tempo contextual nos detalhes de risco/ação e diálogo do registro correspondente. Leitura em ordem temporal com operação, autor, justificativa e data no fuso da empresa. Preservar filtros e foco ao voltar; limpar conteúdo no logout, troca de organização ou perda de acesso.
4. **Direção visual:** prolongar o sistema atual, sem antecipar a mudança de marca do ID 27. Filtros agrupados acima de uma linha do tempo, metadados secundários e justificativas legíveis. Tokens semânticos existentes, hierarquia tipográfica da aplicação, scroll nativo e reflow para uma coluna no mobile; nenhum efeito decorativo novo.
5. **Provas:** observar testes falhando pelo comportamento ausente antes de implementar; executar contratos, HTTP, PostgreSQL local, componentes, jornadas reais desktop/mobile e inspeção visual nos dois temas. Rodar os checks existentes, revisar diff e registrar resultados e limites em `docs/VERIFICACAO_ID21_ID22.md`.

Responsabilidades: backend e contratos no módulo audit; frontend no módulo history e integrações de navegação/detalhes. Nenhum commit, push ou deploy integra este escopo.
