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

| Tela       | Desktop e tablet                                                                               | Celular                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Entrada    | Acima de 900 px, formulário à esquerda e apresentação compacta ao lado; no tablet, empilhados. | Formulário antes da apresentação complementar; botão Entrar com área de toque mínima de 44 px. |
| Workspace  | Navegação lateral e cabeçalho de contexto.                                                     | Navegação em drawer com Escape, foco e rolagem contida.                                        |
| Painel     | KPIs em grade, barras e anel com tabela/lista equivalente.                                     | Grade compacta e gráficos empilhados, sem cortar ações.                                        |
| Inventário | Filtros identificados e tabela paginada.                                                       | Registros em cards com rótulos equivalentes à tabela.                                          |
| Registro   | Seções de leitura, origem, fichas e histórico.                                                 | Mesmas informações; navegação de seções rolável e campos empilhados.                           |

Dados de empresas diferentes não permanecem visíveis durante troca ou carregamento.
Respostas atrasadas são descartadas; alternar A → B → A exige nova leitura, sem reapresentar o snapshot anterior.
As rotas de detalhe e os filtros podem ser compartilhados, respeitando sessão e autorização.

No acesso, a ordem do DOM acompanha a apresentação visual e a leitura assistiva:
o título principal é “Acesse o ReNR+” e a narrativa complementar usa título de segundo nível.
O formulário fica disponível imediatamente, sem depender da ilustração ou de uma interação.
E-mail, senha e Entrar ficam na primeira tela em 375 × 812 e 390 × 844, no estado inicial,
sem teclado aberto e com zoom padrão. Em 1440 × 900, a composição inicial e o rodapé cabem sem rolagem.
Nos desktops de 1280 × 720 e 1366 × 768, os campos e Entrar ficam acessíveis na primeira tela;
o restante do conteúdo pode exigir rolagem nativa.

Avisos de sessão, validação, erro e envio pendente continuam no fluxo e podem aumentar a altura.
Janelas baixas e leitura ampliada preservam a rolagem até todos os controles.
No celular, a apresentação abaixo do formulário continua completa e pode ultrapassar a primeira tela.
Essas condições e os limites das verificações estão no relatório; não implicam teste em aparelho físico.

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
Erros de formulário são ligados aos campos. No login, erros de validação e envio permanecem antes de Entrar.
Gráficos têm nome acessível, escala iniciada em zero e acesso aos valores sem depender de cor.
Arquivados, unidades inativas e fichas preliminares têm identificação textual.
Ausência de ficha não é apresentada como classificação de risco.

O login foi verificado nas larguras 320, 375, 390, 768, 1280, 1366 e 1440 px, nos temas claro/escuro.
Testes automatizados complementam a inspeção visual; não equivalem a certificação de acessibilidade.
Resultados e condições estão no [relatório de verificação](VERIFICACAO_V03.md).
