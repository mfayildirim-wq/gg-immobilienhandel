import { expect, test } from '@playwright/test';

/** Unternehmen (Normalform 17.10.2026): Firma im Makler-Dialog als Vorschlagsfeld, Einstellungen → Unternehmen mit Zusammenführen. */
test('Unternehmen: Firma im Makler-Dialog verknüpft oder legt an, Einstellungen führen Schreibweisen zusammen', async ({ page }) => {
  const kennung = `Firma${Date.now()}`;
  const m1 = await (await page.request.post('/api/makler', { data: { name: `${kennung} Anna`, firma: `${kennung} Immobilien GmbH`, email: `anna.${kennung}@example.test` } })).json();
  const m2 = await (await page.request.post('/api/makler', { data: { name: `${kennung} Bernd`, firma: `${kennung}  immobilien gmbh.` } })).json();
  // Gleicher Name in anderer Schreibweise → dasselbe Unternehmen
  expect(m1.unternehmenId).toBeTruthy();
  expect(m2.unternehmenId).toBe(m1.unternehmenId);
  expect(m2.firma).toBe(`${kennung} Immobilien GmbH`);

  // Makler-Dialog: Firma ist ein Feld mit Vorschlägen, ein neuer Name legt ein Unternehmen an
  await page.goto(`/makler?makler=${m2.id}`);
  const s = page.getByRole('region', { name: 'Makler-Detail' });
  const firma = s.getByRole('combobox', { name: 'Firma' });
  await expect(firma).toHaveValue(`${kennung} Immobilien GmbH`);
  await expect(s.getByLabel('Unternehmen')).toContainText('2 Makler');
  await firma.fill(`${kennung} Zweitfirma AG`);
  await s.getByRole('button', { name: 'Speichern' }).click();
  await expect(s.getByLabel('Unternehmen')).toContainText(`${kennung} Zweitfirma AG`);
  const detail = await (await page.request.get(`/api/makler/${m2.id}`)).json();
  expect(detail.unternehmen).toMatchObject({ name: `${kennung} Zweitfirma AG`, rechtsform: 'AG', maklerAnzahl: 1 });
  expect(detail.unternehmenId).not.toBe(m1.unternehmenId);

  // Einstellungen → Unternehmen: beide da, Zweitfirma in die Erste zusammenführen
  await page.goto('/einstellungen/unternehmen');
  await page.getByLabel('Unternehmen suchen').fill(kennung);
  const tabelle = page.getByRole('table', { name: 'Unternehmen' });
  await expect(tabelle.locator('[data-unternehmen]')).toHaveCount(2);
  await tabelle.locator(`[data-unternehmen="${detail.unternehmenId}"]`).getByRole('button', { name: 'Zusammenführen' }).click();
  const dialog = page.getByRole('dialog', { name: /zusammenführen/ });
  await dialog.getByRole('combobox', { name: 'Behalten' }).click();
  await page.getByRole('option', { name: new RegExp(`${kennung} Immobilien GmbH`) }).click();
  await dialog.getByRole('button', { name: 'Zusammenführen' }).click();
  await expect(dialog).toBeHidden();
  await expect(tabelle.locator('[data-unternehmen]')).toHaveCount(1);
  await expect(tabelle.locator(`[data-unternehmen="${m1.unternehmenId}"]`)).toContainText('2');
  expect((await (await page.request.get(`/api/makler/${m2.id}`)).json()).unternehmenId).toBe(m1.unternehmenId);
});
