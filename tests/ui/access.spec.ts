import { expect, test } from '@playwright/test';

const org = '10000000-0000-4000-8000-000000000001';
const id = '20000000-0000-4000-8000-000000000001';
const stamp = '2026-10-23T12:00:00.000Z';
const longName = 'Pessoa responsável pela administração e validação de acessos organizacionais';
const member = {
  organizationId: org,
  userId: id,
  name: longName,
  email: 'responsavel.sintetico.de.acessos@example.test',
  role: 'ADMIN',
  capabilities: [],
  isActive: true,
  version: 1,
  updatedAt: stamp,
};
const widths = [320, 375, 390, 768, 1280, 1440];
for (const theme of ['light', 'dark'] as const) {
  test(`acessos ${theme}: membros, edição e convite com reflow e teclado`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const list = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 20 });
      if (path === '/api/v1/health')
        return route.fulfill({ json: { status: 'ok', service: 'renr-api', timestamp: stamp } });
      if (path === '/api/v1/auth/session')
        return route.fulfill({
          json: {
            user: { id, name: longName, email: member.email },
            memberships: [
              {
                organizationId: org,
                organizationName: 'Empresa demonstrativa de prevenção e acompanhamento',
                role: 'ADMIN',
              },
            ],
            activeOrganizationId: org,
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        });
      if (path === '/api/v1/auth/session-capabilities')
        return route.fulfill({
          json: { organizationId: org, capabilities: [], canManageAccess: true },
        });
      if (path.endsWith('/access-memberships')) return route.fulfill({ json: list([member]) });
      if (path.endsWith('/access-invites') || path.endsWith('/access-history'))
        return route.fulfill({ json: list([]) });
      throw new Error(`Unexpected synthetic request: ${path}`);
    });
    await page.goto('/#/acessos');
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('button', { name: `Gerenciar ${longName}`, exact: true }),
    ).toBeVisible();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole('heading', { name: 'Acessos', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const manage = page.getByRole('button', { name: `Gerenciar ${longName}`, exact: true });
    await manage.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: `Gerenciar ${longName}`, exact: true }),
    ).toBeFocused();
    await page
      .getByLabel('Justificativa da alteração', { exact: true })
      .fill('Justificativa sintética longa para conferir reflow e legibilidade nos dois temas.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Cancelar alteração', exact: true }).click();
    await page.getByRole('button', { name: 'Convites de acesso', exact: true }).click();
    await page.getByRole('button', { name: 'Novo convite', exact: true }).click();
    await page.getByLabel('Nome da pessoa', { exact: true }).fill(longName);
    await page.getByLabel('E-mail da pessoa', { exact: true }).fill(member.email);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.getByRole('button', { name: 'Emitir convite', exact: true })).toBeVisible();
    }
    // Layout at 200% CSS zoom; native browser zoom remains a final ID27 check.
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => {
      document.documentElement.style.zoom = '';
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => new Promise<void>((accept) => requestAnimationFrame(() => accept())));
    await page.screenshot({ path: `tmp/access-form-${theme}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
