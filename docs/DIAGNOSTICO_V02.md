# Executar o diagnóstico demonstrativo

## Preparar

Use Node 24, pnpm 11, PostgreSQL local e somente dados fictícios. Execute o guia da raiz: instalação,
`setup:local`, infraestrutura, `db:deploy`, build e `db:seed`. O seed cria um instrumento por empresa
de demonstração, preservando registros existentes. Uma empresa nova sem instrumento mostra estado vazio.

## Percorrer

1. Entre como administrador e confirme a empresa ativa. Abra **Diagnóstico → Novo ciclo**.
2. Informe nome, unidade/setor, início anterior ao momento atual e término futuro. Crie, consulte e abra o ciclo.
3. Emita convites. Guarde os códigos, exibidos somente nessa operação. Copie o link de participação e compartilhe cada código separadamente.
4. Em outro navegador ou contexto, abra `/#/participar`, informe um código e responda às cinco perguntas fictícias. Confirme o envio e repita com participantes de teste distintos.
5. Volte à gestão, encerre o ciclo e consulte a consolidação. Uma distribuição só aparece quando suas contagens cumprem o limiar demonstrativo.

Um envio abaixo do limiar serve para demonstrar a proteção, não um resultado vazio incorreto.
Para uma demonstração de consolidação visível, use pelo menos cinco envios fictícios com a mesma opção
em cada pergunta. Testes distintos verificam grupos pequenos e distribuições com opções raras.

## Entender os limites

ADMIN altera ciclos; READER consulta. Participação não exige conta administrativa e não associa identidade
ao envio. Convites controlam um envio por código, não comprovam uma pessoa única: outro convite pode
permitir nova resposta da mesma pessoa. Não há garantia absoluta de anonimato.

O instrumento é fixo e imutável. Editor, texto livre, avaliação de riscos, filtros, exportação e acesso
individual não estão implementados neste recorte. Sem IA ou interpretação clínica. Validação de SST,
metodologia e política de coleta/retenção precisam ser concluídas antes de usar dados reais.

## Recuperar de falhas

Validação preserva o convite e identifica a pergunta/campo afetado. Código expirado, revogado ou utilizado
apresenta indisponibilidade. Na falha de rede, o navegador conserva o preenchimento em memória e não
repete POST automaticamente. Se a confirmação se perder, não é possível consultar a resposta individual
para comprovar o envio; confira a orientação do responsável antes de repetir ou solicitar outro código.

## Atualizar a homologação

Somente depois das PRs aprovadas e verificações verdes, publicar manualmente o commit da `main` no serviço
Render Free existente. Manter deploy automático desativado. Aplicar a migração aditiva com a conexão
direta já configurada, sem resetar o Neon, e provisionar somente os instrumentos fictícios usando o fluxo
restrito de homologação. Credenciais nunca entram nos pacotes, repositório ou apresentação.

Repetir os checks públicos, login/painel/isolamento/permissões/logout e diagnóstico com massa fictícia.
Em falha, retornar ao deploy anterior; preservar o banco e investigar antes de reaplicar. Tabelas novas
permanecem compatíveis com a aplicação anterior. Não executar migrations `dev` ou testes contra o Neon.
