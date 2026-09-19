import { expect, test } from '@playwright/test';

test('Cockpit: KI-Stil analysieren, Nachricht entwerfen, Mail-Vorlage wählen, Gesprächsöffner im Briefing', async ({ page }) => {
  const heute = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const name = `KI Karl ${Date.now()}`;
  const m = await (await page.request.post('/api/makler', { data: { name, tel: '+49 711 4711', email: 'karl@example.test', prio: 'A' } })).json();
  const d = await (await page.request.get(`/api/makler/${m.id}`)).json();
  await page.request.patch(`/api/makler/${m.id}`, { data: { version: d.version, nextContact: heute } });
  for (const text of ['Hallo Karl, hast du das Exposé?', 'Danke dir!', 'Kannst du mir die Mieterliste schicken?', 'Bis morgen', 'Grüße']) {
    await page.request.post(`/api/makler/${m.id}/kommunikation`, { data: { kanal: 'whatsapp', richtung: 'ausgehend', text } });
  }
  // lastContact wurde heute → nächster Kontakt erneut auf heute setzen
  const d2 = await (await page.request.get(`/api/makler/${m.id}`)).json();
  await page.request.patch(`/api/makler/${m.id}`, { data: { version: d2.version, nextContact: heute } });

  await page.goto('/');
  await page.getByRole('button', { name: 'Makler kontaktieren öffnen' }).click();
  await page.getByRole('button', { name: '🧠 KI-Stil' }).click();
  const stil = page.getByRole('dialog', { name: '🧠 Kommunikationsstil' });
  await stil.getByRole('button', { name: /Kommunikationsstil analysieren|Neu analysieren/ }).click();
  await expect(stil.getByText('Test-Modus: direkt und freundlich.')).toBeVisible();
  // Nicht mit Escape: das schlösse auch das Schubfach darunter, in dem die Makler-Karten stehen.
  await stil.getByRole('button', { name: 'Schließen' }).click();

  const karte = page.getByRole('article', { name: `Makler ${name}` }).or(page.getByLabel(`Makler ${name}`, { exact: true }));
  await karte.getByRole('button', { name: /Nachricht entwerfen/ }).click();
  await expect(karte.locator('[data-entwurf-wa]')).toContainText('Test-Modus');
  await expect(karte.getByRole('link', { name: '📱 Als WA senden' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\+49711 ?4711\?text=/);

  await karte.getByRole('button', { name: 'karl@example.test' }).click();
  const auswahl = page.getByRole('dialog', { name: '✉️ E-Mail-Vorlage wählen' });
  await expect(auswahl.locator('[data-mailvorlage="Nachfass"]')).toHaveAttribute('href', new RegExp(`^mailto:karl@example.test\\?subject=Nochmal%3A`));
  await expect(auswahl.locator('[data-mailvorlage="Nachfass"]')).toHaveAttribute('href', new RegExp(encodeURIComponent(`Guten Tag ${name}`)));
  await auswahl.getByRole('button', { name: 'Schließen' }).click();

  await karte.getByRole('button', { name: /anrufen/ }).click();
  const briefing = page.getByRole('dialog', { name: `📞 ${name}` });
  await expect(briefing.locator('[data-gespraechsoeffner]')).toContainText('Test-Modus');
  await expect(briefing.getByRole('button', { name: '🎤 Anruf aufnehmen' })).toBeVisible();
});
