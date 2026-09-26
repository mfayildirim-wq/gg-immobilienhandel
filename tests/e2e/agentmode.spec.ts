import { expect, type Page, test } from '@playwright/test';

/**
 * AgentMode im Browser (mit `KI_ATTRAPPE=1` antwortet das Attrappen-Modell deterministisch):
 * Overlay einschalten → Auftrag tippen → der Agent bedient die App sichtbar → Bestätigung → Notiz ist gespeichert.
 *
 * Geschrieben wird nur in Deals, die der Test selbst anlegt und danach löscht: „erster Deal“ trifft je nach Bestand
 * einen fremden Deal — dort wird deshalb nur bis zur Rückfrage geprüft und abgelehnt.
 */

const heute = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
const notiz = () => `Mailbox besprochen, Rückruf Montag (Test ${Date.now()})`;

const angelegt: { makler: string[]; objekte: string[]; deals: string[] } = { makler: [], objekte: [], deals: [] };

// Der Morgenvorschlag kommt einmal am Tag beim Öffnen — für die übrigen Tests vorab verbrauchen, sonst platzt er
// in ein laufendes Gespräch (sein eigener Test stellt die Uhr auf einen neuen Tag)
test.beforeEach(async ({ page }) => {
  await page.request.post('/api/agent/morgen', { data: { heute: heute() } });
});

test.afterEach(async ({ page }) => {
  // Der Agent merkt sich Formulierungen — die des Tests wieder vergessen
  const g = (await (await page.request.get('/api/agent/gedaechtnis')).json().catch(() => ({ eintraege: [] }))) as { eintraege?: { id: string; inhalt: string }[] };
  for (const e of g.eintraege ?? []) if (e.inhalt.includes('(Test ')) await page.request.delete(`/api/agent/gedaechtnis/${e.id}`).catch(() => undefined);
  for (const id of angelegt.deals.splice(0)) await page.request.delete(`/api/deals/${id}`).catch(() => undefined);
  for (const id of angelegt.objekte.splice(0)) await page.request.delete(`/api/objekte/${id}`).catch(() => undefined);
  for (const id of angelegt.makler.splice(0)) await page.request.delete(`/api/makler/${id}`).catch(() => undefined);
});

/** Ein heute fälliger Deal — steht im Cockpit unter „Heute kontaktieren“. */
async function faelligerDeal(page: Page, titel: string) {
  const m = await (await page.request.post('/api/makler', { data: { name: `Agent-Makler ${Date.now()}`, tel: '+49 30 555' } })).json();
  angelegt.makler.push(m.id);
  // Den Titel bildet die API aus der Adresse — die Straße trägt die Kennung
  const o = await (await page.request.post('/api/objekte', { data: { strasse: titel, stadt: 'Berlin' } })).json();
  angelegt.objekte.push(o.id);
  const d = await (await page.request.post('/api/deals', { data: { objektId: o.id, maklerId: m.id } })).json();
  angelegt.deals.push(d.id);
  const r = await page.request.patch(`/api/deals/${d.id}`, { data: { version: 1, nextContact: heute(), nachfassFrequenz: 'Wöchentlich' } });
  expect(r.ok()).toBe(true);
  return { dealId: d.id as string, titel };
}

/** Overlay einschalten und ein frisches Gespräch beginnen (eine ältere Sitzung könnte noch auf eine Antwort warten). */
async function agentOeffnen(page: Page) {
  await page.getByRole('button', { name: 'Agent-Overlay' }).click();
  const oben = page.locator('[data-agentmode-oben]');
  await expect(oben).toBeVisible();
  await oben.getByRole('button', { name: 'Neues Gespräch' }).click();
  return oben;
}

test.describe('AgentMode', () => {
  test('navigiert und füllt sichtbar aus, fragt vor dem Abschicken — „Nein“ speichert nichts', async ({ page }) => {
    await faelligerDeal(page, `Agent-Objekt ${Date.now()}`);
    const text = notiz();
    await page.goto('/');
    const oben = await agentOeffnen(page);
    await expect(oben.getByRole('img', { name: /Agent:/ })).toBeVisible();

    const eingabe = page.getByLabel('Nachricht an den Agenten');
    await eingabe.fill(`Ankauf, erster Deal, Kommentar: ${text}. Abschicken.`);
    await eingabe.press('Enter');

    // Sichtbar: Etikett am Ziel, Feld gefüllt, dann die Rückfrage
    await expect(page.locator('[data-etikett]')).toBeVisible();
    await expect(page.getByLabel('Neue Gesprächsnotiz')).toHaveValue(text, { timeout: 15_000 });
    await expect(page.locator('.am-blase[data-wer="agent"]').last()).toContainText('Notiz abschicken?');

    // Welchen Deal hat der Agent geöffnet? (der erste fällige — im Bestand nicht unbedingt unserer)
    const kontext = await page.locator('section[aria-label="Kommentare"][data-agent-kontext]').getAttribute('data-agent-kontext');
    const dealId = (JSON.parse(kontext!) as { dealId: string }).dealId;

    await page.getByRole('button', { name: 'Nein' }).click();
    await expect(page.locator('.am-blase[data-wer="agent"]').last()).toContainText('nicht gesendet', { timeout: 15_000 });
    const deal = await (await page.request.get(`/api/deals/${dealId}`)).json();
    expect(deal.kommentare.filter((k: { text: string }) => k.text === text)).toHaveLength(0);
  });

  test('speichert die Notiz im geöffneten Deal nach „Ja“ und merkt sich die Formulierung', async ({ page }) => {
    const { dealId, titel } = await faelligerDeal(page, `Agent-Ziel ${Date.now()}`);
    const text = notiz();
    await page.goto('/');
    await agentOeffnen(page);

    // Der Nutzer wählt seinen Deal — der Agent arbeitet in dem, was offen ist
    await page.getByLabel(`Deal ${titel}`).click();
    await expect(page.getByLabel('Neue Gesprächsnotiz')).toBeVisible();

    const eingabe = page.getByLabel('Nachricht an den Agenten');
    await eingabe.fill(`Kommentar: ${text}. Abschicken.`);
    await eingabe.press('Enter');
    await expect(page.getByLabel('Neue Gesprächsnotiz')).toHaveValue(text, { timeout: 15_000 });

    await page.getByRole('button', { name: 'Ja, ausführen' }).click();
    await expect.poll(async () => {
      const deal = await (await page.request.get(`/api/deals/${dealId}`)).json();
      return deal.kommentare.filter((k: { text: string }) => k.text === text).length;
    }, { timeout: 15_000 }).toBe(1);

    // Die Formulierung ist gemerkt — beim nächsten Mal ein Vorschlag
    await expect.poll(async () => ((await (await page.request.get('/api/agent/vorschlaege?ziel=deal.kommentar')).json()) as { vorschlaege: string[] }).vorschlaege, { timeout: 10_000 })
      .toContain(text);
  });

  test('eigene Seite zeigt Todos, Zeitstrahl und dasselbe Gespräch', async ({ page }) => {
    await faelligerDeal(page, `Agent-Seite ${Date.now()}`);
    await page.goto('/agent');
    await page.getByRole('button', { name: 'Neues Gespräch' }).click();
    await expect(page.getByRole('heading', { name: 'Heute' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Was ich getan habe' })).toBeVisible();
    const eingabe = page.getByLabel('Nachricht an den Agenten');
    await eingabe.fill('Was ist heute fällig?');
    await eingabe.press('Enter');
    // Der Satz steht in der Sprechblase (und noch einmal im Transkript) — die erste genügt
    await expect(page.locator('.am-blase[data-wer="agent"]').first()).toContainText(/Heute sind \d+ Deals und \d+ Makler fällig/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Ersten Deal öffnen' })).toBeVisible();
  });
  test('lernt ohne Overlay und schlägt die Formulierung am Feld vor', async ({ page }) => {
    const erster = await faelligerDeal(page, `Agent-Lernen ${Date.now()}`);
    const zweiter = await faelligerDeal(page, `Agent-Vorschlag ${Date.now()}`);
    const text = notiz();
    await page.goto('/');
    await expect(page.locator('[data-agentmode-oben]')).toHaveCount(0);
    await page.getByLabel(`Deal ${erster.titel}`).click();
    await page.getByLabel('Neue Gesprächsnotiz').fill(text);
    await page.getByRole('button', { name: '+ Eintrag' }).click();
    await expect.poll(async () => ((await (await page.request.get('/api/agent/vorschlaege?ziel=deal.kommentar')).json()) as { vorschlaege: string[] }).vorschlaege, { timeout: 10_000 })
      .toContain(text);

    await page.getByLabel(`Deal ${zweiter.titel}`).click();
    await page.getByRole('group', { name: 'Vorschläge aus dem Gedächtnis' }).getByRole('button', { name: text }).click();
    await expect(page.getByLabel('Neue Gesprächsnotiz')).toHaveValue(text);
  });

  test('begrüßt beim ersten Öffnen des Tages mit dem Morgenvorschlag, danach nicht noch einmal', async ({ page }) => {
    // Ein Tag, den es für diesen Nutzer noch nicht gab
    await page.clock.setFixedTime(new Date(2090, 0, 1 + Math.floor(Math.random() * 3000), 9, 0));
    const morgen = page.waitForResponse((r) => r.url().endsWith('/api/agent/morgen'));
    await page.goto('/agent');
    expect(((await (await morgen).json()) as { antwort: unknown }).antwort).not.toBeNull();
    await expect(page.locator('.am-blase[data-wer="agent"]').last()).toContainText(/Heute sind \d+ Deals/, { timeout: 15_000 });

    const zweites = page.waitForResponse((r) => r.url().endsWith('/api/agent/morgen'));
    await page.reload();
    expect(((await (await zweites).json()) as { antwort: unknown }).antwort).toBeNull();
    // Der Verlauf der Sitzung zeigt ihn weiter
    await expect(page.locator('.am-blase[data-wer="agent"]').last()).toContainText(/Heute sind \d+ Deals/);
  });
});
