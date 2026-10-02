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

/** Braucht die KI-Attrappe (KI_ATTRAPPE=1): erwartet deren erkennbare Testtexte, mit echtem Schlüssel antwortet das Modell frei. */
test('Bank-Präsentation: KI-Texte für Lage und Objekt behalten Getipptes; „✨ Helligkeit“ ersetzt das Bild durch eine aufgehellte Kopie', async ({ page }) => {
  const strasse = `Praes-KI ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '7', plz: '70378', stadt: 'Stuttgart' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  // Ein flaues Foto am Objekt: Grauverlauf von 40 (links) bis 120 (rechts)
  await page.goto('/deals');
  const flau = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 60; c.height = 40;
    const x = c.getContext('2d')!;
    for (let i = 0; i < 60; i++) { const v = 40 + Math.round((i * 80) / 59); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, 0, 1, 40); }
    return c.toDataURL('image/png').split(',')[1]!;
  });
  const foto = await (await page.request.post(`/api/objekte/${o.id}/fotos`, { data: Buffer.from(flau, 'base64'), headers: { 'content-type': 'application/octet-stream', 'x-dateiname': 'Flau.png' } })).json();
  const p = await (await page.request.post(`/api/deals/${d.id}/praesentation`, { data: { vorlage: 'standard' } })).json();
  const mitBild = p.slides.map((s: { typ: string; data: Record<string, unknown> }) => (s.typ === 'deckblatt' ? { ...s, data: { ...s.data, bildPath: foto.ref } } : s));
  expect((await page.request.put(`/api/praesentationen/${p.id}`, { data: { bankName: '', internNotiz: '', version: p.version, slides: mitBild } })).ok()).toBe(true);

  await page.goto(`/praesentationen/${p.id}`);
  const folien = page.getByRole('navigation', { name: 'Folien' });
  const formular = page.getByRole('region', { name: 'Folie bearbeiten' });

  // Lage: der getippte Punkt bleibt und steht zuerst
  await folien.getByRole('button', { name: /Lagebeschreibung$/ }).click();
  await formular.getByRole('textbox', { name: 'Standort' }).fill('Ruhige Wohnlage');
  await formular.getByRole('button', { name: '🤖 KI: Lagebeschreibung generieren' }).click();
  await expect(page.getByText('✅ Lagebeschreibung generiert (3 Bullets)')).toBeVisible();
  await expect(formular.getByRole('textbox', { name: 'Standort' })).toHaveValue('Ruhige Wohnlage\nWohnlage in Stuttgart (Test-Modus)');
  await expect(formular.getByRole('textbox', { name: 'Anbindung' })).toHaveValue('ÖPNV in der Nähe (Test-Modus)');

  // Objekt: Beschreibung aus den bekannten Fakten
  await folien.getByRole('button', { name: /Objektbeschreibung$/ }).click();
  await formular.getByRole('button', { name: '🤖 KI: Beschreibung generieren' }).click();
  await expect(page.getByText('✅ Objektbeschreibung generiert (15 Wörter)')).toBeVisible();
  await expect(formular.getByRole('textbox', { name: 'Beschreibung' })).toHaveValue(/^Bei dem Objekt handelt es sich um ein Mehrfamilienhaus .*Test-Modus, \d+ Fakten\)\.$/);

  // Helligkeit: neues Foto am Objekt, die Folie zeigt die aufgehellte Kopie
  await folien.getByRole('button', { name: /Deckblatt$/ }).click();
  const bild = formular.getByRole('img', { name: 'Hauptbild (1 Bild)' });
  const vorher = await bild.getAttribute('src');
  expect(vorher).toContain(foto.ref.slice('photo:'.length));
  await formular.getByRole('button', { name: '✨ Helligkeit' }).click();
  await expect(page.getByText('✨ Helligkeit optimiert')).toBeVisible();
  await expect(bild).not.toHaveAttribute('src', vorher!);
  const fotos = await (await page.request.get(`/api/objekte/${o.id}/fotos`)).json();
  expect(fotos.map((f: { dateiname: string }) => f.dateiname.replace(/\d+/, 'N')).sort()).toEqual(['Flau.png', 'enhanced-N.jpg']);
  // Der Verlauf reicht jetzt von fast Schwarz bis fast Weiß (JPEG lässt etwas Spiel)
  const rand = await bild.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d')!; x.drawImage(img, 0, 0);
    return [x.getImageData(1, 20, 1, 1).data[0]!, x.getImageData(img.naturalWidth - 2, 20, 1, 1).data[0]!];
  });
  expect(rand[0]).toBeLessThan(25);
  expect(rand[1]).toBeGreaterThan(230);

  // Automatisch gespeichert: die Folie verweist auf das neue Foto
  await expect(page.getByLabel('Speicherstand')).toHaveText('gespeichert');
  const gespeichert = await (await page.request.get(`/api/praesentationen/${p.id}`)).json();
  const neu = fotos.find((f: { dateiname: string }) => f.dateiname.startsWith('enhanced-'));
  expect(gespeichert.slides.find((s: { typ: string }) => s.typ === 'deckblatt').data.bildPath).toBe(neu.ref);
  expect(gespeichert.slides.find((s: { typ: string }) => s.typ === 'lagebeschreibung').data.standortBullets).toBe('Ruhige Wohnlage\nWohnlage in Stuttgart (Test-Modus)');
});
