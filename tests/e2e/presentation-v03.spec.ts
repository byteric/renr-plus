import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { demoPassword } from '../../scripts/e2e-data.mjs';
import { navigateWorkspace } from './navigation';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.afterEach(async ({ page }) => {
  await page.request.delete('/api/v1/auth/session', {
    headers: { Origin: 'http://127.0.0.1:5173' },
  });
});

test('leitura ampliada e interação mantêm o fluxo com CPU reduzida', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail', { exact: true }).fill('admin1@renr.example');
  await page.getByLabel('Senha', { exact: true }).fill(demoPassword());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Empresas', exact: true })).toBeVisible();
  await navigateWorkspace(page, 'Painel');
  await expect(page.getByRole('list', { name: 'Indicadores do inventário' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Cadastros de riscos por dia', exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.getByRole('link', { name: 'Ver inventário', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inventário', exact: true })).toBeVisible();
  await page.getByLabel('Buscar no inventário', { exact: true }).fill('fictício');
  await page.getByRole('button', { name: 'Aplicar filtros', exact: true }).click();
  await expect(page).toHaveURL(/q=fict/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.evaluate(() => {
    document.documentElement.style.zoom = '';
  });
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const samples: {
      elapsedMs: number;
      frameP50Ms: number;
      frameP95Ms: number;
      frameP99Ms: number;
    }[] = [];
    for (let run = 0; run < 3; run++) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      const started = await page.evaluate(() => performance.now());
      await page.getByRole('button', { name: /Modo (claro|escuro)/ }).click();
      await page.keyboard.press('PageDown');
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
      samples.push(
        await page.evaluate(async (start) => {
          const frames: number[] = [];
          let previous = performance.now();
          for (let index = 0; index < 30; index++)
            await new Promise<void>((resolve) =>
              requestAnimationFrame((now) => {
                frames.push(now - previous);
                previous = now;
                resolve();
              }),
            );
          const sorted = frames.slice(1).sort((a, b) => a - b);
          const percentile = (p: number) =>
            Number(
              sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!.toFixed(2),
            );
          return {
            elapsedMs: Number((performance.now() - start).toFixed(2)),
            frameP50Ms: percentile(0.5),
            frameP95Ms: percentile(0.95),
            frameP99Ms: percentile(0.99),
          };
        }, started),
      );
    }
    const report = JSON.stringify(
      {
        environment:
          'Chromium headless, Vite local, CPU throttle 4x; não é INP ou teste de produção',
        project: testInfo.project.name,
        viewport: page.viewportSize(),
        samples,
      },
      null,
      2,
    );
    const reportPath = testInfo.outputPath('interacoes-cpu4-local.json');
    await writeFile(reportPath, report);
    await testInfo.attach('interacoes-cpu4-local.json', {
      path: reportPath,
      contentType: 'application/json',
    });
  } finally {
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await client.detach();
  }
});
