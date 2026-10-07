# Ambiente local

Pré-requisito: Docker Desktop com Compose V2 e engine Linux iniciada.

1. Na raiz do repositório: `pnpm setup:local`.
2. `pnpm infra:up`.
3. `pnpm infra:verify` para preparar/testar o bucket privado com dados sintéticos.
4. `pnpm db:deploy` para aplicar as migrações existentes, sem reset.
5. `pnpm infra:status` para conferir os serviços.

No Windows, `INICIAR_AMBIENTE_COMPLETO.cmd` executa essa preparação e inicia web/API.
O helper dos comandos `infra:*` detecta a instalação Docker por usuário e inicia Docker
Desktop se necessário. Ele não altera o PATH global, nem adiciona usuários a grupos administrativos.

PostgreSQL: `127.0.0.1:5432`. MinIO: `127.0.0.1:9000`, console `127.0.0.1:9001`.
Credenciais ficam no `.env` local, criado com senhas aleatórias. Não publicar esse arquivo.

O MinIO Community é compilado a partir de uma revisão fixa do repositório oficial,
sem usar espelhos de terceiros ou imagens antigas presumidas disponíveis.
A primeira inicialização exige rede e leva mais tempo por causa da compilação.
Esta configuração é de desenvolvimento, não uma decisão de hospedagem de produção.
O bucket configurado pela API é criado sem acesso público. O teste S3 grava/lê e remove
somente um objeto sintético único. Políticas por usuário e organização continuam sendo
responsabilidade da implementação do módulo de evidências, antes de usar dados reais.

`pnpm infra:down` para os serviços preservando os volumes. Não remova volumes para
resolver erros sem verificar o conteúdo; essa operação apagaria dados locais.
