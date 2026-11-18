import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { employeeImportPreviewSchema, employeeImportResultSchema } from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { Pagination } from '../ui/pagination';
import { StatusMessage } from '../ui/status-message';

type Preview = ReturnType<typeof employeeImportPreviewSchema.parse>;
type Result = ReturnType<typeof employeeImportResultSchema.parse>;
const rowStatus = { READY: 'Novo cadastro', EXISTING: 'Já cadastrado', INVALID: 'Corrigir' };
const pageSize = 20;
const fileLimit = 1024 * 1024;

export function EmployeeImport({
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
  const id = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<'preview' | 'confirm' | null>(null);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => () => operation.current?.abort(), []);

  function changeFile(next: File | null) {
    setFile(next);
    setPreview(null);
    setError('');
    setPage(1);
  }

  function changeOpen(next: boolean) {
    if (operation.current) return;
    if (!next) changeFile(null);
    setOpen(next);
  }

  async function submit(stage: 'preview' | 'confirm') {
    if (!file || operation.current) return;
    if (stage === 'confirm' && (!preview || preview.invalid > 0 || preview.ready === 0)) return;
    if (!/\.xlsx$/i.test(file.name) || file.size === 0 || file.size > fileLimit) {
      setError('Escolha uma planilha .xlsx preenchida de até 1 MiB.');
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setPending(stage);
    setError('');
    const body = new FormData();
    body.set('file', file);
    const options = { method: 'POST', body, signal: controller.signal };
    try {
      if (stage === 'preview') {
        setPreview(null);
        const result = await request(
          `${employeesPath}/import/preview`,
          employeeImportPreviewSchema,
          options,
        );
        if (!controller.signal.aborted) {
          setPreview(result);
          setPage(1);
        }
      } else {
        body.set('version', preview!.version);
        const result = await request(
          `${employeesPath}/import/confirm`,
          employeeImportResultSchema,
          options,
        );
        if (!controller.signal.aborted) {
          changeFile(null);
          setOpen(false);
          onConfirmed(result);
        }
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (stage === 'confirm') setPreview(null);
      if (failure instanceof RequestError) {
        if (failure.status === 401) return onExpire();
        if (failure.status === 403 || failure.status === 404) return onDenied();
        if (failure.status === 409) {
          setError('A prévia expirou ou o cadastro mudou. Gere uma nova prévia.');
          return;
        }
        if (failure.status === 415 || failure.status === 413) {
          setError('Use o modelo .xlsx de até 1 MiB.');
          return;
        }
        if (failure.status === 400 && failure.fields.length) {
          setError(failure.fields.map(({ message }) => message).join(' '));
          return;
        }
      }
      setError(
        stage === 'confirm'
          ? 'A importação ainda não foi confirmada pela tela. Gere uma nova prévia para conferir os cadastros antes de tentar novamente.'
          : failure instanceof Error
            ? failure.message
            : 'Não foi possível gerar a prévia.',
      );
    } finally {
      operation.current = null;
      if (!controller.signal.aborted) setPending(null);
    }
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit('preview');
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline">Importar Excel</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="surface workforce-dialog workforce-import-dialog">
          <Dialog.Title>Importar colaboradores</Dialog.Title>
          <Dialog.Description>
            Use o modelo com matrícula em texto, nome, unidade e setor. Os nomes de unidade e setor
            devem corresponder aos cadastros da empresa ativa.
          </Dialog.Description>
          <a className="workforce-download" href="/modelo-colaboradores.xlsx" download>
            Baixar modelo Excel
          </a>
          <form className="workforce-import-file" onSubmit={review}>
            <label htmlFor={id}>Planilha Excel</label>
            <input
              id={id}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-describedby={`${id}-limites`}
              disabled={Boolean(pending)}
              onChange={(event) => changeFile(event.target.files?.[0] ?? null)}
            />
            <small id={`${id}-limites`}>
              Até 500 linhas de dados e 1 MiB. A prévia vale por 15 minutos.
            </small>
            <Button type="submit" variant="outline" disabled={!file || Boolean(pending)}>
              Gerar prévia
            </Button>
          </form>
          {pending && (
            <StatusMessage tone="loading">
              {pending === 'preview' ? 'Validando a planilha…' : 'Confirmando o lote…'}
            </StatusMessage>
          )}
          {error && <StatusMessage tone="error">{error}</StatusMessage>}
          {preview && (
            <section aria-label="Prévia da importação" className="workforce-import-preview">
              <StatusMessage tone={preview.invalid ? 'warning' : 'success'} role="status">
                {preview.total} {preview.total === 1 ? 'linha' : 'linhas'} · {preview.ready}{' '}
                {preview.ready === 1 ? 'novo cadastro' : 'novos cadastros'} · {preview.existing}{' '}
                {preview.existing === 1 ? 'matrícula existente' : 'matrículas existentes'} ·{' '}
                {preview.invalid} com erro
              </StatusMessage>
              {preview.invalid > 0 && (
                <p>Corrija as linhas com erro na planilha e gere outra prévia para importar.</p>
              )}
              <table className="workforce-import-table" aria-label="Resultado por linha">
                <thead>
                  <tr>
                    <th scope="col">Linha</th>
                    <th scope="col">Situação e orientação</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice((page - 1) * pageSize, page * pageSize).map((row) => (
                    <tr key={row.row}>
                      <th scope="row">{row.row}</th>
                      <td>
                        <strong>{rowStatus[row.status]}</strong>
                        {row.messages.length > 0 && <p>{row.messages.join(' ')}</p>}
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
            {preview && preview.invalid === 0 && preview.ready > 0 && (
              <Button onClick={() => void submit('confirm')} disabled={Boolean(pending)}>
                Confirmar importação
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
