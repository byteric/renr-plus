import { useState } from 'react';
import type { SessionResponse, Capability, PlatformCapability } from '@renr/contracts';
import { Button } from './ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from './ui/sheet';
export function WorkspaceNavigation({
  session,
  route,
  unitId,
  pending,
  onSelect,
  capabilities = [],
  platformCapabilities = [],
}: {
  session: SessionResponse;
  route: string;
  unitId: string | null;
  pending: boolean;
  onSelect: (id: string) => void;
  capabilities?: Capability[];
  platformCapabilities?: PlatformCapability[];
}) {
  const [open, setOpen] = useState(false);
  const membership = session.memberships.find(
    (value) => value.organizationId === session.activeOrganizationId,
  );
  function links(close = false) {
    return (
      <nav aria-label={close ? 'Navegação móvel' : 'Estrutura organizacional'}>
        {[
          ['painel', 'Painel'],
          ['empresas', 'Empresas'],
          ['unidades', 'Unidades'],
          ...(unitId ? [[`setores/${unitId}`, 'Setores']] : []),
          ...(membership?.role === 'ADMIN'
            ? [
                ['colaboradores', 'Colaboradores'],
                ['grupos', 'Grupos de avaliação'],
              ]
            : []),
          ['instrumentos', 'Instrumentos'],
          ['coletas', 'Coletas'],
          ['diagnostico', 'Diagnóstico'],
          ['inventario', 'Inventário'],
          ['acoes', 'Ações'],
          ...(capabilities.some((cap) => cap.startsWith('HR_'))
            ? [['pessoas', 'Gestão de Pessoas']]
            : []),
          ...(membership ? [['relatorios', 'Relatórios']] : []),
          ...(membership?.role === 'ADMIN'
            ? [
                ['acessos', 'Acessos'],
                ['auditoria', 'Auditoria'],
              ]
            : []),
          ...(platformCapabilities.length ? [['plataforma', 'Administração da plataforma']] : []),
          ...(platformCapabilities.includes('READ_OVERVIEW')
            ? [['plataforma/relatorios', 'Relatórios da plataforma']]
            : []),
        ].map(([path, label]) => (
          <a
            key={path}
            href={`#/${path}`}
            aria-current={
              route ===
              (path === 'plataforma/relatorios' ? 'platform-reports' : path?.split('/')[0])
                ? 'page'
                : undefined
            }
            onClick={() => close && setOpen(false)}
          >
            {label}
          </a>
        ))}
      </nav>
    );
  }
  return (
    <aside className="workspace-nav">
      <p className="panel-label">ESPAÇO DE TRABALHO</p>
      <p className="user-name">{session.user.name}</p>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" className="mobile-nav-trigger">
            Abrir navegação
          </Button>
        </SheetTrigger>
        <SheetContent>
          <SheetTitle>Navegação</SheetTitle>
          <SheetDescription>Escolha a próxima etapa do seu trabalho.</SheetDescription>
          {links(true)}
        </SheetContent>
      </Sheet>
      <div className="desktop-navigation">{links()}</div>
      <div className="context">
        {route === 'plataforma' || route === 'platform-reports' ? (
          <p className="feedback">Escopo global da plataforma</p>
        ) : (
          <>
            <label htmlFor="organization-context">Empresa ativa</label>
            <select
              id="organization-context"
              value={session.activeOrganizationId ?? ''}
              disabled={pending}
              onChange={(event) => onSelect(event.target.value)}
            >
              <option value="" disabled>
                Selecione uma empresa
              </option>
              {session.memberships.map((value) => (
                <option key={value.organizationId} value={value.organizationId}>
                  {value.organizationName}
                </option>
              ))}
            </select>
            {membership && (
              <span>{membership.role === 'ADMIN' ? 'Administrador' : 'Somente leitura'}</span>
            )}
            {pending && <p role="status">Atualizando contexto…</p>}
          </>
        )}
      </div>
    </aside>
  );
}
