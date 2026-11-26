import * as Dialog from '@radix-ui/react-dialog';
import { Button } from './button';
import './contextual-help.css';

export function ContextualHelp({
  screen,
  purpose,
  nextStep,
  prerequisites,
}: {
  screen: string;
  purpose: string;
  nextStep: string;
  prerequisites: string;
}) {
  const title = 'Ajuda sobre ' + screen;
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button variant="outline" className="contextual-help-trigger" aria-label={title}>
          <span aria-hidden="true">?</span>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="contextual-help-overlay" />
        <Dialog.Content className="contextual-help-dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>{purpose}</Dialog.Description>
          <dl>
            <div>
              <dt>Próximo passo</dt>
              <dd>{nextStep}</dd>
            </div>
            <div>
              <dt>Pré-requisitos</dt>
              <dd>{prerequisites}</dd>
            </div>
          </dl>
          <Dialog.Close asChild>
            <Button variant="outline">Fechar ajuda</Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
