# Verificação — v0.4 e v0.5

Base: v0.3, `c301caae569442a4aa5ccef34111ffaf32f05982`.
Preparação iniciada em 21/10/2026; integração da release em 23/10/2026.
As contribuições entram por PR em `integracao/v04-v05`, com CI aprovada antes da mesclagem.
A promoção para `main` exige revisão independente válida; a publicação no Render é manual.
Os resultados locais abaixo não substituem a confirmação do commit ativo na homologação.

## Escopo exercitado

- Ações ligadas a risco registrado, snapshot de origem, ficha opcional, responsável nominal,
  prazo civil, resultado esperado e critério de aferição.
- Edição e transições com versão/justificativa, notas, revisões imutáveis, auditoria e concorrência.
- Indicadores reais, filtros/paginação, atraso pelo fuso da empresa e navegação responsiva.
- Evidências privadas PDF/PNG/JPEG até 5 MiB, limite de 20 ativas, upload/download autenticados,
  arquivamento lógico, retenção de histórico e compensação segura em falha de persistência.
- Dois perfis, isolamento por empresa/ação/anexo, Origin, indisponibilidade e resultado de envio incerto.

## Resultados da validação local original

| Verificação                                  | Resultado                                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                 | Aprovado: lint, tipos, 49 testes de scripts, 88 de contratos, 131 de API e 107 de interface; builds concluídos        |
| `pnpm format:check`                          | Aprovado                                                                                                              |
| `pnpm prisma:validate`                       | Schema válido                                                                                                         |
| `pnpm test:integration` com MinIO habilitado | 6 suítes, 56 testes aprovados, sem skips                                                                              |
| Testes focais backend de ações/anexos/datas  | 5 suítes, 28 aprovados com PostgreSQL/MinIO reais                                                                     |
| Armazenamento desativado                     | Resposta 503 sanitizada; consulta de ações/notas continuam disponíveis; 4 cenários de bytes não executados nesse modo |
| Migrações                                    | Banco vazio, repetição e preservação aprovados; seed repetido preserva oito ações e dezesseis revisões byte a byte    |
| `pnpm test:e2e`                              | 124 testes aprovados, desktop e mobile, na fonte preparada                                                            |
| Composição integrada sobre base limpa        | Instalação offline, check, formatação, schema, integração, migrações e 124 E2E aprovados sobre a base v0.3            |

Testes ordinários da API não executam as 57 verificações dependentes de banco.
As suítes de integração e persistência são executadas separadamente com infraestrutura local.
Na reprodução, um primeiro navegador apresentou `ERR_NO_BUFFER_SPACE`; a execução completa
com um worker passou nos 124 cenários, sem alteração do código do produto.
O limite de logins por IP permaneceu intacto: os testes reutilizam sua própria sessão para a limpeza.
Logs 500/503 induzidos por testes não significam que essas respostas foram ignoradas:
as asserções verificam o envelope seguro e ausência de gravação parcial.

## Correções verificadas durante a integração

- Arquivamento de evidência exige justificativa não nula também no PostgreSQL.
  A regressão reproduziu a aceitação indevida e passou após a restrição corrigida.
- A edição de ações mostra a versão atual consultada e reconcilia campos não modificados
  antes de reaplicar um rascunho. Quatro cenários focais passaram: conflitos consecutivos,
  preservação de campos de outro editor, alteração deliberada no mesmo campo e estados terminais.
  Tipagem, lint e formatação da correção foram aprovados.

O CI das PRs executa os gates normais sobre o conteúdo efetivamente integrado.
Consulte o resultado associado ao commit da release; as contagens da validação original
não incluem essas regressões adicionais.

## Migração e dados

PostgreSQL local exclusivo e MinIO privado separado foram utilizados. Nenhum teste
escreveu no Neon ou no serviço online. As duas migrações são aditivas e não modificam
as migrações já publicadas da v0.3. O teste incremental compara registros anteriores,
incluindo resposta de diagnóstico, risco/ficha e ação/revisão antes e depois da atualização.
Bancos temporários são removidos somente quando criados pela própria execução.

Os exemplos de ações são explicitamente fictícios. O seed não substitui senhas, registros
ou vínculos existentes. Históricos imutáveis de cenários locais permanecem preservados;
limpeza de jornada é lógica e restrita aos identificadores fictícios do teste.

## Interface e desempenho

As jornadas novas exercitam criação, execução informada, anotação, upload, download,
arquivamento, permissões, logout e retorno dos filtros. A inspeção real do detalhe em
375px não mostrou transbordamento horizontal. Testes de lista/detalhe também cobrem
320, 375, 768 e 1440px, nos dois temas. Não foi feita validação em todo aparelho físico.

Build de produção: JavaScript inicial 179,96 kB gzip (base 178,72 kB; limite planejado 200 kB).
Áreas de ações, riscos e painel continuam em chunks sob demanda. Há aviso do bundler
para chunk minificado inicial acima de 500 kB, embora o orçamento gzip tenha sido atendido.
Isso não substitui medição de desempenho em aparelhos/redes reais.

As revisões de integração motivaram as correções de arquivamento e concorrência descritas acima.
As suítes HTTP e de integração foram executadas com PostgreSQL e MinIO locais.

## Ambiente demonstrativo e licença

A licença permanece pendente de decisão conjunta entre a equipe e a ReTech+.
Um banco demonstrativo local separado contém três usuários, duas empresas, oito ações e
dezesseis revisões sintéticas; não recebe o acúmulo dos cenários de regressão.

## Limites de liberação

Eficácia técnica, reavaliação, relatório consolidado, editor de instrumento e colaboradores
não integram este recorte. Execução informada/anexo não certificam SST ou conformidade.
Não existe antivírus, validação técnica do documento ou garantia absoluta de anonimato.

MinIO privado atende desenvolvimento e CI. A homologação usa um projeto Supabase exclusivo,
no plano Free, com bucket privado para PDF/PNG/JPEG e limite de 5 MiB por arquivo.
As credenciais S3 permanecem nas variáveis privadas do Render, fora do repositório e frontend.
O acesso passa pela autorização da API; não foram criadas políticas públicas de Storage.
A configuração só entra em uso após publicação e verificação da release.
Publicação exige CI válida, revisão independente, confirmação do commit ativo e testes dos fluxos.
Falha de compensação/resultado de commit desconhecido prioriza preservar bytes; eventual
objeto órfão requer conciliação operacional, nunca exclusão ampla do bucket.
O aviso de depreciação do driver pg sobre consultas concorrentes na mesma transação
permanece observável; a dependência atual executou os testes com sucesso.
