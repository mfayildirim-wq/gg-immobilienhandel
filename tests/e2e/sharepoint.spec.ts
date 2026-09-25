import { expect, test } from '@playwright/test';

/**
 * Einstellungen → SharePoint: Stand, Formular, Speichern ohne die Ablage zu verändern. Der Verbindungstest braucht einen
 * echten Mandanten und läuft nicht hier (dafür `pnpm sharepoint:probe` und der Knopf in der Oberfläche).
 */
test('SharePoint-Einstellungen: Stand sichtbar, Speichern hält die Werte, Schalter hängt an der Azure-App', async ({ page }) => {
  const vorher = await (await page.request.get('/api/sharepoint')).json();
  await page.goto('/einstellungen/sharepoint');
  const status = page.locator('[data-sharepoint-status]');
  await expect(status).toContainText(vorher.aktiv ? 'aktiv' : vorher.siteUrl ? 'eingerichtet, nicht aktiv' : 'nicht eingerichtet');
  await expect(page.getByLabel('Site-Adresse')).toHaveValue(vorher.siteUrl);
  await expect(page.getByLabel('Wurzelordner in der Dokumentbibliothek')).toHaveValue(vorher.wurzel);
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeDisabled(); // nichts geändert

  // Wurzel ändern und zurück — Speichern wird aktiv, die Ablage bleibt, wie sie war
  const wurzel = page.getByLabel('Wurzelordner in der Dokumentbibliothek');
  await wurzel.fill(`${vorher.wurzel} X`);
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Verbindung prüfen' })).toBeDisabled();
  await wurzel.fill(vorher.wurzel);
  await expect(page.getByRole('button', { name: 'Speichern' })).toBeDisabled(); // wieder wie gespeichert
  const nachher = await (await page.request.get('/api/sharepoint')).json();
  expect(nachher).toEqual(vorher);
  // ohne Azure-App kein Schalter
  if (!vorher.m365Eingerichtet) await expect(page.getByLabel(/SharePoint aktiv/)).toBeDisabled();
});
