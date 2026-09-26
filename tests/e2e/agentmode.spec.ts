import { expect, type Page, test } from '@playwright/test';

/**
 * AgentMode im Browser (mit `KI_ATTRAPPE=1` antwortet das Attrappen-Modell deterministisch):
 * Overlay einschalten → Auftrag tippen → der Agent bedient die App sichtbar → Bestätigung → Notiz ist gespeichert.
 */

const heute = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());

const angelegt: { makler: string[]; objekte: string[]; deals: string[] } = { makler: [], objekte: [], deals: [] };

test.afterEach(async ({ page }) => {
  for (const id of angelegt.deals.splice(0)) await page.request.delete(`/api/deals/${id}`).catch(() => undefined);
  for (const id of angelegt.objekte.splice(0)) await page.request.delete(`/api/objekte/${id}`).catch(() => undefined);
  for (const id of angelegt.makler.splice(0)) await page.request.delete(`/api/makler/${id}`).catch(() => undefined);
});

/** Ein fälliger Deal, der im Cockpit ganz oben steht (überfällig sortiert vor „heute“). */
async function faelligerDeal(page: Page, titel: string) {
  const m = await (await page.request.post('/api/makler', { data: { name: `Agent-Makler ${Date.now()}`, tel: '+49 30 555' } })).json();
  angelegt.makler.push(m.id);
  const o = await (await page.request.post('/api/objekte', { data: { titel, stadt: 'Berlin' } })).json();
  angelegt.objekte.push(o.id);
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id, maklerId: m.id } })).json();
  angelegt.deals.push(d.id);
  const r = await page.request.patch(`/api/deals/${d.id}`, { data: { version: 1, nextContact: heute(), nachfassFrequenz: 'Wöchentlich' } });
  expect(r.ok()).toBe(true);
  return d.id as string;
}

test.describe('AgentMode', () => {
  test('bedient die App sichtbar, fragt vor dem Abschicken und speichert die Notiz', async ({ page }) => {
    const titel = `Agent-Objekt ${Date.now()}`;
    const dealId = await faelligerDeal(page, titel);
    await page.goto('/');

    // Overlay einschalten (Schalter unten in der Seitenleiste)
    await page.getByRole('button', { name: 'Agent-Overlay' }).click();
    const oben = page.locator('[data-agentmode-oben]');
    await expect(oben).toBeVisible();
    await expect(oben.getByRole('img', { name: /Agent:/ })).toBeVisible();

    // Auftrag: Notiz erfassen und abschicken
    const eingabe = page.getByLabel('Nachricht an den Agenten');
    await eingabe.fill(`Ankauf, erster Deal, Kommentar: Mailbox besprochen, Rückruf Montag. Abschicken.`);
    await eingabe.press('Enter');

    // Der Agent handelt sichtbar: Etikett am Ziel, Feld gefüllt, dann die Frage
    await expect(page.locator('[data-etikett]')).toBeVisible();
    await expect(page.getByLabel('Neue Gesprächsnotiz')).toHaveValue('Mailbox besprochen, Rückruf Montag', { timeout: 15_000 });
    await expect(page.getByText('Notiz abschicken?')).toBeVisible();

    // Ohne Bestätigung ist nichts gespeichert
    const vorher = await (await page.request.get(`/api/deals/${dealId}`)).json();
    expect(vorher.kommentare.filter((k: { text: string }) => k.text.includes('Mailbox besprochen'))).toHaveLength(0);

    await page.getByRole('button', { name: 'Ja, ausführen' }).click();
    await expect.poll(async () => {
      const deal = await (await page.request.get(`/api/deals/${dealId}`)).json();
      return deal.kommentare.filter((k: { text: string }) => k.text.includes('Mailbox besprochen')).length;
    }, { timeout: 15_000 }).toBe(1);

    // Die Formulierung ist gemerkt — beim nächsten Mal ein Vorschlag
    await expect.poll(async () => (await (await page.request.get('/api/agent/vorschlaege?ziel=deal.kommentar')).json()).vorschlaege, { timeout: 10_000 })
      .toContain('Mailbox besprochen, Rückruf Montag');
  });

  test('eigene Seite zeigt Todos, Zeitstrahl und dasselbe Gespräch', async ({ page }) => {
    await faelligerDeal(page, `Agent-Seite ${Date.now()}`);
    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: 'Heute' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Was ich getan habe' })).toBeVisible();
    const eingabe = page.getByLabel('Nachricht an den Agenten');
    await eingabe.fill('Was ist heute fällig?');
    await eingabe.press('Enter');
    // Der Satz steht in der Sprechblase (und noch einmal im Transkript) — die erste genügt
    await expect(page.locator('.am-blase[data-wer="agent"]').first()).toContainText(/Heute sind \d+ Deals und \d+ Makler fällig/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Ersten Deal öffnen' })).toBeVisible();
  });
});
