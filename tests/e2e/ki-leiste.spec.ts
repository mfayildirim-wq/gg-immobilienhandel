import { expect, test } from '@playwright/test';

// Mit KI-Attrappe: das Modell nennt Dialog und Gedächtnis, `werkzeug:<name> {…}` ruft ein MCP-Werkzeug; Gedächtnis im Speicher
test('KI-Leiste: roter Kreis öffnet die Leiste zum offenen Dialog; Chat, Werkzeug, Ablegen, Verlauf; Dialogwechsel', async ({ page }) => {
  const name = `Leiste ${Date.now()}`;
  const m = await (await page.request.post('/api/makler', { data: { name, tel: '0711 2' } })).json();
  const o = await (await page.request.post('/api/objekte', { data: { strasse: `${name} Str`, hausnr: '5', stadt: 'Ulm' } })).json();

  await page.goto(`/makler?makler=${m.id}`);
  const leiste = page.getByRole('region', { name: 'KI-Leiste' });
  if (await leiste.isVisible()) await page.getByRole('button', { name: 'KI-Leiste schließen' }).first().click();
  await expect(leiste).toBeHidden();
  const breiteVorher = (await page.locator('main > *').first().boundingBox())?.width;
  await page.getByRole('button', { name: 'KI-Leiste öffnen' }).click();
  await expect(leiste).toBeVisible();
  // Offen steht der rote Kreis nicht im Kopf — geschlossen wird mit ✕ in der Leiste
  await expect(page.getByRole('button', { name: 'KI-Leiste öffnen' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'KI-Leiste schließen' })).toHaveCount(1);
  // Die Leiste liegt als Ebene über dem Inhalt: die Seite darunter behält ihre Breite
  expect((await page.locator('main > *').first().boundingBox())?.width).toBe(breiteVorher);
  await expect(leiste.locator(`[data-ki-bezug="makler:${m.id}"]`)).toContainText(`Makler: ${name}`);

  // Frage → Antwort der Attrappe mit Dialog und Gedächtnis (frischer Makler: noch leer)
  const frage = leiste.getByRole('textbox', { name: 'Frage an die KI' });
  await frage.fill('Was weißt du?');
  await frage.press('Enter');
  const antwort = leiste.locator('[data-ki-nachricht="ki"]').first();
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

  // „merk dir …“: die KI schlägt vor, erst „Ablegen“ speichert
  await frage.fill('merk dir: ruft nur vormittags zurück');
  await frage.press('Enter');
  const karte = leiste.getByRole('group', { name: 'Vorschlag fürs Gedächtnis' });
  await expect(karte).toContainText('ruft nur vormittags zurück');
  await expect(leiste.getByRole('tab', { name: /Gedächtnis \(1\)/ })).toBeVisible();
  await karte.getByRole('button', { name: 'Ablegen' }).click();
  await expect(leiste.locator('[data-ki-nachricht="ki"]').last()).toContainText('✓ Im Gedächtnis abgelegt: Notiz');
  await expect(leiste.getByRole('tab', { name: /Gedächtnis \(2\)/ })).toBeVisible();

  // Verlauf: das Gespräch steht dort, lässt sich wieder öffnen und löschen
  await leiste.getByRole('tab', { name: /Verlauf \(1\)/ }).click();
  await expect(leiste.locator('[data-ki-gespraech]')).toContainText('Was weißt du?');
  await leiste.getByRole('button', { name: 'Neues Gespräch' }).click();
  await expect(leiste.locator('[data-ki-nachricht]')).toHaveCount(0);
  await leiste.locator('[data-ki-gespraech]').click();
  await expect(leiste.locator('[data-ki-nachricht="ki"]').filter({ hasText: '✓ Im Gedächtnis abgelegt: Zusammenfassung' })).toHaveCount(1);
  await leiste.getByRole('button', { name: 'Gespräch löschen: Was weißt du?' }).click();
  await leiste.getByRole('button', { name: 'Wirklich löschen' }).click();
  await expect(leiste.getByRole('tab', { name: /Verlauf \(0\)/ })).toBeVisible();
  await expect(leiste.locator('[data-ki-nachricht]')).toHaveCount(0);

  // Anderer Dialog: neues Gespräch, Bezug folgt; die Leiste bleibt offen
  await page.goto(`/objekte?objekt=${o.id}`);
  await expect(leiste.locator(`[data-ki-bezug="objekt:${o.id}"]`)).toContainText(`Objekt: ${name} Str 5`);
  await expect(leiste.locator('[data-ki-nachricht]')).toHaveCount(0);
  await expect(leiste.getByRole('tab', { name: /Verlauf \(0\)/ })).toBeVisible();

  await page.getByRole('button', { name: 'KI-Leiste schließen' }).first().click();
  await expect(leiste).toBeHidden();
  await expect(page.getByRole('button', { name: 'KI-Leiste öffnen' })).toBeVisible();
});

test('KI-Leiste: Änderung nur mit Bestätigung — Karte zeigt die Felder, „Übernehmen“ speichert am Makler', async ({ page }) => {
  const name = `Ändern ${Date.now()}`;
  const m = await (await page.request.post('/api/makler', { data: { name, tel: '0711 3', prio: 'B' } })).json();
  await page.goto(`/makler?makler=${m.id}`);
  const leiste = page.getByRole('region', { name: 'KI-Leiste' });
  if (!(await leiste.isVisible())) await page.getByRole('button', { name: 'KI-Leiste öffnen' }).click();
  await expect(leiste.locator(`[data-ki-bezug="makler:${m.id}"]`)).toContainText(name);

  // Die Attrappe ruft das Schreibwerkzeug — es wird zur Karte, gespeichert ist noch nichts
  const frage = leiste.getByRole('textbox', { name: 'Frage an die KI' });
  await frage.fill(`werkzeug:update_makler {"id":"${m.id}","version":${m.version},"prio":"A","hinweis":"über die Leiste"}`);
  await frage.press('Enter');
  const karte = leiste.getByRole('group', { name: 'Änderung: Makler ändern' });
  await expect(karte).toContainText('prio');
  await expect(karte).toContainText('über die Leiste');
  await expect(karte).not.toContainText('version');
  expect((await (await page.request.get(`/api/makler/${m.id}`)).json()).prio).toBe('B');

  await karte.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(karte).toContainText('✓ Übernommen');
  await expect(karte.getByRole('button', { name: 'Übernehmen' })).toHaveCount(0);
  expect(await (await page.request.get(`/api/makler/${m.id}`)).json()).toMatchObject({ prio: 'A', hinweis: 'über die Leiste' });
});

test('KI-Leiste: linken Rand ziehen macht sie breiter — höchstens bis zur Fenstermitte, gemerkt; Doppelklick stellt 440 px wieder her', async ({ page }) => {
  await page.goto('/');
  const leiste = page.getByRole('region', { name: 'KI-Leiste' });
  if (!(await leiste.isVisible())) await page.getByRole('button', { name: 'KI-Leiste öffnen' }).click();
  const rand = page.locator('[data-ki-teiler]');
  const aside = page.locator('aside:has([data-ki-teiler])');
  await rand.dblclick();
  await expect.poll(async () => (await aside.boundingBox())?.width).toBe(440);

  const fenster = page.viewportSize()!.width;
  const ziehen = async (um: number) => {
    const b = (await rand.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + 200);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 - um, b.y + 200, { steps: 5 });
    await page.mouse.up();
  };
  await ziehen(100);
  await expect.poll(async () => (await aside.boundingBox())?.width).toBe(Math.min(540, Math.round(fenster / 2)));
  // Weit über die Mitte hinaus: bleibt an der Mitte stehen
  await ziehen(fenster);
  await expect.poll(async () => (await aside.boundingBox())?.width).toBe(Math.round(fenster / 2));
  await page.reload();
  if (!(await leiste.isVisible())) await page.getByRole('button', { name: 'KI-Leiste öffnen' }).click();
  await expect.poll(async () => (await aside.boundingBox())?.width).toBe(Math.round(fenster / 2));
  await rand.dblclick();
  await expect.poll(async () => (await aside.boundingBox())?.width).toBe(440);
});
