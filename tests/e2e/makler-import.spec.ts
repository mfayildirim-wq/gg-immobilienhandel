import { expect, test } from '@playwright/test';
import * as XLSX from 'xlsx';

test('Makler-Import: Tabelle wählen, Vorschau prüfen, übernehmen', async ({ page }) => {
  const kennung = `Tabelle${Date.now()}`;
  const mappe = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(mappe, XLSX.utils.aoa_to_sheet([
    ['Ansprechpartner', 'Unternehmen', 'Mobil', 'E-Mail', 'Kategorie', 'Turnus'],
    [`${kennung} Anna`, 'Import GmbH', '0711 4711', `${kennung}a@example.test`, '1', 'quartalsweise'],
    ['', 'Ohne Namen', '', `${kennung}b@example.test`, '', ''],
    [`${kennung} Bernd`, '', '', `${kennung}c@example.test`, '3', '30'],
  ]), 'Makler');
  const bytes = XLSX.write(mappe, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  await page.goto('/einstellungen/sicherung');
  await page.getByTestId('makler-tabelle').setInputFiles({ name: 'makler.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
  const vorschau = page.getByLabel('Import-Vorschau');
  await expect(vorschau.locator('[data-import-zeilen]')).toContainText('3 Zeilen');
  await expect(vorschau).toContainText('Import GmbH');

  await vorschau.getByRole('button', { name: /Zeilen übernehmen/ }).click();
  await expect(page.getByText('✅ 2 Makler übernommen, 1 übersprungen.')).toBeVisible();

  const makler = await (await page.request.get('/api/makler')).json();
  const anna = makler.find((m: { name: string }) => m.name === `${kennung} Anna`);
  expect(anna).toMatchObject({ firma: 'Import GmbH', prio: 'A' });
  const detail = await (await page.request.get(`/api/makler/${anna.id}`)).json();
  expect(detail.kontaktFrequenz ?? detail.nachfassFrequenz).toBe('Alle 3 Monate');
});
