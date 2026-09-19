import { expect, test } from '@playwright/test';

test('Zugänge: Schlüssel hinterlegen, maskiert sehen, entfernen', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
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
