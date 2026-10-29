# Verificação — IDs 19 e 20

Data: 28/10/2026. Incremento concluído e verificado localmente.
Base Git 18e63dd preservada. Sem novo commit, push, PR ou alteração das proteções.
Os incrementos locais 11–18 foram preservados. A publicação do protocolo novo é
uma etapa posterior; a correção de configuração B03 foi validada no código já publicado.

## Resultado funcional

Tentativa durável com chave por organização, ação e criador, fingerprint imutável,
versões concorrentes e lease. A reserva conta no limite de vinte. PUT ocorre fora
da transação, e finalização revalida atribuição, autorização, ação e lease. Evidência,
revisão, auditoria e avanço de versão são gravados atomicamente.

Após falha, consulta e conciliação distinguem objeto presente, ausente e desconhecido.
Presença exige HEAD compatível e hash dos bytes de GET; somente HEAD 404 confirma
ausência. Retry sonda novamente antes do PUT. Nenhum resultado incerto causa reenvio
ou exclusão automática, e execuções superadas não finalizam. Abandono termina a
reserva sem apagar objetos. Contratos estritos e rotas anteriores permanecem compatíveis.

A central preserva arquivo, texto e chave após falha recuperável; uma tentativa não
registrada só pode ser repetida explicitamente após revalidar a ação, com a mesma
chave. Rejeição definitiva libera edição. A perda de acesso remove o rascunho.
Eventos reais do transporte distinguem transmissão de confirmação, sem percentual
estimado. Arquivos mostram estado, metadados e usos paginados em pareceres e
encerramentos. A confirmação de arquivamento exige consulta do arquivo exato.

## Gates executados

| Verificação               | Evidência e resultado                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Check integrado           | `pnpm check` passou: geração Prisma, lint, tipos, 60 testes de scripts, 134 de contratos, 167 de API sem banco, 301 de frontend e build.                                                                                                                           |
| Recuperação e autorização | 19 suítes PostgreSQL/MinIO, **213 testes aprovados**; mais **1 teste do CLI contra a API real**, com usuário de duas organizações, Origin, ativação, dry-run sem alterar tentativas e aplicação explícita sem PUT/delete.                                          |
| Migrações                 | 17 migrações em banco vazio, repetição de deploy e seed; oito testes de evolução e quatro de expansões anteriores aprovados. Teste novo preserva hashes/contagens de todas as tabelas anteriores, incluindo evidência e revisões, sem inferir tentativas.          |
| Comparação de schema      | Nenhuma divergência nova. Permanecem as duas diferenças de defaults de `instrument_versions.instrument_id` e `creation_transaction`, já documentadas antes deste incremento.                                                                                       |
| Compatibilidade           | Consumidores congelados v0.3, retorno à aplicação anterior e retomada da atual passaram; dados históricos preservados no schema expandido.                                                                                                                         |
| Interface                 | **40 cenários aprovados**, incluindo teclado, reflow 320/390/768/1440, dois temas e controles de 44 px. As duas jornadas de evidências foram repetidas para capturas reais de viewport.                                                                            |
| E2E com API/banco reais   | **85 aprovados em desktop e 85 em mobile**, 170 ao todo. Inclui os dois novos casos de resposta perdida e repetição com chave original.                                                                                                                            |
| Blueprint                 | Estrutura validada com o JSON Schema oficial atual do Render. Testes de inicialização/Free passaram após manter storage habilitado, S3 com `sync:false`, deploy automático e previews desligados, sem worker ou banco pago. Nenhum sync do Blueprint foi aplicado. |
| Formatação e diff         | pnpm format:check e git diff --check passaram.                                                                                                                                                                                                                     |

Saídas completas e capturas sintéticas estão na pasta local ignorada `tmp/`.
Não há senha, sessão, chave de infraestrutura ou conteúdo binário nos arquivos versionáveis.

## Casos críticos comprovados

- Replay concluído retorna a mesma evidência e revisão, inclusive com storage indisponível.
  Conteúdo diferente com a mesma chave é recusado. Concorrência mantém uma finalização.
- PUT com resposta perdida e confirmação de commit perdida preservam bytes e metadados;
  após recriar a aplicação, a mesma tentativa é recuperada sem outro PUT.
- Alteração de versão, revogação de autorização e reatribuição durante PUT impedem a
  finalização antiga. A reatribuição conclui enquanto o storage está suspenso, provando
  ausência de transação de banco aberta durante a transferência.
- Vinte reservas impedem uma vigésima primeira; abandono libera capacidade. Uma
  execução atrasada com lease superado não finaliza. Probe desconhecido mantém
  incerteza; objeto que chegou atrasado é finalizado sem novo PUT.
- Usos em parecer e encerramento são consultados por snapshot. Consulta bem-sucedida
  de B não habilita arquivamento de A. Erros definitivos também liberam edição após
  repetir tentativa ainda não registrada. Troca de contexto aborta o transporte real.

TDD incluiu Red/Green para replay, consulta sem mutação, sondagem antes de retry,
contratos de estado, transporte e recuperação da interface. A revisão independente
apontou origem local/empresa ativa do CLI e readiness por documento; correções
possuem testes específicos.

## B03 na homologação: prova separada

O POST autenticado com PDF inteiramente fictício retornou 503 em 305 ms. Não criou
evidência nem mudou a versão da ação. O Render tinha `STORAGE_ENABLED=false`;
endpoint, região e bucket correspondiam ao Supabase ativo, privado e com limite de
5 MiB para PDF/PNG/JPEG. As chaves não foram exibidas nem copiadas para o projeto.

Somente a flag foi alterada, preservando as demais variáveis. A ferramenta do Render
acionou republicação do **mesmo commit 18e63dd**, sem código novo. Upload passou a
retornar 201; o download autenticado retornou 200 com SHA-256 igual aos bytes enviados.
Depois de uma segunda republicação do mesmo commit, o arquivo continuou acessível
e íntegro; total permaneceu um e versão dois. Download sem sessão retornou 401,
e a rota pública do objeto privado retornou 400. Os oito checks públicos passaram.
Ao concluir, a empresa fictícia desta verificação foi inativada pelo seu ID e nome
exatos, preservando arquivo e histórico e evitando deixá-la na lista de empresas ativas.

Deploys verificados: `dep-dbgr1s6gekts738lvqh0` e `dep-dbgr6gfb9u1s7392hrug`, ambos
ativos no mesmo SHA. Serviço continua na main, plano Free e atualização automática
desativada. Neon não foi resetado nem migrado nesta operação; nenhuma senha foi
redefinida e nenhum recurso pago foi criado.

O Blueprint local também deixa de declarar o storage desabilitado e mantém valores
S3 externos ao arquivo. A validação estrutural não substitui o sync futuro do
manifesto nem a validação do commit novo após publicação.

## Limites explícitos

O fluxo privado do provedor foi comprovado no commit publicado. O protocolo durável,
a migração 17 e a central nova foram verificados localmente e só chegarão ao link
após a promoção autorizada do incremento. Não confundir essa preparação com deploy.

Rascunho e seleção de arquivo ficam na memória do painel; um reload completo não
restaura o arquivo do computador. A recuperação operacional usa a chave durável.
Objetos sem finalização podem permanecer no bucket: não há garbage collection nem
exclusão física automática. Isso impede apagar bytes de um commit incerto.

Inspeção visual: hierarquia, tipografia, espaço, temas, estados verdadeiros,
coerência com o sistema existente e controles/rolagem foram conferidos nas capturas.
Os pares renderizados de erro, sucesso, rótulo e botão de evidência atingiram ao
menos 4,5:1 nos dois temas, com composição de fundos transparentes. Contraste
numérico global, LCP/INP/CLS de campo e teste em aparelho físico não foram
medidos; emulação Chromium mobile não equivale a Safari/iPhone real. Identidade
global, reorganização do painel e redução do bundle permanecem nos IDs próprios.
O build mantém o aviso anterior de chunk acima de 500 kB (588,11 kB, 188,55 kB gzip),
sem aumentar o limite para ocultá-lo.

## Gate visual no escopo da central de evidências

| Eixo                  | Estado             | Evidência                                                                                                                                                        |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anti-slop e verdade   | Aprovado           | Estados vêm da API; transferência não é sucesso; nenhum percentual, indicador ou imagem decorativa inventado.                                                    |
| Hierarquia e tarefa   | Aprovado           | Envio, recuperação, lista, uso e arquivamento agrupados; confirmação vinculada ao documento consultado.                                                          |
| Tipografia e voz      | Aprovado           | Papéis tipográficos do sistema preservados, nomes longos legíveis e mensagens específicas; sem nova fonte ou ativo externo.                                      |
| Espaço e composição   | Aprovado           | Capturas reais nos dois temas e reflow 320–1440; campos, metadados e ações sem overflow.                                                                         |
| Física e motion       | Aprovado no escopo | Sem animação nova decorativa; feedback imediato por evento, interrupção e teardown testados, reduced motion respeitado. Taxa de quadros global não medida.       |
| Acesso e estados      | Aprovado no escopo | Teclado, nomes, alvos de 44 px, estados e recuperação testados; quatro pares reais de contraste ≥4,5:1 em ambos os temas. Sem alegação de auditoria WCAG global. |
| Responsive e contexto | Aprovado no escopo | 85 jornadas desktop e 85 mobile Chromium, capturas de viewport e download privado; aparelho físico/Safari não verificados.                                       |
