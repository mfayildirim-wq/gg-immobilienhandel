import { expect, test } from '@playwright/test';

test('Dubletten: Paar finden, vergleichen, zusammenführen, rückgängig, ignorieren', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const kennung = `Dublette${Date.now()}`;
  const m1 = await (await page.request.post('/api/makler', { data: { name: `${kennung} Anna`, email: `${kennung}@example.test`, prio: 'B' } })).json();
  const m2 = await (await page.request.post('/api/makler', { data: { name: `${kennung} Anna`, email: `${kennung}@example.test`, firma: 'Doppelt GmbH', prio: 'A' } })).json();

  await page.goto('/einstellungen/dubletten');
  const zeile = page.locator(`[data-dublette="${m1.id}:${m2.id}"], [data-dublette="${m2.id}:${m1.id}"]`);
  await expect(zeile).toContainText('Gleiche E-Mail-Adresse');
  await expect(zeile).toContainText('Exakt');
  // Die Liste steht in der Reihenfolge der Makler-Liste (neu zuerst): A ist der zweite angelegte Makler
  const [erst, zweit] = (await zeile.getAttribute('data-dublette'))!.split(':');
  expect(erst).toBe(m2.id);

  await zeile.getByRole('button', { name: 'Vergleichen & Zusammenführen' }).click();
  const dialog = page.getByRole('dialog', { name: /Zusammenführen/ });
  await expect(dialog.locator('[data-konflikt="prio"]')).toBeVisible();
  await dialog.locator('[data-konflikt="prio"]').getByRole('radio', { name: 'A' }).check();
  await dialog.getByRole('button', { name: '✓ Zusammenführen' }).click();
  await expect(dialog).toBeHidden();

  // Der behaltene Makler (A) behält seine Firma, das Duplikat liegt im Papierkorb
  const zusammen = await (await page.request.get(`/api/makler/${erst}`)).json();
  expect(zusammen).toMatchObject({ firma: 'Doppelt GmbH', prio: 'A' });
  expect((await page.request.get(`/api/makler/${zweit}`)).status()).toBe(404);
  await expect(page.getByText('Zuletzt zusammengeführt')).toBeVisible();

  await page.getByRole('button', { name: '↩ Rückgängig' }).first().click();
  await expect(page.locator(`[data-dublette="${erst}:${zweit}"]`)).toBeVisible();
  expect((await page.request.get(`/api/makler/${zweit}`)).status()).toBe(200);

  await page.locator(`[data-dublette="${erst}:${zweit}"]`).getByRole('button', { name: 'Keine Dublette' }).click();
  await expect(page.locator(`[data-dublette="${erst}:${zweit}"]`)).toHaveCount(0);
});
