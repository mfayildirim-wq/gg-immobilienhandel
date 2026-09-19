import { expect, test } from '@playwright/test';

test('Papierkorb: gelöschtes Objekt erscheint, Wiederherstellen bringt es zurück, Endgültig entfernt es', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const strasse = `Papierkorbweg ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '2' } })).json();
  await page.request.delete(`/api/objekte/${o.id}`);

  await page.goto('/einstellungen/papierkorb');
  const zeile = page.locator(`[data-papierkorb="${o.id}"]`);
  await expect(zeile).toContainText(strasse);
  await expect(zeile).toContainText('noch 30 Tage');

  await zeile.getByRole('button', { name: '↩ Wiederherstellen' }).click();
  await expect(zeile).toHaveCount(0);
  // Die Objektliste steht standardmäßig schmal links neben dem Detail; hier wird die Tabelle geprüft.
  await page.addInitScript(() => { try { localStorage.setItem('gg.objekte.layout', 'untereinander'); } catch { /* ohne Speicher Standardansicht */ } });
  await page.goto('/objekte');
  await page.getByLabel('Suchen').fill(strasse);
  await expect(page.getByRole('table', { name: 'Objektliste' }).locator('tbody tr')).toHaveCount(1);

  await page.request.delete(`/api/objekte/${o.id}`);
  await page.goto('/einstellungen/papierkorb');
  await page.locator(`[data-papierkorb="${o.id}"]`).getByRole('button', { name: '✖ Endgültig' }).click();
  await expect(page.locator(`[data-papierkorb="${o.id}"]`)).toHaveCount(0);
  expect((await page.request.get(`/api/objekte/${o.id}`)).status()).toBe(404);
});
