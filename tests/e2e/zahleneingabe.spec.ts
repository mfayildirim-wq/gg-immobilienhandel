import { expect, type Locator, test } from '@playwright/test';

/** Wie ein Mensch: anklicken, alles markieren, Zeichen für Zeichen tippen. */
async function tippen(feld: Locator, text: string) {
  await feld.click();
  await feld.page().waitForTimeout(60);
  await feld.press('ControlOrMeta+a');
  await feld.pressSequentially(text, { delay: 60 });
}

test('Kundenkalkulation: Kommastellen lassen sich tippen und bleiben nach dem Speichern erhalten', async ({ page }) => {
  const o = await (await page.request.post('/api/objekte', { data: { strasse: `Komma ${Date.now()}`, hausnr: '1', stadt: 'Ulm' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const leer = { zimmer: null, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null };
  await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: { version: 1, kalkulation: {}, sanierungen: [], einheiten: [{ ...leer, typ: 'Wohnung', lage: 'EG', flaeche: 70, mieteIst: 800, renditeK: 4 }] } });
  const k = await (await page.request.post(`/api/deals/${d.id}/kundenkalkulationen`, { data: { scope: 'global', name: 'Komma' } })).json();
  await page.goto(`/kundenkalkulationen/${k.id}`);

  // Vorher: aus „4,“ wurde sofort „0 %“, weiter getippt „075 %“
  const finanzierung = page.getByRole('region', { name: 'Finanzierung' });
  for (const [feld, text, anzeige] of [['Zinssatz', '4,75', '4,75 %'], ['Tilgung', '1,25', '1,25 %']] as const) {
    const f = finanzierung.getByRole('textbox', { name: feld });
    await tippen(f, text.slice(0, 2));
    await expect(f).toHaveValue(`${text.slice(0, 2)} %`); // „4,“ bleibt stehen
    await f.pressSequentially(text.slice(2), { delay: 60 });
    await f.press('Tab');
    await expect(f).toHaveValue(anzeige);
  }
  await tippen(page.getByRole('textbox', { name: 'Notar %' }), '1,75');
  await tippen(page.getByRole('textbox', { name: 'Steuersatz' }), '42,5');
  await page.getByRole('textbox', { name: 'Steuersatz' }).press('Tab');

  await expect(page.getByLabel('Speicherstand')).toHaveText('gespeichert');
  await page.reload();
  await expect(page.getByRole('region', { name: 'Finanzierung' }).getByRole('textbox', { name: 'Zinssatz' })).toHaveValue('4,75 %');
  await expect(page.getByRole('region', { name: 'Finanzierung' }).getByRole('textbox', { name: 'Tilgung' })).toHaveValue('1,25 %');
  await expect(page.getByRole('textbox', { name: 'Notar %' })).toHaveValue('1,75 %');
  await expect(page.getByRole('textbox', { name: 'Steuersatz' })).toHaveValue('42,5 %');
});

test('Deal-Kalkulation: VKP mit Komma wird beim Tippen nicht gerundet', async ({ page }) => {
  const o = await (await page.request.post('/api/objekte', { data: { strasse: `KommaVkp ${Date.now()}`, hausnr: '1', stadt: 'Ulm' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const leer = { zimmer: null, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null };
  await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: { version: 1, kalkulation: {}, sanierungen: [], einheiten: [{ ...leer, typ: 'Wohnung', lage: 'EG', flaeche: 70, mieteIst: 800, renditeK: 4 }] } });
  await page.goto(`/deals?deal=${d.id}`);
  await page.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
  const kpm2 = page.getByLabel('Einheiten').getByRole('textbox', { name: 'KP/m²', exact: true });
  await tippen(kpm2, '3500,5');
  await expect(kpm2).toHaveValue('3.500,5'); // vorher: nach „3500,“ sprang der Wert um
  await kpm2.press('Tab');
  await expect(page.getByLabel('Einheiten').getByRole('textbox', { name: 'Verkaufspreis' })).toHaveValue('245.035'); // 3.500,5 × 70 m²
});
