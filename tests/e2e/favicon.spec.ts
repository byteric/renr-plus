import { expect, test } from '@playwright/test';

for (const format of ['image/svg+xml', 'image/x-icon']) {
  test(`a aba carrega um ícone ReNR+ válido em ${format}`, async ({ page, request }) => {
    await page.goto('/');
    const icon = page.locator(`head link[rel="icon"][type="${format}"]`);
    await expect(icon).toHaveCount(1);
    const href = await icon.getAttribute('href');
    expect(href).toMatch(/^\/(?!\/)/);

    const response = await request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(
      format === 'image/svg+xml' ? /image\/svg\+xml/ : /image\/(?:x-icon|vnd\.microsoft\.icon)/,
    );

    const dimensions = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = source!;
      await image.decode();
      return { width: image.naturalWidth, height: image.naturalHeight };
    }, href);
    expect(dimensions.width).toBeGreaterThanOrEqual(16);
    expect(dimensions.height).toBe(dimensions.width);
  });
}
