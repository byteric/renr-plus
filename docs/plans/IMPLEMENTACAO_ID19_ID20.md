# Evidências recuperáveis e central de anexos — IDs 19 e 20

Estado em 28/10/2026: concluído e verificado localmente. Incrementos 11–18,
contratos estritos anteriores e proteções da main preservados. Provas e limites
estão em [VERIFICACAO_ID19_ID20](../VERIFICACAO_ID19_ID20.md).

## Diagnóstico B03

O envio autenticado de PDF fictício retornou 503, sem criar evidência nem avançar
a versão da ação. O serviço de homologação estava com STORAGE_ENABLED=false.
Endpoint, região e bucket correspondiam ao projeto Supabase ativo e privado.
Somente essa flag foi habilitada; a ferramenta do Render republicou o mesmo commit
18e63dd. Repetição: upload 201, download 200 e SHA-256 idêntico. Não houve troca
de credenciais, schema remoto, branch, plano ou ativação de deploy automático.

## Contrato e invariantes

- POST multipart legado mantém descrição, arquivo e expectedVersion; Idempotency-Key
  UUID é opcional para clientes antigos e obrigatório na interface nova. Repetição
  concluída retorna a mesma evidência, sem novo objeto ou revisão.
- Tentativa durável por organização, ação, criador e chave. Metadados e fingerprint
  são imutáveis. Estados: UPLOADING, UNCERTAIN, RETRYABLE, COMPLETED, ABANDONED.
- Transação curta reserva a tentativa e o limite; PUT ocorre fora da transação;
  outra transação revalida acesso, versão e lease e finaliza evidência e histórico.
- Contar evidências ativas e reservas não terminais sob lock da ação. Limite 20,
  tipos PDF/PNG/JPEG e tamanho máximo de 5 MiB preservados.
- Timeout ou confirmação perdida não provam ausência. HEAD 404 é ausência; erro
  403, timeout ou resposta inconclusiva permanecem incertos. Presença requer
  metadados e SHA-256 dos bytes conferidos. Nenhum cleanup automático de objetos.
- Lease e attemptVersion impedem finalização por execução antiga. Uma nova
  tentativa exige consulta e decisão explícita; nunca repetir upload automaticamente.

## Rotas adicionais

Sob /api/v1/organizations/:orgId/actions/:actionId/evidence:

- GET /upload-attempts/:key: estado e verificação somente leitura, sem finalizar.
- POST /upload-attempts/:key/reconcile: expectedVersion e attemptVersion; localizar
  resultado existente e finalizar quando seguro, ou registrar ausência confirmada.
- POST /upload-attempts/:key/retry: multipart com conteúdo original e ambas as
  versões. Revalidar identidade do arquivo antes de qualquer PUT.
- POST /upload-attempts/:key/abandon: attemptVersion e motivo; encerrar reserva sem
  apagar bytes ou permitir finalização tardia.
- GET /:id/usage: referências paginadas em pareceres e encerramentos técnicos,
  separadas do DTO legado de evidência.

As tentativas são consultadas somente por seu criador com acesso atual à ação.
Downloads continuam privados pela API; nenhuma chave S3, URL pública ou assinada
chega ao frontend. A chave S3 do provedor permanece exclusivamente no Render.

## Interface e operação

Preservar descrição e arquivo na mesma ação durante falha recuperável e refresh.
Exibir andamento indeterminado honesto, resultado incerto, consulta, recuperação e
arquivamento. Nunca simular percentual ou mostrar sucesso em 503. Troca de contexto,
logout ou perda de autorização purga os dados privados e invalida respostas antigas.
Mostrar arquivo, tipo, tamanho, autoria, data, estado e uso técnico; consultar o
impacto antes de confirmar arquivamento. Manter tokens, temas e navegação acessível.

CLI de reconciliação: consulta somente leitura por padrão; --apply explícito para
reconciliar tentativas identificadas, pela API e com autorização normal. Nenhum
worker pago, varredura global ou exclusão automática de storage.

## Gates de conclusão

1. TDD Red/Green para storage, recuperação no serviço, contratos e interface.
2. PostgreSQL/MinIO: concorrência, limite, replay, falha de PUT/commit, lease,
   revogação de autorização, isolamento e referências técnicas preservadas.
3. Migração aditiva em banco vazio e preenchido, seed repetido e compatibilidade.
4. Check, formato, integração, UI e E2E em desktop/mobile, com inspeção visual.
5. Homologação: upload/download privado e hash, acesso sem autenticação negado,
   arquivo existente acessível após reinício. Registrar claramente o que foi testado
   no commit publicado e o que ainda depende da publicação dos incrementos locais.
