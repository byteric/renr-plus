# Diagnóstico demonstrativo — histórias e critérios

Recorte da segunda semana da v0.2. A aplicação persiste respostas de teste; o instrumento é fictício, não validado e sem pontuação de risco. Somente dados fictícios são permitidos. Editor, texto livre, avaliação de riscos e IA não pertencem a esta rodada.

## D02-01 — Consultar instrumento

Como usuário autorizado, quero consultar o instrumento fixo da empresa ativa antes de abrir um ciclo.

- A consulta exige sessão válida e vínculo com a empresa ativa. Recursos de outra empresa retornam 404.
- O instrumento informa título, versão publicada, caráter demonstrativo e cinco perguntas obrigatórias: três de escolha única e duas de múltipla escolha.
- Cada pergunta contém identificador, ordem, enunciado, tipo e opções ordenadas. Não há campos de edição/publicação nesta etapa.
- Empresa sem instrumento apresenta estado vazio orientativo, não perguntas inventadas pelo navegador.

## D02-02 — Criar e consultar ciclo

Como administrador, quero criar um ciclo para um setor da empresa ativa.

- Informar nome com 3–120 caracteres, setor, versão do instrumento, início e término. O término deve ser posterior ao início.
- Organização, unidade e setor devem estar ativos; setor e instrumento devem pertencer à empresa autorizada. O servidor determina o contexto, não um campo oculto do formulário.
- A criação retorna o ciclo em DRAFT. Consulta e recarga preservam nome, setor, período, versão e estado.
- Listagem segue a paginação existente. Leitor consulta, mas não cria; a API recusa sua tentativa de escrita com 403.

## D02-03 — Abrir e encerrar ciclo

Como administrador, quero controlar a janela de participação.

- Abrir somente rascunho e durante o período definido. Não aceitar convites/respostas fora do período.
- Encerrar ciclo aberto torna o estado CLOSED e bloqueia novas respostas. Não há reabertura neste recorte.
- Submissão concorrente com encerramento deve obedecer à ordem transacional: um envio confirmado antes do fechamento é preservado; nenhum envio posterior ao fechamento é aceito.
- O navegador apresenta ações coerentes com o estado; a API aplica as mesmas restrições independentemente da interface.

## D02-04 — Emitir convite

Como administrador, quero gerar de 1 a 20 convites individuais para um ciclo aberto.

- A resposta de emissão mostra cada código apenas naquela operação, separado do endereço público de participação.
- O código tem 32 bytes aleatórios, é armazenado somente como hash e expira até o término do ciclo. Não incluir códigos em URL, logs, apresentação ou armazenamento do navegador.
- A página pode copiar endereço e código separadamente. Recarregar não recupera códigos já emitidos; um código novo não substitui automaticamente o anterior.
- Não existe envio automático de e-mail ou controle de pessoas convidadas nesta versão.

## D02-05 — Responder sem login administrativo

Como participante demonstrativo, quero acessar `/#/participar`, informar meu código e responder às perguntas.

- Não exigir sessão administrativa, nome, e-mail ou identificação. Código é enviado no corpo de requisições limitadas à participação.
- Escolha única aceita exatamente uma opção; múltipla escolha aceita uma ou mais opções distintas da pergunta correspondente.
- Pergunta obrigatória sem resposta gera erro identificando o campo e não consome o convite. IDs desconhecidos, perguntas repetidas, opções de outra pergunta e versão divergente são rejeitados no servidor.
- Consumo e gravação são atômicos. Duas submissões simultâneas do mesmo código geram um único envio aceito. Erro de persistência desfaz ambos.
- Convite inválido, expirado, revogado ou usado apresenta indisponibilidade sem revelar resposta anterior. Falha de rede preserva o formulário em memória; não repetir POST automaticamente. Se a confirmação se perder, explicar a incerteza sem emitir outro convite automaticamente.

## D02-06 — Consultar resultado coletivo

Como usuário autorizado, quero consultar consolidação do ciclo encerrado sem ler respostas individuais.

- Ciclo não encerrado não revela contagens nem distribuições. Ciclo encerrado com menos de cinco envios também não revela esses valores.
- Após atingir o limiar demonstrativo, calcular frequências e percentuais a partir de respostas persistidas, nunca de números fixos no frontend.
- Se uma opção tiver contagem positiva inferior a cinco, suprimir toda a distribuição da pergunta; opções com zero não provocam supressão por si só.
- Múltipla escolha usa o número de envios como denominador; percentuais podem somar mais de 100%, e a interface explica isso.
- Não oferecer filtros, exportação, consulta individual ou interpretação clínica. O limiar de cinco reduz divulgação de grupos pequenos, mas não comprova anonimato. Metodologia e política de dados reais exigem validação externa.

## D02-07 — Navegar com segurança

- Empresa ativa permanece visível. Ao alternar contexto, cancelar/descartar consultas anteriores e não exibir seus dados na nova empresa.
- Temas claro/escuro, teclado, foco, validação, estados vazio/carregando/erro e largura móvel de 320 px mantêm as ações essenciais utilizáveis.
- Movimento é complementar, limitado a transições curtas, com limpeza no desmontar e respeito a `prefers-reduced-motion`.
- O fluxo completo deve passar em testes unitários, PostgreSQL real descartável e navegador desktop/mobile.
