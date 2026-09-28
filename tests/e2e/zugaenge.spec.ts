import { expect, test } from '@playwright/test';

test('Zugänge: Schlüssel hinterlegen, maskiert sehen, entfernen', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  // Ein echter Schlüssel in der Entwicklungsdatenbank wird nicht gelöscht — der Test überspringt dann
  const vorher = (await (await page.request.get('/api/zugaenge')).json()) as { schluessel: string; quelle: string; maske?: string }[];
  const propstack = vorher.find((z) => z.schluessel === 'propstack-api-key');
  test.skip(propstack?.quelle === 'einstellungen' && !(propstack.maske ?? '').endsWith('7654'), 'echter Propstack-Schlüssel hinterlegt — wird nicht gelöscht');
  await page.request.put('/api/zugaenge/propstack-api-key', { data: { wert: '' } });

  await page.goto('/einstellungen/zugaenge');
  const zeile = page.locator('[data-zugang="propstack-api-key"]');
  await expect(zeile.locator('[data-quelle]')).toHaveText('nicht hinterlegt');

  await zeile.getByLabel('Propstack Schlüssel').fill('ps-live-987654');
  await zeile.getByRole('button', { name: 'Speichern' }).click();
  await expect(zeile.locator('[data-quelle]')).toHaveText('hier hinterlegt · ••••7654');
  await expect(zeile.getByLabel('Propstack Schlüssel')).toHaveValue('');

  await zeile.getByRole('button', { name: 'Entfernen' }).click();
  await expect(zeile.locator('[data-quelle]')).toHaveText('nicht hinterlegt');
});
