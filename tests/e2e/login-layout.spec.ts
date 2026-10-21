import { expect, test, type Locator, type Page } from '@playwright/test';

async function openLogin(page: Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1, name: 'Acesse o ReNR+' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function expectFirstScreen(control: Locator) {
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  const viewport = control.page().viewportSize()!;
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

async function expectReachable(control: Locator) {
  await control.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expectFirstScreen(control);
  const header = await control.page().getByRole('banner').boundingBox();
  const box = await control.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`login no tema ${theme}`, () => {
    test.use({ colorScheme: theme });

    for (const viewport of [
      { width: 320, height: 640 },
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      test(`acesso na primeira tela em ${viewport.width} × ${viewport.height}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize(viewport);
        await openLogin(page);
        await expect(page.getByRole('status')).toHaveText('API conectada');
        expect(await page.evaluate(() => scrollY)).toBe(0);
        await expectFirstScreen(page.getByLabel('E-mail', { exact: true }));
        await expectFirstScreen(page.getByLabel('Senha', { exact: true }));
        const submit = page.getByRole('button', { name: 'Entrar', exact: true });
        await expectFirstScreen(submit);
        expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expectNoHorizontalOverflow(page);
        if (viewport.width <= 900) {
          const panel = await page.getByRole('region', { name: 'Acesse o ReNR+' }).boundingBox();
          const brand = await page.getByRole('region', { name: /Da informação/ }).boundingBox();
          expect(brand!.y).toBeGreaterThanOrEqual(panel!.y + panel!.height);
        }
        if (viewport.width === 1440) {
          expect(
            await page.evaluate(() => document.documentElement.scrollHeight),
          ).toBeLessThanOrEqual(viewport.height);
        }
        if (viewport.width === 375 || viewport.width === 1440) {
          await page.screenshot({
            path: testInfo.outputPath(`login-${viewport.width}-${theme}.png`),
          });
          await page.screenshot({
            path: testInfo.outputPath(`login-${viewport.width}-${theme}-full.png`),
            fullPage: true,
          });
        }
      });
    }

    test('ordem de foco acompanha o acesso e preserva foco perceptível', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await openLogin(page);
      for (const control of [
        page.getByRole('link', { name: 'Ir para conteúdo', exact: true }),
        page.getByRole('link', { name: 'ReNR+ início', exact: true }),
        page.getByRole('button', { name: /Modo (claro|escuro)/ }),
        page.getByLabel('E-mail', { exact: true }),
        page.getByLabel('Senha', { exact: true }),
        page.getByRole('button', { name: 'Entrar', exact: true }),
      ]) {
        await page.keyboard.press('Tab');
        await expect(control).toBeFocused();
        await expect(control).toBeVisible();
      }
      const submit = page.getByRole('button', { name: 'Entrar', exact: true });
      expect(await submit.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe(
        'none',
      );
      await page.keyboard.press('Shift+Tab');
      const password = page.getByLabel('Senha', { exact: true });
      expect(await password.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
        'solid',
      );
    });

    test('validação preserva campos associados e rolagem em janela baixa', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await openLogin(page);
      let requests = 0;
      await page.route('**/api/v1/auth/sessions', async (route) => {
        requests++;
        await route.fulfill({ status: 401, json: {} });
      });
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('Informe um e-mail válido e sua senha.');
      await expect(page.getByLabel('E-mail', { exact: true })).toHaveAttribute(
        'aria-describedby',
        'login-error',
      );
      await expect(page.getByLabel('Senha', { exact: true })).toHaveAttribute(
        'aria-describedby',
        'login-error',
      );
      expect(requests).toBe(0);
      // Reduced viewport approximates the space left by a software keyboard; no physical keyboard is emulated.
      await page.setViewportSize({ width: 375, height: 360 });
      for (const control of [
        page.getByLabel('E-mail', { exact: true }),
        page.getByLabel('Senha', { exact: true }),
        page.getByRole('alert'),
        page.getByRole('button', { name: 'Entrar', exact: true }),
      ])
        await expectReachable(control);
      await expectNoHorizontalOverflow(page);
    });

    for (const status of [401, 503, 200]) {
      test(`resposta ${status} mantém erro e acesso disponível sem criar sessão inválida`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.route('**/api/v1/auth/sessions', (route) => route.fulfill({ status, json: {} }));
        await openLogin(page);
        await page.getByLabel('E-mail', { exact: true }).fill('layout@example.test');
        await page.getByLabel('Senha', { exact: true }).fill('synthetic-layout-password');
        await page.getByRole('button', { name: 'Entrar', exact: true }).click();
        await expect(page.getByRole('alert')).toHaveText(
          status === 401
            ? 'E-mail ou senha inválidos. Confira os dados e tente novamente.'
            : status === 503
              ? 'Serviço temporariamente indisponível. Tente novamente em instantes.'
              : 'Não foi possível concluir a operação. Tente novamente.',
        );
        await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('layout@example.test');
        await expect(page.getByLabel('Senha', { exact: true })).toHaveValue(
          'synthetic-layout-password',
        );
        await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeEnabled();
        await expectReachable(page.getByRole('alert'));
        await expectNoHorizontalOverflow(page);
      });
    }

    test('envio pendente bloqueia duplicação e libera nova tentativa após erro', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      let requests = 0;
      let release!: () => void;
      const response = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/api/v1/auth/sessions', async (route) => {
        requests++;
        await response;
        await route.fulfill({ status: 401, json: {} });
      });
      await openLogin(page);
      await page.getByLabel('E-mail', { exact: true }).fill('layout@example.test');
      await page.getByLabel('Senha', { exact: true }).fill('synthetic-layout-password');
      await page.getByRole('button', { name: 'Entrar', exact: true }).click();
      try {
        const pending = page.getByRole('button', { name: 'Entrando…', exact: true });
        await expect(pending).toBeDisabled();
        await expectFirstScreen(pending);
        await page
          .getByRole('form', { name: 'Acesso', exact: true })
          .evaluate((form: HTMLFormElement) => {
            form.requestSubmit();
            form.requestSubmit();
          });
      } finally {
        release();
      }
      await expect(page.getByRole('alert')).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(requests).toBe(1);
      await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeEnabled();
    });

    test('indisponibilidade preserva aviso, formulário e recuperação real da conexão', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.route('**/api/v1/auth/session', (route) =>
        route.fulfill({ status: 503, json: {} }),
      );
      // A 200 response without a valid health payload must not claim connectivity.
      await page.route('**/api/v1/health', (route) => route.fulfill({ status: 200, json: {} }));
      await openLogin(page);
      await expect(
        page.getByRole('status').filter({ hasText: 'Serviço temporariamente indisponível' }),
      ).toBeVisible();
      await expect(page.getByRole('status').filter({ hasText: 'API indisponível' })).toBeVisible();
      await expectReachable(page.getByRole('button', { name: 'Entrar', exact: true }));
      await expectReachable(
        page.getByRole('button', { name: 'Verificar meu acesso novamente', exact: true }),
      );
      await page.unroute('**/api/v1/health');
      await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'API conectada' })).toBeVisible();
      await page.unroute('**/api/v1/auth/session');
      await page
        .getByRole('button', { name: 'Verificar meu acesso novamente', exact: true })
        .click();
      await expect(page.getByRole('heading', { level: 1, name: 'Acesse o ReNR+' })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Verificar meu acesso novamente', exact: true }),
      ).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });

    test('zoom CSS 200% mantém controles alcançáveis com rolagem nativa', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openLogin(page);
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      for (const control of [
        page.getByLabel('E-mail', { exact: true }),
        page.getByLabel('Senha', { exact: true }),
        page.getByRole('button', { name: 'Entrar', exact: true }),
      ])
        await expectReachable(control);
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('PageDown');
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    });

    test('movimento reduzido mantém acesso imediato e conteúdo complementar rolável', async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 375, height: 812 });
      await openLogin(page);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await expectFirstScreen(page.getByRole('button', { name: 'Entrar', exact: true }));
      await page.keyboard.press('PageDown');
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
      await expect(page.getByRole('list', { name: 'Jornada de gestão preventiva' })).toBeVisible();
      await expectReachable(page.getByRole('button', { name: 'Verificar conexão', exact: true }));
    });
  });
}
