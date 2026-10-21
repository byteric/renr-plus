# Usar o inventário e as fichas preliminares

## Entrar no ambiente local

Prepare banco, migrações, build e dados sintéticos pelos comandos do [README](../README.md#começar).
Abra `http://127.0.0.1:5173` e use uma conta de demonstração autorizada.
A senha local fica em `DEMO_PASSWORD`, no arquivo `apps/api/.env`; não compartilhe esse arquivo.
O seed preserva senhas existentes. Reinstalar dependências não altera a senha de uma conta já cadastrada.

Selecione a empresa ativa antes de consultar o painel, diagnóstico ou inventário.
Administrador cadastra e altera registros; leitor consulta as mesmas informações permitidas, sem controles de escrita.

## Consultar o painel

Abra **Painel**. Os indicadores mostram registros não arquivados, rascunhos, registrados e registros sem ficha.
Clique em um indicador para abrir o recorte correspondente do inventário.
Expanda **Ver valores e filtrar por unidade** para consultar a tabela equivalente ao gráfico.
**Outras unidades** agrega as unidades além das oito maiores; seu link abre o inventário completo.

O anel usa registros com ficha / registros não arquivados.
Sem registros, o painel informa ausência de dados; não apresenta 100% de conclusão.
O horário informa a atualização do snapshot, não um monitoramento em tempo real.
Os totais organizacionais abaixo têm atualização própria e não representam avaliação de riscos.

Em **Cadastros de riscos por dia**, escolha 7, 30 ou 90 dias.
A série usa a data de criação e o fuso configurado da empresa, incluindo dias sem cadastro.
Inclui rascunhos, registrados e arquivados: arquivar não apaga um cadastro da série histórica.
Por isso, o total do período não precisa coincidir com os registros ativos do painel.
Expanda **Ver cadastros por dia** para conferir as datas e contagens.

## Cadastrar um risco

Abra **Inventário → Novo risco**. Escolha unidade e setor ativos e descreva o fator, sem identificar trabalhadores.
**Salvar rascunho** exige fator de 3–160 caracteres e setor válido.
Campos pendentes podem ficar vazios, mas seus limites máximos permanecem aplicados.

Para **Registrar risco**, complete os campos abaixo:

| Campo                 | Conteúdo e limite                                                           |
| --------------------- | --------------------------------------------------------------------------- |
| Descrição do fator    | Contexto coletivo; 10–2.000 caracteres.                                     |
| Contexto de exposição | Situação de trabalho; 10–2.000 caracteres.                                  |
| Grupo exposto         | Grupo, sem nomes; 3–2.000 caracteres.                                       |
| Possíveis agravos     | Descrição preliminar; 5–2.000 caracteres.                                   |
| Controles existentes  | Medidas identificadas; 5–2.000 caracteres.                                  |
| Tipo de origem        | Registro técnico contextual ou diagnóstico coletivo.                        |
| Nota de origem        | Fonte e contexto; 10–1.000 caracteres.                                      |
| Ciclo de origem       | Exigido para diagnóstico: encerrado, mesmo setor e consolidação disponível. |

No diagnóstico encerrado, **Criar registro de risco a partir deste ciclo** preenche o escopo e o vínculo.
Revise os demais campos antes de salvar. A origem contextual não valida uma metodologia técnica.
O setor não muda após o cadastro; um registro completo também preserva tipo de origem e ciclo.

## Acrescentar uma ficha

No detalhe de um risco registrado, escolha **Adicionar ficha preliminar**.
Preencha referência do método (3–200 caracteres), versão (1–40), observação e justificativa (10–2.000 cada).
Ao salvar, o servidor determina sequência, autoria, data e versão do risco utilizada.
Expanda **Contexto preservado nesta ficha** para conferir a cópia daquela versão.
Uma edição posterior do risco não altera as fichas anteriores. Não existe edição ou exclusão de ficha.

## Filtrar, compartilhar e retornar

Use a busca pelo nome do fator e os filtros da lista; confirme em **Aplicar filtros**.
Os atalhos de rascunhos, sem ficha e arquivados abrem um recorte explícito na página 1.
Os filtros e a página permanecem na URL após recarga e navegação voltar/avançar.
Arquivados só aparecem quando esse estado é solicitado explicitamente.
Trocar a unidade limpa o setor anterior para evitar filtros incompatíveis.

No detalhe, os atalhos **Resumo, Exposição, Origem, Fichas e Histórico** acompanham a leitura.
O endereço com `section` recupera a seção após recarga.
**Voltar ao inventário** recupera o recorte e a posição da lista nesta sessão de navegação.
Trocar de empresa descarta dados e rascunhos do contexto anterior.

## Resolver uma falha sem perder informação

| Situação                             | Como proceder                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Campos incompletos                   | Corrija os campos destacados; o primeiro erro recebe foco.                                                               |
| Serviço indisponível antes de salvar | Aguarde e tente novamente; o formulário mantém o texto.                                                                  |
| Outra pessoa editou o risco          | Copie o texto que deseja preservar; cancele, consulte a versão atual e reaplique conscientemente.                        |
| Rede interrompida durante gravação   | Consulte inventário/histórico antes de reenviar: a primeira gravação pode ter sido concluída. Não há reenvio automático. |
| Falha ou conflito no arquivamento    | Use **Atualizar registro**, confira o estado atual e só então confirme novamente.                                        |
| Sessão expirada                      | Entre novamente; a tela privada é removida.                                                                              |

## Arquivar

Escolha **Arquivar risco** e confirme após ler o aviso.
O registro sai do recorte padrão e fica somente para consulta, inclusive suas fichas.
Não há restauração nem exclusão física pelo produto nesta versão.
