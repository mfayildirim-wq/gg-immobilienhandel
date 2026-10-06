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

test('Einheitenliste: Miete SOLL ohne Kästchen wie in der alten App; Zeilen mit dem Griff „≡“ verschieben, Reihenfolge bleibt gespeichert', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const kennung = `Reihe ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse: kennung, hausnr: '5', stadt: 'Ulm' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const dd = await (await page.request.get(`/api/deals/${d.id}`)).json();
  const einheit = (lage: string) => ({ typ: 'Wohnung', lage, zimmer: 2, flaeche: 50, mieteIst: 500, mieteNeu: null, mieteNeuManuell: false, renditeK: 4, verkaufspreis: null, stueck: null });
  await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: { version: dd.version, kalkulation: { kaufpreis: 250_000 }, einheiten: ['A', 'B', 'C'].map(einheit), sanierungen: [] } });

  await page.goto(`/deals?deal=${d.id}`);
  const detail = page.getByLabel('Deal-Detail');
  await detail.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
  const liste = detail.getByLabel('Einheiten', { exact: true });
  const zeilen = liste.locator('tbody tr');
  const lagen = () => zeilen.getByLabel('Lage').evaluateAll((es) => es.map((e) => (e as HTMLInputElement).value));
  await expect.poll(lagen).toEqual(['A', 'B', 'C']);

  // Kein Kästchen mehr; ein eigener SOLL-Wert gilt, ein leeres Feld folgt wieder der IST-Miete
  await expect(liste.getByLabel('Miete neu manuell')).toHaveCount(0);
  const erste = zeilen.first();
  await erste.getByLabel('Miete neu').fill('600');
  await expect(erste.getByLabel('Verkaufspreis')).toHaveAttribute('placeholder', '180.000'); // 600 × 12 / 4 %
  await erste.getByLabel('Miete neu').fill('');
  await expect(erste.getByLabel('Verkaufspreis')).toHaveAttribute('placeholder', '150.000'); // wieder 500 € IST

  // Ziehen: A unter C
  const griff = (i: number) => zeilen.nth(i).getByRole('button', { name: 'Zeile verschieben' });
  const ziel = (await zeilen.nth(2).boundingBox())!;
  await griff(0).hover();
  await page.mouse.down();
  await page.mouse.move(ziel.x + 10, ziel.y + ziel.height - 4, { steps: 8 });
  await page.mouse.up();
  await expect.poll(lagen).toEqual(['B', 'C', 'A']);

  // Tastatur: Griff fokussieren, Pfeil hoch
  await griff(2).focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(lagen).toEqual(['B', 'A', 'C']);

  // Speichern und neu laden: Reihenfolge bleibt
  await detail.getByLabel('Kalkulation speichern und Varianten').getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/deals/${d.id}`)).json()).einheiten.map((e: { lage: string }) => e.lage)).toEqual(['B', 'A', 'C']);
  await page.reload();
  await detail.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
  await expect.poll(lagen).toEqual(['B', 'A', 'C']);
});
