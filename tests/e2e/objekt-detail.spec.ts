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

test('Objekt-Detail: Reiter „Dokumente“ — hochladen am Objekt, Pfad sichtbar, Dokumente der Deals dabei, Anzeigen liefert die Datei', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const strasse = `Dokweg ${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse, hausnr: '3', stadt: 'Ulm' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  // ein Deal-Dokument über die API — es muss am Objekt mit erscheinen
  const form = { multipart: { dateien: { name: 'Mietvertrag.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n' + 'm'.repeat(100)) } } };
  expect((await page.request.post(`/api/deals/${d.id}/dokumente`, form)).status()).toBe(201);

  await page.goto(`/objekte?objekt=${o.id}`);
  const detail = page.getByRole('region', { name: 'Objekt-Detail' });
  await detail.getByRole('tab', { name: '📁 Dokumente' }).click();
  await expect(detail.getByText('📁 Noch keine Dokumente')).toBeVisible();
  await expect(detail.getByLabel('Dokumente der Deals').locator('[data-dokument]')).toHaveCount(1);
  await expect(detail.getByLabel('Dokumente der Deals')).toContainText('Mietvertrag.pdf');

  await detail.getByTestId('dokument-auswahl').setInputFiles([{ name: 'Grundbuch.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n' + 'g'.repeat(200)) }]);
  await expect(detail.getByText('1 Dokument gespeichert')).toBeVisible({ timeout: 30_000 }); // SharePoint-Ablage braucht länger
  const zeile = detail.locator('[data-dokument]').filter({ hasText: 'Grundbuch.pdf' });
  // Ablage je nach Einstellung: Supabase (Standard) oder SharePoint (Einstellungen → SharePoint aktiv)
  const ablage = await zeile.getAttribute('data-ablage');
  expect(['supabase', 'sharepoint']).toContain(ablage);
  await expect(zeile.locator('[data-pfad]')).toContainText(ablage === 'sharepoint' ? `Objekte/${strasse} 3, Ulm [${o.id}]/Grundbuch.pdf` : `deal-docs/${o.id}/`);
  const antwort = await page.request.get((await zeile.getByRole('link', { name: 'Anzeigen' }).getAttribute('href'))!);
  expect(antwort.status()).toBe(200);
  expect((await antwort.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const liste = await (await page.request.get(`/api/objekte/${o.id}/dokumente`)).json();
  expect(liste).toHaveLength(1);
  expect(liste[0]).toMatchObject({ dateiname: 'Grundbuch.pdf', bezug: { art: 'objekt', id: o.id }, ablage });
  if (ablage === 'sharepoint') { expect(liste[0].webUrl).toContain('sharepoint.com'); await expect(zeile.getByRole('link', { name: 'In SharePoint öffnen' })).toBeVisible(); }
  else expect(liste[0].webUrl).toBeNull();
  await zeile.getByRole('button', { name: 'Löschen' }).click();
  await expect(detail.getByText('📁 Noch keine Dokumente')).toBeVisible();
});
