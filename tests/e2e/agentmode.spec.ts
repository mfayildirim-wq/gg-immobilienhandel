import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { expect, type Page, test } from '@playwright/test';
import { z } from 'zod';

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
  const g = (await (await page.request.get('/api/agent/gedaechtnis')).json().catch(() => ({ eintraege: [] }))) as { eintraege?: { id: string; art: string; inhalt: string; kontext?: { dealId?: string } }[] };
  // … alles zu den Deals des Tests (auch „deal.erledigt“ ohne Text) und die Routinen, die aus den Test-Abläufen entstanden sind.
  // Die Klicktests laufen mit demselben lokalen Nutzer wie die Entwicklung — ohne das bliebe ihr Gedächtnis voller Testspuren.
  const testDeals = new Set(angelegt.deals);
  for (const e of g.eintraege ?? []) {
    if (e.inhalt.includes('(Test ') || e.art === 'routine' || (e.kontext?.dealId && testDeals.has(e.kontext.dealId))) await page.request.delete(`/api/agent/gedaechtnis/${e.id}`).catch(() => undefined);
  }
  // Ergebnisse, die an den Test-Deals hängen
  for (const id of angelegt.deals) {
    const e = (await (await page.request.get(`/api/agent/ergebnisse?typ=deal&id=${id}`)).json().catch(() => ({ ergebnisse: [] }))) as { ergebnisse?: { id: string }[] };
    for (const x of e.ergebnisse ?? []) await page.request.delete(`/api/agent/ergebnisse/${x.id}`).catch(() => undefined);
  }
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
    await expect(page.getByRole('textbox', { name: 'Neue Gesprächsnotiz' })).toHaveValue(text, { timeout: 15_000 });
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
    await expect(page.getByRole('textbox', { name: 'Neue Gesprächsnotiz' })).toBeVisible();

    const eingabe = page.getByLabel('Nachricht an den Agenten');
    await eingabe.fill(`Kommentar: ${text}. Abschicken.`);
    await eingabe.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Neue Gesprächsnotiz' })).toHaveValue(text, { timeout: 15_000 });

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
    await page.getByRole('textbox', { name: 'Neue Gesprächsnotiz' }).fill(text);
    await page.getByRole('button', { name: '+ Eintrag' }).click();
    await expect.poll(async () => ((await (await page.request.get('/api/agent/vorschlaege?ziel=deal.kommentar')).json()) as { vorschlaege: string[] }).vorschlaege, { timeout: 10_000 })
      .toContain(text);

    await page.getByLabel(`Deal ${zweiter.titel}`).click();
    await page.getByRole('group', { name: 'Vorschläge aus dem Gedächtnis' }).getByRole('button', { name: text }).click();
    await expect(page.getByRole('textbox', { name: 'Neue Gesprächsnotiz' })).toHaveValue(text);
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
  test('erkennt „Notiz → Erledigt“ als Routine und führt sie mit zwei Bestätigungen aus', async ({ page }) => {
    const text = notiz();
    // Dreimal derselbe Ablauf in eigenen Deals — so, wie die App ihn meldet
    for (let i = 0; i < 3; i += 1) {
      const d = await faelligerDeal(page, `Agent-Routine ${Date.now()}-${i}`);
      await page.request.post('/api/agent/ereignis', { data: { art: 'gespeichert', ziel: 'deal.kommentar', wert: text, kontext: { dealId: d.dealId } } });
      await page.request.post('/api/agent/ereignis', { data: { art: 'gespeichert', ziel: 'deal.erledigt', kontext: { dealId: d.dealId } } });
    }
    const ziel = await faelligerDeal(page, `Agent-Routineziel ${Date.now()}`);
    await page.goto('/');
    await agentOeffnen(page);
    await page.getByLabel(`Deal ${ziel.titel}`).click();
    await page.getByRole('button', { name: 'Routine: Neue Gesprächsnotiz → Erledigt' }).click();

    // Erstes Senden: die Notiz (mit der gemerkten Formulierung)
    await expect(page.getByRole('textbox', { name: 'Neue Gesprächsnotiz' })).toHaveValue(text, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Ja, ausführen' }).click();
    await expect.poll(async () => ((await (await page.request.get(`/api/deals/${ziel.dealId}`)).json()) as { kommentare: { text: string }[] }).kommentare.filter((k) => k.text === text).length, { timeout: 15_000 }).toBe(1);

    // Zweites Senden fragt noch einmal — erst danach ist der Deal erledigt
    await expect(page.locator('.am-blase[data-wer="agent"]').last()).toContainText('deal.erledigt ausführen?', { timeout: 15_000 });
    expect(((await (await page.request.get(`/api/deals/${ziel.dealId}`)).json()) as { lastContact: string | null }).lastContact).not.toBe(heute());
    await page.getByRole('button', { name: 'Ja, ausführen' }).click();
    await expect.poll(async () => ((await (await page.request.get(`/api/deals/${ziel.dealId}`)).json()) as { lastContact: string | null }).lastContact, { timeout: 15_000 }).toBe(heute());

  });

  test('Einstellungen: ⚙ öffnet sie, Grundregeln fest, eine „Nie“-Regel ergänzen bleibt nach dem Neuladen', async ({ page }) => {
    // Die Einstellungen gelten für den lokalen Nutzer der Entwicklung — am Ende den alten Stand zurückschreiben
    const vorher = (await (await page.request.get('/api/agent/einstellungen')).json()) as { regeln: string[]; nie: string[]; anbieter: string; modell: string };
    try {
      await page.goto('/');
      await agentOeffnen(page);
      await page.getByRole('button', { name: 'Einstellungen des Agenten' }).click();
      await expect(page).toHaveURL(/\/einstellungen\/agentmode$/);
      const grund = page.getByRole('region', { name: 'Grundregeln' });
      await expect(grund).toContainText('nie von dir aus');
      await expect(grund.getByRole('button')).toHaveCount(0);

      const regel = `Nie am Wochenende anrufen (Test ${Date.now()})`;
      const nie = page.getByRole('region', { name: 'Nie' });
      await nie.getByLabel('Neue Regel: Nie').fill(regel);
      await nie.getByRole('button', { name: 'Hinzufügen' }).click();
      await page.getByRole('button', { name: 'Speichern' }).click();
      await expect(page.getByText('Gespeichert — gilt ab der nächsten Nachricht.')).toBeVisible();
      await page.reload();
      await expect(page.getByRole('region', { name: 'Nie' }).locator('input').first()).toHaveValue(regel);
    } finally {
      await page.request.put('/api/agent/einstellungen', { data: { regeln: vorher.regeln, nie: vorher.nie, anbieter: vorher.anbieter, modell: vorher.modell } });
    }
  });

  test('MCP-Server anbinden: Werkzeuge erscheinen, fragen vorher, lassen sich freigeben — und wieder entfernen', async ({ page }) => {
    // Ein echter MCP-Server mit Anmeldung, lokal — der lokale API-Server darf lokale Adressen (nur außerhalb der Produktion)
    const mcp: Server = createServer(async (req, res) => {
      if (req.headers.authorization !== 'Bearer e2e-geheim') { res.writeHead(401).end(); return; }
      const server = new McpServer({ name: 'post', version: '1.0.0' });
      server.registerTool('suche_mails', { description: 'Sucht Mails im Postfach', inputSchema: { stichwort: z.string() }, annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: 'keine' }] }));
      server.registerTool('mail_senden', { description: 'Sendet eine Mail', inputSchema: { an: z.string() } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });
    await new Promise<void>((r) => mcp.listen(0, '127.0.0.1', r));
    const name = `E2E-Post-${Date.now() % 100000}`;
    try {
      await page.goto('/einstellungen/agentmode');
      const bereich = page.getByRole('region', { name: 'MCP-Server', exact: true });
      await bereich.getByLabel('Name').fill(name);
      await bereich.getByLabel('Adresse').fill(`http://127.0.0.1:${(mcp.address() as AddressInfo).port}/mcp`);
      await bereich.getByLabel('Kopfzeile (optional)').fill('Authorization: Bearer e2e-geheim');
      await bereich.getByRole('button', { name: 'Verbinden' }).click();
      await expect(bereich.getByText('2 Werkzeuge gefunden')).toBeVisible({ timeout: 15_000 });
      await expect(bereich.locator(`[data-mcp="${name}"]`)).toContainText('mit Zugang');

      const werkzeug = `mcp_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_suche_mails`;
      const zeile = page.locator(`[data-werkzeug="${werkzeug}"]`);
      await expect(zeile).toContainText('Sucht Mails im Postfach');
      const schalter = zeile.getByRole('switch');
      await expect(schalter).not.toBeChecked();
      await schalter.click({ force: true });
      await expect.poll(async () => ((await (await page.request.get('/api/agent/werkzeuge')).json()) as { werkzeuge: { name: string; recht: string }[] }).werkzeuge.find((w) => w.name === werkzeug)?.recht).toBe('frei');

      await bereich.locator(`[data-mcp="${name}"]`).getByRole('button', { name: 'Entfernen' }).click();
      await expect(bereich.locator(`[data-mcp="${name}"]`)).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/agent/mcp/${encodeURIComponent(name)}`);
      await new Promise((r) => mcp.close(r));
    }
  });

  test('Ergebnis: Analyse im geöffneten Deal nach „Ja“ speichern, unter 🗂 sehen, vergrößern, schließen', async ({ page }) => {
    const { dealId, titel } = await faelligerDeal(page, `Agent-Ergebnis ${Date.now()}`);
    await page.goto('/');
    const oben = await agentOeffnen(page);
    await page.getByLabel(`Deal ${titel}`).click();
    await expect(page.locator(`[data-agent-fokus*="${dealId}"]`)).toHaveCount(1);
    await expect(oben.getByRole('button', { name: 'Ergebnisse (0)' })).toBeVisible();

    const eingabe = page.getByLabel('Nachricht an den Agenten');
    await eingabe.fill('Analysiere die Lage');
    await eingabe.press('Enter');
    await expect(page.locator('.am-blase[data-wer="agent"]').last()).toContainText(`Als Ergebnis „Analyse: Lage“ bei Deal ${titel}`, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Ja, ausführen' }).click();
    await expect(oben.getByRole('button', { name: 'Ergebnisse (1)' })).toBeVisible({ timeout: 15_000 });
    // Gespeichert in CoSAi mit Bezug auf Deal und Objekt — nicht in den Tabellen der App
    const e = (await (await page.request.get(`/api/agent/ergebnisse?typ=deal&id=${dealId}`)).json()) as { ergebnisse: { titel: string; bezuege: { typ: string }[] }[] };
    expect(e.ergebnisse[0]).toMatchObject({ titel: 'Analyse: Lage' });
    expect(e.ergebnisse[0]!.bezuege.map((b) => b.typ).sort()).toEqual(['deal', 'objekt']);

    await oben.getByRole('button', { name: 'Ergebnisse (1)' }).click();
    const bereich = oben.getByRole('region', { name: 'Ergebnisse' });
    await expect(page.getByLabel('Nachricht an den Agenten')).toHaveCount(0);
    await bereich.getByRole('button', { name: /Analyse: Lage/ }).click();
    await expect(bereich).toContainText('ruhige Wohnlage');
    await bereich.getByRole('button', { name: 'Ergebnisse vergrößern' }).click();
    const dialog = page.getByRole('dialog', { name: /Ergebnisse/ });
    await expect(dialog).toContainText('Preise seitwärts');
    await dialog.getByRole('button', { name: 'Ergebnisse schließen' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Nachricht an den Agenten')).toBeVisible();
  });
});
