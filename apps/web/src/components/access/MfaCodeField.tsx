import { useEffect, useId, useRef } from 'react';
import type { MfaProof } from '@renr/contracts';
import { Button } from '../ui/button';

export function MfaCodeField({
  code,
  method,
  onChange,
  onSwitch,
  disabled,
}: {
  code: string;
  method: MfaProof['method'];
  onChange: (code: string) => void;
  onSwitch?: () => void;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const previousMethod = useRef(method);
  const isRecovery = method === 'recovery';
  useEffect(() => {
    if (previousMethod.current !== method) input.current?.focus();
    previousMethod.current = method;
  }, [method]);
  return (
    <>
      <label htmlFor={id}>{isRecovery ? 'Código de recuperação' : 'Código do autenticador'}</label>
      <input
        id={id}
        ref={input}
        type="text"
        inputMode={isRecovery ? 'text' : 'numeric'}
        autoComplete={isRecovery ? 'off' : 'one-time-code'}
        autoCapitalize={isRecovery ? 'characters' : 'off'}
        spellCheck={false}
        maxLength={isRecovery ? 19 : 6}
        aria-describedby={`${id}-help`}
        value={code}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required
      />
      <small id={`${id}-help`} className="muted">
        {isRecovery
          ? 'Informe um código guardado no formato XXXX-XXXX-XXXX-XXXX.'
          : 'Informe os 6 dígitos exibidos no aplicativo.'}
      </small>
      {onSwitch && (
        <Button variant="outline" className="mfa-method" onClick={onSwitch} disabled={disabled}>
          {isRecovery ? 'Usar código do autenticador' : 'Usar código de recuperação'}
        </Button>
      )}
    </>
  );
}
