import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createDiagnosticCycleSchema,
  diagnosticCycleSchema,
  diagnosticCycleListSchema,
  diagnosticInstrumentSchema,
  diagnosticResultsSchema,
  participationInvitesSchema,
  unitListSchema,
  sectorListSchema,
  type DiagnosticCycle,
  type DiagnosticCycleList,
  type DiagnosticInstrument,
  type DiagnosticResults,
  type ParticipationInvites,
  type SessionResponse,
  type Unit,
  type Sector,
} from '@renr/contracts';
import { request, RequestError } from '../lib/api';
import { Button } from './ui/button';
import { DemoNotice } from './Participation';
const statusLabels = { DRAFT: 'Rascunho', OPEN: 'Aberto', CLOSED: 'Encerrado' };
const date = (value: string) => new Date(value).toLocaleString('pt-BR');
function failureMessage(failure: unknown) {
  return failure instanceof Error ? failure.message : 'Não foi possível concluir a operação.';
}

function CycleCreator({
  organizationId,
  onCreated,
  onCancel,
  onExpire,
}: {
  organizationId: string;
  onCreated: (cycle: DiagnosticCycle) => void;
  onCancel: () => void;
  onExpire: () => void;
}) {
  const [instrument, setInstrument] = useState<DiagnosticInstrument | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [unitPage, setUnitPage] = useState(1);
  const [unitTotal, setUnitTotal] = useState(0);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [sectorPage, setSectorPage] = useState(1);
  const [sectorTotal, setSectorTotal] = useState(0);
  const [sectorId, setSectorId] = useState('');
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const controller = useRef(new AbortController());
  function changeUnitPage(page: number) {
    setUnitPage(page);
    setUnits([]);
    setUnitId('');
    setSectorId('');
    setSectors([]);
    setSectorPage(1);
    setSectorTotal(0);
    setLoading(true);
  }
  function changeSectorPage(page: number) {
    setSectorPage(page);
    setSectorId('');
    setSectors([]);
  }
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    const current = new AbortController();
    let active = true;
    void Promise.all([
      request(
        `/organizations/${organizationId}/diagnostic-instrument`,
        diagnosticInstrumentSchema,
        { signal: current.signal },
      ),
      request(
        `/organizations/${organizationId}/units?page=${unitPage}&pageSize=50`,
        unitListSchema,
        { signal: current.signal },
      ),
    ])
      .then(([value, list]) => {
        if (active) {
          setInstrument(value);
          setUnits(list.items);
          setUnitTotal(list.total);
          setLoading(false);
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          setLoading(false);
          if (failure instanceof RequestError && failure.status === 401) onExpire();
          else setError(failureMessage(failure));
        }
      });
    return () => {
      active = false;
      current.abort();
    };
  }, [organizationId, unitPage, onExpire]);
  useEffect(() => {
    if (!unitId) return;
    const current = new AbortController();
    let active = true;
    void request(`/units/${unitId}/sectors?page=${sectorPage}&pageSize=50`, sectorListSchema, {
      signal: current.signal,
    })
      .then((list) => {
        if (active) {
          setSectors(list.items);
          setSectorTotal(list.total);
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          if (failure instanceof RequestError && failure.status === 401) onExpire();
          else setError(failureMessage(failure));
        }
      });
    return () => {
      active = false;
      current.abort();
    };
  }, [unitId, sectorPage, onExpire]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const start = new Date(startsAt),
      end = new Date(endsAt);
    const parsed = createDiagnosticCycleSchema.safeParse({
      name,
      sectorId,
      instrumentVersionId: instrument?.id,
      startsAt: Number.isNaN(start.getTime()) ? '' : start.toISOString(),
      endsAt: Number.isNaN(end.getTime()) ? '' : end.toISOString(),
    });
    if (!parsed.success) {
      setError('Informe nome, setor, início e término posterior ao início.');
      return;
    }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const value = await request(
        `/organizations/${organizationId}/diagnostic-cycles`,
        diagnosticCycleSchema,
        { method: 'POST', body: JSON.stringify(parsed.data), signal: controller.current.signal },
      );
      if (!controller.current.signal.aborted) onCreated(value);
    } catch (failure) {
      if (!controller.current.signal.aborted) {
        if (failure instanceof RequestError && failure.status === 401) onExpire();
        else setError(failureMessage(failure));
      }
    } finally {
      if (!controller.current.signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  return (
    <section className="surface editor">
      <h2>Novo ciclo</h2>
      {loading && <p role="status">Carregando instrumento e unidades…</p>}
      <form noValidate onSubmit={(event) => void save(event)} aria-label="Criar ciclo">
        <label htmlFor="cycle-name">Nome do ciclo</label>
        <input
          id="cycle-name"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <label htmlFor="cycle-unit">Unidade</label>
        <select
          id="cycle-unit"
          value={unitId}
          onChange={(event) => {
            setUnitId(event.target.value);
            setSectorId('');
            setSectors([]);
            setSectorPage(1);
            setSectorTotal(0);
          }}
        >
          <option value="">Selecione uma unidade</option>
          {units
            .filter((u) => u.isActive)
            .map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
        </select>
        {unitTotal > 50 && (
          <div className="pagination">
            <Button
              variant="outline"
              disabled={unitPage === 1}
              onClick={() => changeUnitPage(unitPage - 1)}
            >
              Unidades anteriores
            </Button>
            <Button
              variant="outline"
              disabled={unitPage * 50 >= unitTotal}
              onClick={() => changeUnitPage(unitPage + 1)}
            >
              Mais unidades
            </Button>
          </div>
        )}
        <label htmlFor="cycle-sector">Setor</label>
        <select
          id="cycle-sector"
          value={sectorId}
          disabled={!unitId}
          required
          onChange={(event) => setSectorId(event.target.value)}
        >
          <option value="">Selecione um setor</option>
          {sectors
            .filter((s) => s.isActive)
            .map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.name}
              </option>
            ))}
        </select>
        {sectorTotal > 50 && (
          <div className="pagination">
            <Button
              variant="outline"
              disabled={sectorPage === 1}
              onClick={() => changeSectorPage(sectorPage - 1)}
            >
              Setores anteriores
            </Button>
            <Button
              variant="outline"
              disabled={sectorPage * 50 >= sectorTotal}
              onClick={() => changeSectorPage(sectorPage + 1)}
            >
              Mais setores
            </Button>
          </div>
        )}
        <label htmlFor="cycle-start">Início</label>
        <input
          id="cycle-start"
          type="datetime-local"
          value={startsAt}
          onChange={(event) => setStartsAt(event.target.value)}
          required
        />
        <label htmlFor="cycle-end">Término</label>
        <input
          id="cycle-end"
          type="datetime-local"
          value={endsAt}
          onChange={(event) => setEndsAt(event.target.value)}
          required
        />
        <p className="input-hint">
          Datas no fuso deste dispositivo. Instrumento: {instrument?.title ?? 'carregando'}.
        </p>
        {error && (
          <p role="alert" className="feedback error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" disabled={pending || loading}>
            {pending ? 'Salvando…' : 'Criar ciclo'}
          </Button>
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </section>
  );
}

function Results({ result }: { result: DiagnosticResults }) {
  return (
    <section className="surface">
      <h2>Resultados agregados</h2>
      {result.availability === 'CYCLE_OPEN' ? (
        <p>Os resultados estarão disponíveis após o encerramento do ciclo.</p>
      ) : result.availability === 'INSUFFICIENT_RESPONSES' ? (
        <p>
          Resultados protegidos: são necessárias ao menos {result.minimumResponses} respostas.
          Contagens não são exibidas.
        </p>
      ) : (
        <>
          <p>{result.responseCount} respostas recebidas. Os dados abaixo são agregados.</p>
          {result.questions.map((question) => (
            <section className="result-question" key={question.id}>
              <h3>{question.label}</h3>
              {question.suppressed ? (
                <p className="feedback">
                  Distribuição suprimida para proteger a confidencialidade: ao menos uma opção tem
                  menos de {result.minimumResponses} respostas.
                </p>
              ) : (
                <ul className="result-options">
                  {question.options.map((option) => (
                    <li key={option.id}>
                      <span>{option.label}</span>
                      <strong>
                        {option.count} · {option.percentage.toLocaleString('pt-BR')}%
                      </strong>
                      <meter
                        min={0}
                        max={100}
                        value={option.percentage}
                        aria-label={`${option.label}: ${option.percentage}%`}
                      />
                    </li>
                  ))}
                </ul>
              )}
              {question.type === 'MULTIPLE_CHOICE' && !question.suppressed && (
                <p className="input-hint">
                  Múltipla escolha: cada pessoa pode selecionar mais de uma opção; a soma dos
                  percentuais pode exceder 100%.
                </p>
              )}
            </section>
          ))}
        </>
      )}
    </section>
  );
}

function CycleDetail({
  organizationId,
  id,
  canWrite,
  onBack,
  onExpire,
}: {
  organizationId: string;
  id: string;
  canWrite: boolean;
  onBack: () => void;
  onExpire: () => void;
}) {
  const [cycle, setCycle] = useState<DiagnosticCycle | null>(null);
  const [instrument, setInstrument] = useState<DiagnosticInstrument | null>(null);
  const [results, setResults] = useState<DiagnosticResults | null>(null);
  const [invites, setInvites] = useState<ParticipationInvites | null>(null);
  const [count, setCount] = useState(1);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState('');
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  const controller = useRef(new AbortController());
  const path = `/organizations/${organizationId}/diagnostic-cycles/${id}`;
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    const current = new AbortController();
    let active = true;
    void Promise.all([
      request(path, diagnosticCycleSchema, { signal: current.signal }),
      request(`${path}/results`, diagnosticResultsSchema, { signal: current.signal }),
    ])
      .then(([value, result]) => {
        if (active) {
          setCycle(value);
          setResults(result);
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          if (failure instanceof RequestError && failure.status === 401) onExpire();
          else setError(failureMessage(failure));
        }
      });
    return () => {
      active = false;
      current.abort();
    };
  }, [path, attempt, onExpire]);
  async function mutate(action: 'open' | 'close' | 'participation-invites') {
    if (!canWrite || busy.current) return;
    if (
      action === 'participation-invites' &&
      (!Number.isInteger(count) || count < 1 || count > 20)
    ) {
      setError('Emita entre 1 e 20 convites por vez.');
      return;
    }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const options = {
        method: 'POST',
        signal: controller.current.signal,
        ...(action === 'participation-invites' ? { body: JSON.stringify({ count }) } : {}),
      };
      if (action === 'participation-invites') {
        const value = await request(`${path}/${action}`, participationInvitesSchema, options);
        if (!controller.current.signal.aborted) setInvites(value);
      } else {
        const value = await request(`${path}/${action}`, diagnosticCycleSchema, options);
        if (!controller.current.signal.aborted) {
          setCycle(value);
          setInvites(null);
          setAttempt((current) => current + 1);
        }
      }
    } catch (failure) {
      if (!controller.current.signal.aborted) {
        if (failure instanceof RequestError && failure.status === 401) onExpire();
        else
          setError(
            failure instanceof RequestError && failure.status === 0
              ? 'A conexão foi interrompida. O resultado da operação é incerto; confira o ciclo antes de emitir novos convites.'
              : failure instanceof RequestError && failure.code === 'CONFLICT'
                ? 'Esta operação não está disponível no estado atual do ciclo. Atualize o ciclo e confira sua janela de participação.'
                : failureMessage(failure),
          );
      }
    } finally {
      if (!controller.current.signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  async function preview() {
    setError('');
    try {
      const value = await request(
        `/organizations/${organizationId}/diagnostic-instrument`,
        diagnosticInstrumentSchema,
        { signal: controller.current.signal },
      );
      if (!controller.current.signal.aborted) setInstrument(value);
    } catch (failure) {
      if (!controller.current.signal.aborted) setError(failureMessage(failure));
    }
  }
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copiado.`);
    } catch {
      setCopied('Não foi possível copiar automaticamente. Selecione e copie o texto exibido.');
    }
  }
  return (
    <div className="diagnostic-stack">
      <Button variant="outline" onClick={onBack}>
        Voltar aos ciclos
      </Button>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {!cycle ? (
        <p role="status">Carregando ciclo…</p>
      ) : (
        <section className="surface">
          <h2>{cycle.name}</h2>
          <span className="badge">{statusLabels[cycle.status]}</span>
          <p>
            {cycle.unitName} → {cycle.sectorName}
          </p>
          <p className="muted">
            {date(cycle.startsAt)} até {date(cycle.endsAt)}
          </p>
          <p>Instrumento: {cycle.instrumentTitle}</p>
          <div className="form-actions">
            <Button variant="outline" onClick={() => void preview()}>
              Visualizar instrumento
            </Button>
            {canWrite && cycle.status === 'DRAFT' && (
              <Button disabled={pending} onClick={() => void mutate('open')}>
                Abrir ciclo
              </Button>
            )}
            {canWrite && cycle.status === 'OPEN' && (
              <Button variant="outline" disabled={pending} onClick={() => void mutate('close')}>
                Encerrar ciclo
              </Button>
            )}
          </div>
          {canWrite && cycle.status === 'OPEN' && (
            <div className="invite-actions">
              <label htmlFor="invite-count">Quantidade de convites</label>
              <input
                id="invite-count"
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
              />
              <Button disabled={pending} onClick={() => void mutate('participation-invites')}>
                {pending ? 'Aguarde…' : 'Emitir convites'}
              </Button>
            </div>
          )}
          {invites && (
            <section className="invites">
              <h3>Guarde estes códigos agora</h3>
              <p>
                Os códigos são exibidos uma única vez. Compartilhe o link e cada código
                separadamente com participantes fictícios.
              </p>
              <p className="copy-value">
                {new URL(invites.participationPath, window.location.origin).href}
              </p>
              <Button
                variant="outline"
                onClick={() =>
                  void copy(new URL(invites.participationPath, window.location.origin).href, 'Link')
                }
              >
                Copiar link de participação
              </Button>
              {invites.invites.map((invite, index) => (
                <div key={invite.code} className="invite-code">
                  <label htmlFor={`generated-code-${index}`}>Código {index + 1}</label>
                  <input id={`generated-code-${index}`} readOnly value={invite.code} />
                  <p className="input-hint">Expira em {date(invite.expiresAt)}</p>
                  <Button variant="outline" onClick={() => void copy(invite.code, 'Código')}>
                    Copiar código {index + 1}
                  </Button>
                </div>
              ))}
              {copied && <p role="status">{copied}</p>}
            </section>
          )}
        </section>
      )}
      {instrument && (
        <section className="surface">
          <h2>
            {instrument.title} · versão {instrument.version}
          </h2>
          <ol className="instrument-preview">
            {instrument.questions.map((question) => (
              <li key={question.id}>
                <h3>{question.label}</h3>
                <p className="input-hint">
                  {question.type === 'SINGLE_CHOICE' ? 'Escolha única' : 'Múltipla escolha'} ·
                  Obrigatória
                </p>
                <ul>
                  {question.options.map((option) => (
                    <li key={option.id}>{option.label}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}
      {results && <Results result={results} />}
      <Button variant="outline" disabled={pending} onClick={() => setAttempt(attempt + 1)}>
        Atualizar ciclo
      </Button>
    </div>
  );
}

export function Diagnostics({
  session,
  onExpire,
}: {
  session: SessionResponse;
  onExpire: () => void;
}) {
  const organizationId = session.activeOrganizationId;
  const canWrite =
    session.memberships.find((value) => value.organizationId === organizationId)?.role === 'ADMIN';
  const [list, setList] = useState<DiagnosticCycleList | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!organizationId) return;
    const controller = new AbortController();
    let active = true;
    void request(
      `/organizations/${organizationId}/diagnostic-cycles?page=${page}&pageSize=50`,
      diagnosticCycleListSchema,
      { signal: controller.signal },
    )
      .then((value) => {
        if (active) {
          setList(value);
          setError('');
        }
      })
      .catch((failure: unknown) => {
        if (active) {
          if (failure instanceof RequestError && failure.status === 401) onExpire();
          else setError(failureMessage(failure));
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [organizationId, page, attempt, onExpire]);
  if (!organizationId)
    return (
      <div className="surface empty-state">
        <h2>Selecione uma empresa</h2>
        <a href="#/empresas">Ir para Empresas</a>
      </div>
    );
  return (
    <div className="diagnostic-stack">
      <DemoNotice />
      {selected ? (
        <CycleDetail
          key={selected}
          organizationId={organizationId}
          id={selected}
          canWrite={canWrite}
          onExpire={onExpire}
          onBack={() => {
            setSelected(null);
            setList(null);
            setAttempt(attempt + 1);
          }}
        />
      ) : creating ? (
        <CycleCreator
          organizationId={organizationId}
          onExpire={onExpire}
          onCancel={() => setCreating(false)}
          onCreated={(cycle) => {
            setCreating(false);
            setSelected(cycle.id);
            setAttempt(attempt + 1);
          }}
        />
      ) : (
        <>
          {canWrite && <Button onClick={() => setCreating(true)}>Novo ciclo</Button>}
          {error && (
            <div className="feedback error" role="alert">
              <p>{error}</p>
              <Button variant="outline" onClick={() => setAttempt(attempt + 1)}>
                Atualizar ciclos
              </Button>
            </div>
          )}
          {!list && !error && <p role="status">Carregando ciclos…</p>}
          {list?.items.length === 0 && (
            <section className="surface empty-state">
              <h2>Nenhum ciclo criado</h2>
              <p>Os ciclos da empresa selecionada aparecerão aqui.</p>
            </section>
          )}
          {list && (
            <>
              <p className="list-summary">
                {list.total} ciclos · Página {list.page}
              </p>
              <ul className="record-list">
                {list.items.map((cycle) => (
                  <li className="surface record" key={cycle.id}>
                    <div>
                      <h2>{cycle.name}</h2>
                      <p>
                        {cycle.unitName} → {cycle.sectorName}
                      </p>
                      <span className="badge">{statusLabels[cycle.status]}</span>
                      <p className="muted">
                        {date(cycle.startsAt)} até {date(cycle.endsAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      aria-label={`Ver ciclo ${cycle.name}`}
                      onClick={() => setSelected(cycle.id)}
                    >
                      Ver ciclo
                    </Button>
                  </li>
                ))}
              </ul>
              {list.total > 50 && (
                <nav className="pagination" aria-label="Paginação de ciclos">
                  <Button
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => {
                      setList(null);
                      setPage(page - 1);
                    }}
                  >
                    Página anterior
                  </Button>
                  <Button
                    variant="outline"
                    disabled={page * 50 >= list.total}
                    onClick={() => {
                      setList(null);
                      setPage(page + 1);
                    }}
                  >
                    Próxima página
                  </Button>
                </nav>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
