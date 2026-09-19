import { expect, test } from '@playwright/test';

test('Makler-Detail: Profil (Prio, Telefon normalisiert, Nicht kontaktieren), Notiz mit KI-Zusammenfassung und Erwähnung, Beziehungsprofil, E-Mail mit Vorlage, Persönlich, Deals, Löschen', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  const name = `Makler Detail ${Date.now()}`;
  const m = await (await page.request.post('/api/makler', { data: { name, email: 'detail@example.test', tel: '0711 555' } })).json();
  const o = await (await page.request.post('/api/objekte', { data: { strasse: `${name} Str`, hausnr: '1', stadt: 'Ulm', angebotspreis: 900000 } })).json();
  await page.request.post('/api/deals', { data: { objektId: o.id, maklerId: m.id } });

  await page.goto(`/makler?makler=${m.id}`);
  // Das Detail steht rechts neben der Liste (früher ein Schubfach).
  const s = page.getByRole('region', { name: 'Makler-Detail' });

  // 👤 Profil
  await s.getByText('▲ A', { exact: true }).click();
  await s.getByLabel('Telefon').fill('0049 (711) 999 888');
  await s.getByRole('combobox', { name: 'Frequenz' }).click();
  await page.getByRole('option', { name: 'Nicht kontaktieren' }).click();
  await s.getByRole('button', { name: 'Speichern' }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/makler/${m.id}`)).json())).toMatchObject({ prio: 'A', tel: '+49 711 999 888', kontaktFrequenz: 'Nie' });

  // 💬 Kommunikation: Notiz → Verlauf, KI-Zusammenfassung, Erwähnung
  await s.getByRole('tab', { name: '💬 Kommunikation' }).click();
  await s.getByRole('textbox', { name: 'Neue Notiz' }).fill('Er fährt nächste Woche in den Urlaub nach Mallorca.');
  await s.getByRole('button', { name: /\+ Hinzufügen/ }).click();
  const verlauf = s.getByRole('region', { name: 'Kommunikation' });
  await expect(verlauf.locator('[data-kanal]').first()).toHaveText('Notiz');
  await expect(verlauf.locator('[data-ts]').first()).toHaveText(new RegExp(`^${new Date().toLocaleDateString('de-DE')} \\d{2}:\\d{2}$`));
  await expect(s.locator('[data-ki-zusammenfassung]')).toContainText('Test-Modus');
  await s.getByRole('button', { name: '🤖 Analysieren' }).click();
  await expect(s.getByText('Noch zu wenig Kommunikation mit diesem Makler')).toBeVisible();

  // E-Mail vorbereiten mit Vorlage „Erstanfrage“: Platzhalter aus Deal/Objekt
  await s.getByRole('button', { name: '✉️ E-Mail vorbereiten' }).click();
  const mail = s.locator('[aria-label="E-Mail vorbereiten"]');
  await mail.getByRole('combobox', { name: 'Vorlage' }).click();
  await page.getByRole('option', { name: 'Erstanfrage' }).click();
  await expect(mail.getByLabel('Betreff')).toHaveValue(`Anfrage: ${name} Str, Ulm`);
  await expect(mail.getByLabel('Nachricht')).toHaveValue(new RegExp(`ich habe Ihr Angebot in Ulm \\(${name} Str\\) gesehen`));

  // 🎯 Persönlich: Erwähnung aus der Notiz, Geburtstag speichern
  await s.getByRole('tab', { name: '🎯 Persönlich' }).click();
  await expect(s.locator('[data-erwaehnung="0"]')).toContainText('Urlaub');
  await s.getByLabel('🎂 Geburtstag').fill('03-15');
  await s.getByRole('button', { name: 'Persönliches speichern' }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/makler/${m.id}`)).json()).persoenlich).toMatchObject({ geburtsdatum: '03-15', geburtstagQuelle: 'manuell' });

  // 🤝 Deals
  await s.getByRole('tab', { name: '🤝 Deals' }).click();
  await expect(s.getByText('Aktive Deals (1)')).toBeVisible();
  await expect(s.locator('[data-makler-deal]')).toContainText(`${name} Str, Ulm`);

  // Löschen → Papierkorb
  await s.getByRole('tab', { name: '👤 Profil' }).click();
  await s.getByRole('button', { name: 'Löschen' }).click();
  // Der Detailbereich bleibt stehen und zeigt den nächsten Makler — der gelöschte verschwindet aus der Liste.
  await expect(page.locator('[data-makler]').filter({ hasText: name })).toHaveCount(0);
  await expect(s).not.toContainText(name);
  expect((await page.request.get(`/api/makler/${m.id}`)).status()).toBe(404);
});
