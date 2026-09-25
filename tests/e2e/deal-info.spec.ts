import { expect, test } from '@playwright/test';

test('Deal-Info: Frequenz belegt Termin vor, Schnellknopf, E-Mail an Makler, Objekt wechseln mit Vorbelegung, Dateien, Papierkorb', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const kennung = `DealInfo ${Date.now()}`;
  const o1 = await (await page.request.post('/api/objekte', { data: { strasse: `${kennung} A`, hausnr: '1', stadt: 'Ulm', angebotspreis: 800000 } })).json();
  const o2 = await (await page.request.post('/api/objekte', { data: { strasse: `${kennung} B`, hausnr: '2', stadt: 'Ulm', angebotspreis: 1_100_000 } })).json();
  const m = await (await page.request.post('/api/makler', { data: { name: `Makler ${kennung}`, email: 'info@example.test' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o1.id, maklerId: m.id } })).json();

  await page.goto(`/deals?deal=${d.id}`);
  const detail = page.getByLabel('Deal-Detail');
  await detail.getByRole('tab', { name: 'Übersicht' }).click();
  await expect(detail.getByRole('link', { name: 'E-Mail an Makler' })).toHaveAttribute('href', `mailto:info@example.test?subject=${encodeURIComponent(`Anfrage: ${kennung} A 1, Ulm`)}`);

  // Nachfassen steht im Reiter „Kommunikation“ — Frequenzwechsel ohne Termin: Vorschlag heute + 30 Tage
  await detail.getByRole('tab', { name: 'Kommunikation' }).click();
  const termin = detail.getByLabel('Nächster Kontakt');
  await expect(termin).toHaveValue('');
  await detail.getByRole('combobox', { name: 'Frequenz' }).click();
  await page.getByRole('option', { name: 'Monatlich', exact: true }).click();
  const inTagen = (t: number) => new Date(Date.now() + t * 86_400_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  await expect(termin).toHaveValue(inTagen(30));
  await detail.getByRole('button', { name: '1 Wo', exact: true }).click();
  await expect(termin).toHaveValue(inTagen(7));

  // Objekt wechseln: Kaufpreis aus dem neuen Objekt
  await detail.getByRole('tab', { name: 'Übersicht' }).click();
  await detail.getByRole('combobox', { name: '🏢 Objekt' }).click();
  await page.getByRole('option', { name: new RegExp(`${kennung} B`) }).click();
  await expect(detail.getByRole('heading', { name: `${kennung} B 2` })).toBeVisible();
  const kalk = await (await page.request.get(`/api/deals/${d.id}`)).json();
  expect(kalk.kalkulation.kaufpreis).toBe(1_100_000);

  // Dateien
  await detail.getByRole('tab', { name: 'Dateien' }).click();
  await expect(detail.getByText('📁 Noch keine Dokumente')).toBeVisible();
  const auswahl = detail.getByTestId('dokument-auswahl');
  await auswahl.setInputFiles([{ name: 'archiv.pdf', mimeType: 'application/pdf', buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, ...new Array(80).fill(65)]) }]);
  await expect(detail.getByText(/Upload fehlgeschlagen: „archiv.pdf" ist ein gepacktes Archiv/)).toBeVisible();
  await auswahl.setInputFiles([
    { name: 'Exposé.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n' + 'x'.repeat(200)) },
    { name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('Besichtigung am Freitag') },
  ]);
  await expect(detail.getByText('2 Dokumente gespeichert')).toBeVisible();
  const zeilen = detail.locator('[data-dokument]');
  await expect(zeilen).toHaveCount(2);
  const txt = zeilen.filter({ hasText: 'notiz.txt' });
  await expect(txt).toContainText('📎');
  await txt.getByLabel('Bezeichnung').fill('Notiz Besichtigung');
  await txt.getByLabel('Bezeichnung').blur();
  await expect.poll(async () => (await (await page.request.get(`/api/deals/${d.id}/dokumente`)).json()).find((x: { dateiname: string }) => x.dateiname === 'notiz.txt').label).toBe('Notiz Besichtigung');
  const oeffnen = zeilen.filter({ hasText: 'Exposé.pdf' }).getByRole('link', { name: 'Anzeigen' });
  const antwort = await page.request.get((await oeffnen.getAttribute('href'))!);
  expect(antwort.headers()['content-type']).toBe('application/pdf');
  await txt.getByRole('button', { name: 'Löschen' }).click();
  await expect(zeilen).toHaveCount(1);

  // Deal-Liste zeigt das Exposé
  await page.goto('/deals');
  await page.getByLabel('untereinander').click();
  await page.getByLabel('Suchen').fill(`${kennung} B`);
  await expect(page.locator(`tr[data-deal="${d.id}"]`).getByTitle('Exposé öffnen')).toBeVisible();

  // Löschen → Papierkorb: aus der Liste verschwunden
  await page.locator(`tr[data-deal="${d.id}"]`).click();
  await detail.getByRole('tab', { name: 'Übersicht' }).click();
  await detail.getByRole('button', { name: 'Löschen' }).last().click();
  await expect(page.locator(`tr[data-deal="${d.id}"]`)).toHaveCount(0);
});
