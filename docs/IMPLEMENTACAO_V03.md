# Incremento v0.3 — inventário e rastreabilidade

## Recorte

A v0.3 conecta o diagnóstico coletivo ao inventário de riscos e às fichas preliminares.
O painel apresenta dados persistidos e oferece acesso ao inventário filtrado.
A composição do código, a integração remota e a publicação são etapas verificadas separadamente.

## Funcionalidades

- Inventário paginado, busca pelo fator e filtros de unidade, setor, estado e existência de ficha.
- Cadastro em rascunho e registro completo, com origem contextualizada e validação por campo.
- Edição com versão esperada; um conflito preserva o texto local sem sobrescrever outro editor.
- Fichas preliminares sequenciais, com autoria, data e cópia imutável do contexto daquela versão.
- Arquivamento lógico; registros e fichas permanecem consultáveis em modo de leitura.
- Indicadores reais, barras por unidade e anel de preenchimento, com alternativas textuais e filtros navegáveis.
- Série diária real de cadastros nos últimos 7, 30 ou 90 dias, com fuso explícito e dias sem registros preenchidos com zero.
- Recortes rápidos de rascunhos, registros sem ficha e arquivados, sem perder os filtros detalhados.
- Entrada redesenhada, temas claro/escuro, favicon, navegação móvel e animações opcionais.

## Continuidade com a v0.2

Login, sessão, cadastros e diagnóstico demonstrativo permanecem disponíveis.
O endpoint `/overview` mantém seu contrato; `/risk-overview` acrescenta o inventário sem alterar os consumidores anteriores.
A migração `20261017000000_risk_inventory` adiciona tabelas, relações, índices e proteção do histórico.
Não exige reset, nova senha, troca de provedor ou recriação de organizações.

Uma origem de diagnóstico exige ciclo encerrado, mesmo setor/grupo e resultados coletivos disponíveis.
O registro não identifica participantes nem referencia respostas individuais.
O limiar demonstrativo e a supressão dos resultados diagnósticos continuam aplicados.

## Limites do produto

Uma ficha preliminar documenta observação e fundamentação; não é laudo, score ou aprovação técnica de SST.
O percentual do painel mede preenchimento de registros, não saúde, redução de exposição ou conformidade legal.
O papel de administrador concede permissão operacional, não comprova habilitação profissional.

Editor de instrumentos, colaboradores, matriz técnica validada, plano de ação completo, evidências,
relatórios regulamentares e IA permanecem fora deste incremento.
Use exclusivamente dados fictícios na demonstração.

## Referências

- [Como usar o fluxo](USO_V03.md)
- [Contratos e critérios observáveis](CRITERIOS_V03.md)
- [Experiência, acessibilidade e movimento](UX_V03.md)
- [Verificação da versão](VERIFICACAO_V03.md)
- [Plano e prioridades](plans/PLANO_APLICACAO_V03.md)
