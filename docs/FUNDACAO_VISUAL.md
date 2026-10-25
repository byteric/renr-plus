# Fundação visual ReNR+ — ID 01

## Objetivo e limites

Dar às telas existentes uma base visual consistente, legível e reutilizável para a
evolução do produto. Usuários de gestão devem distinguir informação, tarefa e
recuperação de erro sem confundir estado operacional com parecer técnico.

Esta etapa não introduz novas telas de negócio, permissões, atribuições reais,
avaliação de eficácia ou animações adicionais. Mantém React, Manrope, os componentes
Button/Sheet existentes e a paleta ReNR+/ReTech+.

## Direção visual

O conteúdo e as ações vêm antes da decoração: títulos claros, filtros agrupados,
superfícies discretas e histórico em sequência. A referência visual é orientação de
hierarquia e identidade, não prova de funcionalidade ou dado real.

`apps/web/src/design-tokens.css` concentra os tokens. `foundation.css` dá tratamento
comum às primitivas; os estilos de domínio continuam com cada módulo.

| Papel       | Regra                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidade  | Petróleo, verde e laranja existentes, sem copiar ativos externos                                                                                     |
| Temas       | Claro e escuro com cores semânticas próprias de informação, sucesso, aviso e erro                                                                    |
| Tipografia  | Manrope; corpo 16px, controles/tabelas 14px, legenda 12px, subtítulo 20px, seção 24px, título de página 30px, métrica 36px, na escala padrão de 16px |
| Ritmo       | Espaçamentos nomeados em múltiplos de 4px; dimensões tipográficas em rem para respeitar preferências do usuário                                      |
| Superfícies | Bordas legíveis, raios de 8/12/16px e sombras leves, sem depender da sombra para identificar controles                                               |
| Interação   | Alvos principais de pelo menos 44px, foco visível e controles HTML nativos                                                                           |
| Movimento   | Tokens de duração disponíveis; nenhum motor, efeito ou dependência acrescentado nesta etapa                                                          |

## Componentes e consumidores

| Padrão               | Responsabilidade                                                                                                                            | Consumidores reais                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| StatusMessage        | Mensagem contextual e recuperação; erro anuncia `alert`, carregamento/sucesso anunciam `status`; informação/aviso não interrompem a leitura | Inventário/detalhe de riscos; lista/detalhe de ações |
| StatusBadge          | Rótulo explícito, quebra de texto e cor semântica; não calcula nem inventa estado                                                           | Inventário/detalhe de riscos; lista/detalhe de ações |
| Pagination           | Botões nativos, limites da coleção, bloqueio durante consulta e resumo de página                                                            | Listas e históricos de riscos e ações                |
| Cabeçalhos e filtros | Classes compartilhadas existentes, escala de títulos e organização responsiva                                                               | Empresas, unidades, inventário, ações e painel       |
| Histórico            | Sequência e tipografia compartilhadas; autoria, instante e texto continuam vindo dos contratos de domínio                                   | Revisões de riscos e de ações                        |

Filtros e paginação preservam os parâmetros das rotas. Consulta, autorização,
rascunhos, mutações e decisões técnicas continuam sob responsabilidade dos módulos.
As classes de status legadas permanecem compatíveis com seus consumidores.

## Critérios de aceite verificáveis

1. Claro e escuro mantêm texto legível, foco visível e rótulos não dependentes apenas
   de cor. Mensagem de erro e badges exercitados no navegador têm contraste de texto
   mínimo de 4,5:1.
2. Empresas funcionam em 320, 375, 768 e 1440 CSS pixels com nome extenso, sem
   transbordamento horizontal da página; editar permanece alcançável pelo teclado.
3. A lista de ações oferece recuperação dentro do erro e mantém rótulo de estado,
   responsável e atraso legíveis no mobile.
4. Inventário preserva filtros e navegação de página por teclado; reflow em 640 CSS
   pixels verifica o espaço útil equivalente a 1280px com ampliação de 200%.
5. Testes de componentes, tipos, lint, build e fluxos E2E existentes passam sem
   alterar o contrato de negócio. A suíte de apresentação usa respostas sintéticas
   e não acessa banco ou nuvem.

## Verificação reproduzível

```sh
pnpm check
pnpm format:check
pnpm test:ui
pnpm test:e2e
```

Os E2E de negócio exigem os serviços locais e dados sintéticos preparados conforme
o README. A suíte `test:ui` inicia seu próprio Vite e não usa credenciais. Capturas
ficam em `test-results/`, fora do versionamento. Os resultados executados de cada
etapa são registrados em `docs/VERIFICACAO_ID01_ID02.md`.
