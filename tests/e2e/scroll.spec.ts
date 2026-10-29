import { expect, test } from '@playwright/test';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { navigateWorkspace } from './navigation';
import { riskListSchema } from '../../packages/contracts/src/index';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test.afterEach(async ({ page }) => {
  const response = await page
    .context()
    .request.delete('/api/v1/auth/session', { headers: { Origin: 'http://127.0.0.1:5173' } });
  expect([204, 401]).toContain(response.status());
});

test('movimento reduzido preserva conteúdo, foco, PageDown e retorno do drawer', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 700 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: /Da informação/ })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('login-375-reduced-motion.png'),
    fullPage: true,
  });
  await page.getByLabel('E-mail', { exact: true }).fill('admin1@renr.example');
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
  const organization = page.getByRole('combobox', { name: 'Empresa ativa', exact: true });
  const organizationId = '10000000-0000-4000-8000-000000000001';
  if ((await organization.inputValue()) !== organizationId) {
    await organization.selectOption(organizationId);
    await expect(page.getByRole('heading', { name: 'Unidades', exact: true })).toBeVisible();
  }
  await navigateWorkspace(page, 'Painel');
  const heading = page.getByRole('heading', { name: 'Painel', exact: true });
  await expect(heading).toBeFocused();
  await expect(page.getByRole('list', { name: 'Indicadores do inventário' })).toBeVisible();
  const initial = await page.evaluate(() => scrollY);
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(initial);
  await page.keyboard.press('Home');
  await page.evaluate(() => scrollTo(0, 0));
  const trigger = page.getByRole('button', { name: 'Abrir navegação', exact: true });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const restored = await page.evaluate(() => scrollY);
  await page.keyboard.press('PageDown');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(restored);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('filtros ficam acessíveis no desktop e âncoras não são encobertas pelo cabeçalho', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill('admin1@renr.example');
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
  const company = page.getByRole('combobox', { name: 'Empresa ativa', exact: true });
  const targetOrganizationId = '10000000-0000-4000-8000-000000000001';
  if ((await company.inputValue()) !== targetOrganizationId) {
    await company.selectOption(targetOrganizationId);
    await expect(page.getByRole('heading', { name: 'Unidades', exact: true })).toBeVisible();
  }
  await navigateWorkspace(page, 'Inventário');
  const filters = page.getByRole('form', { name: 'Filtros do inventário' });
  await expect(filters).toBeVisible();
  const presets = page.getByRole('navigation', { name: 'Recortes rápidos do inventário' });
  expect(await presets.evaluate((element) => getComputedStyle(element).position)).toBe('sticky');
  const risks = riskListSchema.parse(
    await (
      await page.request.get('/api/v1/organizations/10000000-0000-4000-8000-000000000001/risks')
    ).json(),
  );
  const risk = risks.items[0];
  if (!risk) throw new Error('Fixture fictícia ausente. Execute db:seed.');
  await page.getByRole('link', { name: risk.factor, exact: true }).click();
  await page.getByRole('link', { name: 'Origem', exact: true }).click();
  const header = await page.locator('.site-header').boundingBox();
  const navigation = await page
    .getByRole('navigation', { name: 'Seções do registro' })
    .boundingBox();
  const origin = await page.locator('#risk-origem').boundingBox();
  expect(navigation!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  expect(origin!.y).toBeGreaterThanOrEqual(navigation!.y + navigation!.height);
  await page.setViewportSize({ width: 375, height: 700 });
  await page.getByRole('link', { name: 'Voltar ao inventário', exact: false }).click();
  await expect(filters).toBeVisible();
  expect(await filters.evaluate((element) => getComputedStyle(element).position)).toBe('relative');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
