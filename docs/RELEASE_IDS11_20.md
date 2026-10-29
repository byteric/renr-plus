# Promoção dos IDs 11–20

Este incremento conecta avaliação técnica, atribuição e execução de ações, pareceres
de eficácia, reavaliação e encerramento, preservando o histórico. Evidências privadas
ganham tentativas duráveis, idempotência e recuperação explícita. A interface mostra
o contexto das decisões e o uso dos arquivos antes de arquivá-los.

## Conteúdo para revisão

| Área            | Incrementos                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Avaliação       | Métodos e versões publicados com aprovação explícita, avaliação imutável e matriz por versão exata.                                         |
| Ações           | Responsável nominal preservado, atribuição opcional a vínculo ativo e execução restrita por capacidade.                                     |
| Decisão técnica | Pareceres de eficácia, provas preservadas, reavaliações ligadas ao predecessor, encerramento e corretivas próprias.                         |
| Evidências      | PUT fora da transação, lease/CAS, replay, reconciliação, retry explícito, abandono e consulta paginada de uso.                              |
| Interface       | Inventário e detalhe contextual, preparação/revisão de decisões, seleção de provas, estados verdadeiros e recuperação de arquivo/descrição. |

Métodos reais continuam dependendo de configuração e validação técnica da ReTech+.
Os dados e instrumentos de demonstração não produzem diagnóstico clínico ou
certificação automática de conformidade.

## Sequência de promoção

1. Compor commits de backend, frontend, operação e documentação em `dev/ricardo`,
   com coautorias por área. Submeter a PR para `main`.
2. Solicitar revisão de Luiz (`Luizrocha0`) e aguardar CI e aprovação válidas no
   último commit. Qualquer correção exige nova conferência dos checks e da revisão.
3. Mesclar por **merge commit**, preservando histórico. A `main` mantém suas
   proteções e nenhuma atualização automática do Render é habilitada.
4. Confirmar o banco `renr_homologation`, a conexão direta com TLS verificado e
   o histórico de migrações. Aplicar somente migrações pendentes por
   `prisma migrate deploy`, sem reset, seed local ou recriação de usuários.
5. Publicar manualmente o commit resultante da `main` no serviço existente
   `renr-plus-homologation`, plano Free. Confirmar o SHA ativo antes de validar o link.

São **17 migrações** no conjunto. A promoção a partir da base publicada de dez
acrescenta sete migrações aditivas; os dez arquivos anteriores não são reescritos.
Não inferir pareceres, atribuições, reavaliações ou tentativas para registros antigos.
`RUN_MIGRATIONS=false` permanece no serviço porque a migração é uma etapa manual.

A conferência prévia do Neon identificou uma diferença histórica de CRLF/LF
nas duas primeiras migrações, já concluídas. Os checksums correspondem às mesmas
instruções SQL com CRLF. Preservar esses registros e os arquivos publicados;
não reexecutar as migrações nem editar `_prisma_migrations`. Os sete arquivos
novos preservam os bytes verificados localmente e não sofrem normalização do Git.

## Validação e liberação do link

As provas locais estão nos relatórios de
[11/12](VERIFICACAO_ID11_ID12.md), [13/14](VERIFICACAO_ID13_ID14.md),
[15/16](VERIFICACAO_ID15_ID16.md), [17/18](VERIFICACAO_ID17_ID18.md) e
[19/20](VERIFICACAO_ID19_ID20.md). Eles registram a validação anterior à promoção;
o estado online precisa ser comprovado no commit publicado.

Gates locais: check, formato, 213 testes PostgreSQL/MinIO, teste do CLI pela API
real, migrações em base vazia/preenchida, compatibilidade, 40 verificações de
interface e 85 jornadas desktop mais 85 mobile.

Após o deploy, validar:

- Oito checks públicos, readiness do banco e ausência de exposição de `.env`/Swagger.
- Login, cookie protegido, troca de empresa, permissões de leitor, isolamento e logout.
- Com dados inteiramente sintéticos: avaliação, atribuição, execução, parecer,
  reavaliação e encerramento; ADMIN não recebe capacidade técnica implicitamente.
- Upload privado, consulta/reconciliação, download com hash, uso técnico e arquivamento;
  nenhuma mensagem de sucesso para resultado incerto.
- Telas principais em desktop e celular, temas e navegação, sem usar dados pessoais
  ou reter senha/cookie em capturas ou logs.

Usar apenas a credencial demonstrativa do arquivo privado existente. Não alterar
senhas para executar a verificação. Inativar os registros sintéticos criados pelo
teste após confirmar seu ID e contexto, preservando o histórico.

Se a aplicação falhar após a migração, retornar ao deploy anterior já verificado,
preservando o banco expandido. Não tentar desfazer o schema com reset ou remoção de
tabelas. Registrar o SHA aprovado, as migrações aplicadas, o deploy e os resultados
antes de comunicar a disponibilidade do incremento.

## Infraestrutura

Neon continua responsável por PostgreSQL; o Supabase usa bucket privado; as chaves
S3 ficam somente nas variáveis privadas do Render. Nenhum worker, disco ou plano
pago é acrescentado. Valores existentes de conexão e storage são preservados.
O Blueprint local mantém o storage habilitado e o deploy automático desligado.
