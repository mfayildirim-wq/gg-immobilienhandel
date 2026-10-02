import { expect, test } from '@playwright/test';

test.describe('App-Rahmen', () => {
  test('Seitenleiste: eingeklappt bleiben die Symbole, die Maus klappt sie vorübergehend aus', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, 'auf kleinen Bildschirmen über das Menü');
    await page.goto('/deals');
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(nav.getByText('Deals', { exact: true })).toBeVisible();

    // Einklappen: nur noch Symbole, die Einträge bleiben erreichbar
    await page.getByRole('button', { name: 'Seitenleiste einklappen' }).click();
    await expect(nav).toHaveAttribute('data-schmal', 'true');
    await expect(nav.getByText('Deals', { exact: true })).toBeHidden();
    await expect(nav.getByRole('link', { name: 'Deals' })).toBeVisible();
    await page.waitForTimeout(250);
    expect((await nav.boundingBox())?.width).toBe(64);

    // Maus darüber klappt vorübergehend aus — erst hinaus (der Klapp-Knopf liegt eingeklappt innerhalb der 64 px), dann hinein
    await page.mouse.move(900, 400);
    await page.waitForTimeout(100);
    await nav.hover();
    await expect(nav).not.toHaveAttribute('data-schmal', 'true');
    await page.waitForTimeout(250);
    expect((await nav.boundingBox())?.width).toBe(240);

    await page.getByRole('button', { name: 'Seitenleiste ausklappen' }).click();
    await page.mouse.move(900, 400);
    await expect(nav.getByText('Deals', { exact: true })).toBeVisible();
  });

  test('Navigation: die gewählte Seite steht fett', async ({ page }) => {
    await page.goto('/deals');
    const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });
    const gewicht = (name: string) => nav.getByRole('link', { name }).evaluate((e) => getComputedStyle(e.querySelector('.mantine-NavLink-label') ?? e).fontWeight);
    expect(await gewicht('Deals')).toBe('700');
    expect(await gewicht('Objekte')).not.toBe('700');
  });

  test('Wählmaschine öffnet von „Nächste Kontakte“ aus — im Kopf der App gibt es keinen Knopf mehr', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: 'Wählmaschine' })).toBeHidden();
    await expect(page.getByRole('banner').getByRole('button', { name: 'Wählmaschine öffnen' })).toHaveCount(0);
    await page.getByLabel('Nächste Kontakte').getByRole('button', { name: 'Wählmaschine öffnen' }).click();
    await expect(page.getByRole('dialog', { name: 'Wählmaschine' })).toBeVisible();
  });
});

test.describe('Deals', () => {
  test('Ansicht wechselt zwischen nebeneinander und untereinander und bleibt gemerkt', async ({ page }) => {
    await page.goto('/deals');
    const bereich = page.locator('[data-layout]');
    await expect(bereich).toHaveAttribute('data-layout', 'nebeneinander');
    await page.getByLabel('untereinander').click();
    await expect(bereich).toHaveAttribute('data-layout', 'untereinander');
    await page.reload();
    await expect(page.locator('[data-layout]')).toHaveAttribute('data-layout', 'untereinander');
  });

  test('Listenzeile: Überfahren färbt den Hintergrund, die Auswahl bleibt hervorgehoben', async ({ page }) => {
    await page.goto('/deals');
    const zeilen = page.locator('[data-deal]');
    await zeilen.first().waitFor();
    test.skip(await zeilen.count() < 2, 'braucht mindestens zwei Deals');
    const farbe = (n: number) => zeilen.nth(n).evaluate((e) => getComputedStyle(e).backgroundColor);

    // Die zweite Zeile ist nicht gewählt: ruhend durchsichtig, beim Überfahren gefärbt
    const ruhe = await farbe(1);
    await zeilen.nth(1).hover();
    await page.waitForTimeout(200);
    expect(await farbe(1)).not.toBe(ruhe);

    // Die gewählte Zeile bleibt in der Auswahlfarbe, auch ohne Maus darauf
    await expect(zeilen.first()).toHaveAttribute('data-aktiv', 'true');
    expect(await farbe(0)).not.toBe(ruhe);
  });

  test('Objekt und Makler anlegen, Deal anlegen, Status wechseln, Verlauf sehen', async ({ page }) => {
    // Dublettenprüfung beim Anlegen (wie alt): ähnliche Namen aus früheren Läufen mit „Trotzdem anlegen“ bestätigen
    page.on('dialog', (d) => void d.accept());
    const kennung = `E2E ${Date.now()}`;

    await page.goto('/objekte');
    await page.getByRole('button', { name: 'Neues Objekt' }).click();
    await page.getByLabel('Straße').fill(kennung);
    await page.getByLabel('Hausnr.').fill('5');
    await page.getByLabel('Stadt').fill('Teststadt');
    await page.getByRole('button', { name: 'Objekt anlegen' }).click();
    await expect(page.locator('[data-objekt]').filter({ hasText: `${kennung} 5` })).toBeVisible();

    await page.goto('/makler');
    await page.getByRole('button', { name: 'Neuer Makler' }).click();
    // „Name" steht auch im Detail rechts — deshalb im Dialog suchen.
    const neuerMakler = page.getByRole('dialog', { name: 'Neuer Makler' });
    await neuerMakler.getByLabel('Name').fill(`Makler ${kennung}`);
    await neuerMakler.getByRole('button', { name: 'Makler anlegen' }).click();
    await expect(page.locator('[data-makler]').filter({ hasText: `Makler ${kennung}` })).toBeVisible();

    await page.goto('/deals');
    await page.getByRole('button', { name: 'Neuer Deal' }).click();
    const dialog = page.getByRole('dialog', { name: 'Neuer Deal' });
    await dialog.getByRole('combobox', { name: 'Objekt' }).fill(kennung);
    await page.getByRole('option', { name: new RegExp(kennung) }).click();
    await dialog.getByRole('combobox', { name: 'Makler' }).fill(`Makler ${kennung}`);
    await page.getByRole('option', { name: `Makler ${kennung}` }).click();
    await dialog.getByRole('button', { name: 'Deal anlegen' }).click();

    const detail = page.getByLabel('Deal-Detail');
    await expect(detail.getByRole('heading', { name: `${kennung} 5` })).toBeVisible();
    await detail.getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Closing Path' }).click();

    const verlauf = detail.getByRole('region', { name: 'Status-Verlauf' });
    await expect(verlauf.getByText('Closing Path', { exact: true })).toBeVisible();
    await expect(verlauf.getByText('von In Prüfung')).toBeVisible();
  });
});

test('Einstellungen: Untermenü mit einer Seite je Bereich', async ({ page }) => {
  await page.goto('/einstellungen');
  await expect(page).toHaveURL(/\/einstellungen\/kalkulation$/);
  await expect(page.getByRole('region', { name: 'Kalkulation Einstellungen' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Begleitscheine Einstellungen' })).toHaveCount(0);
  const menue = page.getByRole('navigation', { name: 'Hauptnavigation' });
  for (const [link, bereich] of [['Kundenkalkulation', 'Standardannahmen Kundenkalkulation'], ['Bank-Präsentation', 'Bank-Präsentation Standards'], ['Vertriebslisten', 'Vertriebslisten Einstellungen'], ['Begleitscheine', 'Begleitscheine Einstellungen']] as const) {
    await menue.locator('a[href^="/einstellungen/"]', { hasText: link }).click();
    await expect(page.getByRole('region', { name: bereich }).or(page.getByRole('heading', { name: bereich }))).toBeVisible();
    await expect(page.getByRole('region', { name: 'Kalkulation Einstellungen' })).toHaveCount(0);
  }
});

for (const [pfad, liste, detail] of [['/deals', 'Deal-Liste', 'Deal-Detail'], ['/objekte', 'Objekt-Liste', 'Objekt-Detail'], ['/makler', 'Makler-Liste', 'Makler-Detail']] as const) {
  test(`${pfad}: Teiler ziehen und Liste einklappen wie auf der Ankauf-Seite`, async ({ page }) => {
    await page.goto(pfad);
    const listenfeld = page.getByLabel(liste, { exact: true });
    const detailfeld = page.getByRole('region', { name: detail });
    const breite = async (l: typeof listenfeld) => Math.round((await l.boundingBox())!.width);
    await expect(detailfeld.getByRole('button', { name: 'Liste ausblenden' })).toBeVisible();
    expect(await breite(listenfeld)).toBe(360);
    const detailVorher = await breite(detailfeld);

    // Teiler 100 px nach rechts: die Liste wird breiter, das Detail um denselben Betrag schmaler
    const teiler = page.getByRole('separator', { name: 'Breite der Liste ändern' });
    const t = (await teiler.boundingBox())!;
    await page.mouse.move(t.x + t.width / 2, t.y + 80);
    await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2 + 100, t.y + 80, { steps: 6 });
    await page.mouse.up();
    expect(await breite(listenfeld)).toBe(460);
    expect(await breite(detailfeld)).toBe(detailVorher - 100);

    // Liste zu: das Detail hat die ganze Breite; wieder auf: die gezogene Breite ist geblieben
    await detailfeld.getByRole('button', { name: 'Liste ausblenden' }).click();
    await expect(listenfeld).toBeHidden();
    expect(await breite(detailfeld)).toBeGreaterThan(detailVorher + 300);
    await page.reload();
    await detailfeld.getByRole('button', { name: 'Liste einblenden' }).click();
    await expect(listenfeld).toBeVisible();
    expect(await breite(listenfeld)).toBe(460);
  });
}
