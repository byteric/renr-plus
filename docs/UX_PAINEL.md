# Experiência do painel organizacional

## Objetivo

Dar ao gestor uma visão da estrutura cadastrada antes de iniciar os próximos módulos de prevenção.
O painel complementa os cadastros existentes; não representa uma avaliação de riscos.

## Direção visual

Preservar a identidade ReTech+: verde, petróleo e laranja de apoio, com os tokens já existentes.
Primeiro apresentar empresa e situação dos cadastros; depois unidades sem setores e acesso aos cadastros.
Usar tipografia e bordas do produto, sem acrescentar outra biblioteca ou sistema de temas.

## Comportamento

- A navegação oferece o painel no contexto da empresa selecionada.
- Unidades e setores são apresentados com rótulos textuais para ativos, inativos e totais.
- A informação não depende apenas de cor.
- Um painel vazio orienta o próximo passo, sem fingir métricas já coletadas.
- Carregamento e falha têm mensagens próprias; a nova tentativa mantém o contexto autorizado.
- A troca de empresa não mantém dados de outro contexto na tela.
- Links de cadastros aproveitam as rotas e os controles existentes.

## Acessibilidade e apresentação

Usar títulos ordenados, listas de definição para números, foco visível e controles nativos.
No celular, reorganizar as informações mantendo as ações disponíveis.
Claros e escuros usam os mesmos conteúdos e significados. Não introduzir animação obrigatória.

## Validação

Conferir navegação por teclado, empresa sem dados, erro recuperável, tela estreita e ambos os temas.
Os testes automatizados complementam a inspeção visual; não substituem a revisão da apresentação.
