import { expect, test } from '@playwright/test';

// Mit KI-Attrappe nutzt gg eine Gedächtnis-Attrappe im Speicher (dieselbe Ersetzen-Regel wie der Dienst)
test('Gedächtnis: Makler-Kontakt landet im Gedächtnis, neue Nummer ersetzt die alte; Merken, Korrigieren, Vergessen; Deal-Status', async ({ page }) => {
  const name = `Gedaechtnis ${Date.now()}`;
  const m = await (await page.request.post('/api/makler', { data: { name, tel: '0711 1' } })).json();
  const v = async () => (await (await page.request.get(`/api/makler/${m.id}`)).json()).version;
  await page.request.patch(`/api/makler/${m.id}`, { data: { version: await v(), mobil: '0171 5550001' } });
  await page.request.patch(`/api/makler/${m.id}`, { data: { version: await v(), mobil: '0172 9990002' } });

  await page.goto(`/makler?makler=${m.id}`);
  const s = page.getByRole('region', { name: 'Makler-Detail' });
  await s.getByRole('tab', { name: '🧠 Gedächtnis' }).click();
  const kasten = s.locator(`[data-gedaechtnis="makler:${m.id}"]`);
  const eintraege = kasten.locator('[data-gedaechtnis-eintrag]');
  await expect(eintraege).toHaveCount(1);
  await expect(eintraege.first()).toContainText('Mobil 0172 9990002');
  await expect(eintraege.first()).toContainText('aus der App');
  await expect(kasten).not.toContainText('0171');

  await kasten.getByLabel('Merken').fill('Bevorzugt Termine am Vormittag');
  await kasten.getByRole('button', { name: 'Merken' }).click();
  await expect(eintraege).toHaveCount(2);
  const notizId = await eintraege.filter({ hasText: 'Vormittag' }).getAttribute('data-gedaechtnis-eintrag');
  const notiz = kasten.locator(`[data-gedaechtnis-eintrag="${notizId}"]`);
  await expect(notiz).toContainText('gemerkt');

  await notiz.getByRole('button', { name: 'Korrigieren' }).click();
  await notiz.getByRole('textbox').fill('Bevorzugt Termine vor 12 Uhr');
  await notiz.getByRole('button', { name: 'Speichern' }).click();
  await expect(notiz).toContainText('vor 12 Uhr');
  await expect(notiz).toContainText('korrigiert');
  await notiz.getByRole('button', { name: 'Vergessen' }).click();
  await expect(eintraege).toHaveCount(1);

  // Deal: Statuswechsel steht im Gedächtnis des Deals
  const o = await (await page.request.post('/api/objekte', { data: { strasse: `${name} Str`, hausnr: '1', stadt: 'Ulm' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id, maklerId: m.id } })).json();
  const dv = (await (await page.request.get(`/api/deals/${d.id}`)).json()).version;
  expect((await page.request.patch(`/api/deals/${d.id}/status`, { data: { status: 'Angebot abgegeben', version: dv } })).status()).toBe(200);
  const texte = (await (await page.request.get(`/api/gedaechtnis/deal/${d.id}`)).json()).eintraege.map((e: { text: string }) => e.text);
  expect(texte).toHaveLength(1);
  expect(texte[0]).toMatch(new RegExp(`^Deal ${name} Str 1.*: Status Angebot abgegeben\\.$`));
});
