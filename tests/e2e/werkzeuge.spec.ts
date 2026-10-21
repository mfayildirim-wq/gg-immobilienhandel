import { expect, test } from '@playwright/test';

test('Werkzeuge: Nachfass-Reset mit Vorschau und Ausführen, KI-Kosten-Übersicht', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const strasse = `Nachfassweg ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '3' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const dd = await (await page.request.get(`/api/deals/${d.id}`)).json();
  // Ein Tag, den sonst niemand belegt: Andere Klicktests („1M“) und die HubSpot-Migration (nächster Kontakt in den
  // kommenden 3 Monaten) setzen Termine nahe heute; jeder Lauf nimmt einen eigenen Tag, auch die Wiederholung.
  const datum = new Date(Date.UTC(2031, 0, 1) + (Date.now() % 3000) * 864e5).toISOString().slice(0, 10);
  await page.request.patch(`/api/deals/${d.id}`, { data: { version: dd.version, nextContact: datum, lastContact: '2026-09-01' } });

  await page.goto('/einstellungen/werkzeuge');
  await page.getByLabel('Nachfass-Datum').fill(datum);
  await page.getByRole('button', { name: '🔍 Vorschau' }).click();
  const vorschau = page.getByLabel('Nachfass-Vorschau');
  await expect(vorschau).toContainText('1 Deals');
  await expect(vorschau.locator(`[data-nachfass="${d.id}"]`)).toContainText(`${strasse} 3`);

  await page.getByRole('button', { name: '🔧 Datum löschen' }).click();
  await expect(page.getByText('✅ Zurückgesetzt: 1 Deals und 0 Makler.')).toBeVisible();
  const danach = await (await page.request.get(`/api/deals/${d.id}`)).json();
  expect(danach.nextContact).toBeNull();
  expect(danach.lastContact).toBeNull();

  await expect(page.locator('[data-ki-summe]')).toContainText('Summe:');
  await page.getByLabel('Zeitraum').selectOption('365');
  await expect(page.locator('[data-ki-summe]')).toContainText('365 Tagen');
});
