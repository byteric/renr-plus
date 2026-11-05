import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import {
  peopleReportSectionLabels,
  reportListSchema,
  reportSnapshotSchema,
} from '../../packages/contracts/src/reports';
import { navigateWorkspace } from './navigation';
import { selectCompany, test } from './people-report-fixture';

const platformApi = '/api/v1/platform/reports';
const preview = (page: Page) => page.getByRole('region', { name: 'Prévia congelada do relatório' });
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

async function issue(page: Page, endpoint: string) {
  const issued = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === endpoint && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Emitir relatório' }).click();
  const response = await issued;
  expect(response.status()).toBe(201);
  return reportSnapshotSchema.parse(await response.json());
}

async function downloadPdf(page: Page, endpoint: string, kind: 'people' | 'platform') {
  const fetched = page.waitForResponse((response) => new URL(response.url()).pathname === endpoint);
  const downloaded = page.waitForEvent('download');
  await preview(page).getByRole('button', { name: 'Baixar PDF' }).click();
  const response = await fetched;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/pdf');
  expect(response.headers()['cache-control']).toBe('private, no-store');
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(new RegExp('^renr-' + kind + '-.*\\.pdf$'));
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(preview(page).getByText('PDF preparado para download.')).toBeVisible();
}

test('relatório PEOPLE congela o recorte nominal e revalida escopo e permissão financeira', async ({
  page,
  hr,
}) => {
  test.setTimeout(75_000);
  const endpoint = hr.tenantApi + '/reports';
  await hr.recordCompensation();
  await hr.login(page);
  await navigateWorkspace(page, 'Relatórios');
  await page.getByLabel('Tipo de relatório').selectOption('PEOPLE');
  await page.getByLabel('Unidade do relatório').selectOption(hr.unit.id);
  await page.getByLabel('Setor do relatório').selectOption(hr.sector.id);
  await page.getByLabel('Competência').fill('2026-11');
  await page.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('true');
  await page.getByLabel('Incluir detalhes nominais').check();
  await page.getByLabel('Incluir dados financeiros').check();
  const sections = page.getByRole('group', { name: 'Seções da emissão' });
  for (const label of Object.values(peopleReportSectionLabels)) {
    if (label !== peopleReportSectionLabels['people-population']) {
      await sections.getByRole('checkbox', { name: label, exact: true }).uncheck();
    }
  }
  const snapshot = await issue(page, endpoint);
  expect(snapshot).toMatchObject({
    kind: 'PEOPLE',
    organizationId: hr.org.id,
    nominal: true,
    financial: true,
  });
  expect(snapshot.sections.map(({ key }) => key)).toEqual([
    'people-population',
    'nominal-employees',
    'nominal-compensation',
  ]);
  const path = endpoint + '/' + snapshot.id;
  const nominal = preview(page).getByRole('table', { name: 'Mapeamento nominal autorizado' });
  await expect(nominal.getByText(hr.employee.name, { exact: false })).toBeVisible();
  await expect(nominal.getByText(hr.inactive.name, { exact: false })).toHaveCount(0);
  await expect(nominal.getByText(hr.foreign.name, { exact: false })).toHaveCount(0);
  await expect(
    preview(page).getByRole('table', { name: 'Remuneração nominal na competência' }),
  ).toBeVisible();
  await expect(preview(page).getByText(/9\.876,54/)).toBeVisible();
  await hr.renameEmployee('Nome sintético alterado depois da emissão');
  await page.reload();
  await page.getByRole('button', { name: 'Abrir Gestão de Pessoas', exact: true }).click();
  await expect(nominal.getByText(hr.employee.name, { exact: false })).toBeVisible();
  await expect(nominal.getByText('Nome sintético alterado depois da emissão')).toHaveCount(0);
  const persisted = await page.request.get(path);
  expect(persisted.status()).toBe(200);
  expect(reportSnapshotSchema.parse(await persisted.json())).toEqual(snapshot);
  await downloadPdf(page, path + '/pdf', 'people');

  await selectCompany(page, hr.other.id);
  await navigateWorkspace(page, 'Relatórios');
  await expect(page.getByText('Nenhum relatório emitido.')).toBeVisible();
  await expect(preview(page)).toHaveCount(0);
  for (const suffix of ['', '/pdf']) {
    expect((await page.request.get(path + suffix)).status()).toBe(404);
    expect(
      (
        await page.request.get(
          '/api/v1/organizations/' + hr.other.id + '/reports/' + snapshot.id + suffix,
        )
      ).status(),
    ).toBe(404);
  }
  await selectCompany(page, hr.org.id);
  await navigateWorkspace(page, 'Relatórios');
  await page.getByRole('button', { name: 'Abrir Gestão de Pessoas', exact: true }).click();
  await expect(nominal).toBeVisible();
  await hr.revokeCompensation();
  for (const suffix of ['', '/pdf']) {
    expect((await page.request.get(path + suffix)).status()).toBe(404);
  }
  const list = await page.request.get(endpoint);
  expect(list.status()).toBe(200);
  expect(reportListSchema.parse(await list.json()).items).toHaveLength(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(preview(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Abrir Gestão de Pessoas', exact: true }),
  ).toHaveCount(0);
});

test('relatório PLATFORM exige concessão global e expõe somente catálogo e agregados', async ({
  page,
  hr,
}) => {
  test.setTimeout(75_000);
  await hr.recordCompensation();
  await hr.login(page);
  await page.goto('/#/plataforma/relatorios');
  await expect(page.getByText('Relatórios globais exigem leitura da plataforma.')).toBeVisible();
  expect((await page.request.get(platformApi)).status()).toBe(403);

  await hr.allowPlatform();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Relatórios da plataforma', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Nome ou CNPJ').fill(hr.org.name);
  await page.getByLabel('Classificação').selectOption('DEMONSTRATION');
  await page.getByLabel('Estado fiscal').selectOption('MISSING');
  await page.getByLabel('Incluir detalhes', { exact: true }).check();
  const snapshot = await issue(page, platformApi);
  expect(snapshot).toMatchObject({
    kind: 'PLATFORM',
    organizationId: null,
    nominal: false,
    financial: false,
  });
  expect(snapshot.sections.map(({ key }) => key)).toEqual([
    'platform-overview',
    'platform-clients',
  ]);
  const table = preview(page).getByRole('table', { name: 'Catálogo no recorte solicitado' });
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('row').nth(1).getByRole('cell')).toHaveText([
    new RegExp(hr.org.name),
    'DEMONSTRATION / MISSING / Ativo',
    '1',
    '1',
  ]);
  await expect(preview(page).getByText(hr.employee.name)).toHaveCount(0);
  await expect(preview(page).getByText(/9\.876,54/)).toHaveCount(0);
  await expect(
    preview(page).getByText('Sem detalhes nominais. Sem dados financeiros.'),
  ).toBeVisible();
  const path = platformApi + '/' + snapshot.id;
  const persisted = await page.request.get(path);
  expect(persisted.status()).toBe(200);
  expect(reportSnapshotSchema.parse(await persisted.json())).toEqual(snapshot);
  await downloadPdf(page, path + '/pdf', 'platform');
  expect((await page.request.get(hr.tenantApi + '/reports/' + snapshot.id)).status()).toBe(404);

  await hr.revokePlatform();
  const denied = page.waitForResponse(
    (response) => new URL(response.url()).pathname === path + '/pdf',
  );
  await preview(page).getByRole('button', { name: 'Baixar PDF' }).click();
  expect((await denied).status()).toBe(403);
  await expect(page.getByText(/acesso aos relatórios foi revogado/i)).toBeVisible();
  await expect(preview(page)).toHaveCount(0);
  expect((await page.request.get(path)).status()).toBe(403);
});
