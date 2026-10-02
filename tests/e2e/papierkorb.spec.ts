import { expect, test } from '@playwright/test';

test('Papierkorb: gelöschtes Objekt erscheint, Wiederherstellen bringt es zurück, Endgültig entfernt es', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const strasse = `Papierkorbweg ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '2' } })).json();
  await page.request.delete(`/api/objekte/${o.id}`);

  await page.goto('/einstellungen/papierkorb');
  const zeile = page.locator(`[data-papierkorb="${o.id}"]`);
  await expect(zeile).toContainText(strasse);
  await expect(zeile).toContainText('noch 30 Tage');

  await zeile.getByRole('button', { name: '↩ Wiederherstellen' }).click();
  await expect(zeile).toHaveCount(0);
  // Die Objektliste steht standardmäßig schmal links neben dem Detail; hier wird die Tabelle geprüft.
  await page.addInitScript(() => { try { localStorage.setItem('gg.objekte.layout', 'untereinander'); } catch { /* ohne Speicher Standardansicht */ } });
  await page.goto('/objekte');
  await page.getByLabel('Suchen').fill(strasse);
  await expect(page.getByRole('table', { name: 'Objektliste' }).locator('tbody tr')).toHaveCount(1);

  await page.request.delete(`/api/objekte/${o.id}`);
  await page.goto('/einstellungen/papierkorb');
  await page.locator(`[data-papierkorb="${o.id}"]`).getByRole('button', { name: '✖ Endgültig' }).click();
  await expect(page.locator(`[data-papierkorb="${o.id}"]`)).toHaveCount(0);
  expect((await page.request.get(`/api/objekte/${o.id}`)).status()).toBe(404);
});

test('Objekt mit Deal: Löschen ist gesperrt und sagt warum; mit dem Deal geht das Objekt in den Papierkorb und kommt mit ihm zurück', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const strasse = `Hängtweg ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '3' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();

  await page.goto(`/objekte?objekt=${o.id}`);
  const objekt = page.getByRole('region', { name: 'Objekt-Detail' });
  await expect(objekt.getByRole('button', { name: '🗑 Löschen' })).toBeDisabled();
  await expect(objekt.locator('[data-hinweis="objekt-hat-deal"]')).toHaveText('Das Objekt hängt an einem Deal und kann nicht gelöscht werden. Lösche zuerst den Deal.');

  // Deal löschen: sein Objekt geht mit, weil kein anderer Deal daran hängt
  await page.goto(`/deals?deal=${d.id}`);
  const deal = page.getByLabel('Deal-Detail');
  await deal.getByRole('tab', { name: 'Übersicht' }).click();
  await deal.getByRole('button', { name: 'Löschen' }).click();
  await expect.poll(async () => (await page.request.get(`/api/deals/${d.id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/objekte/${o.id}`)).status()).toBe(404);

  await page.goto('/einstellungen/papierkorb');
  const hinweis = page.locator('[data-hinweis="papierkorb"]');
  const zeileDeal = page.locator(`[data-papierkorb="${d.id}"]`);
  const zeileObjekt = page.locator(`[data-papierkorb="${o.id}"]`);
  await expect(zeileDeal).toHaveCount(1);
  await zeileObjekt.getByRole('button', { name: '✖ Endgültig' }).click();
  await expect(hinweis).toContainText('Unter „Deals“ gibt es Einträge, die hierauf verweisen');
  await expect(zeileObjekt).toHaveCount(1);

  // Der Deal bringt sein Objekt mit zurück
  await zeileDeal.getByRole('button', { name: '↩ Wiederherstellen' }).click();
  await expect(zeileDeal).toHaveCount(0);
  await expect(zeileObjekt).toHaveCount(0);
  await expect(hinweis).toHaveCount(0);
  expect((await page.request.get(`/api/deals/${d.id}`)).status()).toBe(200);
  expect((await page.request.get(`/api/objekte/${o.id}`)).status()).toBe(200);
});
