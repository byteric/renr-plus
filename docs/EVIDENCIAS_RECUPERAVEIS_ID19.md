# Evidências: envio, recuperação e operação

As evidências continuam privadas, com PDF/PNG/JPEG de até 5 MiB e limite de vinte
arquivos ativos ou reservas por ação. O nome de download é um identificador seguro;
a descrição identifica o documento no acompanhamento. Arquivar preserva os bytes
e os registros históricos. Um upload não comprova eficácia ou conformidade.

## Envio pela interface

Selecione o arquivo e descreva o conteúdo. A tela distingue transferência em curso
de confirmação no servidor: terminar a transmissão não confirma a gravação. O
sucesso depende da resposta válida de finalização, ou da consulta posterior que
comprove a evidência persistida. Não é exibido percentual estimado.

Em indisponibilidade ou resultado incerto, descrição, seleção do arquivo e chave
original permanecem na memória do painel. Consulte a tentativa antes de decidir.
Uma tentativa concluída é recuperada sem novo POST. Se o objeto já existe, a
conciliação pode finalizar os metadados; ausência confirmada permite reenviar o
mesmo conteúdo. Se a tentativa ainda não está registrada, a ação é revalidada e
uma repetição explícita reutiliza a chave original, protegendo contra respostas
atrasadas. Não há reenvio automático.

Uma rejeição definitiva de validação libera a edição sem apagar o rascunho. Trocar
de empresa, de usuário ou de ação, encerrar a sessão ou perder a autorização remove
os dados privados do painel. Recarregar a aba inteira não preserva o arquivo local;
para recuperação operacional posterior, use a chave da tentativa durável.

Antes de arquivar, consulte o uso do arquivo específico em pareceres e encerramentos.
Uma consulta de outro documento não habilita a confirmação. Pareceres e snapshots
permanecem preservados, mas arquivar prova selecionada pode exigir revisão técnica.
O backend revalida a versão e as permissões; uma alteração concorrente exige nova consulta.

## API

Prefixo: `/api/v1/organizations/:orgId/actions/:actionId/evidence`.
Sessão e organização ativa são obrigatórias. ADMIN ou executor explicitamente
atribuído e com capacidade operacional pode enviar e recuperar suas tentativas.
Arquivamento exige ADMIN. A consulta de tentativas é exclusiva do criador com
autorização atual; listagem, uso e download seguem a autorização de leitura da ação.

| Operação                              | Contrato                                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST no prefixo                       | Multipart `file`, `description`, `expectedVersion`; header opcional `Idempotency-Key` UUID. Retorna Evidence 201; replay concluído mantém o mesmo registro e revisão.        |
| GET `upload-attempts/:key`            | Estado estrito, versão da tentativa/ação, lease, observação do objeto e evidência quando concluída. Sonda fora da transação, sem gravar nem finalizar.                       |
| POST `upload-attempts/:key/reconcile` | JSON `expectedVersion`, `attemptVersion`. Finaliza objeto verificado, registra ausência ou mantém incerteza.                                                                 |
| POST `upload-attempts/:key/retry`     | Multipart original e `attemptVersion`. Confere fingerprint e sonda novamente antes de PUT. Objeto presente é finalizado sem reenvio; resultado desconhecido não permite PUT. |
| POST `upload-attempts/:key/abandon`   | JSON `attemptVersion`, `reason` de 10–1000 caracteres. Termina a reserva, sem apagar objetos.                                                                                |
| GET `:id/usage`                       | Página, totais e referências de pareceres/encerramentos com o arquivo selecionado.                                                                                           |
| PATCH `:id`                           | Arquivamento legado por `expectedVersion` e `changeReason`.                                                                                                                  |
| GET `:id/download`                    | Bytes pela API autenticada, inclusive de evidência arquivada. Sem URL pública ou assinada.                                                                                   |

Chave com conteúdo diferente, versão desatualizada, lease ativo/superado ou limite
atingido retorna 409. Tipos/assinaturas inválidos retornam 400, excesso 413;
perda de sessão 401 e acesso indisponível 403/404. Erro do provedor ou resultado
inconclusivo retorna 503. Nenhuma dessas respostas confirma que os bytes estão ausentes.

## Reconciliação operacional

Execute a partir da raiz do repositório, com contratos compilados. O arquivo de
acesso fica fora do Git e contém `HOMOLOGATION_PASSWORD`; informe o e-mail por
parâmetro ou `HOMOLOGATION_EMAIL`. Não passe senha na linha de comando.

```powershell
node scripts/reconcile-evidence-uploads.mjs --origin https://renr-plus-homologation.onrender.com --organization UUID_EMPRESA --action UUID_ACAO --key UUID_TENTATIVA --access-file CAMINHO_PRIVADO --email EMAIL_AUTORIZADO
```

O padrão é **DRY_RUN**: autentica, ativa a empresa solicitada, consulta tentativas e
encerra a sessão, sem alterar tentativas, ações ou arquivos. Acrescente `--apply`
para reconciliar explicitamente as chaves consultadas. Até vinte chaves distintas,
repetindo `--key`. Cada chave recebe no máximo uma reconciliação; conflitos não
geram repetição automática. O comando nunca envia, arquiva ou exclui bytes.

Também aceita API local `http://127.0.0.1:3000` ou `http://localhost:3000`, com a
origem padrão da interface `http://127.0.0.1:5173`. Outras origens são recusadas para
evitar transmissão acidental de credenciais. Não há varredura global, acesso direto
ao banco, worker pago ou serviço agendado.

## Persistência e armazenamento

A tentativa reserva capacidade em transação curta. PUT e a sonda de recuperação
ficam fora da transação; finalização revalida vínculo, atribuição, versão e lease.
Evidência, revisão, auditoria, avanço da ação e conclusão são atômicos. Fingerprint
e localização são imutáveis; uma execução atrasada não pode finalizar uma tentativa
superada. Apenas HEAD 404 confirma ausência. Presença exige tipo, tamanho, metadata
e SHA-256 dos bytes; falhas de consulta mantêm resultado desconhecido.

Nenhum cleanup automático exclui objetos. Tentativas abandonadas ou objetos não
finalizados podem permanecer no bucket; qualquer política futura de remoção física
exigirá verificação de referências e de execuções pendentes. Essa escolha evita
perder arquivo associado a commit cuja confirmação se perdeu.

MinIO permanece local/CI; Supabase privado na homologação e Neon para PostgreSQL.
Chaves S3 ficam somente no servidor, pois ignoram RLS no provedor. Não registrar
credenciais, objetos binários ou respostas individuais em logs. A migração aditiva
não cria tentativas fictícias para os anexos antigos nem altera seus metadados.

O protocolo novo exige a publicação deste incremento. A correção B03 de configuração
foi validada separadamente no commit já publicado, conforme o relatório de verificação.
