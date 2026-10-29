import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  actionDetailSchema,
  archiveEvidenceSchema,
  evidenceListSchema,
  evidenceSchema,
  evidenceUploadAttemptSchema,
  uploadEvidenceSchema,
  type ActionDetail,
  type Evidence,
  type EvidenceUploadAttempt,
} from '@renr/contracts';
import { request, RequestError, send } from '../../lib/api';
import { sendEvidenceFile } from '../../lib/evidence-upload';
import { Button } from '../ui/button';
import { riskDate, scrollToField } from '../risks/useRiskData';
import { useActionData } from './useActionData';
import { EvidenceUsage } from './EvidenceUsage';

type EvidenceProps = {
  organizationId: string;
  action: ActionDetail;
  canWrite: boolean;
  canArchive?: boolean;
  refreshing?: boolean;
  onExpire: () => void;
  onChanged: () => void;
};

export function ActionEvidence(props: EvidenceProps) {
  return <EvidencePanel key={`${props.organizationId}/${props.action.id}`} {...props} />;
}

function EvidencePanel({
  organizationId,
  action,
  canWrite,
  canArchive = canWrite,
  refreshing = false,
  onExpire,
  onChanged,
}: EvidenceProps) {
  const path = `/organizations/${organizationId}/actions/${action.id}/evidence`;
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [archive, setArchive] = useState<Evidence | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<'TRANSFER' | 'FINALIZE' | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [uploadKey, setUploadKey] = useState<string | null>(null);
  const [missingAttempt, setMissingAttempt] = useState(false);
  const [uploadAttempt, setUploadAttempt] = useState<EvidenceUploadAttempt | null>(null);
  const [abandonReason, setAbandonReason] = useState('');
  const [usageId, setUsageId] = useState<string | null>(null);
  const [usageReadyId, setUsageReadyId] = useState<string | null>(null);
  const [usageConsultation, setUsageConsultation] = useState(0);
  const [version, setVersion] = useState(action.version);
  const expectedVersion = Math.max(version, action.version);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState('');
  const controller = useRef(new AbortController());
  const form = useRef<HTMLFormElement>(null);
  const evidence = useActionData(
    unavailable ? null : `${path}?page=${page}&pageSize=50`,
    evidenceListSchema,
    organizationId,
    onExpire,
    attempt + action.version,
  );
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    if (unavailable) controller.current.abort();
  }, [unavailable]);
  if (!unavailable && evidence.errorStatus && [401, 403, 404].includes(evidence.errorStatus)) {
    setUnavailable(true);
    setDescription('');
    setFile(null);
    setUploadKey(null);
    setUploadAttempt(null);
    setArchive(null);
    setReason('');
    setAbandonReason('');
    setSuccess('');
    setError('');
  }
  function denyAccess(status: number) {
    controller.current.abort();
    setUnavailable(true);
    setDescription('');
    setFile(null);
    setUploadKey(null);
    setUploadAttempt(null);
    setArchive(null);
    setReason('');
    setAbandonReason('');
    form.current?.reset();
    if (status === 401) onExpire();
  }
  function failure(value: unknown) {
    if (controller.current.signal.aborted) return;
    setSuccess('');
    if (value instanceof RequestError && [401, 403, 404].includes(value.status)) {
      denyAccess(value.status);
      return;
    }
    if (value instanceof RequestError && ([0, 409].includes(value.status) || value.status >= 500)) {
      setBlocked(true);
      setUploadAttempt(null);
      setError(
        value.status === 409
          ? 'A ação foi alterada. Seu texto e arquivo foram preservados; consulte a versão atual.'
          : value.status === 503
            ? 'Armazenamento de evidências indisponível. Resultado incerto; descrição e arquivo preservados. Consulte a tentativa antes de repetir.'
            : 'Resultado incerto. Descrição e arquivo preservados. Consulte a tentativa antes de repetir.',
      );
    } else
      setError(value instanceof Error ? value.message : 'Não foi possível concluir a operação.');
  }
  function complete(recovered: boolean) {
    setSuccess(
      recovered
        ? 'Evidência recuperada; envio confirmado no histórico.'
        : 'Evidência adicionada ao histórico.',
    );
    setError('');
    setDescription('');
    setFile(null);
    setUploadKey(null);
    setUploadAttempt(null);
    setBlocked(false);
    setAttempt((value) => value + 1);
    form.current?.reset();
    onChanged();
  }
  function acceptAttempt(value: EvidenceUploadAttempt, consulted = true) {
    if (
      value.organizationId !== organizationId ||
      value.actionId !== action.id ||
      value.key !== uploadKey
    )
      throw new RequestError(502);
    setMissingAttempt(false);
    setUploadAttempt(consulted ? value : null);
    setVersion(value.currentActionVersion);
    setError('');
    if (value.state === 'COMPLETED' && value.evidence) complete(true);
    else if (value.state === 'ABANDONED') {
      setUploadKey(null);
      setUploadAttempt(null);
      setBlocked(false);
      setAbandonReason('');
      setSuccess('Tentativa abandonada. Você pode preparar um novo envio.');
    } else if (!consulted)
      setError(
        'Resultado ainda não confirmado. Consulte novamente a tentativa antes de decidir o próximo passo.',
      );
  }
  async function consultAttempt() {
    if (!uploadKey || pending || refreshing || unavailable) return;
    setPending(true);
    setMissingAttempt(false);
    setUploadAttempt(null);
    setSuccess('');
    try {
      const value = await request(
        `${path}/upload-attempts/${uploadKey}`,
        evidenceUploadAttemptSchema,
        { signal: controller.current.signal },
      );
      if (!controller.current.signal.aborted) acceptAttempt(value);
    } catch (value) {
      if (value instanceof RequestError && value.status === 404) {
        try {
          const current = await request(
            `/organizations/${organizationId}/actions/${action.id}`,
            actionDetailSchema,
            { signal: controller.current.signal },
          );
          if (controller.current.signal.aborted) return;
          if (current.organizationId !== organizationId || current.id !== action.id)
            throw new RequestError(502);
          setVersion(current.version);
          setMissingAttempt(true);
          setError(
            'Tentativa ainda não localizada. A ação está acessível; arquivo, descrição e chave original preservados. Você pode repetir explicitamente a tentativa original.',
          );
        } catch (accessError) {
          failure(accessError);
        }
      } else failure(value);
    } finally {
      if (!controller.current.signal.aborted) {
        setPending(false);
        setUploadPhase(null);
      }
    }
  }
  async function resolveAttempt(operation: 'reconcile' | 'retry' | 'abandon') {
    if (!uploadKey || !uploadAttempt || pending || refreshing || unavailable || !canWrite) return;
    if (operation === 'retry' && (!uploadAttempt.retryAllowed || !file)) return;
    if (
      operation === 'abandon' &&
      (abandonReason.trim().length < 10 || abandonReason.trim().length > 1000)
    ) {
      setError('Informe de 10 a 1.000 caracteres para abandonar a tentativa.');
      return;
    }
    setPending(true);
    setUploadPhase(operation === 'retry' ? 'TRANSFER' : 'FINALIZE');
    setSuccess('');
    const body = new FormData();
    if (file) body.set('file', file);
    body.set('description', description);
    body.set('expectedVersion', String(uploadAttempt.currentActionVersion));
    body.set('attemptVersion', String(uploadAttempt.attemptVersion));
    try {
      const value =
        operation === 'retry'
          ? await sendEvidenceFile(
              `${path}/upload-attempts/${uploadKey}/retry`,
              evidenceUploadAttemptSchema,
              body,
              {
                key: uploadKey,
                signal: controller.current.signal,
                onTransferred: () => {
                  if (!controller.current.signal.aborted) setUploadPhase('FINALIZE');
                },
              },
            )
          : await request(
              `${path}/upload-attempts/${uploadKey}/${operation}`,
              evidenceUploadAttemptSchema,
              {
                method: 'POST',
                signal: controller.current.signal,
                headers: { 'Idempotency-Key': uploadKey },
                body: JSON.stringify(
                  operation === 'abandon'
                    ? {
                        attemptVersion: uploadAttempt.attemptVersion,
                        reason: abandonReason.trim(),
                      }
                    : {
                        expectedVersion: uploadAttempt.currentActionVersion,
                        attemptVersion: uploadAttempt.attemptVersion,
                      },
                ),
              },
            );
      if (!controller.current.signal.aborted) acceptAttempt(value, false);
    } catch (value) {
      failure(value);
    } finally {
      if (!controller.current.signal.aborted) {
        setPending(false);
        setUploadPhase(null);
      }
    }
  }
  async function upload(event?: FormEvent<HTMLFormElement>, repeatOriginal = false) {
    event?.preventDefault();
    if (pending || refreshing || !canWrite || unavailable) return;
    if (repeatOriginal ? !uploadKey || !missingAttempt : blocked || !!uploadKey) return;
    const parsed = uploadEvidenceSchema.safeParse({
      description,
      expectedVersion: String(expectedVersion),
    });
    const next: Record<string, string> = {};
    if (
      !file ||
      file.size < 1 ||
      file.size > 5 * 1024 * 1024 ||
      !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)
    )
      next.file = 'Selecione PDF, PNG ou JPEG de até 5 MiB, com conteúdo.';
    if (!parsed.success) next.description = 'Descreva a evidência em 10 a 1.000 caracteres.';
    if (Object.keys(next).length) {
      setErrors(next);
      scrollToField(form.current, Object.keys(next)[0] ?? 'file');
      return;
    }
    if (!file || !parsed.success) return;
    const body = new FormData();
    body.set('file', file);
    body.set('description', parsed.data.description);
    body.set('expectedVersion', String(expectedVersion));
    setPending(true);
    setUploadPhase('TRANSFER');
    const key = uploadKey ?? crypto.randomUUID();
    setUploadKey(key);
    setMissingAttempt(false);
    setBlocked(true);
    setSuccess('');
    setError('');
    setErrors({});
    try {
      const uploaded = await sendEvidenceFile(path, evidenceSchema, body, {
        signal: controller.current.signal,
        key,
        onTransferred: () => {
          if (!controller.current.signal.aborted) setUploadPhase('FINALIZE');
        },
      });
      if (!controller.current.signal.aborted) {
        if (uploaded.organizationId !== organizationId || uploaded.actionId !== action.id)
          throw new RequestError(502);
        complete(false);
      }
    } catch (value) {
      if (value instanceof RequestError && [400, 413, 415].includes(value.status)) {
        setUploadKey(null);
        setBlocked(false);
      }
      failure(value);
    } finally {
      if (!controller.current.signal.aborted) {
        setPending(false);
        setUploadPhase(null);
      }
    }
  }
  async function archiveFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !archive ||
      usageReadyId !== archive.id ||
      pending ||
      blocked ||
      refreshing ||
      !canArchive ||
      unavailable
    )
      return;
    const parsed = archiveEvidenceSchema.safeParse({
      expectedVersion,
      changeReason: reason,
    });
    if (!parsed.success) {
      setErrors({ changeReason: 'Informe de 10 a 1.000 caracteres.' });
      return;
    }
    setPending(true);
    setError('');
    try {
      await request(`${path}/${archive.id}`, evidenceSchema, {
        method: 'PATCH',
        body: JSON.stringify(parsed.data),
        signal: controller.current.signal,
      });
      if (!controller.current.signal.aborted) {
        setArchive(null);
        setReason('');
        setSuccess('Evidência arquivada; arquivo e histórico preservados.');
        onChanged();
      }
    } catch (value) {
      failure(value);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  async function refresh() {
    if (pending || refreshing) return;
    setPending(true);
    try {
      const current = await request(
        `/organizations/${organizationId}/actions/${action.id}`,
        actionDetailSchema,
        { signal: controller.current.signal },
      );
      if (!controller.current.signal.aborted) {
        setVersion(current.version);
        setAttempt((value) => value + 1);
        if (!uploadKey) setBlocked(false);
        setError('');
        setSuccess(
          uploadKey
            ? 'Versão atual consultada. Consulte a tentativa para recuperar o envio.'
            : 'Versão atual consultada. Confira a lista e o histórico antes de reenviar.',
        );
      }
    } catch (value) {
      failure(value);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  async function download(item: Evidence) {
    if (pending || refreshing) return;
    setPending(true);
    setError('');
    let objectUrl: string | null = null;
    try {
      const response = await send(`${path}/${item.id}/download`, {
        signal: controller.current.signal,
        headers: { Accept: item.mimeType },
      });
      const blob = await response.blob();
      if (controller.current.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = item.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setSuccess('Download solicitado.');
    } catch (value) {
      failure(value);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  if (unavailable)
    return (
      <section className="surface">
        <p role="alert">
          Evidências indisponíveis. Acesso não autorizado ou registro removido. Atualize a ação.
        </p>
      </section>
    );
  return (
    <section className="surface risk-stack" aria-labelledby="evidence-heading">
      <div className="risk-section-heading">
        <h3 id="evidence-heading">Evidências</h3>
        <Button variant="outline" disabled={pending || refreshing} onClick={() => void refresh()}>
          Atualizar evidências e versão
        </Button>
      </div>
      <p className="muted">
        Documentos privados de acompanhamento. Upload não comprova eficácia; arquivos são baixados
        como anexo e não são exibidos nesta página.
      </p>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="feedback success">
          {success}
        </p>
      )}
      {pending && uploadPhase && (
        <p role="status">
          {uploadPhase === 'TRANSFER'
            ? 'Transferindo arquivo. A confirmação do servidor continua pendente.'
            : 'Finalizando no servidor. A confirmação continua pendente.'}{' '}
          Envio ainda não concluído.
        </p>
      )}
      {uploadKey && !pending && (
        <div className="risk-stack" aria-label="Recuperação de envio">
          <p>
            Envio pendente de confirmação. Não envie outro arquivo enquanto esta tentativa estiver
            aberta.
          </p>
          <Button
            variant="outline"
            disabled={pending || refreshing}
            onClick={() => void consultAttempt()}
          >
            Consultar tentativa de envio
          </Button>
          {missingAttempt && (
            <Button
              disabled={pending || refreshing || !canWrite || !file}
              onClick={() => void upload(undefined, true)}
            >
              Repetir tentativa original
            </Button>
          )}
          {uploadAttempt && (
            <>
              <p>
                Estado da tentativa:{' '}
                {uploadAttempt.state === 'UPLOADING'
                  ? 'envio em andamento'
                  : uploadAttempt.state === 'RETRYABLE'
                    ? 'reenvio permitido pelo servidor'
                    : 'resultado incerto'}
                . Estado do arquivo:{' '}
                {uploadAttempt.objectState === 'PRESENT'
                  ? 'presente'
                  : uploadAttempt.objectState === 'ABSENT'
                    ? 'ausente'
                    : 'desconhecido'}
                .
              </p>
              <div className="record-actions">
                <Button
                  disabled={pending || refreshing || !canWrite}
                  onClick={() => void resolveAttempt('reconcile')}
                >
                  Conciliar e finalizar tentativa
                </Button>
                {uploadAttempt.retryAllowed && (
                  <Button
                    disabled={pending || refreshing || !canWrite || !file}
                    onClick={() => void resolveAttempt('retry')}
                  >
                    Reenviar o mesmo arquivo
                  </Button>
                )}
              </div>
              <label htmlFor="evidence-abandon-reason">Motivo para abandonar tentativa</label>
              <textarea
                id="evidence-abandon-reason"
                maxLength={1000}
                value={abandonReason}
                onChange={(event) => setAbandonReason(event.target.value)}
                disabled={pending || refreshing}
              />
              <Button
                variant="outline"
                disabled={pending || refreshing || !canWrite}
                onClick={() => void resolveAttempt('abandon')}
              >
                Abandonar tentativa
              </Button>
            </>
          )}
        </div>
      )}
      {canWrite && (
        <form
          ref={form}
          className="risk-form risk-stack"
          aria-label="Adicionar evidência"
          onSubmit={(event) => void upload(event)}
          noValidate
        >
          <fieldset className="risk-fieldset" disabled={pending || refreshing || !!uploadKey}>
            <legend>Adicionar documento</legend>
            <div>
              <label htmlFor="evidence-file">Arquivo da evidência</label>
              <input
                id="evidence-file"
                name="file"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                aria-invalid={!!errors.file}
                aria-describedby="evidence-file-hint"
              />
              <p id="evidence-file-hint" className={errors.file ? 'field-error' : 'field-hint'}>
                {errors.file || 'PDF, PNG ou JPEG · até 5 MiB.'}
              </p>
            </div>
            <div>
              <label htmlFor="evidence-description">Descrição da evidência</label>
              <textarea
                id="evidence-description"
                name="description"
                rows={3}
                maxLength={1000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                aria-invalid={!!errors.description}
                aria-describedby="evidence-description-hint"
              />
              <p
                id="evidence-description-hint"
                className={errors.description ? 'field-error' : 'field-hint'}
              >
                {errors.description || '10 a 1.000 caracteres.'}
              </p>
            </div>
          </fieldset>
          <Button type="submit" disabled={pending || blocked || refreshing || !!uploadKey}>
            {pending ? 'Processando…' : 'Enviar evidência'}
          </Button>
        </form>
      )}
      {evidence.loading && <p role="status">Carregando evidências…</p>}
      {evidence.error && (
        <p role="alert" className="feedback error">
          {evidence.error}
        </p>
      )}
      {evidence.data?.items.length === 0 && <p>Nenhuma evidência nesta página.</p>}
      <ul className="action-evidence-list">
        {evidence.data?.items.map((item) => (
          <li key={item.id}>
            <p className="risk-long-text">
              <strong>{item.fileName}</strong>{' '}
              <span>{item.archivedAt ? 'ARQUIVADA' : 'ATIVA'}</span>
            </p>
            <p className="risk-long-text">
              <strong>{item.description}</strong>
            </p>
            <p>
              {item.mimeType} · {(item.size / 1024).toFixed(1)} KiB · {item.createdBy.name} ·{' '}
              {riskDate(item.createdAt)}
            </p>
            {item.archivedAt && (
              <p>
                Arquivada por {item.archivedBy?.name} · {riskDate(item.archivedAt)} ·{' '}
                {item.archiveReason}. Arquivo e histórico retidos.
              </p>
            )}
            <div className="record-actions">
              <Button
                variant="outline"
                disabled={pending || refreshing}
                onClick={() => {
                  setUsageReadyId(null);
                  setUsageConsultation((value) => value + 1);
                  setUsageId(usageId === item.id ? null : item.id);
                }}
              >
                Consultar usos da evidência
              </Button>
              <Button
                variant="outline"
                disabled={pending || refreshing}
                onClick={() => void download(item)}
              >
                Baixar documento
              </Button>
              {canArchive && !item.archivedAt && (
                <Button
                  variant="outline"
                  disabled={pending || blocked || refreshing}
                  onClick={() => {
                    setArchive(item);
                    setUsageId(item.id);
                    setUsageReadyId(null);
                    setUsageConsultation((value) => value + 1);
                    setReason('');
                  }}
                >
                  Arquivar evidência
                </Button>
              )}
            </div>
            {usageId === item.id && (
              <EvidenceUsage
                key={`${item.id}/${usageConsultation}`}
                evidenceId={item.id}
                path={`${path}/${item.id}/usage`}
                onReady={setUsageReadyId}
                onPending={() => setUsageReadyId(null)}
                onUnavailable={denyAccess}
              />
            )}
          </li>
        ))}
      </ul>
      {archive && (
        <form
          className="risk-form risk-stack"
          aria-label="Arquivar evidência"
          onSubmit={(event) => void archiveFile(event)}
        >
          <h4>Arquivar evidência</h4>
          <p>
            O arquivamento é lógico. Arquivo, histórico e snapshots permanecem preservados. Se esta
            prova foi escolhida para eficácia ou encerramento, revise a seleção antes de continuar.
          </p>
          <label htmlFor="evidence-reason">Motivo do arquivamento</label>
          <textarea
            id="evidence-reason"
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={pending || refreshing}
          />
          {errors.changeReason && <p className="field-error">{errors.changeReason}</p>}
          <div className="record-actions">
            <Button
              type="submit"
              disabled={
                pending || blocked || refreshing || !canArchive || usageReadyId !== archive.id
              }
            >
              Confirmar arquivamento da evidência
            </Button>
            <Button
              variant="outline"
              disabled={pending || refreshing}
              onClick={() => setArchive(null)}
            >
              Manter evidência
            </Button>
          </div>
        </form>
      )}
      {evidence.data && evidence.data.total > 50 && (
        <nav className="pagination" aria-label="Paginação de evidências">
          <Button
            variant="outline"
            disabled={page === 1 || pending || refreshing}
            onClick={() => setPage(page - 1)}
          >
            Evidências anteriores
          </Button>
          <Button
            variant="outline"
            disabled={page * 50 >= evidence.data.total || pending || refreshing}
            onClick={() => setPage(page + 1)}
          >
            Mais evidências
          </Button>
        </nav>
      )}
    </section>
  );
}
