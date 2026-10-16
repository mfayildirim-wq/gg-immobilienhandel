import { expect, test } from '@playwright/test';

test('Objekt-Detail: Details mit Kennzahlen und Recherche, Bearbeiten mit Einheiten und Summen, Status, Löschen', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const strasse = `Detailweg ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '11' } })).json();

  await page.goto(`/objekte?objekt=${o.id}`);
  // Das Detail steht rechts neben der Liste (früher ein Schubfach).
  const schublade = page.getByRole('region', { name: 'Objekt-Detail' });

  // Bearbeiten: Felder und Einheiten
  await schublade.getByRole('tab', { name: '✏️ Bearbeiten' }).click();
  await schublade.getByRole('textbox', { name: 'PLZ' }).fill('70173');
  await schublade.getByRole('textbox', { name: 'Stadt' }).fill('Stuttgart');
  await schublade.getByRole('textbox', { name: 'Baujahr' }).fill('1965');
  await schublade.getByRole('textbox', { name: 'Angebotspreis €' }).fill('900.000');
  await schublade.getByRole('textbox', { name: 'Ist-Miete/Mo €' }).fill('3.000');
  await schublade.getByLabel('Energieausweis').selectOption('C');
  const einheiten = schublade.getByLabel('Einheitenaufstellung');
  await einheiten.getByRole('button', { name: 'Wohnung / Gewerbe' }).click();
  await einheiten.getByLabel('Lage').fill('EG links');
  await einheiten.getByLabel('Fläche').fill('80');
  await einheiten.getByLabel('Kaltmiete').fill('800');
  await expect(einheiten.locator('[data-proqm]')).toHaveText('10.00 €');
  await einheiten.getByRole('button', { name: 'Stellplatz' }).click();
  await einheiten.getByLabel('Stück').fill('4');
  await einheiten.getByLabel('Kaltmiete').nth(1).fill('160');
  await einheiten.getByLabel('Vermietung').nth(1).selectOption('Leerstand');
  await expect(einheiten.locator('[data-summe="flaeche"]')).toHaveText('80 m²');
  await expect(einheiten.locator('[data-summe="kaltmiete"]')).toHaveText('960 €');
  await expect(einheiten.locator('[data-summe="proQm"]')).toHaveText('12.00 €/m²');
  await schublade.getByRole('textbox', { name: '📝 Notizen' }).fill('Dach 2021 neu');
  const gespeichert = page.waitForResponse((r) => r.url().includes(`/api/objekte/${o.id}`) && r.request().method() === 'PATCH');
  await schublade.getByRole('button', { name: 'Speichern' }).click();
  expect((await gespeichert).status()).toBe(200);

  // Details: Kennzahlen aus den gespeicherten Werten
  await schublade.getByRole('tab', { name: '📋 Details' }).click();
  await expect(schublade.getByLabel('Lage', { exact: true })).toContainText('70173 Stuttgart');
  await expect(schublade.getByLabel('Kennzahlen')).toContainText('900.000 €');
  await expect(schublade.getByLabel('Kennzahlen')).toContainText('4.00%');
  await expect(schublade.getByLabel('Kennzahlen')).toContainText('25.0x');
  await expect(schublade.getByLabel('Gebäude')).toContainText('1965');
  await expect(schublade.getByLabel('Recherche').getByRole('link', { name: '📍 Google Maps' }))
    .toHaveAttribute('href', `https://maps.google.com/?q=${encodeURIComponent(`${strasse} 11 70173 Stuttgart`)}`);
  const tabelle = schublade.getByLabel('Einheiten des Objekts');
  await expect(tabelle.locator('tbody tr')).toHaveCount(2);
  await expect(tabelle.locator('tbody tr').first()).toContainText('10.00 €');
  await expect(tabelle.locator('tbody tr').nth(1)).toContainText('⬜ Leerstand');
  await expect(schublade.getByLabel('Notizen')).toContainText('Dach 2021 neu');

  // Status-Schnellwahl und Löschen
  await schublade.getByLabel('Objekt-Status').selectOption('Angekauft');
  await expect(schublade.getByLabel('Objekt-Status')).toHaveValue('Angekauft');
  await schublade.getByRole('button', { name: '🗑 Löschen' }).click();
  // Der Detailbereich bleibt stehen und zeigt das nächste Objekt — das gelöschte verschwindet aus der Liste.
  await expect(page.locator('[data-objekt]').filter({ hasText: strasse })).toHaveCount(0);
  await expect(schublade).not.toContainText(strasse);
  expect((await page.request.get(`/api/objekte/${o.id}`)).status()).toBe(404);
});
