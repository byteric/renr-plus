# Conferir o incremento antes de publicar

## Integração

- [ ] Todas as PRs da rodada possuem os dois blocos previstos e foram revisadas.
- [ ] Checks, integração com PostgreSQL e navegação desktop/mobile passaram na versão composta.
- [ ] A PR final compara `integracao/deploy-v01` com `main`, sem segredos ou dados reais.
- [ ] Ricardo aprovou o merge e autorizou separadamente a publicação.

## Nuvem

- [ ] Um Web Service Render Free executa frontend compilado e API no mesmo container.
- [ ] Banco Neon Free é `renr_homologation`, sem dependência do PostgreSQL ou MinIO do PC.
- [ ] Conexões de pool e migração direta usam TLS verificado e o mesmo banco.
- [ ] Origem HTTPS exata, cookies Secure/HttpOnly e isolamento por empresa estão preservados.
- [ ] Não há plano pago, disco, worker, domínio comprado ou publicação automática ativada.
- [ ] Seed local não foi executado na nuvem; o provisionamento remoto é manual e protegido.

## Link de demonstração

- [ ] Executar `node scripts/check-hosted.mjs ORIGEM_HTTPS_RENDER`, substituindo o argumento pela origem do serviço.
- [ ] Confirmar manualmente login, painel, cadastros, leitor e troca de empresa em navegador HTTPS.
- [ ] Recarregar a página, sair e entrar novamente; não manter dados de sessão anterior.
- [ ] Reiniciar o serviço Render e confirmar persistência no Neon.
- [ ] Abrir o link em outro dispositivo, com o PC de desenvolvimento desligado.
- [ ] Se uma proteção ou verificação falhar, não entregar o link.

O script externo não substitui os testes autenticados. O modo gratuito pode suspender a aplicação por inatividade.
