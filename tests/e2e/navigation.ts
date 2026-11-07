import type { Page } from '@playwright/test';

export async function navigateWorkspace(page: Page, label: string): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Abrir navegação', exact: true });
  if (await trigger.isVisible()) {
    await trigger.click();
    await page
      .getByRole('navigation', { name: 'Navegação móvel' })
      .getByRole('link', { name: label, exact: true })
      .click();
    return;
  }
  const desktop = page.getByRole('navigation', { name: 'Estrutura organizacional' });
  const link = desktop.getByRole('link', { name: label, exact: true });
  if (!(await link.isVisible())) {
    await desktop
      .getByRole('group')
      .filter({ has: page.locator('a').and(page.getByText(label, { exact: true })) })
      .getByRole('button')
      .click();
  }
  await link.click();
}
