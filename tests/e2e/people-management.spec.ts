import { expect } from '@playwright/test';
import { navigateWorkspace } from './navigation';
import { test } from './people-report-fixture';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });

test('Gestão de Pessoas filtra, registra RH e remove o cadastro após revogação', async ({
  page,
  hr,
}) => {
  test.setTimeout(75_000);
  await hr.login(page);
  await navigateWorkspace(page, 'Gestão de Pessoas');

  await expect(page.getByRole('heading', { name: 'Visão de pessoas' })).toBeVisible();
  const totals = page.getByRole('region', { name: 'Registros no recorte' });
  await expect(totals.getByText('2', { exact: true })).toBeVisible();
  await page.getByText('Filtros de Pessoas', { exact: true }).click();
  await page.getByLabel('Unidade', { exact: true }).selectOption(hr.unit.id);
  await page.getByLabel('Setor', { exact: true }).selectOption(hr.sector.id);
  await page.getByLabel('Situação').selectOption('true');
  await page.getByLabel('Competência').fill('2026-11');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(totals.getByText('0', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/competence=2026-11/);

  await page.getByRole('button', { name: 'Colaboradores', exact: true }).click();
  await expect(page.getByText(/1 registros de colaboradores/)).toBeVisible();
  await expect(page.getByText(hr.inactive.name)).toHaveCount(0);
  await expect(page.getByText(hr.foreign.name)).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir ' + hr.employee.name }).click();
  const dialog = page.getByRole('dialog', { name: 'Cadastro de RH · ' + hr.employee.name });
  const button = (name: string) => dialog.getByRole('button', { name, exact: true });
  const field = (name: string) => dialog.getByLabel(name, { exact: true });
  const provenance = async (source: string) => {
    await field('Fonte').fill(source);
    await field('Motivo').fill('Registro sintético para a jornada ID31');
  };
  await expect(dialog.getByText(hr.originalSource, { exact: true })).toBeVisible();
  await button('Editar perfil').click();
  await field('Data de nascimento').fill('1993-05-17');
  await field('Requer acompanhamento').check();
  await provenance('Perfil sintético revisado');
  await button('Salvar perfil').click();
  await expect(dialog.getByText('Perfil salvo com histórico.')).toBeVisible();
  await expect(dialog.getByText('17/05/1993')).toBeVisible();

  await button('Vínculos').click();
  await button('Adicionar vínculo').click();
  await field('Início do vínculo').fill('2024-01-01');
  await provenance('Vínculo sintético');
  await button('Salvar vínculo').click();
  await expect(dialog.getByText('01/01/2024 a vínculo em aberto')).toBeVisible();

  await button('Férias').click();
  await button('Adicionar período de férias').click();
  await field('Início aquisitivo').fill('2024-01-01');
  await field('Fim aquisitivo').fill('2024-12-31');
  await field('Limite concessivo').fill('2025-12-31');
  await field('Dias de direito').fill('30');
  await field('Dias de saldo').fill('30');
  await field('Faltas injustificadas').fill('0');
  await field('Histórico do período conhecido').check();
  await provenance('Férias sintéticas');
  await button('Salvar férias').click();
  await expect(dialog.getByText(/saldo 30 de 30 dias/)).toBeVisible();

  await button('Salários').click();
  await button('Adicionar salário').click();
  await field('Competência salarial').fill('2026-11');
  await field('Salário em centavos').fill('123456');
  await provenance('Salário sintético');
  await button('Salvar salário').click();
  await expect(dialog.getByText(/2026-11 · R\$\s*1\.234,56/)).toBeVisible();

  await button('Simulação').click();
  await field('Data do desligamento').fill('2026-11-04');
  await button('Simular com registros persistidos').click();
  await expect(dialog.getByText('Estimativa parcial')).toBeVisible();
  await expect(dialog.getByText('Indisponível: há dados pendentes')).toBeVisible();

  const history = await page.request.get(hr.peopleApi + '/hr-history');
  expect(history.status()).toBe(200);
  expect((await history.json()).items).toHaveLength(4);

  await button('Perfil').click();
  await button('Editar perfil').click();
  await field('Fonte').fill('Rascunho privado sintético');
  await hr.revokePeople();
  expect((await page.request.get(hr.peopleApi + '/hr-profile')).status()).toBe(403);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText(/acesso a Pessoas requer uma permissão de RH/)).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(hr.employee.name)).toHaveCount(0);
});
