import { useId, useState } from 'react';
import type { SessionResponse, Capability, PlatformCapability } from '@renr/contracts';
import { Button } from './ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from './ui/sheet';
import './workspace-navigation.css';

function destinationPage(path: string) {
  return path === 'plataforma/relatorios' ? 'platform-reports' : path.split('/')[0];
}

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
  const [desktopGroup, setDesktopGroup] = useState<{ route: string; label: string | null }>({
    route,
    label: null,
  });
  if (desktopGroup.route !== route) setDesktopGroup({ route, label: null });
  const desktopGroupId = useId();
  const membership = session.memberships.find(
    (value) => value.organizationId === session.activeOrganizationId,
  );
  const groups: { label: string; destinations: (readonly [string, string])[] }[] = [
    {
      label: 'Cadastros',
      destinations: [
        ['empresas', 'Empresas'],
        ['unidades', 'Unidades'],
        ...(unitId ? ([[`setores/${unitId}`, 'Setores']] as const) : []),
        ...(membership?.role === 'ADMIN'
          ? ([
              ['colaboradores', 'Colaboradores'],
              ['grupos', 'Grupos de avaliação'],
            ] as const)
          : []),
      ],
    },
    {
      label: 'Avaliação e prevenção',
      destinations: [
        ['instrumentos', 'Instrumentos'],
        ['coletas', 'Coletas'],
        ['diagnostico', 'Diagnóstico demonstrativo'],
        ['inventario', 'Inventário'],
        ['acoes', 'Ações'],
      ],
    },
    {
      label: 'Gestão',
      destinations: [
        ...(capabilities.some((cap) => cap.startsWith('HR_'))
          ? ([['pessoas', 'Gestão de Pessoas']] as const)
          : []),
        ...(membership ? ([['relatorios', 'Relatórios']] as const) : []),
        ...(membership?.role === 'ADMIN'
          ? ([
              ['acessos', 'Acessos'],
              ['auditoria', 'Auditoria'],
            ] as const)
          : []),
      ],
    },
    {
      label: 'Plataforma',
      destinations: [
        ...(platformCapabilities.length
          ? ([['plataforma', 'Administração da plataforma']] as const)
          : []),
        ...(platformCapabilities.includes('READ_OVERVIEW')
          ? ([['plataforma/relatorios', 'Relatórios da plataforma']] as const)
          : []),
      ],
    },
  ];
  function links(close = false) {
    function destination([path, label]: readonly [string, string]) {
      return (
        <a
          key={path}
          href={`#/${path}`}
          aria-current={route === destinationPage(path) ? 'page' : undefined}
          onClick={close ? () => setOpen(false) : () => setDesktopGroup({ route, label: null })}
        >
          {label}
        </a>
      );
    }
    return (
      <nav aria-label={close ? 'Navegação móvel' : 'Estrutura organizacional'}>
        {destination(['painel', 'Painel'])}
        {groups.map(({ label, destinations }, index) => {
          if (destinations.length === 0) return null;
          const active = destinations.some(([path]) => destinationPage(path) === route);
          const expanded = active || desktopGroup.label === label;
          const id = `${desktopGroupId}-${index}`;
          return (
            <div key={label} className="workspace-nav-group" role="group" aria-label={label}>
              {close ? (
                <p className="panel-label" aria-hidden="true">
                  {label}
                </p>
              ) : (
                <button
                  type="button"
                  className="workspace-group-toggle"
                  aria-controls={id}
                  aria-expanded={expanded}
                  aria-disabled={active || undefined}
                  onClick={() => {
                    if (!active) setDesktopGroup({ route, label: expanded ? null : label });
                  }}
                >
                  {label}
                </button>
              )}
              {close ? (
                destinations.map(destination)
              ) : (
                <div id={id} className="workspace-group-links" hidden={!expanded}>
                  {destinations.map(destination)}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    );
  }
  return (
    <aside className="workspace-nav">
      <p className="panel-label">ESPAÇO DE TRABALHO</p>
      <p className="user-name">{session.user.name}</p>
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
    </aside>
  );
}
