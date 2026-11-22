import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  archiveRiskContributionSchema,
  createRiskContributionSchema,
  riskContributionListSchema,
  riskContributionSchema,
  shareRiskContributionSchema,
  updateRiskContributionSchema,
  type RiskContribution,
  type RiskContributionKind,
  type RiskContributionSpecialty,
  type RiskContributionVisibility,
  type RiskWorkspace,
} from '@renr/contracts';
import { apiBaseUrl, request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusBadge } from '../ui/status-badge';
import { riskDate, useRiskData } from './useRiskData';

const specialtyLabels: Record<RiskContributionSpecialty, string> = {
  SST: 'SST',
  PSYCHOLOGY_ORGANIZATIONAL: 'Psicologia Organizacional',
};

const visibilityLabels: Record<RiskContributionVisibility, string> = {
  RESTRICTED: 'Reservado à especialidade',
  SHARED: 'Compartilhado',
};

const kindLabels: Record<RiskContributionKind, string> = {
  PSYCHOSOCIAL_ANALYSIS: 'Análise de fatores psicossociais do trabalho',
  WORK_ORGANIZATION_NOTE: 'Observação sobre organização do trabalho',
  PREVENTIVE_RECOMMENDATION: 'Recomendação preventiva coletiva',
  TECHNICAL_FOLLOW_UP: 'Acompanhamento técnico interdisciplinar',
};

const eventLabels: Record<string, string> = {
  CREATED: 'Criada',
  UPDATED: 'Editada',
  SHARED: 'Compartilhada',
  ATTACHMENT_ADDED: 'Anexo adicionado',
  ATTACHMENT_ARCHIVED: 'Anexo arquivado',
  ARCHIVED: 'Arquivada',
};

const defaultDraft = {
  kind: 'PSYCHOSOCIAL_ANALYSIS' as RiskContributionKind,
  visibility: 'RESTRICTED' as RiskContributionVisibility,
  title: '',
  workFactors: '',
  preventiveRecommendations: '',
  nextStep: '',
};

export function RiskCollaborationPanel({
  organizationId,
  risk,
  disabled,
  refreshKey,
  onExpire,
  onUnavailable,
}: {
  organizationId: string;
  risk: RiskWorkspace;
  disabled: boolean;
  refreshKey: number;
  onExpire: () => void;
  onUnavailable: (status: number) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [specialty, setSpecialty] = useState<RiskContributionSpecialty>(
    'PSYCHOLOGY_ORGANIZATIONAL',
  );
  const [draft, setDraft] = useState(defaultDraft);
  const [editing, setEditing] = useState<RiskContribution | null>(null);
  const [editDraft, setEditDraft] = useState({
    kind: 'PSYCHOSOCIAL_ANALYSIS' as RiskContributionKind,
    title: '',
    workFactors: '',
    preventiveRecommendations: '',
    nextStep: '',
    changeReason: '',
  });
  const [sharing, setSharing] = useState<RiskContribution | null>(null);
  const [shareReason, setShareReason] = useState('');
  const [shareAttachments, setShareAttachments] = useState(false);
  const [archiving, setArchiving] = useState<RiskContribution | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [attachmentDescription, setAttachmentDescription] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const busy = useRef(false);
  const controller = useRef(new AbortController());
  const scopeKey = `${organizationId}:${risk.id}`;
  const [trackedScopeKey, setTrackedScopeKey] = useState(scopeKey);
  if (trackedScopeKey !== scopeKey) {
    setTrackedScopeKey(scopeKey);
    setCreating(false);
    setDraft(defaultDraft);
    setEditing(null);
    setSharing(null);
    setShareReason('');
    setShareAttachments(false);
    setArchiving(null);
    setArchiveReason('');
    setAttachingId(null);
    setAttachmentDescription('');
    setAttachmentFile(null);
    setPending(false);
    setFeedback('');
    setError('');
  }

  const basePath = `/organizations/${organizationId}/risks/${risk.id}/technical-contributions`;
  const feed = useRiskData(
    `${basePath}?page=1&pageSize=50&includeArchived=${includeArchived ? 'true' : 'false'}`,
    riskContributionListSchema,
    onExpire,
    refreshKey + attempt,
  );

  useEffect(() => {
    busy.current = false;
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, [organizationId, risk.id]);

  const writesEnabled = feed.data?.writesEnabled ?? false;
  const viewerSpecialties = feed.data?.viewerSpecialties ?? [];
  const activeSpecialty: RiskContributionSpecialty = viewerSpecialties.includes(specialty)
    ? specialty
    : (viewerSpecialties[0] ?? 'PSYCHOLOGY_ORGANIZATIONAL');
  const riskEligible = risk.status !== 'ARCHIVED' && risk.unit.isActive && risk.sector.isActive;
  const canCreate = !disabled && writesEnabled && viewerSpecialties.length > 0 && riskEligible;

  function handleMutationError(failure: unknown, signal: AbortSignal) {
    if (signal.aborted) return;
    if (failure instanceof RequestError && failure.status === 401) {
      onExpire();
      return;
    }
    if (failure instanceof RequestError && [403, 404].includes(failure.status)) {
      if (failure.code === 'COLLABORATION_WRITES_DISABLED') {
        setError(failure.message);
        return;
      }
      if (failure.status === 404) {
        onUnavailable(failure.status);
        return;
      }
    }
    setError(failure instanceof Error ? failure.message : 'Não foi possível concluir a operação.');
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || pending || !canCreate) return;
    const parsed = createRiskContributionSchema.safeParse({
      specialty: activeSpecialty,
      kind: draft.kind,
      visibility: draft.visibility,
      title: draft.title,
      workFactors: draft.workFactors,
      preventiveRecommendations: draft.preventiveRecommendations,
      nextStep: draft.nextStep.trim() ? draft.nextStep : null,
      expectedRiskVersion: risk.version,
    });
    if (!parsed.success) {
      setError('Confira os campos obrigatórios (título, fatores do trabalho e recomendações).');
      return;
    }
    const signal = controller.current.signal;
    busy.current = true;
    setPending(true);
    setError('');
    setFeedback('');
    try {
      await request(basePath, riskContributionSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        signal,
      });
      if (!signal.aborted) {
        setCreating(false);
        setDraft(defaultDraft);
        setFeedback('Contribuição técnica registrada com autoria e versão preservadas.');
        setAttempt((v) => v + 1);
      }
    } catch (failure) {
      handleMutationError(failure, signal);
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || pending || !editing) return;
    const parsed = updateRiskContributionSchema.safeParse({
      expectedVersion: editing.version,
      kind: editDraft.kind,
      title: editDraft.title,
      workFactors: editDraft.workFactors,
      preventiveRecommendations: editDraft.preventiveRecommendations,
      nextStep: editDraft.nextStep.trim() ? editDraft.nextStep : null,
      changeReason: editDraft.changeReason,
    });
    if (!parsed.success) {
      setError('Informe as alterações e um motivo de revisão com pelo menos 10 caracteres.');
      return;
    }
    const signal = controller.current.signal;
    busy.current = true;
    setPending(true);
    setError('');
    setFeedback('');
    try {
      await request(`${basePath}/${editing.id}`, riskContributionSchema, {
        method: 'PATCH',
        body: JSON.stringify(parsed.data),
        signal,
      });
      if (!signal.aborted) {
        setEditing(null);
        setFeedback('Nova versão da contribuição registrada no histórico imutável.');
        setAttempt((v) => v + 1);
      }
    } catch (failure) {
      handleMutationError(failure, signal);
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  async function submitShare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || pending || !sharing) return;
    const parsed = shareRiskContributionSchema.safeParse({
      expectedVersion: sharing.version,
      reason: shareReason,
      shareAttachments,
    });
    if (!parsed.success) {
      setError('Informe o motivo do compartilhamento (mínimo de 10 caracteres).');
      return;
    }
    const signal = controller.current.signal;
    busy.current = true;
    setPending(true);
    setError('');
    setFeedback('');
    try {
      await request(`${basePath}/${sharing.id}/share`, riskContributionSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        signal,
      });
      if (!signal.aborted) {
        setSharing(null);
        setShareReason('');
        setShareAttachments(false);
        setFeedback(
          'Contribuição compartilhada com a equipe técnica. Versões reservadas anteriores continuam protegidas.',
        );
        setAttempt((v) => v + 1);
      }
    } catch (failure) {
      handleMutationError(failure, signal);
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  async function submitArchive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || pending || !archiving) return;
    const parsed = archiveRiskContributionSchema.safeParse({
      expectedVersion: archiving.version,
      reason: archiveReason,
    });
    if (!parsed.success) {
      setError('Informe o motivo do arquivamento (mínimo de 10 caracteres).');
      return;
    }
    const signal = controller.current.signal;
    busy.current = true;
    setPending(true);
    setError('');
    setFeedback('');
    try {
      await request(`${basePath}/${archiving.id}/archive`, riskContributionSchema, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        signal,
      });
      if (!signal.aborted) {
        setArchiving(null);
        setArchiveReason('');
        setFeedback('Contribuição arquivada com histórico preservado.');
        setAttempt((v) => v + 1);
      }
    } catch (failure) {
      handleMutationError(failure, signal);
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  async function submitAttachment(event: FormEvent<HTMLFormElement>, item: RiskContribution) {
    event.preventDefault();
    if (busy.current || pending || !attachmentFile || attachmentDescription.trim().length < 5) {
      if (!busy.current && !pending)
        setError(
          'Selecione um arquivo PDF, PNG ou JPEG e informe uma descrição (mín. 5 caracteres).',
        );
      return;
    }
    const signal = controller.current.signal;
    busy.current = true;
    setPending(true);
    setError('');
    setFeedback('');
    try {
      const formData = new FormData();
      formData.append('expectedVersion', String(item.version));
      formData.append('description', attachmentDescription.trim());
      formData.append('file', attachmentFile);
      const response = await fetch(`${apiBaseUrl}${basePath}/${item.id}/attachments`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
        signal,
      });
      if (!response.ok) {
        let code = '';
        try {
          const body = (await response.json()) as { code?: string };
          code = body.code ?? '';
        } catch {
          // fallback generic status error
        }
        throw new RequestError(response.status, [], code);
      }
      if (!signal.aborted) {
        setAttachingId(null);
        setAttachmentDescription('');
        setAttachmentFile(null);
        setFeedback('Anexo privado vinculado à contribuição técnica.');
        setAttempt((v) => v + 1);
      }
    } catch (failure) {
      handleMutationError(failure, signal);
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }

  async function downloadAttachment(
    contributionId: string,
    attachmentId: string,
    fileName: string,
  ) {
    const signal = controller.current.signal;
    setError('');
    try {
      const response = await fetch(
        `${apiBaseUrl}${basePath}/${contributionId}/attachments/${attachmentId}/download`,
        { credentials: 'include', signal },
      );
      if (signal.aborted) return;
      if (response.status === 401) {
        onExpire();
        return;
      }
      if (!response.ok) throw new RequestError(response.status);
      const blob = await response.blob();
      if (signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      handleMutationError(failure, signal);
    }
  }

  return (
    <section
      id="risk-colaboracao"
      className="surface risk-content-section risk-stack"
      aria-labelledby="risk-collaboration-heading"
      tabIndex={-1}
    >
      <div className="risk-section-heading">
        <div>
          <p className="panel-label">COLABORAÇÃO TÉCNICA · SST × PSICOLOGIA ORGANIZACIONAL</p>
          <h3 id="risk-collaboration-heading">Contribuições interdisciplinares</h3>
        </div>
        <div className="record-actions">
          <label className="risk-source-choice">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            Mostrar arquivadas
          </label>
          {canCreate && !creating && (
            <Button onClick={() => setCreating(true)}>Nova contribuição técnica</Button>
          )}
        </div>
      </div>

      <p className="muted">
        Escopo restrito a fatores psicossociais do trabalho e recomendações preventivas coletivas.
        Não registre prontuários clínicos nem identificação individual. Decisões formais de SST
        permanecem exclusivas da capacidade de Decisões técnicas.
      </p>

      {feed.data && !writesEnabled && (
        <p role="status" className="feedback">
          Gravação de contribuições desabilitada neste ambiente (homologação) até validação final
          das atribuições entre ReTech+, SST e Psicologia Organizacional. Somente registros
          autorizados já existentes são exibidos.
        </p>
      )}

      {feed.data && writesEnabled && viewerSpecialties.length === 0 && (
        <p className="field-hint">
          Seu perfil consulta apenas contribuições compartilhadas autorizadas neste recorte. Para
          registrar contribuições, é necessária a capacidade de Decisões técnicas (SST) ou de
          Colaboração técnica (Psicologia Organizacional) sem restrição de recorte.
        </p>
      )}

      {feed.data && writesEnabled && viewerSpecialties.length > 0 && !riskEligible && (
        <p className="field-hint">
          Risco arquivado ou estrutura inativa: novas contribuições técnicas estão indisponíveis;
          registros anteriores permanecem preservados para leitura.
        </p>
      )}

      {feedback && (
        <p role="status" className="feedback success">
          {feedback}
        </p>
      )}
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}

      {creating && canCreate && (
        <form
          className="surface risk-form risk-stack"
          aria-labelledby="create-contribution-title"
          onSubmit={(event) => void submitCreate(event)}
          noValidate
        >
          <h4 id="create-contribution-title">Registrar contribuição técnica</h4>
          <fieldset disabled={pending} className="risk-fieldset">
            <legend>Classificação e visibilidade</legend>
            {viewerSpecialties.length > 1 ? (
              <div>
                <label htmlFor="contrib-specialty">Especialidade autora</label>
                <select
                  id="contrib-specialty"
                  value={activeSpecialty}
                  onChange={(event) =>
                    setSpecialty(event.target.value as RiskContributionSpecialty)
                  }
                >
                  {viewerSpecialties.map((entry) => (
                    <option key={entry} value={entry}>
                      {specialtyLabels[entry]}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="field-hint">
                Especialidade autora: <strong>{specialtyLabels[activeSpecialty]}</strong>
              </p>
            )}
            <div>
              <label htmlFor="contrib-kind">Tipo de contribuição</label>
              <select
                id="contrib-kind"
                value={draft.kind}
                onChange={(event) =>
                  setDraft({ ...draft, kind: event.target.value as RiskContributionKind })
                }
              >
                {Object.entries(kindLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="contrib-visibility">Visibilidade inicial</label>
              <select
                id="contrib-visibility"
                value={draft.visibility}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    visibility: event.target.value as RiskContributionVisibility,
                  })
                }
              >
                <option value="RESTRICTED">
                  Reservado à especialidade (invisível à outra área e fora do PDF SST)
                </option>
                <option value="SHARED">
                  Compartilhado com a equipe técnica (visível a SST/Psicologia e no PDF SST)
                </option>
              </select>
            </div>
            <div>
              <label htmlFor="contrib-title">Título da contribuição</label>
              <input
                id="contrib-title"
                value={draft.title}
                maxLength={160}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                required
              />
            </div>
            <div>
              <label htmlFor="contrib-work-factors">Fatores psicossociais do trabalho</label>
              <textarea
                id="contrib-work-factors"
                rows={4}
                maxLength={2000}
                value={draft.workFactors}
                onChange={(event) => setDraft({ ...draft, workFactors: event.target.value })}
                required
              />
            </div>
            <div>
              <label htmlFor="contrib-recommendations">Recomendações preventivas coletivas</label>
              <textarea
                id="contrib-recommendations"
                rows={4}
                maxLength={2000}
                value={draft.preventiveRecommendations}
                onChange={(event) =>
                  setDraft({ ...draft, preventiveRecommendations: event.target.value })
                }
                required
              />
            </div>
            <div>
              <label htmlFor="contrib-next-step">Próximo passo sugerido (opcional)</label>
              <input
                id="contrib-next-step"
                maxLength={500}
                value={draft.nextStep}
                onChange={(event) => setDraft({ ...draft, nextStep: event.target.value })}
              />
            </div>
          </fieldset>
          <div className="record-actions">
            <Button type="submit" disabled={pending}>
              {pending ? 'Salvando…' : 'Salvar contribuição'}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setCreating(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {feed.loading && <p role="status">Carregando contribuições técnicas…</p>}
      {feed.error && (
        <div role="alert" className="feedback error">
          <p>{feed.error}</p>
          <Button variant="outline" onClick={() => setAttempt((v) => v + 1)}>
            Atualizar contribuições
          </Button>
        </div>
      )}

      {feed.data && feed.data.items.length === 0 && !creating && (
        <div className="empty-state">
          <h4>Nenhuma contribuição técnica visível neste risco</h4>
          <p className="muted">
            Contribuições reservadas aparecem apenas para a especialidade de origem. Registros
            compartilhados ficam visíveis conforme a matriz de acesso.
          </p>
        </div>
      )}

      {feed.data?.items.map((item) => (
        <article
          key={item.id}
          className="surface evaluation-card collaboration-card"
          aria-label={`Contribuição ${item.title}`}
        >
          <div className="risk-section-heading">
            <div>
              <h4>{item.title}</h4>
              <p className="field-hint">
                <strong>{specialtyLabels[item.specialty]}</strong> · {kindLabels[item.kind]} ·
                versão {item.version}
              </p>
            </div>
            <div className="record-actions">
              <StatusBadge
                className="risk-status"
                label={visibilityLabels[item.visibility]}
                tone={item.visibility === 'SHARED' ? 'info' : 'neutral'}
              />
              {item.status === 'ARCHIVED' && (
                <StatusBadge className="risk-status" label="Arquivada" tone="neutral" />
              )}
            </div>
          </div>

          <div className="risk-reading-block">
            <h5>Fatores do trabalho</h5>
            <p className="risk-long-text">{item.workFactors}</p>
          </div>
          <div className="risk-reading-block">
            <h5>Recomendações preventivas</h5>
            <p className="risk-long-text">{item.preventiveRecommendations}</p>
          </div>
          {item.nextStep && (
            <div className="risk-reading-block">
              <h5>Próximo passo</h5>
              <p className="risk-long-text">{item.nextStep}</p>
            </div>
          )}

          <p className="field-hint">
            Autoria: {item.author.name} ·{' '}
            <time dateTime={item.createdAt}>{riskDate(item.createdAt)}</time>
            {item.sharedAt && item.sharedBy
              ? ` · Compartilhada por ${item.sharedBy.name} em ${riskDate(item.sharedAt)}`
              : ''}
          </p>

          <div className="record-actions">
            {item.permissions.canEdit && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setEditing(item);
                  setEditDraft({
                    kind: item.kind,
                    title: item.title,
                    workFactors: item.workFactors,
                    preventiveRecommendations: item.preventiveRecommendations,
                    nextStep: item.nextStep ?? '',
                    changeReason: '',
                  });
                }}
              >
                Editar versão
              </Button>
            )}
            {item.permissions.canShare && (
              <Button
                disabled={pending}
                onClick={() => {
                  setSharing(item);
                  setShareReason('');
                  setShareAttachments(false);
                }}
              >
                Compartilhar com equipe técnica
              </Button>
            )}
            {item.permissions.canAttach && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setAttachingId(attachingId === item.id ? null : item.id)}
              >
                Anexar documento
              </Button>
            )}
            {item.permissions.canArchive && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setArchiving(item);
                  setArchiveReason('');
                }}
              >
                Arquivar
              </Button>
            )}
          </div>

          {item.permissions.unavailableReason && (
            <p className="field-hint">{item.permissions.unavailableReason}</p>
          )}

          {editing?.id === item.id && (
            <form
              className="risk-form risk-stack"
              aria-label="Editar contribuição"
              onSubmit={(event) => void submitEdit(event)}
              noValidate
            >
              <label htmlFor={`edit-title-${item.id}`}>Título</label>
              <input
                id={`edit-title-${item.id}`}
                value={editDraft.title}
                onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })}
              />
              <label htmlFor={`edit-factors-${item.id}`}>Fatores do trabalho</label>
              <textarea
                id={`edit-factors-${item.id}`}
                rows={3}
                value={editDraft.workFactors}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, workFactors: event.target.value })
                }
              />
              <label htmlFor={`edit-recs-${item.id}`}>Recomendações preventivas</label>
              <textarea
                id={`edit-recs-${item.id}`}
                rows={3}
                value={editDraft.preventiveRecommendations}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, preventiveRecommendations: event.target.value })
                }
              />
              <label htmlFor={`edit-reason-${item.id}`}>Motivo da revisão</label>
              <textarea
                id={`edit-reason-${item.id}`}
                rows={2}
                value={editDraft.changeReason}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, changeReason: event.target.value })
                }
              />
              <div className="record-actions">
                <Button type="submit" disabled={pending}>
                  Salvar revisão
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}

          {sharing?.id === item.id && (
            <form
              className="risk-form risk-stack"
              aria-label="Confirmar compartilhamento"
              onSubmit={(event) => void submitShare(event)}
              noValidate
            >
              <p className="field-hint">
                Ao compartilhar, o conteúdo atual passa a ser visível para SST e perfis autorizados
                neste recorte e entra no relatório PDF SST. Revisões reservadas anteriores continuam
                restritas à sua especialidade. Esta transição não pode ser revertida para reservado.
              </p>
              <label htmlFor={`share-reason-${item.id}`}>Justificativa do compartilhamento</label>
              <textarea
                id={`share-reason-${item.id}`}
                rows={2}
                value={shareReason}
                onChange={(event) => setShareReason(event.target.value)}
              />
              {item.attachments.some((a) => a.visibility === 'RESTRICTED' && !a.archivedAt) && (
                <label className="risk-source-choice">
                  <input
                    type="checkbox"
                    checked={shareAttachments}
                    onChange={(event) => setShareAttachments(event.target.checked)}
                  />
                  Incluir anexos reservados ativos neste compartilhamento
                </label>
              )}
              <div className="record-actions">
                <Button type="submit" disabled={pending}>
                  Confirmar compartilhamento
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setSharing(null)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}

          {archiving?.id === item.id && (
            <form
              className="risk-form risk-stack"
              aria-label="Arquivar contribuição"
              onSubmit={(event) => void submitArchive(event)}
              noValidate
            >
              <label htmlFor={`archive-reason-${item.id}`}>Motivo do arquivamento</label>
              <textarea
                id={`archive-reason-${item.id}`}
                rows={2}
                value={archiveReason}
                onChange={(event) => setArchiveReason(event.target.value)}
              />
              <div className="record-actions">
                <Button type="submit" disabled={pending}>
                  Confirmar arquivamento
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setArchiving(null)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}

          {attachingId === item.id && (
            <form
              className="risk-form risk-stack"
              aria-label="Anexar documento à contribuição"
              onSubmit={(event) => void submitAttachment(event, item)}
              noValidate
            >
              <label htmlFor={`att-desc-${item.id}`}>Descrição do anexo</label>
              <input
                id={`att-desc-${item.id}`}
                maxLength={1000}
                value={attachmentDescription}
                onChange={(event) => setAttachmentDescription(event.target.value)}
              />
              <label htmlFor={`att-file-${item.id}`}>
                Arquivo privado (PDF, PNG ou JPEG até 5 MiB)
              </label>
              <input
                id={`att-file-${item.id}`}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                onChange={(event) => setAttachmentFile(event.target.files?.[0] ?? null)}
              />
              <div className="record-actions">
                <Button type="submit" disabled={pending}>
                  Enviar anexo
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setAttachingId(null)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}

          {item.attachments.length > 0 && (
            <details>
              <summary>Anexos privados ({item.attachments.length})</summary>
              <ul className="risk-timeline">
                {item.attachments.map((att) => (
                  <li key={att.id}>
                    <strong>{att.fileName}</strong> · {visibilityLabels[att.visibility]} ·{' '}
                    {att.description}
                    <div className="record-actions">
                      <Button
                        variant="outline"
                        onClick={() => void downloadAttachment(item.id, att.id, att.fileName)}
                      >
                        Baixar anexo
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <details>
            <summary>Histórico de versões ({item.revisions.length})</summary>
            <ol className="risk-timeline">
              {item.revisions.map((rev) => (
                <li key={rev.id}>
                  <strong>
                    Versão {rev.version} · {eventLabels[rev.event] ?? rev.event} ·{' '}
                    {visibilityLabels[rev.visibility]}
                  </strong>
                  <p className="field-hint">
                    {rev.author.name} ·{' '}
                    <time dateTime={rev.createdAt}>{riskDate(rev.createdAt)}</time>
                  </p>
                  {rev.changeReason && <p>{rev.changeReason}</p>}
                </li>
              ))}
            </ol>
          </details>
        </article>
      ))}
    </section>
  );
}
