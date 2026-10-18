import { expect, test } from '@playwright/test';

// Unternehmen (18.10.2026): Firma, Webseite und Anschrift gehören der Firma — alle ihre Makler sehen dieselben Werte.
test('Makler-Profil: Block „Unternehmen“ nennt die Kollegen; die Webseite gilt für alle Makler der Firma', async ({ page }) => {
  const k = `Firma${Date.now()}`;
  const a = await (await page.request.post('/api/makler', { data: { name: `${k} Anna`, firma: `${k} Immobilien GmbH` } })).json();
  const b = await (await page.request.post('/api/makler', { data: { name: `${k} Bernd`, firma: `${k.toLowerCase()} immobilien gmbh` } })).json();

  await page.goto(`/makler?makler=${a.id}`);
  const s = page.getByRole('region', { name: 'Makler-Detail' });
  await expect(s.getByRole('heading', { name: '🏢 Unternehmen' })).toBeVisible();
  await expect(s.getByLabel('Firma')).toHaveValue(`${k} Immobilien GmbH`);
  await expect(s.locator('[data-unternehmen-kollegen]')).toContainText(`${k} Bernd`);

  await s.getByLabel('Webseite').fill('www.gemeinsam.example');
  await s.getByRole('button', { name: 'Speichern' }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/makler/${b.id}`)).json()).webseite).toBe('www.gemeinsam.example');

  // Über den Kollegen-Link zum anderen Makler: er zeigt dieselbe Webseite
  await s.locator('[data-unternehmen-kollegen]').getByText(`${k} Bernd`).click();
  await expect(s.getByLabel('Name')).toHaveValue(`${k} Bernd`);
  await expect(s.getByLabel('Webseite')).toHaveValue('www.gemeinsam.example');

  for (const id of [a.id, b.id]) await page.request.delete(`/api/makler/${id}`);
});
