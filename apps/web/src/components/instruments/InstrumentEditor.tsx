import { useEffect, useRef, useState } from 'react';
import {
  instrumentVersionSchema,
  instrumentPublicationIssues,
  updateInstrumentDraftSchema,
  type InstrumentVersion,
  type UpdateInstrumentDraft,
} from '@renr/contracts';
import { request, RequestError } from '../../lib/api';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { StatusBadge } from '../ui/status-badge';
import { InstrumentQuestions } from './InstrumentQuestions';
import { InstrumentPreview } from './InstrumentPreview';

type Draft = Omit<UpdateInstrumentDraft, 'expectedRevision'>;
type Issue = { field: string; message: string };
const content = (version: InstrumentVersion): Draft => ({
  title: version.title,
  description: version.description,
  instructions: version.instructions,
  usageMode: version.usageMode,
  questions: version.questions,
});
export function InstrumentEditor({
  initialVersion,
  organizationId,
  canEdit,
  canPublishReal,
  onExpire,
  onSaved,
  onFork,
}: {
  initialVersion: InstrumentVersion;
  organizationId: string;
  canEdit: boolean;
  canPublishReal: boolean;
  onExpire: () => void;
  onSaved: () => void;
  onFork: (versionId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState(initialVersion);
  const [draft, setDraft] = useState<Draft>(() => content(initialVersion));
  const [revision, setRevision] = useState(initialVersion.revision);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [approval, setApproval] = useState('');
  const busy = useRef(false);
  const controller = useRef(new AbortController());
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  const published = snapshot.status === 'PUBLISHED';
  const editing = canEdit && !published;
  const issues = [...(showIssues ? instrumentPublicationIssues(draft) : []), ...serverIssues];
  const fieldIssue = (field: string) => issues.find((issue) => issue.field === field);
  const approvalInvalid = showIssues && draft.usageMode === 'REAL' && !approval.trim();
  const base = `/organizations/${organizationId}/instruments/${snapshot.instrumentId}/versions/${snapshot.id}`;
  function change(value: Partial<Draft>) {
    setDraft((previous) => ({ ...previous, ...value }));
    setDirty(true);
    setServerIssues([]);
    setNotice('');
  }
  function accept(version: InstrumentVersion) {
    if (
      version.id !== snapshot.id ||
      version.instrumentId !== snapshot.instrumentId ||
      version.organizationId !== organizationId
    )
      throw new RequestError(502);
    setSnapshot(version);
    setRevision(version.revision);
    setDraft(content(version));
    setDirty(false);
    onSaved();
    return version;
  }
  async function persist() {
    const body = updateInstrumentDraftSchema.parse({ ...draft, expectedRevision: revision });
    return accept(
      await request(base, instrumentVersionSchema, {
        method: 'PUT',
        body: JSON.stringify(body),
        signal: controller.current.signal,
      }),
    );
  }
  function failure(value: unknown) {
    if (controller.current.signal.aborted) return;
    if (value instanceof RequestError && value.status === 401) {
      onExpire();
      return;
    }
    setError(
      value instanceof RequestError && value.status === 409
        ? 'Revisão desatualizada ou versão publicada. Seu rascunho foi mantido. Volte às versões e reabra o registro atualizado antes de reenviar.'
        : value instanceof RequestError && value.status === 413
          ? 'O instrumento excede o limite do documento. Revise o tamanho dos campos antes de salvar.'
          : value instanceof Error
            ? value.message
            : 'Não foi possível concluir. Seu rascunho foi mantido.',
    );
    if (value instanceof RequestError) setServerIssues(value.fields);
  }
  async function save() {
    if (busy.current || !editing) return;
    busy.current = true;
    setPending(true);
    setError('');
    setNotice('');
    setServerIssues([]);
    try {
      await persist();
      if (!controller.current.signal.aborted)
        setNotice('Rascunho salvo. A versão ainda não foi publicada.');
    } catch (value) {
      failure(value);
    } finally {
      busy.current = false;
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  async function publish() {
    if (busy.current || published) return;
    setShowIssues(true);
    setServerIssues([]);
    setError('');
    setNotice('');
    const invalid = instrumentPublicationIssues(draft);
    if (invalid.length || (draft.usageMode === 'REAL' && !approval.trim())) {
      setError('Confira os campos destacados antes de publicar.');
      requestAnimationFrame(() =>
        editor.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus(),
      );
      return;
    }
    if (draft.usageMode === 'REAL' ? !canPublishReal : !canEdit) return;
    busy.current = true;
    setPending(true);
    try {
      const saved = dirty && canEdit ? await persist() : snapshot;
      const result = await request(`${base}/publish`, instrumentVersionSchema, {
        method: 'POST',
        body: JSON.stringify({
          expectedRevision: saved.revision,
          ...(draft.usageMode === 'REAL' ? { approvalReference: approval.trim() } : {}),
        }),
        signal: controller.current.signal,
      });
      if (!controller.current.signal.aborted) {
        accept(result);
        setNotice('Versão publicada. O conteúdo agora é somente leitura.');
        setShowIssues(false);
      }
    } catch (value) {
      failure(value);
    } finally {
      busy.current = false;
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  async function fork() {
    if (busy.current || !published || !canEdit) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const result = await request(`${base}/fork`, instrumentVersionSchema, {
        method: 'POST',
        body: JSON.stringify({ expectedRevision: revision }),
        signal: controller.current.signal,
      });
      if (
        result.organizationId !== organizationId ||
        result.instrumentId !== snapshot.instrumentId ||
        result.id === snapshot.id
      )
        throw new RequestError(502);
      if (!controller.current.signal.aborted) onFork(result.id);
    } catch (value) {
      failure(value);
    } finally {
      busy.current = false;
      if (!controller.current.signal.aborted) setPending(false);
    }
  }
  const canPublish = draft.usageMode === 'REAL' ? canPublishReal : canEdit;
  return (
    <div ref={editor} className="instrument-editor-workspace">
      <section className="surface instrument-version-heading">
        <div className="instrument-toolbar">
          <h2>Versão {snapshot.version}</h2>
          <StatusBadge
            tone={published ? 'info' : 'neutral'}
            label={published ? 'Publicada · somente leitura' : 'Rascunho'}
          />
        </div>
        <p>
          {Math.max(snapshot.cycleCount, initialVersion.cycleCount)} ciclos associados a esta
          versão. Alterar um rascunho ou criar outra versão não modifica os ciclos existentes.
        </p>
        <p>
          {draft.usageMode === 'DEMONSTRATION'
            ? 'Demonstração, sem aprovação para uso real.'
            : published
              ? 'Uso real: referência de aprovação registrada.'
              : 'Uso real: aprovação técnica pendente.'}
        </p>
        {snapshot.approvalReference && (
          <p className="instrument-approval-record">
            Referência de aprovação: {snapshot.approvalReference}
          </p>
        )}
        {canEdit && published && (
          <Button disabled={pending} onClick={() => void fork()}>
            {pending ? 'Preparando…' : 'Criar nova versão'}
          </Button>
        )}
      </section>
      {error && <StatusMessage tone="error">{error}</StatusMessage>}
      {notice && <StatusMessage tone="success">{notice}</StatusMessage>}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="instrument-editor-layout">
        <div className="instrument-builder">
          <form
            className="surface instrument-metadata"
            aria-label="Editar instrumento"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <h3>Conteúdo da versão</h3>
            <p className="input-hint">
              {published
                ? 'Para mudar o conteúdo, crie uma nova versão.'
                : 'Você pode salvar um rascunho incompleto e continuar depois.'}
            </p>
            <fieldset disabled={!editing || pending}>
              <legend className="sr-only">Metadados do instrumento</legend>
              <label htmlFor="instrument-title">Título da versão</label>
              <input
                id="instrument-title"
                maxLength={160}
                value={draft.title}
                aria-invalid={!!fieldIssue('title')}
                aria-describedby={fieldIssue('title') ? 'instrument-title-error' : undefined}
                onChange={(event) => change({ title: event.target.value })}
              />
              {fieldIssue('title') && (
                <p id="instrument-title-error" className="field-error">
                  {fieldIssue('title')?.message}
                </p>
              )}
              <label htmlFor="instrument-description">Descrição da versão</label>
              <textarea
                id="instrument-description"
                maxLength={2000}
                rows={3}
                value={draft.description}
                onChange={(event) => change({ description: event.target.value })}
              />
              <label htmlFor="instrument-instructions">Instruções ao participante</label>
              <textarea
                id="instrument-instructions"
                maxLength={4000}
                rows={3}
                value={draft.instructions}
                onChange={(event) => change({ instructions: event.target.value })}
              />
              <label htmlFor="instrument-usage">Finalidade prevista</label>
              <select
                id="instrument-usage"
                value={draft.usageMode}
                onChange={(event) =>
                  change({ usageMode: event.target.value as Draft['usageMode'] })
                }
              >
                <option value="DEMONSTRATION">Demonstração — dados fictícios</option>
                <option value="REAL">Uso real — exige aprovação técnica</option>
              </select>
            </fieldset>
            <InstrumentQuestions
              questions={draft.questions}
              onChange={(questions) => change({ questions })}
              issues={issues}
              disabled={!editing || pending}
              announce={setAnnouncement}
            />
            {editing && (
              <div className="form-actions">
                <Button type="submit" disabled={pending}>
                  {pending ? 'Salvando…' : 'Salvar rascunho'}
                </Button>
                <span className="input-hint">
                  {dirty
                    ? 'Alterações ainda não salvas.'
                    : 'Rascunho sincronizado com a versão carregada.'}
                </span>
              </div>
            )}
          </form>
          {!published && (
            <section
              className="surface instrument-publication"
              aria-labelledby="instrument-publication-heading"
            >
              <h3 id="instrument-publication-heading">Publicação</h3>
              <p>
                Confirme o conteúdo na prévia. Depois de publicar, as alterações serão feitas em uma
                nova versão.
              </p>
              {draft.usageMode === 'REAL' && (
                <>
                  <label htmlFor="instrument-approval">Referência de aprovação</label>
                  <textarea
                    id="instrument-approval"
                    maxLength={1000}
                    rows={3}
                    value={approval}
                    disabled={pending || !canPublishReal}
                    aria-invalid={approvalInvalid}
                    aria-describedby={
                      approvalInvalid ? 'instrument-approval-error' : 'instrument-approval-help'
                    }
                    onChange={(event) => setApproval(event.target.value)}
                  />
                  <p id="instrument-approval-help" className="input-hint">
                    Informe a referência do documento de aprovação. Somente uma pessoa com permissão
                    técnica pode publicar para uso real.
                  </p>
                  {approvalInvalid && (
                    <p id="instrument-approval-error" className="field-error">
                      Informe a referência de aprovação para publicar para uso real.
                    </p>
                  )}
                </>
              )}
              {!canPublish && (
                <p className="input-hint">
                  {draft.usageMode === 'REAL'
                    ? 'Sua conta não tem a permissão técnica necessária para esta publicação.'
                    : 'Somente administradores podem publicar versões demonstrativas.'}
                </p>
              )}
              <Button disabled={pending || !canPublish} onClick={() => void publish()}>
                {pending ? 'Publicando…' : 'Publicar versão'}
              </Button>
            </section>
          )}
        </div>
        <InstrumentPreview draft={draft} />
      </div>
    </div>
  );
}
