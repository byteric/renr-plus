import * as Dialog from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

// shadcn Sheet composition with the application's existing brand tokens.
export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;
export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;
export function SheetContent({
  children,
  className,
  ...props
}: ComponentProps<typeof Dialog.Content>) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay" />
      <Dialog.Content className={cn('sheet-content', className)} {...props}>
        {children}
        <Dialog.Close className="sheet-close" aria-label="Fechar navegação">
          ×
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
