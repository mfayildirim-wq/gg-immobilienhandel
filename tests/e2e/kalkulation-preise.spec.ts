import { expect, test } from '@playwright/test';

test('Kalkulation: Rendite, VKP und KP/m² — eines eingeben, die anderen beiden folgen; Rendite mit Pfeilen in 0,1-Schritten', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const kennung = `Preise ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse: kennung, hausnr: '3', stadt: 'Ulm' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const dd = await (await page.request.get(`/api/deals/${d.id}`)).json();
  // 80 m², 1.000 € Miete → 12.000 €/Jahr; Rendite 4 % → VKP 300.000 €, KP/m² 3.750 €
  const einheiten = [{ typ: 'Wohnung', lage: 'EG', zimmer: 3, flaeche: 80, mieteIst: 1000, mieteNeu: null, mieteNeuManuell: false, renditeK: 4, verkaufspreis: null, stueck: null }];
  await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: { version: dd.version, kalkulation: { kaufpreis: 250_000 }, einheiten, sanierungen: [] } });

  await page.goto(`/deals?deal=${d.id}`);
  const detail = page.getByLabel('Deal-Detail');
  await detail.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
  const liste = detail.getByLabel('Einheiten', { exact: true });
  // die Zeile der Einheit — „Alle setzen“ darüber hat eigene Felder mit ähnlichen Namen
  const zeile = liste.locator('tbody tr').first();
  const rendite = zeile.getByLabel('Rendite', { exact: true });
  const vkp = zeile.getByLabel('Verkaufspreis');
  const kpm2 = zeile.getByLabel('KP/m²');
  await expect(vkp).toHaveAttribute('placeholder', '300.000');
  await expect(kpm2).toHaveAttribute('placeholder', '3.750');

  // VKP eingeben → Rendite und KP/m² folgen
  await vkp.fill('320000');
  await expect(rendite).toHaveValue('3,8');
  await expect(kpm2).toHaveValue('4.000');

  // KP/m² eingeben → VKP und Rendite folgen
  await kpm2.fill('2500');
  await expect(vkp).toHaveValue('200.000');
  await expect(rendite).toHaveValue('6');

  // Rendite eingeben → der eingetragene VKP fällt weg, VKP und KP/m² folgen aus der Miete
  await rendite.fill('5');
  await expect(vkp).toHaveValue('');
  await expect(vkp).toHaveAttribute('placeholder', '240.000');
  await expect(kpm2).toHaveAttribute('placeholder', '3.000');

  // Pfeil hoch: +0,1
  await zeile.locator('[data-direction="up"]').click();
  await expect(rendite).toHaveValue('5,1');

  // Fester VKP, dann Miete ändern → die Rendite passt sich an
  await vkp.fill('300000');
  await expect(rendite).toHaveValue('4');
  await zeile.getByLabel('Miete ist').fill('1250');
  await expect(rendite).toHaveValue('5');
  await expect(vkp).toHaveValue('300.000');
});
