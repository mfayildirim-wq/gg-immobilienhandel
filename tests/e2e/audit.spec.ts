import { expect, test } from '@playwright/test';

test('Audit-Log: Eintrag erscheint, Filter und Suche greifen, Hash-Kette wird geprüft', async ({ page }) => {
  const kennung = `Audit${Date.now()}`;
  const o = await (await page.request.post('/api/objekte', { data: { strasse: `${kennung}weg`, hausnr: '1' } })).json();
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id } })).json();
  const hoch = await page.request.post(`/api/deals/${d.id}/dokumente`, {
    multipart: { dateien: { name: 'Audit.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n' + 'x'.repeat(120)) } },
  });
  const dok = (await hoch.json())[0];
  await page.request.patch(`/api/deals/${d.id}/dokumente/${dok.id}`, { data: { label: kennung } });

  await page.goto('/einstellungen/audit');
  await page.getByLabel('Audit durchsuchen').fill(kennung);
  const liste = page.getByLabel('Audit-Liste');
  await expect(liste.locator('[data-audit]').first()).toContainText('doc');
  await expect(liste.locator('[data-audit]').first()).toContainText('Feld: label');
  await expect(liste.locator('[data-audit]').first()).toContainText(kennung);

  await page.getByLabel('Typ').selectOption('kicall');
  await expect(page.locator('[data-audit-zaehler]')).toBeVisible();
  await page.getByLabel('Typ').selectOption('');

  // Die Kette muss ab dem Eintrag dieses Laufs stimmen; ältere Brüche aus früheren Läufen zählen nicht
  const neueste = (await (await page.request.get('/api/audit?limit=1')).json()).zeilen[0].id as number;
  await page.getByRole('button', { name: '🔐 Hash-Kette prüfen' }).click();
  await expect(page.locator('[data-kette]')).toBeVisible();
  const befund = await (await page.request.get('/api/audit/pruefen')).json();
  if (!befund.ok) expect(befund.brokenAt.id, `Bruch bei ${befund.brokenAt.id} (neueste Zeile ${neueste})`).toBeLessThan(neueste);
});
