# Contribuir neste incremento

## Antes de começar

Repositório: https://github.com/byteric/renr-plus.
Destino desta rodada: `integracao/deploy-v01`. A branch é temporária e será integrada à `main` após revisão.
Quando Ricardo reunir a rodada em `dev/ricardo`, os membros envolvidos são creditados por coautoria nos commits pertinentes.
Não reaplicar os pacotes individuais já incluídos nessa PR. Não fazer push direto na `main` nem alterar suas proteções.

1. Aguardar a integração da pessoa anterior indicada no pacote.
2. Confirmar que a cópia local está limpa com `git status --short`.
3. Atualizar a própria branch a partir de `origin/integracao/deploy-v01`, sem reset ou force push.
4. Copiar somente os arquivos do primeiro bloco e conferir o diff.
5. Executar as verificações indicadas e criar o primeiro commit.
6. Aplicar o segundo bloco, executar as verificações e criar o segundo commit.
7. Enviar a branch e abrir uma única PR para `integracao/deploy-v01`, solicitando revisão de Ricardo.

## Conferir o conteúdo

Os comandos `git add` do pacote enumeram caminhos exatos. Não usar `git add .`.
Não copiar `TUTORIAL.md`, `.env`, `node_modules`, builds, relatórios de teste ou o pacote inteiro para o repositório.
Não criar commits vazios para cumprir quantidade. Os dois blocos representam alterações distintas.
Não atribuir implementação ou revisão a quem ainda não conferiu o pacote.

## Datas e publicação

`git commit --date` altera a data do autor, não agenda execução, push ou deploy.
A data do committer continua sendo a data real da criação do commit.
Ao usar esse parâmetro, a metadata do autor não deve ser interpretada como prova do período de trabalho.
Uma data futura não retém o commit: ele aparece no remoto assim que a branch é enviada.

## Se houver conflito

Parar e enviar o erro e `git status --short` a Ricardo.
Não apagar alterações, sobrescrever arquivos fora do pacote, recriar a main ou publicar por outra branch para contornar revisão.
