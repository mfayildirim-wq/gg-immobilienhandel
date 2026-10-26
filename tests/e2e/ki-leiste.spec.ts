import { expect, test } from '@playwright/test';

// Mit KI-Attrappe: das Modell nennt Dialog und Gedächtnis, `werkzeug:<name> {…}` ruft ein MCP-Werkzeug; Gedächtnis im Speicher
test('KI-Leiste: roter Kreis öffnet die Leiste zum offenen Dialog; Chat, Werkzeug, Ablegen, Verlauf; Dialogwechsel', async ({ page }) => {
  const name = `Leiste ${Date.now()}`;
  const m = await (await page.request.post('/api/makler', { data: { name, tel: '0711 2' } })).json();
  const o = await (await page.request.post('/api/objekte', { data: { strasse: `${name} Str`, hausnr: '5', stadt: 'Ulm' } })).json();

  await page.goto(`/makler?makler=${m.id}`);
  const leiste = page.getByRole('region', { name: 'KI-Leiste' });
  if (!(await leiste.isVisible())) await page.getByRole('button', { name: 'KI-Leiste öffnen' }).click();
  await expect(leiste.locator(`[data-ki-bezug="makler:${m.id}"]`)).toContainText(`Makler: ${name}`);

  // Frage → Antwort der Attrappe mit Dialog und Gedächtnis (frischer Makler: noch leer)
  const frage = leiste.getByRole('textbox', { name: 'Frage an die KI' });
  await frage.fill('Was weißt du?');
  await frage.press('Enter');
  const antwort = leiste.locator('[data-ki-nachricht="ki"]').last();
  await expect(antwort).toContainText(`Dialog: Makler „${name}“ · Gedächtnis: 0 Einträge`);

  // Folgefrage im selben Gespräch: das MCP-Werkzeug liest den Makler
  await frage.fill(`werkzeug:read_entity {"collection":"makler","id":"${m.id}"}`);
  await leiste.getByRole('button', { name: 'Senden' }).click();
  await expect(leiste.locator('[data-ki-nachricht="ki"]').last()).toContainText('das Werkzeug hat geantwortet');
  await expect(leiste.locator('[data-ki-nachricht="ki"]').last()).toContainText('🔧 read_entity');

  // Antwort mit Titel ablegen → steht im Gedächtnis des Maklers
  await antwort.getByRole('button', { name: '🧠 Im Gedächtnis ablegen' }).click();
  await antwort.getByRole('textbox', { name: 'Titel im Gedächtnis' }).fill('Zusammenfassung');
  await antwort.getByRole('button', { name: 'Ablegen' }).click();
  await expect(antwort).toContainText('✓ Im Gedächtnis abgelegt: Zusammenfassung');
  await leiste.getByRole('tab', { name: /Gedächtnis \(1\)/ }).click();
  await expect(leiste.locator('[data-ki-gedaechtnis]').filter({ hasText: 'Zusammenfassung' })).toContainText('abgelegt');
  await leiste.getByRole('tab', { name: /Verlauf \(1\)/ }).click();
  await expect(leiste.locator('[data-ki-gespraech]')).toContainText('Was weißt du?');

  // Anderer Dialog: neues Gespräch, Bezug folgt; die Leiste bleibt offen
  await page.goto(`/objekte?objekt=${o.id}`);
  await expect(leiste.locator(`[data-ki-bezug="objekt:${o.id}"]`)).toContainText(`Objekt: ${name} Str 5`);
  await expect(leiste.locator('[data-ki-nachricht]')).toHaveCount(0);
  await expect(leiste.getByRole('tab', { name: /Verlauf \(0\)/ })).toBeVisible();

  await page.getByRole('button', { name: 'KI-Leiste schließen' }).first().click();
  await expect(leiste).toBeHidden();
});
