import { berechneAnkauf, KALK_STANDARD } from '@gg/domain';
import { expect, type Page, test } from '@playwright/test';

async function objektUndDealAnlegen(page: Page, kennung: string) {
  const api = page.request;
  const objekt = await (await api.post('/api/objekte', { data: { strasse: kennung, hausnr: '1', stadt: 'Kalkstadt' } })).json();
  const deal = await (await api.post('/api/deals', { data: { objektId: objekt.id } })).json();
  return { objekt, deal };
}

test.describe('Deal-Kalkulation', () => {
  test('Eingaben rechnen live wie die Engine und bleiben nach dem Speichern erhalten', async ({ page }) => {
    const kennung = `Kalk ${Date.now()}`;
    await objektUndDealAnlegen(page, kennung);
    await page.goto('/deals');
    await page.getByRole('button', { name: new RegExp(kennung) }).click();
    await page.getByRole('tab', { name: 'Kalkulation', exact: true }).click();

    await page.getByRole('textbox', { name: 'Kaufpreis' }).fill('1.000.000');
    const einheiten = page.getByLabel('Einheiten');
    await einheiten.getByRole('button', { name: 'Einheit' }).click();
    await einheiten.getByRole('textbox', { name: 'Fläche' }).fill('80');
    await einheiten.getByRole('textbox', { name: 'Miete ist' }).fill('800');
    await einheiten.getByRole('textbox', { name: 'Rendite' }).fill('4,5');
    const sanierung = page.getByLabel('Sanierung');
    await sanierung.getByRole('button', { name: 'Posten' }).click();
    await sanierung.getByRole('textbox', { name: 'Betrag' }).fill('50.000');

    const erwartet = berechneAnkauf(
      { kaufpreis: 1_000_000 },
      [{ typ: 'Wohnung', fl: 80, mi_ist: 800, rend_k: 4.5 }],
      [{ amt: 50_000, scope: 'both' }],
      KALK_STANDARD,
    );
    const gik = `${Math.round(erwartet.aufteiler.gik).toLocaleString('de-DE')} €`;
    const aufteiler = page.getByLabel('Aufteiler');
    await expect(aufteiler.getByText(gik)).toBeVisible();
    await expect(page.getByText('ungespeichert')).toBeVisible();

    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.getByText('ungespeichert')).toBeHidden();
    await page.reload();
    await page.getByRole('button', { name: new RegExp(kennung) }).click();
    await page.getByRole('tab', { name: 'Kalkulation', exact: true }).click();
    await expect(page.getByLabel('Aufteiler').getByText(gik)).toBeVisible();
    await expect(page.getByLabel('Einheiten').getByRole('textbox', { name: 'Fläche' })).toHaveValue('80');
  });

  test('Kommentar anlegen und „Erledigt“ setzt den letzten Kontakt', async ({ page }) => {
    const kennung = `Info ${Date.now()}`;
    await objektUndDealAnlegen(page, kennung);
    await page.goto('/deals');
    await page.getByRole('button', { name: new RegExp(kennung) }).click();
    await page.getByRole('tab', { name: 'Kommunikation' }).click();
    await page.getByRole('textbox', { name: 'Neue Gesprächsnotiz' }).fill('Exposé angefordert');
    await page.getByRole('button', { name: '+ Eintrag' }).click();
    await expect(page.getByLabel('Kommentare').getByText('Exposé angefordert')).toBeVisible();
    await page.getByRole('button', { name: 'Erledigt' }).click();
    await expect(page.getByText(new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }), { exact: true })).toBeVisible(); // wie alt: 08.09.2026
  });
});

test.describe('Makler und Objekte', () => {
  test('Makler öffnen, Kommunikation eintragen', async ({ page }) => {
    const name = `Makler Komm ${Date.now()}`;
    await page.request.post('/api/makler', { data: { name } });
    await page.goto('/makler');
    await page.locator('[data-makler]').filter({ hasText: name }).click();
    const schublade = page.getByRole('region', { name: 'Makler-Detail' });
    await schublade.getByRole('tab', { name: '💬 Kommunikation' }).click();
    await schublade.getByRole('textbox', { name: 'Neue Notiz' }).fill('Rückruf wegen MFH');
    await schublade.getByRole('button', { name: /\+ Hinzufügen/ }).click();
    await expect(schublade.getByRole('region', { name: 'Kommunikation' }).getByText('Rückruf wegen MFH')).toBeVisible();
  });

  test('Objekt öffnen, Baujahr ändern und speichern', async ({ page }) => {
    const strasse = `Objektweg ${Date.now()}`;
    await page.request.post('/api/objekte', { data: { strasse, hausnr: '9' } });
    await page.goto('/objekte');
    await page.locator('[data-objekt]').filter({ hasText: `${strasse} 9` }).click();
    // Das Detail steht rechts neben der Liste (früher ein Schubfach).
    const schublade = page.getByRole('region', { name: 'Objekt-Detail' });
    await schublade.getByRole('tab', { name: '✏️ Bearbeiten' }).click();
    await schublade.getByRole('textbox', { name: 'Baujahr' }).fill('1905');
    const gespeichert = page.waitForResponse((r) => r.url().includes('/api/objekte/') && r.request().method() === 'PATCH');
    await schublade.getByRole('button', { name: 'Speichern' }).click();
    expect((await gespeichert).status()).toBe(200);
    // Neu laden statt schließen: der Detailbereich bleibt stehen, der Wert muss den Neuaufbau überleben.
    await page.reload();
    await page.locator('[data-objekt]').filter({ hasText: `${strasse} 9` }).click();
    await schublade.getByRole('tab', { name: '✏️ Bearbeiten' }).click();
    await expect(schublade.getByRole('textbox', { name: 'Baujahr' })).toHaveValue('1905');
  });

  test('Objektfotos hochladen, als Titelbild nach vorne holen und löschen', async ({ page }) => {
    const strasse = `Fotoweg ${Date.now()}`;
    await page.request.post('/api/objekte', { data: { strasse, hausnr: '3' } });
    await page.goto('/objekte');
    await page.locator('[data-objekt]').filter({ hasText: `${strasse} 3` }).click();
    const fotos = page.getByRole('region', { name: 'Objekt-Detail' }).getByRole('region', { name: 'Fotos des Objekts' });
    await expect(fotos.getByText('Noch keine Fotos.')).toBeVisible();

    // Zwei echte PNGs im Browser erzeugen (Canvas), wie ein Nutzer sie auswählen würde
    const png = async (farbe: string) => Buffer.from(await page.evaluate(async (f) => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 48;
      const g = c.getContext('2d')!; g.fillStyle = f; g.fillRect(0, 0, 64, 48);
      const b = await new Promise<Blob>((r) => c.toBlob((x) => r(x!), 'image/png'));
      return [...new Uint8Array(await b.arrayBuffer())];
    }, farbe));
    const [auswahl] = await Promise.all([page.waitForEvent('filechooser'), fotos.getByRole('button', { name: 'Fotos hinzufügen' }).click()]);
    await auswahl.setFiles([
      { name: 'rot.png', mimeType: 'image/png', buffer: await png('#c00') },
      { name: 'blau.png', mimeType: 'image/png', buffer: await png('#00c') },
    ]);
    await expect(fotos.locator('img')).toHaveCount(2); // Tabler-Symbole sind SVG, zählen hier nicht
    await expect(fotos.getByText('Titelbild')).toBeVisible();
    await expect(fotos.locator('img[alt="blau.png"]')).toHaveJSProperty('naturalWidth', 64); // Bild kommt wirklich aus der Ablage

    await fotos.getByLabel('Foto blau.png').getByRole('button', { name: 'Foto nach vorne' }).click();
    await expect(fotos.locator('img').first()).toHaveAttribute('alt', 'blau.png');

    page.once('dialog', (d) => void d.accept());
    await fotos.getByLabel('Foto rot.png').getByRole('button', { name: 'Foto löschen' }).click();
    await expect(fotos.locator('img')).toHaveCount(1);
  });
});
