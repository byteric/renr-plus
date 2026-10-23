import { useState } from 'react';
import type { SessionResponse } from '@renr/contracts';
import { Button } from './ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from './ui/sheet';
export function WorkspaceNavigation({
  session,
  route,
  unitId,
  pending,
  onSelect,
}: {
  session: SessionResponse;
  route: string;
  unitId: string | null;
  pending: boolean;
  onSelect: (id: string) => void;
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
          ['diagnostico', 'Diagnóstico'],
          ['inventario', 'Inventário'],
          ['acoes', 'Ações'],
          ...(unitId ? [[`setores/${unitId}`, 'Setores']] : []),
        ].map(([path, label]) => (
          <a
            key={path}
            href={`#/${path}`}
            aria-current={route === path?.split('/')[0] ? 'page' : undefined}
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
      </div>
    </aside>
  );
}
