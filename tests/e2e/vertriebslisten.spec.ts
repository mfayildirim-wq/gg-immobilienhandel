import { expect, test } from '@playwright/test';

test('Vertriebsliste: aus angekauftem Deal anlegen, Zahl mit Punkt eingeben, Rechenspalten, Spalten ausblenden, speichern', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const strasse = `VL-E2E ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '7', stadt: 'Leipzig' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const leer = { zimmer: null, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null, renditeK: null };
  expect((await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: { version: 1, kalkulation: { kaufpreis: 500000, notar: 2, gest: 5, makler: 0 }, sanierungen: [], einheiten: [
    { ...leer, typ: 'Wohnung', lage: 'EG links', flaeche: 60, zimmer: 2, mieteIst: 600, mieteNeu: 750, verkaufspreis: 400000 },
    { ...leer, typ: 'Wohnung', lage: 'OG rechts', flaeche: 40, zimmer: 2, mieteIst: 400, mieteNeu: 500, verkaufspreis: 260000 },
    { ...leer, typ: 'Stellplatz', lage: 'TG-01', flaeche: null, mieteIst: 45, verkaufspreis: 18000 },
  ] } })).ok()).toBe(true);
  const dd = await (await page.request.get(`/api/deals/${d.id}`)).json();
  expect((await page.request.patch(`/api/deals/${d.id}/status`, { data: { status: 'Angekauft', version: dd.version } })).ok()).toBe(true);

  await page.goto('/vertriebslisten');
  const zeile = page.getByRole('table', { name: 'Vertriebslisten' }).locator(`tr[data-deal="${d.id}"]`);
  await zeile.getByRole('button', { name: 'Vertriebsliste anlegen' }).click();
  await expect(page).toHaveURL(/\/vertriebslisten\//);
  await expect(page.getByLabel('Kopfzeile')).toContainText('3 Zeilen · 39/39 Spalten sichtbar · GIK Aufteiler: 535.000 €');

  // Werte wie im alten Klicktest (10-vertriebslisten): GIK 535.000, Gesamtfläche 100 m², Provision 7,14 %
  const z1 = (spalte: string) => page.getByLabel(`${spalte} Zeile 1`, { exact: true });
  await expect(z1('Miete / qm')).toHaveText('10 €');
  await expect(z1('Provision (% siehe Settings)')).toHaveText('28.560 €');
  await expect(z1('Einkaufspreis')).toHaveText('321.000 €');
  await expect(z1('Ergebnis IVT (nach Kosten)')).toHaveText('50.440 €');
  await expect(z1('Rendite Kunde IST')).toHaveText('1,80%');
  await expect(z1('Rendite nach Mieterhöhung voraussichtlich')).toHaveText('2,25%');

  // „85.5“ meint 85,5 (deutsche Zahleneingabe): Anzeige wird normalisiert, Einkaufspreis rechnet mit 145,5 m² Gesamtfläche
  await z1('Wohnfläche').fill('85.5');
  await z1('Lage').focus();
  await expect(z1('Wohnfläche')).toHaveValue('85,5');
  await expect(z1('Einkaufspreis')).toHaveText('364.482 €'); // 535.000 × 85,5 / 125,5
  await z1('Sanierungskosten IVT vor Verkauf').fill('1.234');
  await z1('Lage').focus();
  await expect(z1('Sanierungskosten IVT vor Verkauf')).toHaveValue('1234');
  await page.getByRole('button', { name: 'Ampel Zeile 1: Grün' }).click();

  await page.getByRole('button', { name: 'Spalten' }).click();
  await page.getByRole('checkbox', { name: 'Garten' }).uncheck();
  await expect(page.getByLabel('Kopfzeile')).toContainText('38/39 Spalten sichtbar');
  await expect(page.getByLabel('Speicherstand')).toHaveText('gespeichert');

  await page.reload();
  await expect(z1('Wohnfläche')).toHaveValue('85,5');
  await expect(page.getByRole('button', { name: 'Ampel Zeile 1: Grün' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Kopfzeile')).toContainText('38/39 Spalten sichtbar');

  await page.goto('/vertriebslisten');
  await expect(zeile).toContainText('✓ 3 Zeilen · zuletzt');
});

test('Vertriebslisten-Einstellungen: Provision wirkt auf die Provision-Spalte', async ({ page }) => {
  const vorher = await (await page.request.get('/api/einstellungen/vertriebslisten')).json();
  try {
    await page.goto('/einstellungen/vertriebslisten');
    const bereich = page.getByRole('region', { name: 'Vertriebslisten Einstellungen' });
    await expect(bereich.locator('div[aria-label^="Spalte "]')).toHaveCount(39);
    const prov = bereich.getByRole('textbox', { name: 'Provisionssatz für Berechnung' });
    await prov.fill('3,57');
    await prov.blur();
    await expect.poll(async () => (await (await page.request.get('/api/einstellungen/vertriebslisten')).json()).provision).toBe(3.57);
  } finally {
    await page.request.put('/api/einstellungen/vertriebslisten', { data: vorher });
  }
});
