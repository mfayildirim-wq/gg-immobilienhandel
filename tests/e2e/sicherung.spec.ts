import { expect, test } from '@playwright/test';

test('Sicherung: Umfang sehen, Datei einlesen, Plan prüfen und einspielen', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const strasse = `Sicherungweg ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '2' } })).json();
  const datei = await (await page.request.get('/api/sicherung/export')).text();
  await page.request.delete(`/api/objekte/${o.id}`);
  await page.request.delete(`/api/papierkorb/objekte/${o.id}`);

  await page.goto('/einstellungen/sicherung');
  await expect(page.locator('[data-sicherung-umfang]')).toContainText('Zeilen aus');
  await page.getByTestId('sicherung-datei').setInputFiles({ name: 'gg-sicherung.json', mimeType: 'application/json', buffer: Buffer.from(datei) });

  const plan = page.getByLabel('Einspielplan');
  await expect(plan.locator('[data-plan="objekte"]')).toBeVisible();
  await expect(plan.locator('[data-plan-summe]')).toContainText('neue und');
  await plan.getByRole('button', { name: '⬆ Jetzt einspielen' }).click();
  await expect(page.getByText(/✅ \d+ Zeilen eingespielt/)).toBeVisible();
  expect((await page.request.get(`/api/objekte/${o.id}`)).status()).toBe(200);
});
