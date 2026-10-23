# Usar e testar ações e evidências

## Acessar a homologação

Abra <https://renr-plus-homologation.onrender.com> com a conta fornecida pelo administrador.
A disponibilidade das funções depende do commit publicado. Não execute seed ou testes
automatizados contra esse ambiente. Use somente dados e arquivos fictícios nas demonstrações.
O banco permanece no Neon; anexos usam um bucket privado do Supabase, acessado pela API.
Não há acesso direto ao bucket pelo navegador nem chaves de armazenamento no frontend.

## Preparar

Na raiz do clone, use Node 24 e pnpm 11, com Docker Linux iniciado.

```powershell
pnpm install --frozen-lockfile
pnpm setup:local
pnpm prisma:generate
pnpm infra:up
pnpm infra:verify
pnpm db:deploy
pnpm build
pnpm db:seed
```

O setup preserva `.env` existente. Confira em `apps/api/.env` o banco local e os
valores S3 gerados pelo setup. Para testar anexos, configure `STORAGE_ENABLED=true`
nesse arquivo; não copie credenciais para o Git. O padrão desativado permanece seguro
para ambientes que ainda não possuem armazenamento privado configurado.

```powershell
pnpm dev
```

Abra <http://127.0.0.1:5173>. Use `admin1@renr.example` e a senha local `DEMO_PASSWORD`
de `apps/api/.env`. Nunca use credencial de homologação nem banco remoto para seed/testes.
O seed fornece quatro estados de ações fictícias, preservando registros e senhas existentes.

## Criar e acompanhar

1. No **Inventário**, abra um risco registrado e clique em **Criar ação preventiva**.
2. Informe título, descrição, responsável nominal, prazo, resultado esperado e critério
   de aferição. Uma ficha preliminar de referência é opcional. Salve e recarregue.
3. Em **Ações**, filtre por título/responsável, origem, estado, abertas ou atrasadas.
   Abra uma ação e consulte o contexto original, autoria e revisões.
4. Use **Iniciar execução**, justifique e registre. Depois use **Informar implementação**
   com relato. Cancelamento também exige motivo; ações terminais não são reabertas.
5. Adicione uma anotação e confira sua autoria, versão e conteúdo no histórico.

Uma ação é uma medida preventiva. Responsável nominal não recebe conta/acesso.
Execução informada não equivale a aprovação de eficácia ou encerramento técnico.
Origem arquivada impede nova medida, mas mantém o acompanhamento das ações existentes.

## Anexar e consultar

Na seção **Evidências**, selecione um PDF, PNG ou JPEG fictício de até 5 MiB e descreva
o documento (10–1.000 caracteres). Envie, baixe e compare o conteúdo. O download é privado
e ocorre como anexo; a tela não renderiza o arquivo. Para arquivar, informe o motivo.
O arquivo e seu histórico permanecem acessíveis somente aos perfis autorizados.

O limite é 20 evidências ativas por ação. Arquivamento libera uma posição, mas não apaga
o documento anterior. Não envie dados de saúde, documentos pessoais ou arquivos reais.
Não existe antivírus nem comprovação técnica automática.

## Recuperar falhas

- **409:** alguém alterou a versão. Consulte os dados/histórico atuais e revise o rascunho
  antes de reaplicar. A consulta mostra os campos atuais. Ao confirmar a revisão, campos
  não modificados recebem esses valores e suas alterações são preservadas. Confira diferenças
  no mesmo campo antes de salvar; não há reenvio automático. Estados terminais bloqueiam a edição.
- **Resultado incerto:** confira lista, evidências e histórico antes de novo envio; não
  há repetição automática de POST nem garantia de idempotência.
- **503 de armazenamento:** confira Docker/MinIO, bucket privado, endpoint e flag local.
  Ações e notas continuam funcionando. Descrição/arquivo selecionado são preservados enquanto a tela permanece aberta.
  Na homologação, peça ao administrador para conferir as variáveis privadas do Render
  e o bucket Supabase. Não envie chaves, senhas ou arquivos reais ao relatar o problema.
- **401/403/404:** confira sessão, perfil e empresa ativa. Leitor consulta e baixa arquivos,
  mas não cria, edita, envia ou arquiva.

Trocar empresa descarta dados/rascunhos do contexto anterior. Não use essa troca para
recuperar texto não salvo. A referência de atraso vem do servidor no fuso da empresa,
não da data configurada no navegador.

## Verificar o conjunto

Com banco migrado, build e seed concluídos e MinIO privado habilitado:

```powershell
$env:STORAGE_ENABLED = 'true'
pnpm check
pnpm format:check
pnpm prisma:validate
pnpm test:integration
pnpm test:migrations
pnpm exec playwright install chromium
pnpm test:e2e
```

Integração com armazenamento desativado cobre o erro seguro e não executa os cenários
de bytes. Isso não substitui a verificação completa com MinIO habilitado.
Testes de migração criam bancos temporários próprios; não resetam a base de desenvolvimento.
Registros com histórico imutável são arquivados logicamente quando necessário.
