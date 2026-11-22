import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  commercialContractResponseSchema,
  commercialContractSchema,
  commercialCreateContractSchema,
  commercialDocumentSchema,
  commercialReviseContractSchema,
  type CommercialContract as Contract,
  type CommercialDocument as ContractDocument,
  type CommercialPlan,
} from '@renr/contracts';
import { request, RequestError, send } from '../../../lib/api';
import { Button } from '../../ui/button';
import { StatusMessage } from '../../ui/status-message';
import { usePrivateQuery } from '../usePrivateQuery';
import {
  commercialDate,
  commercialPath,
  commercialPrice,
  todayInSaoPaulo,
  useCommercialAction,
  type CommercialAccessEvents,
} from './commercial-ui';

type Revision = Contract['revisions'][number];
type Edition = Revision['kind'] | 'WITHDRAW_SCHEDULED';
const situations = {
  SCHEDULED: 'Agendado',
  ACTIVE: 'Vigente',
  EXPIRED: 'Vencido',
  CANCELLED: 'Cancelado',
};
const editionTitles = {
  INITIAL: 'Registro inicial',
  RENEWAL: 'Renovação',
  AMENDMENT: 'Revisão de condições',
  CANCELLATION: 'Cancelamento',
};
const editionActions = {
  INITIAL: 'Registrar contrato',
  RENEWAL: 'Registrar renovação',
  AMENDMENT: 'Registrar reajuste ou alteração',
  CANCELLATION: 'Registrar cancelamento',
  WITHDRAW_SCHEDULED: 'Retirar termo agendado',
};
const MAX_PDF_BYTES = 5 * 1024 * 1024;

export function CommercialContract({
  organizationId,
  canEdit,
  plans,
  plansError,
  revision,
  onReloadPlans,
  onClientChanged,
  ...events
}: CommercialAccessEvents & {
  organizationId: string;
  canEdit: boolean;
  plans: CommercialPlan[] | undefined;
  plansError: string;
  revision: number;
  onReloadPlans: () => void;
  onClientChanged: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const path = `${commercialPath}/clients/${organizationId}/contract`;
  const response = usePrivateQuery(
    path,
    commercialContractResponseSchema,
    revision + attempt,
    events.onExpire,
    events.onDenied,
  );
  const reload = () => setAttempt((value) => value + 1);
  if (!response.data && !response.error)
    return <StatusMessage tone="loading">Carregando contrato…</StatusMessage>;
  if (
    response.error ||
    (response.data?.contract && response.data.contract.organizationId !== organizationId)
  ) {
    return (
      <StatusMessage tone="error" action={<Button onClick={reload}>Atualizar contrato</Button>}>
        {response.error || 'Não foi possível conferir o contrato desta empresa.'}
      </StatusMessage>
    );
  }
  return (
    <ContractHistory
      path={path}
      canEdit={canEdit}
      organizationId={organizationId}
      savedContract={response.data?.contract ?? null}
      plans={plans}
      plansError={plansError}
      onReloadPlans={onReloadPlans}
      onReload={reload}
      onClientChanged={onClientChanged}
      {...events}
    />
  );
}

function ContractHistory({
  path,
  organizationId,
  savedContract,
  plans,
  plansError,
  canEdit,
  onReload,
  onReloadPlans,
  onClientChanged,
  ...events
}: CommercialAccessEvents & {
  path: string;
  organizationId: string;
  savedContract: Contract | null;
  plans: CommercialPlan[] | undefined;
  plansError: string;
  canEdit: boolean;
  onReload: () => void;
  onReloadPlans: () => void;
  onClientChanged: () => void;
}) {
  const [contract, setContract] = useState(savedContract);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [notice, setNotice] = useState('');
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const catalog = plans?.filter((plan) => plan.kind === 'PLAN');
  const revisions = contract
    ? [...contract.revisions].sort((left, right) => right.ordinal - left.ordinal)
    : [];
  const latest = revisions.find((item) => !item.withdrawal);
  const current = revisions.find((item) => item.id === contract?.currentRevisionId);
  const startsEarlier = latest && latest.startsOn > todayInSaoPaulo();

  function select(next: Edition, button: HTMLButtonElement) {
    setEdition(next);
    setNotice('');
    trigger.current = button;
  }

  function close() {
    setEdition(null);
    trigger.current?.focus();
  }

  function saved(next: Contract) {
    setContract(next);
    setEdition(null);
    setNotice('Registro salvo. As condições anteriores foram preservadas no histórico.');
    heading.current?.focus();
    onClientChanged();
  }

  return (
    <section className="surface commercial-record" aria-labelledby={headingId}>
      <div className="platform-heading">
        <div>
          <h2 ref={heading} id={headingId} tabIndex={-1}>
            Contrato comercial
          </h2>
          <p className="muted">Registro de condições e documentos assinados pela operação.</p>
        </div>
        <Button variant="outline" onClick={onReload}>
          Atualizar contrato
        </Button>
      </div>
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {contract ? (
        <dl className="commercial-facts">
          <div>
            <dt>Situação</dt>
            <dd>{situations[contract.situation]}</dd>
          </div>
          {current && (
            <>
              <div>
                <dt>Condições de referência</dt>
                <dd>
                  {current.plan.name} · versão {current.planVersion.ordinal}
                </dd>
              </div>
              <div>
                <dt>Vigência do termo</dt>
                <dd>
                  {commercialDate(current.startsOn)} a {commercialDate(current.endsOn)}
                </dd>
              </div>
            </>
          )}
        </dl>
      ) : (
        <StatusMessage>Nenhum contrato cadastrado para esta empresa.</StatusMessage>
      )}
      {canEdit && (
        <>
          {plansError ? (
            <StatusMessage
              tone="error"
              action={<Button onClick={onReloadPlans}>Atualizar catálogo</Button>}
            >
              {plansError}
            </StatusMessage>
          ) : !catalog ? (
            <StatusMessage tone="loading">Carregando catálogo de planos…</StatusMessage>
          ) : catalog.length === 0 ? (
            <StatusMessage>Cadastre um plano no catálogo para registrar condições.</StatusMessage>
          ) : null}
          <div className="platform-areas">
            {contract ? (
              <>
                <Button
                  disabled={!catalog?.length}
                  onClick={(event) => select('RENEWAL', event.currentTarget)}
                >
                  Registrar renovação
                </Button>
                {latest && latest.kind !== 'CANCELLATION' && (
                  <>
                    <Button
                      variant="outline"
                      disabled={!catalog?.length}
                      onClick={(event) => select('AMENDMENT', event.currentTarget)}
                    >
                      Registrar reajuste ou alteração
                    </Button>
                    <Button
                      variant="outline"
                      onClick={(event) => select('CANCELLATION', event.currentTarget)}
                    >
                      Registrar cancelamento
                    </Button>
                  </>
                )}
                {startsEarlier && (
                  <Button
                    variant="outline"
                    onClick={(event) => select('WITHDRAW_SCHEDULED', event.currentTarget)}
                  >
                    Retirar termo agendado
                  </Button>
                )}
              </>
            ) : (
              <Button
                disabled={!catalog?.length}
                onClick={(event) => select('INITIAL', event.currentTarget)}
              >
                Registrar contrato
              </Button>
            )}
          </div>
        </>
      )}
      {canEdit && edition && (
        <ContractEditor
          key={edition}
          edition={edition}
          contract={contract}
          latest={latest}
          plans={catalog ?? []}
          organizationId={organizationId}
          path={path}
          onSaved={saved}
          onReload={onReload}
          onCancel={close}
          {...events}
        />
      )}
      {contract && (
        <div className="commercial-section">
          <div>
            <h3>Histórico de revisões</h3>
            {startsEarlier && <p className="muted">A revisão mais recente tem vigência futura.</p>}
          </div>
          <ol className="commercial-history">
            {revisions.map((item) => (
              <ContractRevision
                key={item.id}
                path={`${path}/${contract.id}/revisions/${item.id}/document`}
                revision={item}
                isCurrent={
                  contract.situation === 'ACTIVE' && item.id === contract.currentRevisionId
                }
                canEdit={canEdit}
                {...events}
              />
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function ContractEditor({
  path,
  organizationId,
  edition,
  contract,
  latest,
  plans,
  onSaved,
  onReload,
  onCancel,
  ...events
}: CommercialAccessEvents & {
  path: string;
  organizationId: string;
  edition: Edition;
  contract: Contract | null;
  latest: Revision | undefined;
  plans: CommercialPlan[];
  onSaved: (contract: Contract) => void;
  onReload: () => void;
  onCancel: () => void;
}) {
  const [planId, setPlanId] = useState(latest?.plan.id ?? '');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState(edition === 'AMENDMENT' ? (latest?.endsOn ?? '') : '');
  const [terms, setTerms] = useState('');
  const [reason, setReason] = useState('');
  const cancelling = edition === 'CANCELLATION';
  const withdrawing = edition === 'WITHDRAW_SCHEDULED';
  const needsPlan = !cancelling && !withdrawing;
  const version = plans
    .find((plan) => plan.id === planId)
    ?.versions.filter((value) => value.effectiveOn <= startsOn)
    .reduce<Revision['planVersion'] | undefined>(
      (selected, value) =>
        !selected || value.effectiveOn > selected.effectiveOn ? value : selected,
      undefined,
    );
  const mutation = useCommercialAction(events);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  useEffect(() => heading.current?.focus(), []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (needsPlan && !version) {
      mutation.setError('Selecione um plano com versão vigente na data de início informada.');
      return;
    }
    const fields = { planVersionId: version?.id, startsOn, endsOn, terms, reason };
    const parsed = contract
      ? commercialReviseContractSchema.safeParse({
          ...(withdrawing
            ? { revisionId: latest?.id, reason }
            : cancelling
              ? { startsOn, reason }
              : fields),
          kind: edition,
          expectedVersion: contract.version,
        })
      : commercialCreateContractSchema.safeParse(fields);
    if (!parsed.success) {
      mutation.setError('Confira as datas de vigência e o motivo do registro.');
      return;
    }
    const target = contract ? `${path}/${contract.id}/revisions` : path;
    const saved = await mutation.run(async (signal) => {
      const result = await request(target, commercialContractSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        signal,
      });
      if (result.organizationId !== organizationId || (contract && result.id !== contract.id))
        throw new RequestError(502);
      return result;
    });
    if (saved) onSaved(saved);
  }

  return (
    <form
      className="platform-editor commercial-editor"
      aria-labelledby={headingId}
      onSubmit={(event) => void save(event)}
    >
      <h3 id={headingId} ref={heading} tabIndex={-1}>
        {editionActions[edition]}
      </h3>
      {latest && (
        <p className="muted">
          {withdrawing
            ? `O termo com início em ${commercialDate(latest.startsOn)} sairá da programação e permanecerá no histórico.`
            : edition === 'RENEWAL'
              ? `O último termo termina em ${commercialDate(latest.endsOn)}. A renovação começa após essa data.`
              : `Informe a data efetiva dentro da vigência do último termo, de ${commercialDate(latest.startsOn)} a ${commercialDate(latest.endsOn)}.`}
        </p>
      )}
      {!withdrawing && (
        <div className="commercial-fields">
          <label>
            {cancelling ? 'Data efetiva do cancelamento' : 'Início da vigência'}
            <input
              type="date"
              required
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </label>
          {!cancelling && (
            <label>
              Fim da vigência
              <input
                type="date"
                min={startsOn || undefined}
                required
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            </label>
          )}
        </div>
      )}
      {needsPlan && (
        <>
          <label>
            Plano
            <select required value={planId} onChange={(event) => setPlanId(event.target.value)}>
              <option value="">Selecione o plano</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
          {version ? (
            <p className="muted">
              Versão {version.ordinal} · {commercialPrice(version)} · desde{' '}
              {commercialDate(version.effectiveOn)}.
            </p>
          ) : planId && startsOn ? (
            <StatusMessage tone="warning">
              Este plano ainda não tem uma versão vigente na data informada.
            </StatusMessage>
          ) : null}
          <label>
            Condições do contrato
            <textarea
              maxLength={8000}
              rows={4}
              value={terms}
              onChange={(event) => setTerms(event.target.value)}
            />
          </label>
        </>
      )}
      <label>
        Motivo do registro
        <textarea
          minLength={3}
          maxLength={1000}
          required
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {mutation.error && (
        <StatusMessage
          tone="error"
          action={
            mutation.conflict ? <Button onClick={onReload}>Reabrir contrato</Button> : undefined
          }
        >
          {mutation.error}
        </StatusMessage>
      )}
      <div className="platform-areas">
        <Button type="submit" disabled={mutation.pending || mutation.conflict}>
          {mutation.pending
            ? 'Salvando…'
            : withdrawing
              ? 'Confirmar retirada'
              : contract
                ? 'Salvar revisão'
                : 'Salvar contrato'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={mutation.pending}>
          Cancelar edição
        </Button>
      </div>
    </form>
  );
}

function ContractRevision({
  path,
  revision,
  isCurrent,
  canEdit,
  ...events
}: CommercialAccessEvents & {
  path: string;
  revision: Revision;
  isCurrent: boolean;
  canEdit: boolean;
}) {
  const headingId = useId();
  const edition = `Revisão ${revision.ordinal} · ${editionTitles[revision.kind]}`;
  const [document, setDocument] = useState<ContractDocument | null>(revision.document);
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState('');
  const mutation = useCommercialAction(events);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
      mutation.setError('Selecione o PDF assinado.');
      return;
    }
    if (file.size < 1 || file.size > MAX_PDF_BYTES) {
      mutation.setError('Envie um PDF de até 5 MiB.');
      return;
    }
    setNotice('');
    const payload = new FormData();
    payload.set('file', file);
    const result = await mutation.run((signal) =>
      request(path, commercialDocumentSchema, { method: 'POST', body: payload, signal }),
    );
    if (!result) return;
    setDocument(result);
    setFile(null);
    setNotice('PDF privado anexado a esta revisão.');
  }

  async function download(item: ContractDocument) {
    setNotice('');
    const blob = await mutation.run(async (signal) => {
      const response = await send(path, { signal, headers: { Accept: 'application/pdf' } });
      if (response.headers.get('Content-Type')?.split(';')[0]?.toLowerCase() !== 'application/pdf')
        throw new RequestError(502);
      return response.blob();
    });
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = item.fileName;
    window.document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    setNotice('Download do PDF solicitado.');
  }

  return (
    <li>
      <section role="group" aria-labelledby={headingId} className="commercial-revision">
        <h4 id={headingId}>{edition}</h4>
        <p className="muted">
          {commercialDate(revision.startsOn)} a {commercialDate(revision.endsOn)}
          {isCurrent ? ' · Vigente' : ''}
          {revision.withdrawal ? ' · Retirado antes da vigência' : ''}
        </p>
        <p>
          <strong>{revision.plan.name}</strong> · versão {revision.planVersion.ordinal} ·{' '}
          {commercialPrice(revision.planVersion)}
        </p>
        {revision.terms && <p className="commercial-text">{revision.terms}</p>}
        <p>
          <strong>Motivo</strong> · {revision.reason}
        </p>
        {revision.withdrawal && (
          <p>
            <strong>Motivo da retirada</strong> · {revision.withdrawal.reason}
          </p>
        )}
        {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
        {mutation.error && (
          <StatusMessage tone="error">
            {mutation.conflict
              ? 'A revisão já possui um PDF associado. Atualize o contrato para consultá-lo.'
              : mutation.error}
          </StatusMessage>
        )}
        {document ? (
          <div>
            <Button
              variant="outline"
              disabled={mutation.pending}
              onClick={() => void download(document)}
            >
              Baixar {document.fileName}
            </Button>
          </div>
        ) : canEdit && (!revision.withdrawal || revision.documentPending) ? (
          <form
            className="platform-editor commercial-document"
            noValidate
            onSubmit={(event) => void upload(event)}
          >
            {revision.documentPending && <p>Envio pendente. Selecione o mesmo PDF para retomar.</p>}
            <label>
              PDF assinado
              <input
                type="file"
                accept="application/pdf,.pdf"
                required
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <div>
              <Button
                type="submit"
                variant="outline"
                disabled={mutation.pending || mutation.conflict}
              >
                {mutation.pending ? 'Anexando…' : 'Anexar PDF assinado'}
              </Button>
            </div>
          </form>
        ) : (
          <p className="muted">
            {revision.documentPending ? 'Envio de PDF pendente.' : 'Sem PDF assinado anexado.'}
          </p>
        )}
      </section>
    </li>
  );
}
