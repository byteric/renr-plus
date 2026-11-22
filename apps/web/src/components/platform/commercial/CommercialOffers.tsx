import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  commercialCreatePlanSchema,
  commercialPlanSchema,
  commercialRevisePlanSchema,
  type CommercialOfferVersion,
  type CommercialOfferVersionInput,
  type CommercialPlan,
} from '@renr/contracts';
import { request } from '../../../lib/api';
import { Button } from '../../ui/button';
import { StatusMessage } from '../../ui/status-message';
import {
  commercialDate,
  commercialPath,
  commercialPrice,
  todayInSaoPaulo,
  useCommercialAction,
  type CommercialAccessEvents,
} from './commercial-ui';
import { referenceOffers } from './reference-offers';

const offerKinds = { PLAN: 'Plano', SERVICE: 'Serviço avulso' };

export function CommercialOffers({
  plans,
  canEdit,
  error,
  onReload,
  ...events
}: CommercialAccessEvents & {
  plans: CommercialPlan[] | undefined;
  canEdit: boolean;
  error: string;
  onReload: () => void;
}) {
  const [edit, setEdit] = useState<'new' | CommercialPlan | null>(null);
  const [notice, setNotice] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const beforeEdit = (value: 'new' | CommercialPlan, button: HTMLButtonElement) => {
    trigger.current = button;
    setNotice('');
    setEdit(value);
  };
  const close = () => {
    setEdit(null);
    trigger.current?.focus();
  };

  return (
    <section className="commercial-section" aria-labelledby="commercial-offers-heading">
      <div className="platform-heading">
        <div>
          <h2 id="commercial-offers-heading">Planos e serviços</h2>
          <p className="muted">Consulte as condições e o histórico de vigência das ofertas.</p>
        </div>
        {canEdit && plans && (
          <Button onClick={(event) => beforeEdit('new', event.currentTarget)}>Nova oferta</Button>
        )}
      </div>
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      {canEdit && edit && (
        <OfferEditor
          key={edit === 'new' ? 'new' : edit.id}
          plan={edit === 'new' ? null : edit}
          onCancel={close}
          onReload={() => {
            close();
            onReload();
          }}
          onSaved={() => {
            close();
            setNotice('Oferta salva. As versões anteriores continuam disponíveis.');
            onReload();
          }}
          {...events}
        />
      )}
      {error ? (
        <StatusMessage tone="error" action={<Button onClick={onReload}>Atualizar ofertas</Button>}>
          {error}
        </StatusMessage>
      ) : !plans ? (
        <StatusMessage tone="loading">Carregando ofertas…</StatusMessage>
      ) : plans.length === 0 ? (
        <StatusMessage>Nenhuma oferta registrada.</StatusMessage>
      ) : (
        <ul className="commercial-records" aria-label="Ofertas registradas">
          {plans.map((plan) => {
            const versions = [...plan.versions].sort((left, right) => right.ordinal - left.ordinal);
            const effective = versions.find((value) => value.effectiveOn <= todayInSaoPaulo());
            return (
              <li key={plan.id} className="surface commercial-record">
                <div className="platform-heading">
                  <div>
                    <p className="panel-label">{offerKinds[plan.kind]}</p>
                    <h3>{plan.name}</h3>
                    <p className="commercial-price">
                      {effective ? commercialPrice(effective) : 'Nenhuma versão vigente'}
                    </p>
                  </div>
                  {canEdit && (
                    <Button
                      variant="outline"
                      aria-label={`Nova versão de ${plan.name}`}
                      onClick={(event) => beforeEdit(plan, event.currentTarget)}
                    >
                      Nova versão
                    </Button>
                  )}
                </div>
                <details>
                  <summary>Versões da oferta ({versions.length})</summary>
                  <ol className="commercial-history">
                    {versions.map((value) => (
                      <OfferVersion
                        key={value.id}
                        version={value}
                        isCurrent={value.id === effective?.id}
                      />
                    ))}
                  </ol>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function OfferVersion({
  version,
  isCurrent,
}: {
  version: CommercialOfferVersion;
  isCurrent: boolean;
}) {
  return (
    <li>
      <h4>
        Versão {version.ordinal}
        {isCurrent ? ' · Vigente' : ''}
      </h4>
      <p className="muted">
        A partir de {commercialDate(version.effectiveOn)} · {commercialPrice(version)}
      </p>
      {version.conditions && <p className="commercial-text">{version.conditions}</p>}
      {version.limits && (
        <p>
          <strong>Limites</strong> · {version.limits}
        </p>
      )}
      {(
        [
          ['Recursos disponíveis', version.includedFeatures],
          ['Recursos previstos', version.plannedFeatures],
        ] as const
      ).map(([label, items]) =>
        items.length > 0 ? (
          <div key={label}>
            <strong>{label}</strong>
            <ul>
              {items.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </li>
  );
}

type VersionDraft = Omit<
  CommercialOfferVersionInput,
  'priceCents' | 'includedFeatures' | 'plannedFeatures'
> & {
  price: string;
  includedFeatures: string;
  plannedFeatures: string;
};

function toDraft(source?: Omit<CommercialOfferVersionInput, 'effectiveOn'>): VersionDraft {
  return {
    effectiveOn: todayInSaoPaulo(),
    price: source ? (source.priceCents / 100).toFixed(2).replace('.', ',') : '',
    pricingUnit: source?.pricingUnit ?? 'EMPLOYEE_MONTH',
    priceMode: source?.priceMode ?? 'FIXED',
    conditions: source?.conditions ?? '',
    limits: source?.limits ?? '',
    includedFeatures: source?.includedFeatures.join('\n') ?? '',
    plannedFeatures: source?.plannedFeatures.join('\n') ?? '',
  };
}

function fromDraft({ price, includedFeatures, plannedFeatures, ...draft }: VersionDraft) {
  const lines = (value: string) =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  return {
    ...draft,
    priceCents: /^\d+(?:[,.]\d{1,2})?$/.test(price.trim())
      ? Math.round(Number(price.trim().replace(',', '.')) * 100)
      : undefined,
    includedFeatures: lines(includedFeatures),
    plannedFeatures: lines(plannedFeatures),
  };
}

function OfferEditor({
  plan,
  onCancel,
  onSaved,
  onReload,
  ...events
}: CommercialAccessEvents & {
  plan: CommercialPlan | null;
  onCancel: () => void;
  onSaved: () => void;
  onReload: () => void;
}) {
  const [name, setName] = useState(plan?.name ?? '');
  const [kind, setKind] = useState<CommercialPlan['kind']>(plan?.kind ?? 'PLAN');
  const [example, setExample] = useState('');
  const [reason, setReason] = useState('');
  const [draft, setDraft] = useState(() =>
    toDraft(
      plan?.versions.reduce((latest, value) => (value.ordinal > latest.ordinal ? value : latest)),
    ),
  );
  const mutation = useCommercialAction(events);
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  function changeKind(next: CommercialPlan['kind']) {
    setKind(next);
    setDraft((value) => ({
      ...value,
      pricingUnit: next === 'PLAN' ? 'EMPLOYEE_MONTH' : 'SERVICE',
    }));
  }

  function fillReference(key: string) {
    setExample(key);
    const chosen = referenceOffers[key];
    if (!chosen) return;
    setName(chosen.name);
    setKind(chosen.kind);
    setDraft(toDraft(chosen.version));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const version = fromDraft(draft);
    const parsed = plan
      ? commercialRevisePlanSchema.safeParse({ expectedVersion: plan.version, version, reason })
      : commercialCreatePlanSchema.safeParse({ name, kind, version, reason });
    if (!parsed.success) {
      mutation.setError('Confira nome, preço em reais, vigência, recursos e motivo do registro.');
      return;
    }
    const path = plan ? `${commercialPath}/plans/${plan.id}/versions` : `${commercialPath}/plans`;
    const result = await mutation.run((signal) =>
      request(path, commercialPlanSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        signal,
      }),
    );
    if (result) onSaved();
  }

  return (
    <section className="surface commercial-record" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} ref={heading}>
        {plan ? `Nova versão de ${plan.name}` : 'Nova oferta'}
      </h3>
      <form className="platform-editor" onSubmit={(event) => void save(event)}>
        {!plan && (
          <>
            <label>
              Exemplo de referência
              <select value={example} onChange={(event) => fillReference(event.target.value)}>
                <option value="">Preencher manualmente</option>
                {Object.entries(referenceOffers).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value.name}
                  </option>
                ))}
              </select>
            </label>
            {example && (
              <p className="muted">
                Confira as condições de referência e confirme a vigência antes de salvar.
              </p>
            )}
            <div className="commercial-fields">
              <label>
                Nome da oferta
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Tipo de oferta
                <select
                  value={kind}
                  onChange={(event) =>
                    changeKind(event.target.value === 'PLAN' ? 'PLAN' : 'SERVICE')
                  }
                >
                  <option value="PLAN">Plano</option>
                  <option value="SERVICE">Serviço avulso</option>
                </select>
              </label>
            </div>
          </>
        )}
        <div className="commercial-fields">
          <label>
            Início da vigência
            <input
              type="date"
              required
              value={draft.effectiveOn}
              onChange={(event) => setDraft({ ...draft, effectiveOn: event.target.value })}
            />
          </label>
          <label>
            Preço em reais
            <input
              inputMode="decimal"
              required
              placeholder="0,00"
              maxLength={18}
              value={draft.price}
              onChange={(event) => setDraft({ ...draft, price: event.target.value })}
            />
          </label>
          <label>
            Modalidade de preço
            <select
              value={draft.priceMode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  priceMode: event.target.value === 'FIXED' ? 'FIXED' : 'STARTING_AT',
                })
              }
            >
              <option value="FIXED">Valor fixo</option>
              <option value="STARTING_AT">A partir de</option>
            </select>
          </label>
          <label>
            Unidade de preço
            <select
              value={draft.pricingUnit}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  pricingUnit:
                    event.target.value === 'TRAINING_CLASS' ? 'TRAINING_CLASS' : 'SERVICE',
                })
              }
              disabled={kind === 'PLAN'}
            >
              {kind === 'PLAN' ? (
                <option value="EMPLOYEE_MONTH">Colaborador/mês</option>
              ) : (
                <>
                  <option value="SERVICE">Serviço</option>
                  <option value="TRAINING_CLASS">Turma</option>
                </>
              )}
            </select>
          </label>
        </div>
        <div className="commercial-fields">
          <label>
            Condições
            <textarea
              rows={3}
              maxLength={4000}
              value={draft.conditions}
              onChange={(event) => setDraft({ ...draft, conditions: event.target.value })}
            />
          </label>
          <label>
            Limites
            <textarea
              rows={3}
              maxLength={4000}
              value={draft.limits}
              onChange={(event) => setDraft({ ...draft, limits: event.target.value })}
            />
          </label>
          <label>
            Recursos disponíveis
            <textarea
              rows={3}
              placeholder="Um recurso por linha"
              value={draft.includedFeatures}
              onChange={(event) => setDraft({ ...draft, includedFeatures: event.target.value })}
            />
          </label>
          <label>
            Recursos previstos
            <textarea
              rows={3}
              placeholder="Um recurso por linha"
              value={draft.plannedFeatures}
              onChange={(event) => setDraft({ ...draft, plannedFeatures: event.target.value })}
            />
          </label>
        </div>
        <label>
          Motivo do registro
          <textarea
            rows={2}
            required
            minLength={3}
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {mutation.error && (
          <StatusMessage
            tone="error"
            action={
              mutation.conflict ? (
                <Button onClick={onReload}>Reabrir com dados atuais</Button>
              ) : undefined
            }
          >
            {mutation.error}
          </StatusMessage>
        )}
        <div className="platform-areas">
          <Button type="submit" disabled={mutation.pending || mutation.conflict}>
            {mutation.pending ? 'Salvando…' : plan ? 'Salvar versão' : 'Salvar oferta'}
          </Button>
          <Button variant="outline" disabled={mutation.pending} onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </section>
  );
}
