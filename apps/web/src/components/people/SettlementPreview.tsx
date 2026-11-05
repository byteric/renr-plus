import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  settlementRequestSchema,
  settlementResultSchema,
  type SettlementResult,
  type SettlementRequest,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { civil, money } from './usePeopleData';
import { SavedSettlementParameters } from './SavedSettlementParameters';

export function SettlementPreview({
  base,
  onExpire,
  onDenied,
  manage = false,
}: {
  base: string;
  onExpire: () => void;
  onDenied: () => void;
  manage?: boolean;
}) {
  const [terminationDate, setTerminationDate] = useState('');
  const [paidSalaryDays, setPaidSalaryDays] = useState('');
  const [advance, setAdvance] = useState('');
  const [thirteenthKnown, setThirteenthKnown] = useState(false);
  const [months, setMonths] = useState<Record<string, string>>({});
  const [acquisitionStart, setAcquisitionStart] = useState('');
  const [acquisitionKnown, setAcquisitionKnown] = useState(false);
  const [absences, setAbsences] = useState('');
  const [fgtsBase, setFgtsBase] = useState('');
  const [fgtsConfirmed, setFgtsConfirmed] = useState(false);
  const [result, setResult] = useState<SettlementResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef(new AbortController());
  const inputRevision = useRef(0);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  const year = terminationDate.slice(0, 4);
  const competences = /^20\d{2}$/.test(year)
    ? Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
    : [];
  function readRequest() {
    return settlementRequestSchema.safeParse({
      terminationDate,
      thirteenthHistoryKnown: thirteenthKnown,
      currentAcquisitionHistoryKnown: acquisitionKnown,
      ...(paidSalaryDays !== '' ? { paidSalaryDays: Number(paidSalaryDays) } : {}),
      ...(advance !== '' ? { thirteenthAdvanceCents: advance } : {}),
      ...(Object.keys(months).length
        ? {
            thirteenthComputableDaysByMonth: Object.fromEntries(
              Object.entries(months)
                .filter(([key, value]) => key.startsWith(year) && value !== '')
                .map(([key, value]) => [key, Number(value)]),
            ),
          }
        : {}),
      ...(acquisitionStart ? { currentAcquisitionStart: acquisitionStart } : {}),
      ...(absences !== '' ? { unjustifiedAbsences: Number(absences) } : {}),
      ...(fgtsBase !== '' || fgtsConfirmed
        ? {
            fgts: {
              ...(fgtsBase ? { terminationBaseCents: fgtsBase } : {}),
              confirmedIncludesPending: fgtsConfirmed,
            },
          }
        : {}),
    });
  }
  function parameters(): SettlementRequest | null {
    const parsed = readRequest();
    return parsed.success ? parsed.data : null;
  }
  async function simulate(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const parsed = readRequest();
    if (!parsed.success) {
      setError('Confira datas, dias e valores em centavos. Confirme apenas históricos conhecidos.');
      return;
    }
    const submittedRevision = inputRevision.current;
    setPending(true);
    setError('');
    setResult(null);
    try {
      const data = await request(`${base}/settlement-preview`, settlementResultSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        signal: controller.current.signal,
      });
      if (!controller.current.signal.aborted && submittedRevision === inputRevision.current)
        setResult(data);
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
      setError(
        failure instanceof Error
          ? failure.message
          : 'Não foi possível simular. As entradas foram preservadas.',
      );
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  return (
    <section className="people-settlement">
      <h3>Simulação rescisória</h3>
      <p>
        Salário, admissão, vínculos e férias são consultados nos registros persistidos. Preencha
        apenas os complementos confirmados. Informação ausente não equivale a zero.
      </p>
      <form
        className="people-editor"
        onSubmit={simulate}
        onChangeCapture={() => {
          inputRevision.current += 1;
          setResult(null);
        }}
        aria-label="Simulação rescisória"
      >
        <div className="people-fields">
          <label>
            Data do desligamento
            <input
              type="date"
              value={terminationDate}
              required
              onChange={(event) => {
                setTerminationDate(event.target.value);
                setResult(null);
              }}
            />
          </label>
          <label>
            Dias de salário já pagos
            <input
              type="number"
              min={0}
              max={31}
              value={paidSalaryDays}
              onChange={(event) => setPaidSalaryDays(event.target.value)}
            />
          </label>
          <label>
            Adiantamento do 13º em centavos
            <input
              inputMode="numeric"
              pattern="[0-9]+"
              value={advance}
              onChange={(event) => setAdvance(event.target.value)}
            />
          </label>
        </div>
        <fieldset>
          <legend>Histórico computável do 13º</legend>
          <label className="people-check">
            <input
              type="checkbox"
              checked={thirteenthKnown}
              onChange={(event) => setThirteenthKnown(event.target.checked)}
            />
            Histórico de 13º conhecido
          </label>
          <p>
            Informe os dias computáveis de cada mês. Deixe em branco o que não foi conferido; use
            zero somente quando confirmado.
          </p>
          <div className="people-fields">
            {competences.map((competence) => (
              <label key={competence}>
                Dias computáveis {competence}
                <input
                  type="number"
                  min={0}
                  max={31}
                  value={months[competence] ?? ''}
                  onChange={(event) => setMonths({ ...months, [competence]: event.target.value })}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Período aquisitivo atual</legend>
          <label className="people-check">
            <input
              type="checkbox"
              checked={acquisitionKnown}
              onChange={(event) => setAcquisitionKnown(event.target.checked)}
            />
            Histórico aquisitivo atual conhecido
          </label>
          <div className="people-fields">
            <label>
              Início aquisitivo atual
              <input
                type="date"
                value={acquisitionStart}
                onChange={(event) => setAcquisitionStart(event.target.value)}
              />
            </label>
            <label>
              Faltas injustificadas do período
              <input
                type="number"
                min={0}
                max={366}
                value={absences}
                onChange={(event) => setAbsences(event.target.value)}
              />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>FGTS confirmado</legend>
          <label>
            Base rescisória de FGTS em centavos
            <input
              inputMode="numeric"
              pattern="[0-9]+"
              value={fgtsBase}
              onChange={(event) => setFgtsBase(event.target.value)}
            />
          </label>
          <label className="people-check">
            <input
              type="checkbox"
              checked={fgtsConfirmed}
              onChange={(event) => setFgtsConfirmed(event.target.checked)}
            />
            Confirmo que a base inclui os depósitos pendentes
          </label>
        </fieldset>
        {error && <StatusMessage tone="error">{error}</StatusMessage>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Calculando…' : 'Simular com registros persistidos'}
        </Button>
      </form>
      {manage && /^20\d{2}-\d{2}-\d{2}$/.test(terminationDate) && (
        <SavedSettlementParameters
          key={terminationDate}
          base={base}
          referenceDate={terminationDate}
          readParameters={parameters}
          onExpire={onExpire}
          onDenied={onDenied}
        />
      )}
      {result && (
        <section className="people-settlement-result" aria-label="Resultado da simulação">
          <h4>{result.status === 'complete' ? 'Estimativa completa' : 'Estimativa parcial'}</h4>
          <p>
            Política {result.policyVersion} · cenário {result.scenario} · referência{' '}
            {civil(result.referenceDate)}
          </p>
          <p>
            Aviso: {result.noticeDays} dias · término projetado{' '}
            {civil(result.projectedTerminationDate)}
          </p>
          <table aria-label="Parcelas da estimativa">
            <thead>
              <tr>
                <th scope="col">Parcela</th>
                <th scope="col">Valor</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.code}>
                  <th scope="row">
                    {item.label}
                    {item.reference ? ` · ${item.reference}` : ''}
                  </th>
                  <td>{item.amountCents === null ? 'Não calculado' : money(item.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="people-facts">
            <div>
              <dt>Subtotal conhecido</dt>
              <dd>{money(result.subtotalCents)}</dd>
            </div>
            <div>
              <dt>Total bruto</dt>
              <dd>
                {result.grossTotalCents === null
                  ? 'Indisponível: há dados pendentes'
                  : money(result.grossTotalCents)}
              </dd>
            </div>
            <div>
              <dt>Multa de FGTS</dt>
              <dd>
                {result.fgtsPenaltyCents === null
                  ? 'Não calculada'
                  : money(result.fgtsPenaltyCents)}
              </dd>
            </div>
          </dl>
          {result.missingInputs.length > 0 && (
            <>
              <h4>Informações pendentes</h4>
              <ul>
                {result.missingInputs.map((input) => (
                  <li key={input}>{input}</li>
                ))}
              </ul>
            </>
          )}
          {result.reasons.length > 0 && (
            <>
              <h4>Limitações e motivos</h4>
              <ul>
                {result.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </>
          )}
          <p>A estimativa deve ser conferida pelo responsável técnico antes de qualquer decisão.</p>
        </section>
      )}
    </section>
  );
}
