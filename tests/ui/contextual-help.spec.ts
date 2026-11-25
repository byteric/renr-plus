import { expect, test, type Page } from '@playwright/test';

const organizationId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const helpLabel = 'Ajuda sobre Diagnóstico demonstrativo';

async function openDiagnostic(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((value) => localStorage.setItem('renr-theme', value), theme);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/session')
      return route.fulfill({
        json: {
          user: { id: userId, name: 'Pessoa fictícia', email: 'ajuda@example.test' },
          memberships: [
            { organizationId, organizationName: 'Organização fictícia', role: 'ADMIN' },
          ],
          activeOrganizationId: organizationId,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      });
    if (path === '/auth/session-capabilities')
      return route.fulfill({ json: { organizationId, capabilities: [], canManageAccess: true } });
    if (path === '/platform/capabilities') return route.fulfill({ json: { capabilities: [] } });
    if (path === `/organizations/${organizationId}/diagnostic-cycles`)
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 50 } });
    return route.fulfill({ status: 404, json: { message: 'Recurso não disponível no cenário.' } });
  });
  await page.goto('/#/diagnostico');
}

test('concentra foco na ajuda por teclado e o devolve ao fechar com Escape', async ({
  page,
}, testInfo) => {
  await openDiagnostic(page, 'light');
  const button = page.getByRole('button', { name: helpLabel, exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: helpLabel });
  const close = dialog.getByRole('button', { name: 'Fechar ajuda' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('ajuda-contextual-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test.describe('toque em tela estreita', () => {
  test.use({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });

  test('abre e fecha a ajuda por toque, com conteúdo dentro da tela', async ({
    page,
  }, testInfo) => {
    await openDiagnostic(page, 'dark');
    const button = page.getByRole('button', { name: helpLabel, exact: true });
    expect((await button.boundingBox())?.width).toBeGreaterThanOrEqual(44);
    await button.tap();
    const dialog = page.getByRole('dialog', { name: helpLabel });
    const close = dialog.getByRole('button', { name: 'Fechar ajuda' });
    await expect(dialog.getByText('Pré-requisitos')).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
    }
    await expect(close).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('ajuda-contextual-mobile.png') });
    await close.tap();
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  });
});
