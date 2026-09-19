import { computeKKalk, KUNDENKALK_STANDARD, kundenkalkulationVorbelegen } from '@gg/domain';
import { expect, test } from '@playwright/test';

test('Kundenkalkulation: Aufteiler mit Stellplatz anlegen, Steuersatz ändern, automatisch gespeichert', async ({ page }) => {
  const strasse = `KK-E2E ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '2', stadt: 'Ulm' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const leer = { zimmer: null, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null };
  const einheiten = [
    { ...leer, typ: 'Wohnung', lage: 'DG', flaeche: 64, mieteIst: 700, renditeK: 4 },
    { ...leer, typ: 'Stellplatz', lage: 'Hof 3', flaeche: null, mieteIst: 50, renditeK: 5 },
  ];
  expect((await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: { version: 1, kalkulation: {}, sanierungen: [], einheiten } })).ok()).toBe(true);

  await page.goto(`/deals?deal=${d.id}`);
  await page.getByRole('tab', { name: 'Kundenkalkulation' }).click();
  await page.getByRole('button', { name: 'Aufteiler …' }).click();
  await page.getByRole('radio', { name: /DG/ }).check();
  await page.getByRole('checkbox', { name: /Hof 3/ }).check();
  await page.getByRole('button', { name: 'Kalkulation anlegen' }).click();
  await expect(page).toHaveURL(/\/kundenkalkulationen\//);
  await expect(page.getByRole('textbox', { name: 'Kaufpreis Wohnung' })).toHaveValue('210.000 €'); // 700 × 12 / 4 %

  await page.getByRole('textbox', { name: 'Steuersatz' }).fill('30');
  await expect(page.getByLabel('Speicherstand')).toHaveText('gespeichert');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Steuersatz' })).toHaveValue('30 %');

  // IRR in der Anzeige = Engine mit denselben Eingaben
  const v = kundenkalkulationVorbelegen({
    scope: 'aufteiler', einheitId: 'x', stellplatzIds: ['y'], dealKaufpreis: 0, objekt: null, standard: KUNDENKALK_STANDARD, hinweise: [], heute: new Date().toISOString().slice(0, 10),
    einheiten: [{ id: 'x', typ: 'Wohnung', lage: 'DG', fl: 64, mi_ist: 700, rend_k: 4 }, { id: 'y', typ: 'Stellplatz', mi_ist: 50, rend_k: 5 }],
  });
  const irr = computeKKalk({ ...v.inputs, grenzsteuersatz: 0.3 }).bankgespraech.hochrechnungVerkauf.nettoEKRenditePA_IRR!;
  await expect(page.getByLabel('Ergebnis Kundenkalkulation').getByText(`${(irr * 100).toFixed(1).replace('.', ',')} %`, { exact: true })).toBeVisible();

  await page.goto('/kundenkalkulationen');
  await expect(page.getByRole('region', { name: `${strasse} 2, Ulm` }).getByText('Kalkulation DG')).toBeVisible();
});

test('Bankgespräch: Live-Vorschau folgt der Eingabe, PDF-Export liefert ein PDF', async ({ page }) => {
  const strasse = `BG-E2E ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '9', stadt: 'Ulm' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const leer = { zimmer: null, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null };
  const einheiten = [{ ...leer, typ: 'Wohnung', lage: 'EG', flaeche: 70, mieteIst: 800, renditeK: 4 }];
  expect((await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: { version: 1, kalkulation: {}, sanierungen: [], einheiten } })).ok()).toBe(true);
  const k = await (await page.request.post(`/api/deals/${d.id}/kundenkalkulationen`, { data: { scope: 'global', name: 'BG Test' } })).json();

  await page.goto(`/kundenkalkulationen/${k.id}`);
  const vorschau = page.frameLocator('iframe[title="Bankgespräch-Vorschau"]');
  await expect(vorschau.getByText('Projekt:', { exact: false }).first()).toBeVisible();
  await expect(vorschau.getByText('240.000 €').first()).toBeVisible(); // Kaufpreis 800 × 12 / 4 %

  // Impression aus den Objektfotos: erscheint in der Vorschau und wird ins PDF eingebettet
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  expect((await page.request.post(`/api/objekte/${o.id}/fotos`, { data: png, headers: { 'content-type': 'application/octet-stream', 'x-dateiname': 'Hof.png' } })).status()).toBe(201);
  await page.getByRole('button', { name: 'Bilder auswählen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Bild Hof.png' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Auswahl übernehmen' }).click();
  await expect(vorschau.locator('img.bg-img')).toHaveCount(1);
  await expect(vorschau.locator('img.bg-img')).toHaveJSProperty('naturalWidth', 1);

  await page.getByRole('textbox', { name: 'Projekt-Titel' }).fill('IVT AG Projekt: Testhaus');
  await expect(vorschau.getByText('IVT AG Projekt: Testhaus')).toBeVisible();
  await expect(page.getByLabel('Speicherstand')).toHaveText('gespeichert');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
  expect(download.suggestedFilename()).toBe('BG_Test.pdf');
  const pfad = await download.path();
  const { readFileSync } = await import('node:fs');
  const inhalt = readFileSync(pfad);
  expect(inhalt.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(inhalt.toString('latin1')).toMatch(/\/Subtype\s*\/Image/); // Foto ist im PDF
});
