import { useId, useState } from 'react';
import type { SessionResponse, Capability, PlatformCapability } from '@renr/contracts';
import { Button } from './ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from './ui/sheet';
import { hasPeopleAccess } from '../lib/people-permissions';
import {
  hasCommercialAccess,
  hasPlatformAdministration,
  hasSupportAccess,
} from '../lib/commercial-permissions';
import './workspace-navigation.css';

function destinationPage(path: string) {
  if (path === 'plataforma/relatorios') return 'platform-reports';
  if (path === 'plataforma/grupos') return 'platform-groups';
  if (path === 'plataforma/comercial') return 'platform-commercial';
  if (path === 'plataforma/chamados') return 'platform-support';
  if (path === 'plataforma/recuperacao') return 'platform-recovery';
  return path.split('/')[0];
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
  const isPlatformRoute =
    route === 'plataforma' ||
    route === 'platform-reports' ||
    route === 'platform-groups' ||
    route === 'platform-support' ||
    route === 'platform-recovery' ||
    route === 'platform-commercial';
  const canReadCommercial = hasCommercialAccess(platformCapabilities);
  const canOpenAdministration = hasPlatformAdministration(platformCapabilities);
  const canManageRecovery =
    platformCapabilities.includes('MANAGE_PASSWORD_RECOVERY') ||
    platformCapabilities.includes('RECOVER_ACCOUNT_MFA');
  const isGroupRoute = route === 'consolidado';
  const isCompanyRoute = !isPlatformRoute && !isGroupRoute;
  const delegated = session.activeOrganizationId
    ? session.organizationScopes?.[session.activeOrganizationId]
    : undefined;
  const canManageCompany = membership?.role === 'ADMIN' && delegated === undefined;
  const scopeLabel =
    platformCapabilities.includes('MANAGE_CLIENTS') ||
    platformCapabilities.includes('MANAGE_GRANTS')
      ? 'Administração Global'
      : 'Consulta Global';
  const groups: { label: string; destinations: (readonly [string, string])[] }[] = [
    {
      label: 'Cadastros',
      destinations: [
        ['empresas', 'Empresas'],
        ['unidades', 'Unidades'],
        ...(unitId ? ([[`setores/${unitId}`, 'Setores']] as const) : []),
        ...(canManageCompany
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
        ...(delegated === undefined
          ? ([
              ['instrumentos', 'Instrumentos'],
              ['diagnostico', 'Diagnóstico demonstrativo'],
            ] as const)
          : []),
        ['coletas', 'Coletas'],
        ['inventario', 'Inventário'],
        ['acoes', 'Ações'],
      ],
    },
    {
      label: 'Gestão',
      destinations: [
        ...(delegated === undefined && hasPeopleAccess(capabilities)
          ? ([['pessoas', 'Gestão de Pessoas']] as const)
          : []),
        ...(membership ? ([['relatorios', 'Relatórios']] as const) : []),
        ...(canManageCompany
          ? ([
              ['acessos', 'Acessos'],
              ['auditoria', 'Auditoria'],
              ['chamados', 'Chamados'],
            ] as const)
          : []),
      ],
    },
    {
      label: 'Plataforma',
      destinations: [
        ...(canOpenAdministration
          ? ([['plataforma', 'Administração da plataforma']] as const)
          : []),
        ...(platformCapabilities.includes('READ_OVERVIEW')
          ? ([['plataforma/relatorios', 'Relatórios da plataforma']] as const)
          : []),
        ...(platformCapabilities.includes('MANAGE_CLIENTS') ||
        platformCapabilities.includes('MANAGE_GRANTS')
          ? ([['plataforma/grupos', 'Gerenciar grupos de empresas']] as const)
          : []),
        ...(canReadCommercial ? ([['plataforma/comercial', 'Comercial']] as const) : []),
        ...(hasSupportAccess(platformCapabilities)
          ? ([['plataforma/chamados', 'Atendimento de chamados']] as const)
          : []),
        ...(canManageRecovery
          ? ([['plataforma/recuperacao', 'Recuperação de acesso']] as const)
          : []),
      ],
    },
  ];
  function links(close = false) {
    function destination([path, label]: readonly [string, string], contextSwitch = false) {
      return (
        <a
          key={path}
          className={contextSwitch ? 'workspace-context-switch' : undefined}
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
        {isCompanyRoute && destination(['painel', 'Painel'])}
        {!isCompanyRoute &&
          session.memberships.length > 0 &&
          destination(['painel', 'Voltar à empresa ativa'], true)}
        {!isPlatformRoute &&
          (canReadCommercial || canOpenAdministration || canManageRecovery) &&
          destination(
            [
              canOpenAdministration
                ? 'plataforma'
                : canReadCommercial
                  ? 'plataforma/comercial'
                  : 'plataforma/recuperacao',
              'Abrir Plataforma',
            ],
            true,
          )}
        {session.hasCompanyGroups && destination(['consolidado', 'Consolidado de empresas'], true)}
        {groups.map(({ label, destinations }, index) => {
          if (
            destinations.length === 0 ||
            (!isCompanyRoute && label !== 'Plataforma') ||
            isGroupRoute
          )
            return null;
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
                destinations.map((item) => destination(item))
              ) : (
                <div id={id} className="workspace-group-links" hidden={!expanded}>
                  {destinations.map((item) => destination(item))}
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
        {isPlatformRoute ? (
          <div>
            <p className="panel-label">
              {route === 'platform-commercial'
                ? 'Acesso Comercial'
                : route === 'platform-recovery'
                  ? 'Recuperação assistida'
                  : scopeLabel}
            </p>
            <p>
              {route === 'platform-commercial'
                ? 'Área comercial da plataforma'
                : 'Escopo global da plataforma'}
            </p>
          </div>
        ) : isGroupRoute ? (
          <div>
            <p className="panel-label">Consulta de grupo</p>
          </div>
        ) : (
          session.memberships.length > 0 && (
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
                <span>
                  {delegated
                    ? 'Acesso por unidade ou setor'
                    : membership.role === 'ADMIN'
                      ? 'Administrador'
                      : 'Somente leitura'}
                </span>
              )}
              {pending && <p role="status">Atualizando contexto…</p>}
            </>
          )
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
