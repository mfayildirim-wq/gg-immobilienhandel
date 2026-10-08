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

test('Zugänge: „Schlüssel testen“ beim Anthropic-Schlüssel zeigt das Ergebnis (mit KI-Attrappe: Test-Modus)', async ({ page }) => {
  await page.goto('/einstellungen/zugaenge');
  const zeile = page.locator('[data-zugang="anthropic-api-key"]');
  await zeile.getByRole('button', { name: 'Schlüssel testen' }).click();
  await expect(zeile.getByRole('alert')).toContainText('Test-Modus');
  // nur beim Anthropic-Schlüssel
  await expect(page.locator('[data-zugang="propstack-api-key"]').getByRole('button', { name: 'Schlüssel testen' })).toHaveCount(0);
});
