import { expect, test } from '@playwright/test';

test('Globale Suche: 🔍 im Kopf und ⌘F, Treffer je Bereich, Klick öffnet Objekt, Deal und Makler', async ({ page }) => {
  const kennung = `Suchweg${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse: kennung, hausnr: '7', plz: '70173', stadt: 'Stuttgart' } })).json();
  const m = await (await page.request.post('/api/makler', { data: { name: `${kennung} Makler`, firma: 'Suchfirma', tel: '+49 711 4711' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id, maklerId: m.id } })).json();

  await page.goto('/');
  await page.getByRole('button', { name: 'Suche öffnen' }).click();
  const dialog = page.getByRole('dialog', { name: '🔍 Suche' });
  await expect(dialog.getByText('Suchbegriff eingeben…')).toBeVisible();
  await dialog.getByLabel('Suche').fill('a');
  await expect(dialog.getByText('Mindestens 2 Zeichen…')).toBeVisible();
  await dialog.getByLabel('Suche').fill(`${kennung}xx`);
  await expect(dialog.getByText('Kein Treffer')).toBeVisible();

  await dialog.getByLabel('Suche').fill(kennung);
  await expect(dialog.getByText('🏢 Objekte (1)')).toBeVisible();
  await expect(dialog.getByText('📋 Deals (1)')).toBeVisible();
  await expect(dialog.getByText('🤝 Makler (1)')).toBeVisible();
  await expect(dialog.locator(`[data-treffer="${o.id}"]`)).toContainText(`${kennung} 7`);
  await expect(dialog.locator(`[data-treffer="${m.id}"]`)).toContainText('Suchfirma · +49 711 4711');
  await dialog.locator(`[data-treffer="${d.id}"]`).click();
  await expect(page.getByRole('region', { name: 'Deal-Detail' })).toContainText(kennung);

  // Telefonziffern finden den Makler; ⌘F öffnet die Suche
  await page.keyboard.press('ControlOrMeta+f');
  await dialog.getByLabel('Suche').fill('711 4711');
  await dialog.locator(`[data-treffer="${m.id}"]`).click();
  // Der Name steht im Profil als Eingabefeld, nicht als Text.
  await expect(page.getByRole('region', { name: 'Makler-Detail' }).getByLabel('Name', { exact: true })).toHaveValue(`${kennung} Makler`);
});
