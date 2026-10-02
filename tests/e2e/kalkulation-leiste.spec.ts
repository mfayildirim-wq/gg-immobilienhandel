import { expect, type Locator, test } from '@playwright/test';

test('Kalkulation: Adresse, Reiter und Knopfleiste bleiben beim Scrollen stehen — links Varianten mit „Speichern als…“, rechts Verwerfen und Speichern', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const kennung = `Leiste ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse: kennung, hausnr: '7', stadt: 'Ulm', angebotspreis: 900_000 } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const dd = await (await page.request.get(`/api/deals/${d.id}`)).json();
  const einheiten = Array.from({ length: 14 }, (_, i) => ({
    typ: 'Wohnung', lage: `Whg ${i + 1}`, zimmer: 2, flaeche: 50, mieteIst: 500, mieteNeu: null, mieteNeuManuell: false, renditeK: 5, verkaufspreis: null, stueck: null,
  }));
  await page.request.put(`/api/deals/${d.id}/kalkulation`, { data: { version: dd.version, kalkulation: { kaufpreis: 900_000 }, einheiten, sanierungen: [] } });

  await page.goto(`/deals?deal=${d.id}`);
  const detail = page.getByLabel('Deal-Detail');
  const reiter = detail.getByRole('tab', { name: 'Kalkulation', exact: true });
  await reiter.click();

  // Miete der letzten Einheit ändern — weit unten, dort wo oben stehende Knöpfe längst weggescrollt wären
  const liste = detail.getByLabel('Einheiten', { exact: true });
  await liste.getByLabel('Miete ist').last().fill('650');
  await detail.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  expect(await detail.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);

  const leiste = detail.getByLabel('Kalkulation speichern und Varianten');
  const speichern = leiste.getByRole('button', { name: 'Speichern', exact: true });
  const verwerfen = leiste.getByRole('button', { name: 'Verwerfen', exact: true });
  const speichernAls = leiste.getByRole('button', { name: '💾 Speichern als…' });
  // Auch die Adresse bleibt stehen — Stadt und Makler stehen in derselben Zeile dahinter
  const adresse = detail.getByRole('heading', { name: `${kennung} 7` });
  const stadtUndMakler = detail.getByText('Ulm · Makler: – (ohne Makler)');
  for (const sichtbar of [adresse, stadtUndMakler, reiter, speichern, verwerfen, speichernAls, leiste.getByText('ungespeichert')]) await expect(sichtbar).toBeInViewport();
  const mitte = async (l: Locator) => { const b = (await l.boundingBox())!; return b.y + b.height / 2; };
  expect(Math.abs(await mitte(adresse) - await mitte(stadtUndMakler))).toBeLessThan(12);
  expect((await stadtUndMakler.boundingBox())!.x).toBeGreaterThan((await adresse.boundingBox())!.x);
  await expect(speichern).toBeEnabled();

  // Anordnung: Varianten links, dann Verwerfen, ganz rechts Speichern
  const links = async (l: Locator) => (await l.boundingBox())!.x;
  expect(await links(speichernAls)).toBeLessThan(await links(verwerfen));
  expect(await links(verwerfen)).toBeLessThan(await links(speichern));

  await speichern.click();
  await expect(leiste.getByText('ungespeichert')).toHaveCount(0);
  const gespeichert = await (await page.request.get(`/api/deals/${d.id}`)).json();
  expect(gespeichert.einheiten.at(-1).mieteIst).toBe(650);
});

test('Kalkulation: ungespeicherte Änderungen — Reiterwechsel, anderer Deal und andere Seite fragen nach; „Abbrechen“ behält die Eingaben', async ({ page }) => {
  const dialoge: string[] = [];
  let verwerfen = false;
  page.on('dialog', (d) => { dialoge.push(d.message()); void (verwerfen ? d.accept() : d.dismiss()); });
  const kennung = `Rückfrage ${Date.now()}`;
  const anlegen = async (hausnr: string) => {
    const o = await (await page.request.post('/api/objekte', { data: { strasse: kennung, hausnr, stadt: 'Ulm', angebotspreis: 900_000 } })).json();
    return (await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json()) as { id: string };
  };
  const d = await anlegen('1');
  await anlegen('2');

  await page.goto(`/deals?deal=${d.id}`);
  await page.getByLabel('Suchen', { exact: true }).fill(kennung);
  const detail = page.getByLabel('Deal-Detail');
  const kalkulation = detail.getByRole('tab', { name: 'Kalkulation', exact: true });
  const uebersicht = detail.getByRole('tab', { name: 'Übersicht', exact: true });
  const kaufpreis = detail.getByRole('textbox', { name: 'Kaufpreis' });
  const frage = 'Die Kalkulation hat ungespeicherte Änderungen.\n\nÄnderungen verwerfen?';

  // Ohne Änderungen wechselt der Reiter ohne Rückfrage
  await kalkulation.click();
  await uebersicht.click();
  await kalkulation.click();
  expect(dialoge).toEqual([]);

  await kaufpreis.fill('1.234.567');
  await expect(detail.getByText('ungespeichert')).toBeVisible();

  // Abbrechen: Reiter, Deal und Seite bleiben, die Eingabe auch
  await uebersicht.click();
  await page.getByLabel('Deal-Liste').getByRole('button', { name: new RegExp(`${kennung} 2`) }).click();
  await page.getByRole('link', { name: 'Makler', exact: true }).click();
  expect(dialoge).toEqual([frage, frage, frage]);
  await expect(page).toHaveURL(/\/deals/);
  await expect(kalkulation).toHaveAttribute('aria-selected', 'true');
  await expect(detail.getByRole('heading', { name: `${kennung} 1` })).toBeVisible();
  await expect(kaufpreis).toHaveValue('1.234.567');

  // Verwerfen: der Reiter wechselt, die Eingabe ist weg
  verwerfen = true;
  await uebersicht.click();
  await expect(uebersicht).toHaveAttribute('aria-selected', 'true');
  await kalkulation.click();
  await expect(kaufpreis).not.toHaveValue('1.234.567');
  await expect(detail.getByText('ungespeichert')).toHaveCount(0);
  expect(dialoge).toHaveLength(4);
});
