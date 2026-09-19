import { expect, test } from '@playwright/test';

test('Angebote: Posteingang aus Microsoft 365, Sperren und Sperre aufheben, Anhang übernehmen', async ({ page }) => {
  // Test-Modus: die Attrappe liefert zwei feste Mails; Sperren aus früheren Läufen zurücknehmen
  for (const uid of ['mail-1', 'mail-2']) await page.request.delete(`/api/m365/mails/${uid}/sperren`);

  await page.goto('/angebote');
  const mail = page.locator('[data-mail="mail-1"]');
  await expect(mail).toContainText('Angebot: Musterweg 1');
  await expect(mail).toContainText('Anna Beispiel');
  await expect(mail.getByRole('button', { name: /Expose\.pdf/ })).toBeVisible();
  await expect(mail.getByRole('link', { name: '🔗 immo.example.test' })).toBeVisible();
  // Triage sagt, wo das Exposé steckt, und begründet es
  await expect(mail.locator('[data-triage]')).toContainText('Landing-Page');
  await expect(mail.locator('[data-triage]')).toContainText('Punkte');

  // Sperren blendet die Mail aus, „auch gesperrte" zeigt sie wieder
  await page.locator('[data-mail="mail-2"]').getByRole('button', { name: '🚫 Sperren' }).click();
  await expect(page.locator('[data-mail="mail-2"]')).toHaveCount(0);
  await page.getByLabel('auch gesperrte').check();
  await expect(page.locator('[data-mail="mail-2"]')).toContainText('gesperrt');
  await page.locator('[data-mail="mail-2"]').getByRole('button', { name: '↩ Sperre aufheben' }).click();
  await expect(page.locator('[data-mail="mail-2"]').getByRole('button', { name: '🚫 Sperren' })).toBeVisible();

  // Anhang übernehmen: landet im Exposé-Import und wird dort analysiert
  await page.getByLabel('auch gesperrte').uncheck();
  await page.locator('[data-mail="mail-1"]').getByRole('button', { name: /Expose\.pdf/ }).click();
  await expect(page).toHaveURL(/\/expose-import\?key=/);
  await expect(page.getByText(/Analyse abgeschlossen|Claude liest das Exposé/)).toBeVisible({ timeout: 20_000 });
});

test('Microsoft 365: Zugang in den Einstellungen eintragen und Status sehen', async ({ page }) => {
  await page.goto('/einstellungen/m365');
  await page.getByLabel('Client-ID').fill('app-klicktest');
  await page.getByLabel('Verzeichnis (Tenant)').fill('contoso.onmicrosoft.com');
  await page.getByLabel('Client-Geheimnis').fill('geheim-klicktest');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('[data-m365-status]')).toContainText('eingerichtet');
  await expect(page.getByText('Mail.Read')).toBeVisible();
});
