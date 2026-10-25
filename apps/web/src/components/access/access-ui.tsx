import type { Capability } from '@renr/contracts';
import { useEffect, useRef } from 'react';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { capabilityLabels } from './access-labels';

export function CapabilityFields({
  value,
  onChange,
  disabled = false,
}: {
  value: Capability[];
  onChange: (value: Capability[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="access-capabilities">
      <legend>Capacidades explícitas</legend>
      <p className="muted">
        Administrar não concede decisões técnicas. Executar uma ação exige também atribuição ao
        usuário.
      </p>
      {(Object.keys(capabilityLabels) as Capability[]).map((capability) => (
        <label key={capability} className="access-check">
          <input
            type="checkbox"
            checked={value.includes(capability)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, capability]
                  : value.filter((item) => item !== capability),
              )
            }
          />
          {capabilityLabels[capability]}
        </label>
      ))}
      <p className="muted">
        A atribuição de ações será integrada no ID 13. Esta concessão não libera escrita global nem
        parecer técnico automático.
      </p>
    </fieldset>
  );
}
export function AccessSecret({ token, onClose }: { token: string; onClose: () => void }) {
  const link = `${window.location.origin}${window.location.pathname}#/ativar/${token}`;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <StatusMessage tone="warning">
      <h3>Entregue este link somente à pessoa convidada</h3>
      <p>
        Exibição única. O convite não é enviado por e-mail. Ao fechar, o segredo não poderá ser
        consultado novamente; será necessário reemitir.
      </p>
      <label htmlFor="activation-secret">Link de ativação — exibição única</label>
      <input
        ref={input}
        id="activation-secret"
        type="text"
        readOnly
        value={link}
        autoComplete="off"
        spellCheck={false}
        onFocus={(event) => event.target.select()}
      />
      <p className="muted">Copie o campo selecionado e compartilhe em canal privado.</p>
      <Button variant="outline" onClick={onClose}>
        Fechar link secreto
      </Button>
    </StatusMessage>
  );
}
