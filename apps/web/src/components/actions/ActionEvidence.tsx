import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  actionDetailSchema,
  archiveEvidenceSchema,
  evidenceListSchema,
  evidenceSchema,
  uploadEvidenceSchema,
  type ActionDetail,
  type Evidence,
} from '@renr/contracts';
import { request, RequestError, send } from '../../lib/api';
import { Button } from '../ui/button';
import { riskDate, scrollToField } from '../risks/useRiskData';
import { useActionData } from './useActionData';

export function ActionEvidence({
  organizationId,
  action,
  canWrite,
  onExpire,
  onChanged,
}: {
  organizationId: string;
  action: ActionDetail;
  canWrite: boolean;
  onExpire: () => void;
  onChanged: () => void;
}) {
  const path = `/organizations/${organizationId}/actions/${action.id}/evidence`;
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [archive, setArchive] = useState<Evidence | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [version, setVersion] = useState(action.version);
  const expectedVersion = Math.max(version, action.version);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState('');
  const controller = useRef(new AbortController());
  const form = useRef<HTMLFormElement>(null);
  const evidence = useActionData(
    `${path}?page=${page}&pageSize=50`,
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
  function failure(value: unknown) {
    if (controller.current.signal.aborted) return;
    if (value instanceof RequestError && value.status === 401) {
      onExpire();
      return;
    }
    if (value instanceof RequestError && [0, 409, 502].includes(value.status)) {
      setBlocked(true);
      setError(
        value.status === 409
          ? 'A ação foi alterada. Seu texto e arquivo foram preservados; consulte a versão atual.'
          : 'Resultado incerto. Consulte as evidências e o histórico antes de decidir por outro envio. Seu texto foi preservado.',
      );
    } else
      setError(
        value instanceof RequestError && value.status === 503
          ? 'Armazenamento de evidências indisponível. O acompanhamento da ação e as anotações continuam disponíveis; sua descrição foi preservada.'
          : value instanceof Error
            ? value.message
            : 'Não foi possível concluir a operação.',
      );
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || blocked) return;
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
    setError('');
    setErrors({});
    try {
      await request(path, evidenceSchema, {
        method: 'POST',
        body,
        signal: controller.current.signal,
      });
      if (!controller.current.signal.aborted) {
        setSuccess('Evidência adicionada ao histórico.');
        setDescription('');
        setFile(null);
        form.current?.reset();
        onChanged();
      }
    } catch (value) {
      failure(value);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  async function archiveFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!archive || pending || blocked) return;
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
    if (pending) return;
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
        setBlocked(false);
        setError('');
        setSuccess('Versão atual consultada. Confira a lista e o histórico antes de reenviar.');
      }
    } catch (value) {
      failure(value);
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  async function download(item: Evidence) {
    if (pending) return;
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
  return (
    <section className="surface risk-stack" aria-labelledby="evidence-heading">
      <div className="risk-section-heading">
        <h3 id="evidence-heading">Evidências</h3>
        <Button variant="outline" disabled={pending} onClick={() => void refresh()}>
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
      {canWrite && (
        <form
          ref={form}
          className="risk-form risk-stack"
          aria-label="Adicionar evidência"
          onSubmit={(event) => void upload(event)}
          noValidate
        >
          <fieldset className="risk-fieldset" disabled={pending}>
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
          <Button type="submit" disabled={pending || blocked}>
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
              <Button variant="outline" disabled={pending} onClick={() => void download(item)}>
                Baixar documento
              </Button>
              {canWrite && !item.archivedAt && (
                <Button
                  variant="outline"
                  disabled={pending || blocked}
                  onClick={() => {
                    setArchive(item);
                    setReason('');
                  }}
                >
                  Arquivar evidência
                </Button>
              )}
            </div>
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
          <p>O arquivamento é lógico. Arquivo e histórico permanecem preservados.</p>
          <label htmlFor="evidence-reason">Motivo do arquivamento</label>
          <textarea
            id="evidence-reason"
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={pending}
          />
          {errors.changeReason && <p className="field-error">{errors.changeReason}</p>}
          <div className="record-actions">
            <Button type="submit" disabled={pending || blocked}>
              Confirmar arquivamento da evidência
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setArchive(null)}>
              Manter evidência
            </Button>
          </div>
        </form>
      )}
      {evidence.data && evidence.data.total > 50 && (
        <nav className="pagination" aria-label="Paginação de evidências">
          <Button
            variant="outline"
            disabled={page === 1 || pending}
            onClick={() => setPage(page - 1)}
          >
            Evidências anteriores
          </Button>
          <Button
            variant="outline"
            disabled={page * 50 >= evidence.data.total || pending}
            onClick={() => setPage(page + 1)}
          >
            Mais evidências
          </Button>
        </nav>
      )}
    </section>
  );
}
