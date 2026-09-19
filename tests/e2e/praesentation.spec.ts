import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('Bank-Präsentation: Standard-Pitch anlegen, Kalkulation übernehmen, Bild wählen, Check, PDF und PowerPoint', async ({ page }) => {
  const strasse = `Praes-E2E ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '7', stadt: 'Ulm' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const leer = { zimmer: null, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null };
  expect((await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: {
    version: 1, kalkulation: { kaufpreis: 900000, notar: 2, gest: 5, fk_p: 85, euribor: 3, margeB: 2, halt: 18 }, sanierungen: [],
    einheiten: [{ ...leer, typ: 'Wohnung', lage: 'EG', flaeche: 80, mieteIst: 800, renditeK: 4 }],
  } })).ok()).toBe(true);
  // ein Objektfoto für die Bildauswahl
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  expect((await page.request.post(`/api/objekte/${o.id}/fotos`, { data: png, headers: { 'content-type': 'application/octet-stream', 'x-dateiname': 'Fassade.png' } })).status()).toBe(201);

  await page.goto(`/deals?deal=${d.id}`);
  await page.getByRole('tab', { name: 'Bank-Präsentation' }).click();
  await page.getByRole('button', { name: 'Standard-IVT-Pitch anlegen' }).click();
  await expect(page).toHaveURL(/\/praesentationen\//);
  const folien = page.getByRole('navigation', { name: 'Folien' });
  await expect(folien.getByRole('button', { name: /^Folie \d+:/ })).toHaveCount(13);

  await page.getByRole('textbox', { name: 'Bank' }).fill('Sparkasse Ulm');

  // Deckblatt: Titel aus Deal, Bild aus den Objektfotos
  const formular = page.getByRole('region', { name: 'Folie bearbeiten' });
  await formular.getByRole('button', { name: 'Titel und Untertitel aus Deal übernehmen' }).click();
  await expect(formular.getByRole('textbox', { name: 'Untertitel' })).toHaveValue(`in Ulm, ${strasse} 7`);
  await formular.getByRole('button', { name: 'Bild auswählen / hochladen' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Bild Fassade.png' }).click();
  await expect(formular.getByRole('img', { name: 'Hauptbild (1 Bild)' })).toBeVisible();
  const vorschau = page.frameLocator('iframe[title="Folienvorschau"]');
  await expect(vorschau.getByText(`in Ulm, ${strasse} 7`)).toBeVisible();

  // Projektkalkulation aus dem Deal
  await folien.getByRole('button', { name: /Projektkalkulation$/ }).click();
  await formular.getByRole('button', { name: 'Aufteiler-Kalkulation aus Deal übernehmen' }).click();
  await expect(formular.getByRole('table', { name: 'Tabelle der Folie' }).getByText('= Gesamt-Investitionskosten (GIK)')).toBeVisible();
  await expect(vorschau.getByText('= Gesamt-Investitionskosten (GIK)')).toBeVisible();

  // Finanzierung übernimmt denselben Scope, Check bleibt ohne Fehler; eine Änderung von Hand wird gemeldet
  await folien.getByRole('button', { name: /Finanzierungsstruktur$/ }).click();
  await formular.getByRole('button', { name: 'Aus Deal-Kalkulation + IVT-Standard übernehmen' }).click();
  await expect(formular.getByRole('textbox', { name: 'Kreditnehmer' })).toHaveValue('IVT Wohnen GmbH');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('dialog').getByText('✅ Alle Slides konsistent')).toBeVisible();
  await page.keyboard.press('Escape');
  await formular.getByRole('textbox', { name: 'Gesamt-Investition (GIK)' }).fill('1.000 €');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByRole('dialog').getByText(/GIK weicht ab/)).toBeVisible();
  await page.keyboard.press('Escape');

  // Folie ausblenden und nach oben schieben
  const grundrisse = folien.getByRole('button', { name: /Grundrisse$/ });
  await grundrisse.locator('xpath=ancestor::div[contains(@class,"mantine-Paper-root")][1]').getByRole('button', { name: /ausblenden/ }).click();

  await expect(page.getByLabel('Speicherstand')).toHaveText('gespeichert');
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF' }).click()]);
  expect(pdf.suggestedFilename()).toBe('Sparkasse_Ulm.pdf');
  expect(readFileSync(await pdf.path()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const [pptx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PowerPoint' }).click()]);
  expect(pptx.suggestedFilename()).toBe('Sparkasse_Ulm.pptx');
  expect(readFileSync(await pptx.path()).subarray(0, 2).toString('latin1')).toBe('PK');

  // gespeichert: nach Neuladen sind Bankname, Tabelle und ausgeblendete Folie da
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Bank' })).toHaveValue('Sparkasse Ulm');
  const p = (await (await page.request.get(`/api/deals/${d.id}/praesentation`)).json()).praesentation;
  expect(p.slides.find((s: { typ: string }) => s.typ === 'grundrisse').visible).toBe(false);
  expect(p.slides.find((s: { typ: string }) => s.typ === 'deckblatt').data.bildPath).toMatch(/^photo:/);
});
