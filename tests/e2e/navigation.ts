import type { Page } from '@playwright/test';

export async function navigateWorkspace(page: Page, label: string): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Abrir navegação', exact: true });
  if (await trigger.isVisible()) await trigger.click();
  await page.getByRole('link', { name: label, exact: true }).click();
}
