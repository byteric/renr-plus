import { expect, type Page } from '@playwright/test';

export async function navigateWorkspace(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: 'Abrir navegação', exact: true });
  if (await trigger.isVisible()) {
    await trigger.click();
    const menu = page.getByRole('dialog', { name: 'Navegação', exact: true });
    await expect(menu).toBeVisible();
    await menu.getByRole('link', { name, exact: true }).click();
    await expect(menu).toBeHidden();
  } else {
    await page
      .getByRole('navigation', { name: 'Estrutura organizacional', exact: true })
      .getByRole('link', { name, exact: true })
      .click();
  }
}
