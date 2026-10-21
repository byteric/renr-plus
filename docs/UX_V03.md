# Experiência da v0.3

## Direção visual

A identidade combina petróleo, verde preventivo, laranja de orientação e fundo creme.
O tema escuro usa superfícies petróleo com texto claro e o mesmo significado dos estados.
Os tokens existentes continuam como fonte de cor, borda e foco; não há um segundo sistema de temas.
O perfil [Design DNA](DESIGN_DNA_V03.json) registra as referências visuais, sem reproduzir marcas ou peças de terceiros.

Títulos usam hierarquia forte; o corpo prioriza leitura e contexto.
KPIs mantêm numerais tabulares e rótulos explícitos.
A pilha tipográfica usa fontes locais de sistema como fallback; não depende de CDN de fontes.
A ilustração de entrada é SVG do produto. O favicon tem versões SVG e ICO.

## Organização das telas

| Tela       | Desktop e tablet                                                      | Celular                                                                    |
| ---------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Entrada    | Narrativa e formulário lado a lado, sem atraso obrigatório de acesso. | Conteúdo e formulário empilhados; ações com área de toque mínima de 44 px. |
| Workspace  | Navegação lateral e cabeçalho de contexto.                            | Navegação em drawer com Escape, foco e rolagem contida.                    |
| Painel     | KPIs em grade, barras e anel com tabela/lista equivalente.            | Grade compacta e gráficos empilhados, sem cortar ações.                    |
| Inventário | Filtros identificados e tabela paginada.                              | Registros em cards com rótulos equivalentes à tabela.                      |
| Registro   | Seções de leitura, origem, fichas e histórico.                        | Mesmas informações; navegação de seções rolável e campos empilhados.       |

Dados de empresas diferentes não permanecem visíveis durante troca ou carregamento.
Respostas atrasadas são descartadas; alternar A → B → A exige nova leitura, sem reapresentar o snapshot anterior.
As rotas de detalhe e os filtros podem ser compartilhados, respeitando sessão e autorização.

## Movimento e rolagem

GSAP anima entrada dos valores, crescimento das barras, preenchimento do anel e conexão da ilustração.
O texto semântico contém o valor real durante toda a animação; o efeito não simula dados novos.
As animações são curtas, locais ao componente e não bloqueiam login ou navegação.
Cada componente limpa seus próprios efeitos ao desmontar ou trocar os dados.

`prefers-reduced-motion` mantém os estados finais sem animação de apresentação.
Mudança da preferência, aba oculta ou componente fora da região visível encerra efeitos em andamento.
Não há reprodução contínua nem dependência de animação para compreender ou acessar conteúdo.

A página usa rolagem nativa, inclusive PageDown, toque e teclado.
Atalhos de seção são pontuais; movimento reduzido usa salto imediato.
Margens de rolagem protegem foco e títulos dos elementos fixos.
O retorno do detalhe restaura a posição anterior da lista; não há scroll-jacking ou barra escondida.
No desktop com altura suficiente, somente a barra compacta de atalhos de filtros acompanha a rolagem.
O formulário completo permanece no fluxo; no celular, os filtros não ocupam uma faixa fixa sobre os registros.
Cabeçalho e navegação de seções usam offsets distintos para não encobrir a seção que recebe foco.

## Estados e acessibilidade

Carregamento, lista vazia, erro, resultado incerto, conflito e modo de leitura têm mensagens distintas.
Erros de formulário são ligados aos campos e o primeiro erro recebe foco.
Gráficos têm nome acessível, escala iniciada em zero e acesso aos valores sem depender de cor.
Arquivados, unidades inativas e fichas preliminares têm identificação textual.
Ausência de ficha não é apresentada como classificação de risco.

Verificação nas larguras 320, 375, 768 e 1440 px e nos temas claro/escuro.
Testes automatizados complementam a inspeção visual; não equivalem a certificação de acessibilidade.
Resultados e condições estão no [relatório de verificação](VERIFICACAO_V03.md).
