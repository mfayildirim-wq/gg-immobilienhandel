import { expect, test } from '@playwright/test';

test('Propstack: Bewertungsdialog je Einheit, Default-Deny blockiert das Anlegen mit Begründung', async ({ page }) => {
  const strasse = `Bewertungsweg ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '7', plz: '70173', stadt: 'Stuttgart' } })).json();
  await page.request.patch(`/api/objekte/${o.id}`, { data: { version: o.version, baujahr: 1965 } });
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const dd = await (await page.request.get(`/api/deals/${d.id}`)).json();
  await page.request.put(`/api/deals/${d.id}/kalkulation`, {
    data: {
      version: dd.version, kalkulation: {}, sanierungen: [],
      einheiten: [{ typ: 'Wohnung', lage: 'EG', zimmer: 3, stueck: null, flaeche: 78.5, mieteIst: 700, mieteNeu: null, mieteNeuManuell: false, renditeK: 4.5, verkaufspreis: null }],
    },
  });

  await page.goto(`/deals?deal=${d.id}`);
  const detail = page.getByLabel('Deal-Detail');
  await detail.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
  await detail.getByLabel('Einheiten', { exact: true }).getByRole('button', { name: 'Bewertung über Propstack' }).click();

  const dialog = page.getByRole('dialog', { name: '📊 Bewertung über Propstack' });
  await expect(dialog.getByLabel('Straße')).toHaveValue(strasse);
  await expect(dialog.getByLabel('Baujahr')).toHaveValue('1965');
  await expect(dialog.getByLabel('Wohnfläche m²')).toHaveValue('78.5');
  await dialog.getByLabel('Etage', { exact: true }).fill('2');
  await dialog.getByLabel('Qualität').selectOption('gehoben');

  await dialog.getByRole('button', { name: '📊 An Propstack senden' }).click();
  const fehler = dialog.locator('[data-propstack-fehler]');
  await expect(fehler).toContainText('blockiert');
  await expect(fehler).toContainText('environment');
  await expect(fehler).toContainText('Einstellungen → Aktionen nach außen');
});
