# Critérios de aceite — ações e evidências

## Papéis e limites

Administrador registra alterações; leitor consulta. Um nome no campo de responsável
não cria usuário ou permissão. Toda operação é limitada à empresa ativa da sessão.
Dados da demonstração são fictícios. Execução informada, anexos e preenchimento de
critérios não representam eficácia comprovada nem aprovação técnica de SST.

## US-A01 — criar uma medida preventiva

Como administrador, quero criar uma ação a partir de um risco para organizar sua execução.

1. O formulário identifica o risco de origem e pede título (3–160), descrição
   (10–2.000), responsável nominal (3–120), prazo civil, resultado esperado
   (10–2.000) e critério de aferição (10–2.000 caracteres).
2. A API exige `expectedRiskVersion`; campos extras, datas inexistentes, ano zero
   ou campos obrigatórios vazios retornam 400, com indicação de campo quando aplicável.
3. Somente risco registrado em empresa/unidade/setor ativos recebe nova ação.
   Risco de outra empresa não revela sua existência; versão desatualizada retorna 409.
4. Ficha de referência é opcional e precisa pertencer ao mesmo risco e à mesma empresa.
   O cliente não define autoria, status inicial, versão, datas nem snapshot.
5. A criação retorna 201, começa planejada e grava ação, revisão inicial e auditoria
   atomicamente. Recarregar mostra os mesmos dados; a versão do risco não muda.

## US-A02 — consultar e filtrar

Como usuário autorizado, quero localizar medidas sem perder meu contexto de navegação.

1. `GET /actions` aceita risco, unidade, setor, estado, busca por título/responsável,
   somente abertas e atraso, com página inicial 1 e tamanho padrão 50, máximo 100.
2. Filtros desconhecidos/duplicados ou combinações unidade/setor incompatíveis são
   recusados. Booleans aceitam apenas os textos `true` e `false`.
3. Sem filtro de estado, mostrar todos os estados; filtro de atraso restringe aos
   estados abertos. Estado terminal combinado com abertas/atrasadas resulta em lista vazia.
4. Ordenação por prazo e identificador é estável; `total` considera o recorte inteiro,
   não apenas a página. Filtros e página são restaurados pela URL e pelo botão voltar.
5. Desktop e celular expõem os mesmos dados e ações permitidas, sem transbordamento
   horizontal. Estado vazio distingue ausência de dados de erro de carregamento.

## US-A03 — editar com concorrência

Como administrador, quero corrigir uma medida aberta sem sobrescrever outra pessoa.

1. Edição aceita apenas os campos operacionais permitidos; origem, ficha original,
   snapshot e autoria de criação não podem ser substituídos.
2. Toda alteração exige versão esperada e justificativa de 10–1.000 caracteres.
   Uma versão vencida retorna 409 sem ação, revisão ou auditoria parcial.
3. Dois escritores usando a mesma versão produzem uma gravação válida e um conflito.
4. A interface mantém o texto em erro recuperável, identifica o conflito e exige
   releitura da versão atual antes de reaplicar. Não reenvia POST automaticamente.
5. Trocar empresa descarta dados e drafts do contexto anterior; resposta atrasada
   da empresa A não reaparece após alternar para B ou retornar a A.

## US-A04 — informar execução ou cancelar

Como administrador, quero acompanhar o estado operacional mantendo a justificativa.

| Estado atual             | Próximo estado permitido | Informação adicional                                   |
| ------------------------ | ------------------------ | ------------------------------------------------------ |
| Planejada                | Em execução              | Versão e justificativa.                                |
| Planejada ou em execução | Cancelada                | Versão e motivo explícito.                             |
| Em execução              | Execução informada       | Versão, justificativa e relato de 20–2.000 caracteres. |

Não é permitido pular de planejada para execução informada ou reabrir estado terminal
nesta rodada. Data/autor da implementação vêm do servidor. Estados terminais não
aceitam edição do conteúdo operacional; o relato anterior permanece no histórico.

## US-A05 — acrescentar nota e ler histórico

Como usuário autorizado, quero entender o que mudou e por quê.

1. Administrador acrescenta nota de 10–2.000 caracteres com versão esperada, inclusive
   após execução informada ou cancelamento, sem alterar o estado operacional.
2. Cada mutação gera exatamente uma nova versão/revisão. Histórico é paginado por
   versão descendente e mostra evento, autor, data e motivo/relato pertinentes.
3. Revisões não têm edição/exclusão e são protegidas no PostgreSQL.
4. Mudança posterior no risco não reescreve o contexto preservado na ação. Arquivar
   o risco ou inativar sua origem impede novas ações, mas não o acompanhamento das existentes.

## US-A06 — acompanhar prazos e painel

Como gestor, quero indicadores que correspondam às medidas cadastradas.

1. A resposta informa fuso e data de referência calculados no servidor. O prazo
   `YYYY-MM-DD` permanece a mesma data civil em qualquer dispositivo.
2. Uma ação aberta só está atrasada quando a referência é posterior ao prazo;
   vencer hoje não é atraso. Estados terminais não entram no atraso.
3. `total = planejadas + em execução + execução informada + canceladas`;
   `abertas = planejadas + em execução` e `atrasadas ≤ abertas`.
4. Indicadores e gráficos usam valores persistidos e levam aos recortes correspondentes.
   Atraso não é um quinto estado nem classificação normativa de risco.
5. Falha do painel tem recuperação própria, sem bloquear outras áreas; tema, foco,
   alternativa textual e movimento reduzido continuam disponíveis.

## US-E01 — anexar uma evidência privada

Como administrador, quero associar um arquivo à ação mantendo rastreabilidade.

1. Upload exige sessão, escopo, papel e Origin válidos antes de processar o arquivo.
2. Enviar um PDF, PNG ou JPEG de até 5 MiB com descrição de 10–1.000 caracteres e
   `expectedVersion`. Extensão, MIME e assinatura precisam concordar. Tipos não suportados,
   arquivos ausentes, tamanho excedido e campos inválidos são recusados com erro seguro.
3. Há no máximo 20 evidências ativas por ação. Nome de objeto, hash, tamanho e autoria
   são definidos pelo servidor; chave de armazenamento não é aceita nem retornada ao cliente.
4. Persistir arquivo/metadados incrementa a versão da ação e acrescenta revisão/auditoria,
   sem alterar o estado operacional, inclusive quando a ação já é terminal.
5. Indisponibilidade de storage não retorna sucesso falso. Se o banco falha depois do
   upload, compensação afeta somente o objeto novo da tentativa, nunca um objeto anterior.

## US-E02 — listar e baixar

Como usuário autorizado, quero recuperar somente os anexos da empresa e ação permitidas.

1. Listagem é paginada e expõe metadados permitidos: descrição, nome seguro, tipo,
   tamanho, hash, autor e data. Não expõe chave, credenciais ou URL pública.
2. Download exige autorização novamente e entrega o arquivo como attachment com
   `nosniff` e `Cache-Control: private, no-store`; conteúdo não é executado como página.
3. Leitor pode consultar/baixar, mas não enviar ou arquivar; chamadas diretas de escrita
   retornam 403. Recurso de outra empresa ou ação não revela sua existência.
4. Sessão expirada, arquivo indisponível e storage desativado têm mensagem de erro,
   sem revelar detalhes de infraestrutura nem impedir ações/notas não relacionadas.

## US-E03 — arquivar sem apagar a rastreabilidade

Como administrador, quero retirar um anexo do uso ativo preservando o registro anterior.

1. Arquivamento exige versão da ação e justificativa de 10–1.000 caracteres.
2. A operação é lógica: preserva bytes privados, metadados, autoria e revisão anterior;
   registra autor/data/motivo do arquivamento e uma única nova versão da ação.
3. Conflito ou falha não produz revisão de sucesso falsa. A interface atualiza a ação
   e a lista de anexos após sucesso, preservando o texto em falha recuperável.
4. Anexar ou arquivar não atesta autenticidade, ausência de malware ou eficácia da medida.

## Portões comuns

Sessão ausente retorna 401; escrita de leitor ou Origin incorreta retorna 403; recurso
fora do escopo retorna 404; conflito de versão/estado retorna 409. Novas respostas privadas,
inclusive erros, não podem ser armazenadas por cache compartilhado. Erros seguem o envelope
existente e não revelam SQL, stack ou credenciais.

A conclusão requer testes de contrato, API, PostgreSQL, MinIO local, interface e navegador,
migração preservando a v0.3 e reprodução dos pacotes combinados. Resultados e limitações
devem constar no relatório de verificação, sem presumir publicação ou validação técnica de SST.
