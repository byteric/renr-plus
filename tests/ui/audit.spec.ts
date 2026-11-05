import { expect, test, type Page, type Locator } from '@playwright/test';

const org = '10000000-0000-4000-8000-000000000001';
const author = {
  id: '20000000-0000-4000-8000-000000000001',
  name: 'Pessoa responsável pela execução e acompanhamento das decisões do grupo de desenvolvimento',
};
const action = '30000000-0000-4000-8000-000000000001';
const revision = '40000000-0000-4000-8000-000000000001';
const event = {
  id: `revision:${revision}`,
  operation: 'ACTION_UPDATED',
  label: 'Alteração da medida preventiva',
  actor: author,
  createdAt: '2026-10-29T01:30:00.000Z',
  reason:
    'Justificativa sintética longa para verificar leitura, quebra de linha e navegação. '.repeat(
      45,
    ),
  resource: {
    type: 'action',
    id: action,
    label:
      'Revisão da capacidade das sprints e distribuição das atividades de desenvolvimento e teste',
  },
  target: { kind: 'action-revision', id: revision, parentId: action, revision: 7 },
};
async function mock(page: Page, theme: string, role = 'ADMIN') {
  await page.addInitScript((theme) => localStorage.setItem('renr-theme', theme), theme);
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let body: unknown = {};
    let status = 200;
    if (path === '/health')
      body = { status: 'ok', service: 'renr-api', timestamp: event.createdAt };
    else if (path === '/auth/session')
      body = {
        user: { ...author, email: 'fixture@example.test' },
        memberships: [
          { organizationId: org, organizationName: 'Empresa fictícia de desenvolvimento', role },
        ],
        activeOrganizationId: org,
        expiresAt: '2099-01-01T00:00:00.000Z',
      };
    else if (path.endsWith('/audit-events'))
      body = { items: [event], page: 1, pageSize: 20, total: 1, timeZone: 'America/Sao_Paulo' };
    else if (path.endsWith(`/history-records/action-revision/${revision}`))
      body = {
        event,
        timeZone: 'America/Sao_Paulo',
        details: [
          {
            label: 'Descrição preservada',
            value:
              'Revisão sete do registro fictício. ' + 'Conteúdo legível sem cortes. '.repeat(100),
          },
        ],
      };
    else status = 404;
    await route.fulfill({ status, json: body });
  });
}

async function contrast(locator: Locator) {
  return locator.evaluate((element) => {
    const luminance = (value: string) =>
      (value.match(/[\d.]+/g) ?? [])
        .slice(0, 3)
        .map(Number)
        .map((channel) => {
          const c = channel / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
    let parent: Element | null = element;
    while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)')
      parent = parent.parentElement;
    if (!parent) throw new Error('Fundo opaco não encontrado');
    const a = luminance(getComputedStyle(element).color),
      b = luminance(getComputedStyle(parent).backgroundColor);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}
for (const theme of ['light', 'dark']) {
  test(`auditoria: reflow, teclado e revisão preservada no tema ${theme}`, async ({
    page,
  }, testInfo) => {
    await mock(page, theme);
    await page.goto('/#/auditoria');
    await expect(page.getByRole('heading', { name: 'Auditoria', exact: true })).toBeVisible();
    await expect(page.getByText('28/10/2026, 22:30', { exact: true })).toBeVisible();
    const filtered = page.waitForResponse(
      (response) =>
        response.url().includes('/audit-events?') &&
        new URL(response.url()).searchParams.get('operation') === 'ACTION_UPDATED',
    );
    await page.getByLabel('Operação', { exact: true }).fill('ACTION_UPDATED');
    await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
    await filtered;
    await expect(page).toHaveURL(/operation=ACTION_UPDATED/);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const button = page.getByRole('button', {
        name: 'Abrir registro · Alteração da medida preventiva',
        exact: true,
      });
      await button.focus();
      await expect(button).toBeFocused();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(/Revisão sete do registro fictício/)).toBeVisible();
      expect(
        await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`auditoria-revisao-${theme}-${width}.png`),
        fullPage: false,
      });
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(button).toBeFocused();
      await expect(page).toHaveURL(/operation=ACTION_UPDATED/);
      await page.getByRole('heading', { name: 'Auditoria', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(`auditoria-${theme}-${width}.png`),
        fullPage: false,
      });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await contrast(page.getByText('28/10/2026, 22:30', { exact: true })),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      await contrast(page.getByRole('button', { name: 'Aplicar filtros', exact: true })),
    ).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button', { name: /Filtrar por este autor/ }).click();
    await expect(page).toHaveURL(new RegExp(`actorId=${author.id}`));
    await page.reload();
    await expect(page.getByLabel('Autor (ID)')).toHaveValue(author.id);
  });
}
test('auditoria: leitor não recebe controles administrativos em endereço direto', async ({
  page,
}) => {
  await mock(page, 'light', 'READER');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/#/auditoria');
  await expect(page.getByRole('alert')).toContainText('apenas para administradores');
  expect(requests.some((url) => url.includes('/audit-events'))).toBe(false);
});
