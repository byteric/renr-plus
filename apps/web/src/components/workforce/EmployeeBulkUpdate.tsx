import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  employeeBulkUpdatePreviewSchema,
  employeeBulkUpdateResultSchema,
  employeeBulkUpdateStatusSchema,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';
import { EmployeeFieldChanges } from './EmployeeBulkUpdateHistory';

type Preview = ReturnType<typeof employeeBulkUpdatePreviewSchema.parse>;
type Result = ReturnType<typeof employeeBulkUpdateResultSchema.parse>;
type Stage = 'preview' | 'confirm' | 'status';

const fileLimit = 1024 * 1024;
const pageSize = 20;
const labels = { READY: 'Alteração', UNCHANGED: 'Sem mudança', INVALID: 'Pendência' };
const preservedLabels = { name: 'nome', unit: 'unidade', sector: 'setor' };

export function EmployeeBulkUpdate({
  employeesPath,
  onExpire,
  onDenied,
  onConfirmed,
}: {
  employeesPath: string;
  onExpire: () => void;
  onDenied: () => void;
  onConfirmed: (result: Result) => void;
}) {
  const fileId = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Stage | null>(null);
  const [unconfirmedVersion, setUnconfirmedVersion] = useState<string | null>(null);
  const confirmationUnknown = unconfirmedVersion !== null;
  const operation = useRef<AbortController | null>(null);
  const base = `${employeesPath}/bulk-update`;

  useEffect(() => () => operation.current?.abort(), []);

  function changeFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setPage(1);
    setError('');
  }

  function changeOpen(next: boolean) {
    if (operation.current) return;
    if (!next) changeFile(null);
    setOpen(next);
  }

  function complete(result: Result) {
    changeFile(null);
    setUnconfirmedVersion(null);
    setOpen(false);
    onConfirmed(result);
  }

  async function submit(stage: Stage) {
    if (operation.current) return;
    if (stage === 'preview' && (!file || confirmationUnknown)) return;
    if (stage === 'status' && !unconfirmedVersion) return;
    if (stage === 'confirm') {
      if (!file || !preview?.ready || preview.invalid > 0 || confirmationUnknown) return;
      if (Date.parse(preview.expiresAt) <= Date.now()) {
        setPreview(null);
        setError('A prévia expirou. Gere uma nova prévia.');
        return;
      }
    }
    if (
      stage !== 'status' &&
      file &&
      (!/\.xlsx$/i.test(file.name) || file.size === 0 || file.size > fileLimit)
    ) {
      setError('Escolha uma planilha .xlsx preenchida de até 1 MiB.');
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setPending(stage);
    setError('');
    const { signal } = controller;
    try {
      if (stage === 'status' && unconfirmedVersion) {
        const status = await request(
          `${base}/${unconfirmedVersion}`,
          employeeBulkUpdateStatusSchema,
          {
            signal,
          },
        );
        if (signal.aborted) return;
        setUnconfirmedVersion(null);
        if (status.status === 'CONFIRMED') complete(status.result);
        if (status.status === 'EXPIRED') {
          setPreview(null);
          setError('O lote expirou. Gere uma nova prévia.');
        }
        if (status.status === 'PENDING') {
          setError(
            preview
              ? 'O lote ainda está pendente. Confira a prévia e tente confirmar novamente.'
              : 'O lote não foi confirmado. Selecione a planilha e gere outra prévia.',
          );
        }
      } else if (file) {
        const body = new FormData();
        body.set('file', file);
        const options = { method: 'POST', body, signal };
        if (stage === 'preview') {
          setPreview(null);
          const result = await request(`${base}/preview`, employeeBulkUpdatePreviewSchema, options);
          if (!signal.aborted) {
            setPreview(result);
            setPage(1);
          }
        } else if (preview) {
          body.set('version', preview.version);
          const result = await request(`${base}/confirm`, employeeBulkUpdateResultSchema, options);
          if (!signal.aborted) complete(result);
        }
      }
    } catch (failure) {
      if (signal.aborted) return;
      if (failure instanceof RequestError) {
        if (failure.status === 401 || failure.status === 403 || failure.status === 404) {
          changeFile(null);
          setUnconfirmedVersion(null);
          setOpen(false);
          return failure.status === 401 ? onExpire() : onDenied();
        }
        if (failure.status === 409) {
          setPreview(null);
          setUnconfirmedVersion(null);
          setError(
            'A prévia expirou ou os dados, as permissões ou o arquivo mudaram. Gere uma nova prévia.',
          );
          return;
        }
        if (failure.status === 413 || failure.status === 415) {
          setPreview(null);
          setError('Use o modelo .xlsx de até 1 MiB.');
          return;
        }
        if (failure.status === 400) {
          setPreview(null);
          setError(failure.fields.map(({ message }) => message).join(' ') || failure.message);
          return;
        }
      }
      if (stage === 'confirm' && preview) {
        setUnconfirmedVersion(preview.version);
        setError('A confirmação não retornou. Consulte o resultado antes de tentar novamente.');
      } else {
        setError(
          failure instanceof Error ? failure.message : 'Não foi possível concluir a operação.',
        );
      }
    } finally {
      operation.current = null;
      if (!signal.aborted) setPending(null);
    }
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit('preview');
  }

  const canConfirm = Boolean(preview?.ready && preview.invalid === 0 && !confirmationUnknown);

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline">Atualizar por planilha</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="surface workforce-dialog workforce-import-dialog">
          <Dialog.Title>Atualizar colaboradores por planilha</Dialog.Title>
          <Dialog.Description>
            Use a matrícula em texto para localizar cada cadastro. Células vazias mantêm os valores
            atuais de nome, unidade e setor.
          </Dialog.Description>
          <a className="workforce-download" href="/modelo-colaboradores.xlsx" download>
            Baixar modelo Excel
          </a>
          <form className="workforce-import-file" onSubmit={review}>
            <label htmlFor={fileId}>Planilha Excel</label>
            <input
              id={fileId}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-describedby={`${fileId}-limites`}
              disabled={Boolean(pending) || confirmationUnknown}
              onChange={(event) => changeFile(event.target.files?.[0] ?? null)}
            />
            <small id={`${fileId}-limites`}>
              Até 500 linhas de dados e 1 MiB. A prévia vale por 15 minutos.
            </small>
            <Button
              type="submit"
              variant="outline"
              disabled={!file || Boolean(pending) || confirmationUnknown}
            >
              Gerar prévia
            </Button>
          </form>
          {pending && (
            <StatusMessage tone="loading">
              {
                {
                  preview: 'Validando a planilha…',
                  confirm: 'Confirmando o lote…',
                  status: 'Consultando o resultado…',
                }[pending]
              }
            </StatusMessage>
          )}
          {error && <StatusMessage tone="error">{error}</StatusMessage>}
          {confirmationUnknown && !error && !pending && (
            <StatusMessage tone="warning">
              Consulte o resultado da última confirmação antes de enviar outra planilha.
            </StatusMessage>
          )}
          {preview && !confirmationUnknown && (
            <section aria-label="Prévia da atualização" className="workforce-import-preview">
              <StatusMessage tone={preview.invalid ? 'warning' : 'info'} role="status">
                {preview.total} linhas · {preview.ready} com alterações · {preview.unchanged} sem
                mudanças · {preview.invalid} com pendências
              </StatusMessage>
              {preview.invalid > 0 && (
                <p>Corrija todas as pendências e gere outra prévia para confirmar.</p>
              )}
              <table className="workforce-import-table" aria-label="Resultado por linha">
                <thead>
                  <tr>
                    <th scope="col">Linha</th>
                    <th scope="col">Situação e diferenças</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice((page - 1) * pageSize, page * pageSize).map((row) => (
                    <tr key={row.row}>
                      <th scope="row">{row.row}</th>
                      <td>
                        <strong>{labels[row.status]}</strong>
                        {row.messages.length > 0 && <p>{row.messages.join(' ')}</p>}
                        <BulkRowChanges row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.rows.length > pageSize && (
                <Pagination
                  label="Páginas da prévia"
                  page={page}
                  pageSize={pageSize}
                  total={preview.rows.length}
                  pending={Boolean(pending)}
                  onPageChange={setPage}
                />
              )}
            </section>
          )}
          <div className="form-actions">
            <Dialog.Close asChild>
              <Button variant="outline" disabled={Boolean(pending)}>
                Fechar
              </Button>
            </Dialog.Close>
            {confirmationUnknown && (
              <Button onClick={() => void submit('status')} disabled={Boolean(pending)}>
                Consultar resultado
              </Button>
            )}
            {canConfirm && (
              <Button onClick={() => void submit('confirm')} disabled={Boolean(pending)}>
                Confirmar atualização
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function BulkRowChanges({ row }: { row: Preview['rows'][number] }) {
  const { before, after, preserved } = row;
  return (
    <>
      {before && after && <EmployeeFieldChanges before={before} after={after} />}
      {preserved.length > 0 && (
        <p>
          Células vazias preservaram {preserved.map((field) => preservedLabels[field]).join(', ')}.
        </p>
      )}
    </>
  );
}
