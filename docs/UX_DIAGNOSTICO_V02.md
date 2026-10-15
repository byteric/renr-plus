# Direção visual e jornadas — diagnóstico v0.2

## Direção

Uma área de trabalho preventiva, legível e focada na próxima ação. A estrutura e as cores existentes do ReNR+ são preservadas; o refinamento aumenta a consistência entre cadastros, ciclo e participação, sem transformar o produto em uma página promocional.

Azul-petróleo é a cor de ações principais; verde destaca progresso e laranja aparece pontualmente na identidade. Estado também possui texto, nunca somente cor. Tipografia usa a família existente e espaçamentos seguem ritmo consistente. Modos claro/escuro preservam contraste e hierarquia.

## Jornadas

| Perfil        | Caminho                                                                            | Resultado                                                             |
| ------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Administrador | Empresa → diagnóstico → instrumento → criação → abertura → convites → encerramento | Ciclo persistido e resultados coletivos disponíveis quando permitido. |
| Leitor        | Empresa → ciclos → detalhe → resultados                                            | Consulta coletiva, sem controles de alteração ou leitura individual.  |
| Participante  | Endereço público → código → perguntas → envio → confirmação                        | Resposta de teste persistida, sem sessão administrativa.              |

## Composição

Cabeçalho apresenta identidade, contexto e tema. Navegação separa painel, cadastros e diagnóstico. A página de ciclo apresenta estado e período antes das ações. A participação usa uma coluna com grupos de opções e confirmação explícita; evita menus administrativos e distratores.

O código de convite não integra endereço ou histórico. Convites aparecem somente após emissão; orientação explica que devem ser copiados e encaminhados manualmente, fora da documentação pública.

## Estados obrigatórios

Carregamento mantém orientação; vazio explica o próximo passo; erro oferece recuperação quando segura; formulário preserva preenchimento em memória. Resultado indisponível explica período/encerramento/supressão sem revelar contagens proibidas. Botões de escrita não aparecem para leitor.

## Movimento e acessibilidade

Movimento curto orienta a próxima ação. GSAP anima apenas transformações leves de entrada/transição, com escopo do componente e reversão no desmontar. Não animar layout, não atrasar validação, não ocultar conteúdo enquanto aguarda efeitos e não duplicar motores na mesma propriedade.

`prefers-reduced-motion` remove o deslocamento e preserva todos os estados. Componentes compostos seguem os padrões shadcn/Radix pertinentes, com foco, retorno de foco e controles semânticos. A navegação móvel mantém acesso às mesmas funções. Não declarar melhoria de FPS ou conformidade completa sem medição/verificação.

## Verificação

Inspecionar desktop e mobile, ambos os temas, menus por teclado, campos obrigatórios, troca rápida de empresa, convite indisponível e supressão de resultados. As telas de diagnóstico exibem: “Demonstração — use somente dados fictícios; instrumento não validado”.
