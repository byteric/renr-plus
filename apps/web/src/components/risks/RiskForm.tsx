import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createRiskSchema,
  updateRiskSchema,
  riskDetailSchema,
  unitListSchema,
  sectorListSchema,
  diagnosticCycleListSchema,
  diagnosticCycleSchema,
  diagnosticResultsSchema,
  type RiskDetail,
} from '@renr/contracts';
import { Button } from '../ui/button';
import { request, RequestError } from '../../lib/api';
import { scrollToField, useRiskData } from './useRiskData';

const textFields = [
  { name: 'description', label: 'Descrição do fator', minimum: 10 },
  { name: 'exposureDescription', label: 'Contexto de exposição', minimum: 10 },
  { name: 'exposedGroupDescription', label: 'Grupo exposto', minimum: 3 },
  { name: 'possibleHarms', label: 'Possíveis agravos', minimum: 5 },
  { name: 'existingControls', label: 'Controles existentes', minimum: 5 },
] as const;
export function RiskForm({
  organizationId,
  item,
  initialQuery = '',
  onExpire,
  onSaved,
  onCancel,
}: {
  organizationId: string;
  item?: RiskDetail;
  initialQuery?: string;
  onExpire: () => void;
  onSaved: (value: RiskDetail) => void;
  onCancel: () => void;
}) {
  const initial = new URLSearchParams(initialQuery);
  const [factor, setFactor] = useState(item?.factor ?? '');
  const [unitId, setUnitId] = useState(item?.unit.id ?? initial.get('unitId') ?? '');
  const [sectorId, setSectorId] = useState(item?.sectorId ?? initial.get('sectorId') ?? '');
  const [unitPage, setUnitPage] = useState(1);
  const [sectorPage, setSectorPage] = useState(1);
  const [cyclePage, setCyclePage] = useState(1);
  const [content, setContent] = useState({
    description: item?.description ?? '',
    exposureDescription: item?.exposureDescription ?? '',
    exposedGroupDescription: item?.exposedGroupDescription ?? '',
    possibleHarms: item?.possibleHarms ?? '',
    existingControls: item?.existingControls ?? '',
  });
  const [sourceKind, setSourceKind] = useState(
    item?.sourceKind ?? (initial.get('diagnosticCycleId') ? 'DIAGNOSTIC_CYCLE' : ''),
  );
  const [sourceNote, setSourceNote] = useState(item?.sourceNote ?? '');
  const [cycleId, setCycleId] = useState(
    item?.diagnosticCycleId ?? initial.get('diagnosticCycleId') ?? '',
  );
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const controller = useRef(new AbortController());
  const frozenOrigin = item?.status === 'REGISTERED';
  const units = useRiskData(
    !item ? `/organizations/${organizationId}/units?page=${unitPage}&pageSize=50` : null,
    unitListSchema,
    onExpire,
  );
  const sectors = useRiskData(
    !item && unitId ? `/units/${unitId}/sectors?page=${sectorPage}&pageSize=50` : null,
    sectorListSchema,
    onExpire,
  );
  const cycles = useRiskData(
    sourceKind === 'DIAGNOSTIC_CYCLE' && !frozenOrigin
      ? `/organizations/${organizationId}/diagnostic-cycles?page=${cyclePage}&pageSize=50`
      : null,
    diagnosticCycleListSchema,
    onExpire,
  );
  const result = useRiskData(
    sourceKind === 'DIAGNOSTIC_CYCLE' && cycleId && !frozenOrigin
      ? `/organizations/${organizationId}/diagnostic-cycles/${cycleId}/results`
      : null,
    diagnosticResultsSchema,
    onExpire,
  );
  const selectedCycle = useRiskData(
    sourceKind === 'DIAGNOSTIC_CYCLE' && cycleId && !frozenOrigin
      ? `/organizations/${organizationId}/diagnostic-cycles/${encodeURIComponent(cycleId)}`
      : null,
    diagnosticCycleSchema,
    onExpire,
  );
  const origin =
    selectedCycle.data?.organizationId === organizationId &&
    selectedCycle.data.unitId === unitId &&
    selectedCycle.data.sectorId === sectorId &&
    selectedCycle.data.status === 'CLOSED'
      ? selectedCycle.data
      : null;
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    scrollToField(form.current, 'factor');
    return () => current.abort();
  }, []);
  async function save(status: 'DRAFT' | 'REGISTERED') {
    if (pending || uncertain) return;
    const parsed = createRiskSchema.safeParse({
      factor,
      sectorId,
      ...content,
      sourceKind: sourceKind || null,
      sourceNote,
      diagnosticCycleId: sourceKind === 'DIAGNOSTIC_CYCLE' ? cycleId || null : null,
      status,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0]);
        next[field] =
          field === 'factor'
            ? 'Informe de 3 a 160 caracteres.'
            : field === 'sectorId'
              ? 'Selecione um setor ativo.'
              : 'Preencha este campo com contexto suficiente para registrar o risco.';
      }
      setFields(next);
      setError('Confira os campos destacados. O registro precisa de informações completas.');
      scrollToField(form.current, Object.keys(next)[0] ?? 'factor');
      return;
    }
    if (
      !item &&
      !sectors.data?.items.some((sector) => sector.id === sectorId && sector.isActive) &&
      !origin
    ) {
      setError('Selecione um setor ativo disponível nesta página.');
      scrollToField(form.current, 'sectorId');
      return;
    }
    if (cycleId && !frozenOrigin && result.data?.availability !== 'AVAILABLE') {
      setError(
        'A origem exige um ciclo encerrado com resultados coletivos disponíveis neste setor.',
      );
      return;
    }
    setPending(true);
    setError('');
    setFields({});
    try {
      const { sectorId: scopeSector, ...editable } = parsed.data;
      const body = item
        ? updateRiskSchema.parse({ ...editable, expectedVersion: item.version })
        : { ...editable, sectorId: scopeSector };
      const saved = await request(
        `/organizations/${organizationId}/risks${item ? `/${item.id}` : ''}`,
        riskDetailSchema,
        {
          method: item ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
          signal: controller.current.signal,
        },
      );
      if (!controller.current.signal.aborted) onSaved(saved);
    } catch (failure) {
      if (controller.current.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) {
        onExpire();
        return;
      }
      if (failure instanceof RequestError && failure.status === 409)
        setError(
          'Este registro foi alterado por outra pessoa. Seu texto foi preservado; cancele para consultar a versão atual antes de reaplicar a alteração.',
        );
      else if (
        failure instanceof RequestError &&
        (failure.status === 0 || failure.status === 502)
      ) {
        setUncertain(true);
        setError(
          'Não foi possível confirmar o resultado da gravação. Confira o inventário antes de reenviar; o registro pode ter sido salvo. Seu texto foi preservado.',
        );
      } else
        setError(
          failure instanceof Error ? failure.message : 'Não foi possível salvar o registro.',
        );
      if (failure instanceof RequestError && failure.fields.length)
        setFields(
          Object.fromEntries(
            failure.fields.map((field) => [field.field, 'Confira o conteúdo deste campo.']),
          ),
        );
    } finally {
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(item?.status === 'REGISTERED' ? 'REGISTERED' : 'DRAFT');
  }
  return (
    <form
      className="surface risk-form risk-stack"
      ref={form}
      onSubmit={submit}
      noValidate
      aria-label={item ? 'Editar risco' : 'Cadastrar risco'}
    >
      <div className="risk-section-heading">
        <div>
          <p className="panel-label">{item ? `VERSÃO ${item.version}` : 'NOVO REGISTRO'}</p>
          <h2>{item ? 'Editar registro' : 'Novo risco'}</h2>
        </div>
        <Button variant="outline" disabled={pending} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
      <p className="muted">
        Comece com um rascunho ou complete os campos para registrar. Não inclua nomes de
        trabalhadores, respostas individuais ou informações clínicas.
      </p>
      {error && (
        <div role="alert" className="feedback error">
          <p>{error}</p>
          {uncertain && (
            <>
              <a href="#/inventario" target="_blank" rel="noreferrer">
                Conferir inventário em outra aba
              </a>
              <Button
                variant="outline"
                onClick={() => {
                  setUncertain(false);
                  setError(
                    'Confira o resultado no inventário antes de decidir por uma nova tentativa.',
                  );
                }}
              >
                Já conferi, retomar edição
              </Button>
            </>
          )}
        </div>
      )}
      <fieldset disabled={pending} className="risk-fieldset">
        <legend>01 · Identificação e escopo</legend>
        <div>
          <label htmlFor="risk-factor">Fator de risco</label>
          <input
            id="risk-factor"
            name="factor"
            maxLength={160}
            value={factor}
            onChange={(event) => setFactor(event.target.value)}
            aria-invalid={!!fields.factor}
            aria-describedby={fields.factor ? 'error-factor' : undefined}
          />
          {fields.factor && (
            <p id="error-factor" className="field-error">
              {fields.factor}
            </p>
          )}
        </div>
        {item ? (
          <div className="risk-scope-summary">
            <p>
              <strong>Unidade:</strong> {item.unit.name}
            </p>
            <p>
              <strong>Setor:</strong> {item.sector.name}
            </p>
            <p className="muted">O setor é preservado para manter o histórico de origem.</p>
          </div>
        ) : (
          <div className="risk-field-grid">
            <div>
              <label htmlFor="risk-unit">Unidade</label>
              <select
                id="risk-unit"
                value={unitId}
                onChange={(event) => {
                  setUnitId(event.target.value);
                  setSectorId('');
                  setSectorPage(1);
                }}
              >
                <option value="">Selecione uma unidade</option>
                {units.data?.items
                  .filter((unit) => unit.isActive)
                  .map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                {origin && !units.data?.items.some((unit) => unit.id === unitId) && (
                  <option value={unitId}>{origin.unitName}</option>
                )}
              </select>
              {units.loading && <p role="status">Carregando unidades…</p>}
              {units.data && units.data.total > 50 && (
                <div className="lookup-pages">
                  <Button
                    variant="outline"
                    disabled={unitPage === 1}
                    onClick={() => {
                      setUnitPage(unitPage - 1);
                      setUnitId('');
                      setSectorId('');
                    }}
                  >
                    Unidades anteriores
                  </Button>
                  <Button
                    variant="outline"
                    disabled={unitPage * 50 >= units.data.total}
                    onClick={() => {
                      setUnitPage(unitPage + 1);
                      setUnitId('');
                      setSectorId('');
                    }}
                  >
                    Mais unidades
                  </Button>
                </div>
              )}
            </div>
            <div>
              <label htmlFor="risk-sector">Setor</label>
              <select
                id="risk-sector"
                name="sectorId"
                disabled={!unitId || sectors.loading}
                value={sectorId}
                onChange={(event) => setSectorId(event.target.value)}
                aria-invalid={!!fields.sectorId}
                aria-describedby={fields.sectorId ? 'error-sectorId' : undefined}
              >
                <option value="">Selecione um setor</option>
                {sectors.data?.items
                  .filter((sector) => sector.isActive)
                  .map((sector) => (
                    <option key={sector.id} value={sector.id}>
                      {sector.name}
                    </option>
                  ))}
                {origin && !sectors.data?.items.some((sector) => sector.id === sectorId) && (
                  <option value={sectorId}>{origin.sectorName}</option>
                )}
              </select>
              {fields.sectorId && (
                <p id="error-sectorId" className="field-error">
                  {fields.sectorId}
                </p>
              )}
              {sectors.data && sectors.data.total > 50 && (
                <div className="lookup-pages">
                  <Button
                    variant="outline"
                    disabled={sectorPage === 1}
                    onClick={() => {
                      setSectorPage(sectorPage - 1);
                      setSectorId('');
                    }}
                  >
                    Setores anteriores
                  </Button>
                  <Button
                    variant="outline"
                    disabled={sectorPage * 50 >= sectors.data.total}
                    onClick={() => {
                      setSectorPage(sectorPage + 1);
                      setSectorId('');
                    }}
                  >
                    Mais setores
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
        {(units.error || sectors.error) && (
          <p role="alert" className="feedback error">
            {units.error || sectors.error} <a href="#/unidades">Conferir estrutura</a>
          </p>
        )}
      </fieldset>
      <fieldset disabled={pending} className="risk-fieldset">
        <legend>02 · Contexto de trabalho</legend>
        <p className="muted">
          Obrigatórios ao registrar; opcionais no rascunho. Descreva situações coletivas, não
          pessoas.
        </p>
        {textFields.map(({ name, label, minimum }) => (
          <div key={name}>
            <label htmlFor={`risk-${name}`}>{label}</label>
            <textarea
              id={`risk-${name}`}
              name={name}
              maxLength={2000}
              rows={3}
              value={content[name]}
              onChange={(event) => setContent({ ...content, [name]: event.target.value })}
              aria-invalid={!!fields[name]}
              aria-describedby={`hint-${name}${fields[name] ? ` error-${name}` : ''}`}
            />
            <p className="field-hint" id={`hint-${name}`}>
              De {minimum} a 2.000 caracteres ao registrar.
            </p>
            {fields[name] && (
              <p id={`error-${name}`} className="field-error">
                {fields[name]}
              </p>
            )}
          </div>
        ))}
      </fieldset>
      <fieldset disabled={pending} className="risk-fieldset">
        <legend>03 · Origem rastreável</legend>
        <div>
          <label htmlFor="risk-source">Tipo de origem</label>
          <select
            id="risk-source"
            name="sourceKind"
            disabled={frozenOrigin}
            value={sourceKind}
            onChange={(event) => {
              setSourceKind(event.target.value);
              setCycleId('');
            }}
            aria-invalid={!!fields.sourceKind}
          >
            <option value="">Ainda não informado</option>
            <option value="TECHNICAL_RECORD">Registro técnico contextual</option>
            <option value="DIAGNOSTIC_CYCLE">Diagnóstico coletivo</option>
          </select>
          {fields.sourceKind && <p className="field-error">{fields.sourceKind}</p>}
        </div>
        {sourceKind === 'DIAGNOSTIC_CYCLE' && (
          <div>
            <label htmlFor="risk-cycle">Ciclo de origem</label>
            <select
              id="risk-cycle"
              name="diagnosticCycleId"
              disabled={frozenOrigin || cycles.loading}
              value={cycleId}
              onChange={(event) => setCycleId(event.target.value)}
            >
              <option value="">Selecione um ciclo encerrado</option>
              {cycles.data?.items
                .filter((cycle) => cycle.status === 'CLOSED' && cycle.sectorId === sectorId)
                .map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.name}
                  </option>
                ))}
              {origin && !cycles.data?.items.some((cycle) => cycle.id === cycleId) && (
                <option value={cycleId}>{origin.name}</option>
              )}
              {frozenOrigin && cycleId && (
                <option value={cycleId}>Ciclo vinculado ao registro</option>
              )}
            </select>
            {cycles.data && cycles.data.total > 50 && !frozenOrigin && (
              <div className="lookup-pages">
                <Button
                  variant="outline"
                  disabled={cyclePage === 1}
                  onClick={() => {
                    setCyclePage(cyclePage - 1);
                    setCycleId('');
                  }}
                >
                  Ciclos anteriores
                </Button>
                <Button
                  variant="outline"
                  disabled={cyclePage * 50 >= cycles.data.total}
                  onClick={() => {
                    setCyclePage(cyclePage + 1);
                    setCycleId('');
                  }}
                >
                  Mais ciclos
                </Button>
              </div>
            )}
            {result.loading && <p role="status">Verificando disponibilidade coletiva…</p>}
            {cycleId &&
              !frozenOrigin &&
              result.data?.availability !== 'AVAILABLE' &&
              !result.loading && (
                <p className="feedback">
                  Este ciclo não tem consolidação disponível. Não é possível usá-lo como origem
                  neste momento.
                </p>
              )}
            {(cycles.error || result.error || selectedCycle.error) && (
              <p role="alert" className="feedback error">
                {cycles.error || result.error || selectedCycle.error}
              </p>
            )}
          </div>
        )}
        <div>
          <label htmlFor="risk-source-note">Nota de origem</label>
          <textarea
            id="risk-source-note"
            name="sourceNote"
            rows={3}
            maxLength={1000}
            value={sourceNote}
            onChange={(event) => setSourceNote(event.target.value)}
            aria-invalid={!!fields.sourceNote}
          />
          {fields.sourceNote && <p className="field-error">{fields.sourceNote}</p>}
          <p className="field-hint">
            Ao registrar, use de 10 a 1.000 caracteres para contextualizar a fonte. O vínculo não
            valida a metodologia.
          </p>
        </div>
      </fieldset>
      <div className="risk-form-actions">
        {item?.status !== 'REGISTERED' && (
          <Button type="submit" variant="outline" disabled={pending || uncertain}>
            {pending ? 'Salvando…' : 'Salvar rascunho'}
          </Button>
        )}
        <Button
          type="button"
          disabled={pending || uncertain}
          onClick={() => void save('REGISTERED')}
        >
          {pending
            ? 'Salvando…'
            : item?.status === 'REGISTERED'
              ? 'Salvar registro'
              : 'Registrar risco'}
        </Button>
      </div>
    </form>
  );
}
