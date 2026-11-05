import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  settlementParametersSchema,
  writeSettlementParametersSchema,
  type SettlementRequest,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { usePeopleData, civil, money } from './usePeopleData';

const nullableParameters = settlementParametersSchema.nullable();
export function SavedSettlementParameters({
  base,
  referenceDate,
  readParameters,
  onExpire,
  onDenied,
}: {
  base: string;
  referenceDate: string;
  readParameters: () => SettlementRequest | null;
  onExpire: () => void;
  onDenied: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewedVersion, setReviewedVersion] = useState<number | null>(null);
  const controller = useRef(new AbortController());
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  const path = `${base}/settlement-parameters`;
  const organizationId = base.split('/')[2]!;
  const saved = usePeopleData(
    `${path}?referenceDate=${referenceDate}`,
    nullableParameters,
    organizationId,
    onExpire,
    onDenied,
    revision,
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || conflict || saved.loading || saved.error) return;
    const parameters = readParameters();
    const parsed = writeSettlementParametersSchema.safeParse({
      expectedVersion: reviewedVersion ?? saved.data?.version ?? 0,
      source,
      reason,
      parameters,
    });
    if (!parsed.success) {
      setError('Confira os complementos da simulação, a fonte e o motivo antes de salvar.');
      return;
    }
    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await request(path, settlementParametersSchema, {
        method: 'PUT',
        body: JSON.stringify(parsed.data),
        signal: controller.current.signal,
      });
      if (!controller.current.signal.aborted) {
        setReviewedVersion(result.version);
        setNotice('Parâmetros salvos para o painel.');
        setRevision((value) => value + 1);
      }
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) {
        onExpire();
        return;
      }
      if (failure instanceof RequestError && failure.status === 403) {
        onDenied();
        return;
      }
      if (failure instanceof RequestError && failure.status === 409) {
        setConflict(true);
        setError(
          'Os parâmetros mudaram. Seu rascunho foi preservado; revise a versão atual antes de salvar novamente.',
        );
      } else
        setError(
          failure instanceof Error ? failure.message : 'Não foi possível salvar os parâmetros.',
        );
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <section>
      <h4>Parâmetros do painel</h4>
      <p>
        Salvar estes complementos autoriza o painel a consultar o cenário nesta data de referência.
        A simulação isolada não grava informações.
      </p>
      {saved.loading && (
        <StatusMessage tone="loading">Conferindo parâmetros existentes…</StatusMessage>
      )}
      {saved.error && (
        <StatusMessage
          tone="error"
          action={
            <Button onClick={() => setRevision((value) => value + 1)}>
              Reconsultar parâmetros
            </Button>
          }
        >
          {saved.error}
        </StatusMessage>
      )}
      {!saved.loading && !saved.error && (
        <p>
          {saved.data
            ? `Versão persistida ${saved.data.version}, fonte: ${saved.data.source}.`
            : 'Nenhum parâmetro persistido para esta referência.'}
        </p>
      )}
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      <form onSubmit={save} className="people-editor" aria-label="Parâmetros do painel">
        <label>
          Fonte dos parâmetros
          <input
            required
            minLength={3}
            maxLength={500}
            value={source}
            onChange={(event) => setSource(event.target.value)}
          />
        </label>
        <label>
          Motivo dos parâmetros
          <textarea
            required
            minLength={3}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <Button type="submit" disabled={pending || conflict || saved.loading || !!saved.error}>
          Salvar parâmetros para o painel
        </Button>
      </form>
      {conflict && (
        <>
          <Button
            variant="outline"
            onClick={() => {
              setReviewing(true);
              setRevision((value) => value + 1);
            }}
          >
            Carregar parâmetros atuais para revisão
          </Button>
          {reviewing && !saved.loading && !saved.error && (
            <section className="people-review">
              <h4>Versão atual: {saved.data?.version ?? 0}</h4>
              <p>Compare com suas entradas. O rascunho não será substituído.</p>
              {saved.data && (
                <dl>
                  <div>
                    <dt>Referência</dt>
                    <dd>{civil(saved.data.referenceDate)}</dd>
                  </div>
                  <div>
                    <dt>Histórico do 13º</dt>
                    <dd>
                      {saved.data.parameters.thirteenthHistoryKnown ? 'Conhecido' : 'Desconhecido'}
                    </dd>
                  </div>
                  <div>
                    <dt>Adiantamento do 13º</dt>
                    <dd>{money(saved.data.parameters.thirteenthAdvanceCents ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Base FGTS</dt>
                    <dd>{money(saved.data.parameters.fgts?.terminationBaseCents ?? null)}</dd>
                  </div>
                </dl>
              )}
              <Button
                onClick={() => {
                  setReviewedVersion(saved.data?.version ?? 0);
                  setConflict(false);
                  setReviewing(false);
                  setError('Versão revisada. Confira as entradas antes de salvar.');
                }}
              >
                Confirmar parâmetros revisados
              </Button>
            </section>
          )}
        </>
      )}
    </section>
  );
}
