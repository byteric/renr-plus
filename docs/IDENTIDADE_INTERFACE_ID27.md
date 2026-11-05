# Identidade de interface — ID 27

## Direção aplicada

A interface ReNR+ usa a identidade aprovada **Percurso**: verde profundo `#173E3A`, mineral `#579277`, lima suave `#D5E7A3`, claro `#F7F8F2` e Manrope já carregada pelo projeto. O radar de frontend e o guia Impeccable foram consultados; a identidade fornecida é a referência, sem importar templates ou gerar outra marca.

O login mantém sua ordem: proposta de gestão preventiva, jornada de registros e acesso. A composição de apoio incorpora os símbolos SVG existentes, com percurso aberto conectando diagnóstico e registro. A ilustração é decorativa e não acrescenta paradas de teclado. O texto da jornada permanece acessível independentemente da imagem.

Os tokens semânticos controlam texto, ação, superfícies, foco e estados nos dois temas. Lima funciona como acento e ação no tema escuro; mineral permanece nos detalhes da composição. Os aliases antigos de cor da marca foram mantidos para consumidores existentes. Cores de sucesso, alerta e erro continuam com papéis próprios.

## Comportamento preservado

- A `picture` responsiva da marca no cabeçalho não foi alterada. O SVG de apoio reserva proporção `520 / 270` e dimensões dos símbolos durante a carga.
- O login conserva o grid e os breakpoints existentes. Não foram introduzidos altura fixa, bloqueio de rolagem ou ocultação de ações.
- Conteúdo comum recebe cursor padrão; links, botões e controles acionáveis recebem pointer; campos de texto e conteúdo editável recebem I-beam. Campos somente leitura não sugerem edição; desabilitados mantêm a indicação de indisponibilidade.
- Seleção nativa de texto, caret e foco continuam disponíveis. Não foram aplicados `user-select: none`, caret transparente ou remoção global de outline.
- Os seletores `data-motion-illustration` e `data-motion-connection` continuam integrados ao hook existente, com sua preferência por movimento reduzido.

## Verificação executada

Em 04/11/2026:

- Red: `node apps/web/node_modules/vitest/vitest.mjs run --root apps/web src/components/BrandIntro.test.tsx`, com `TEMP` e `TMP` apontando para `tmp`, executou dois testes; o novo falhou pela ausência dos símbolos aprovados, antes da alteração de produção.
- Green: `node --experimental-import-meta-resolve apps/web/node_modules/vitest/vitest.mjs run --config tmp/id27-vitest.config.mjs src/components/BrandIntro.test.tsx` passou **2/2**. A configuração transitória em `tmp` usa resolução ESM do Node para contornar a falha de resolução Vite no caminho local; não altera configuração versionada.
- `node node_modules/typescript/bin/tsc --noEmit --project apps/web/tsconfig.json`: passou.
- `node node_modules/eslint/bin/eslint.js apps/web/src/components/BrandIntro.tsx apps/web/src/components/BrandIntro.test.tsx --max-warnings 0`: passou.
- Prettier foi aplicado somente aos arquivos atribuídos. Contraste de pares opacos de tokens calculado pela luminância relativa sRGB: texto principal/claro **11,01:1**, texto secundário/claro **5,75:1**, acento de texto/claro **5,42:1**, ação/cartão escuro **10,03:1**, texto secundário/fundo escuro **9,38:1**. Isso não substitui auditoria dos estados renderizados.

A tentativa de inspeção Playwright local não produziu capturas válidas: a resolução transitória usada para Vitest encaminhou `react/jsx-dev-runtime` para um módulo incompatível com o browser. Não foi instalada dependência nem alterada a configuração permanente para contornar esse problema.

## Gate visual de sete eixos

| Eixo                      | Estado                     | Evidência e limite                                                                                                                     |
| ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Identidade e verdade      | Aprovado no código         | Paleta e símbolos aprovados reutilizados; sem dados ou claims novos. Aparência final pendente de renderização.                         |
| Hierarquia e tarefa       | Não verificado visualmente | Jornada e ausência de controles decorativos cobertas por teste; posição e acesso renderizados ainda precisam de inspeção.              |
| Tipografia e voz          | Não verificado visualmente | Família Manrope e textos existentes preservados; fallback e tamanhos-alvo não inspecionados.                                           |
| Espaço e composição       | Não verificado visualmente | SVG reserva proporção e símbolos têm dimensões explícitas; clipping e reflow precisam de browser funcional.                            |
| Física e motion           | Não verificado visualmente | Hook e seletores preservados; movimento e preferência reduzida não medidos nesta etapa.                                                |
| Acesso e estados          | Parcial                    | Pares principais medidos e decoração oculta da árvore acessível; teclado, caret e cursores computados precisam de inspeção no browser. |
| Responsividade e contexto | Não verificado visualmente | Breakpoints e rolagem existentes preservados; desktop, mobile, zoom e ambos os temas precisam de validação visual integrada.           |

Pendência de integração: executar o login em servidor funcional nos dois temas e em desktop/mobile, conferir foco, seleção, caret, cursor computado, zoom e acesso ao botão Entrar por rolagem. Esta nota não declara conformidade global, aprovação visual ou medição de desempenho.

## Verificação integrada de 05/11/2026

O Chromium renderizou o build de produção com fixtures HTTP sintéticas interceptadas, pois o sandbox rejeitou a conexão com o preview de loopback. Login e áreas de Pessoas, Plataforma e prévia de Relatórios passaram sem overflow de página em 320, 375, 390, 768, 1280 e 1440 px nos dois temas. O reflow a 200% usou zoom CSS em viewport de 640 px. A inspeção das capturas em 320 px confirmou contraste da assinatura nos dois temas e revelou que o seletor de empresa confundia o escopo global; a navegação global passou a exibir o identificador de escopo. A verificação de teclado inclui foco programático no título da prévia e retorno ao botão ao fechar a correção cadastral com Escape. O cursor computado foi `default` em texto estático, `text` no campo de e-mail e `pointer` no link da marca. As referências SVG e ICO versionadas do favicon retornaram HTTP 200 e foram decodificadas pelo Chromium. A checagem do ícone na aba do navegador e zoom nativo permanecem pendentes.

A ilustração do login agora é estática. O GSAP continua restrito às transições de conteúdo e visualizações, com limpeza no ciclo de vida e dados finais imediatamente disponíveis para movimento reduzido. A fonte Manrope Variable WOFF2 está em `public/brand` e tem 28,95 kB. O build mediu cerca de 177 kB gzip de JavaScript inicial, somando o módulo de entrada às dependências estáticas. As três áreas privadas continuam em módulos carregados sob demanda.
