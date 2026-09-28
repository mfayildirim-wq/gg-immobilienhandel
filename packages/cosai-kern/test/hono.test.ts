import { Hono } from 'hono';
import { afterAll, describe, expect, it } from 'vitest';
import { agentRouten } from '../src/hono.ts';
import { agentKern } from '../src/kern.ts';
import { drehbuchModell, ki } from '../src/modell.ts';
import { eq } from 'drizzle-orm';
import { agenten } from '../src/schema.ts';
import { testDb, url } from './db.ts';

/** Ein Tag, den es für den Testnutzer noch nicht gab: Jahr aus der Uhrzeit, Monat und Tag zufällig */
function einmaligerTag(): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${2100 + (Math.floor(Date.now() / 1000) % 7000)}-${z(1 + Math.floor(Math.random() * 12))}-${z(1 + Math.floor(Math.random() * 28))}`;
}

describe.skipIf(!url)('Hono-Routen', () => {
  const { db, client } = url ? testDb() : ({} as ReturnType<typeof testDb>);
  afterAll(async () => { if (url) await db.delete(agenten).where(eq(agenten.slug, 'test-hono')); await client?.end(); });
  const ziele = [{ ziel: 'deal.kommentar.senden', beschreibung: 'Knopf' }];
  const bauen = (drehbuch = [ki('Hallo!')], modell?: Parameters<typeof agentKern>[0]['modell']) => {
    // Eigener Agent-Name: die Einstellungen der Entwicklung bleiben unberührt
    const kern = agentKern({ db, modell: modell ?? drehbuchModell(drehbuch), openapi: { paths: {} }, ziele, aufruf: async () => ({ status: 200, text: '{}' }), dna: { slug: 'test-hono' } });
    const app = new Hono();
    app.route('/api/agent', agentRouten(kern, (c) => (c.req.header('x-nutzer') ? { id: c.req.header('x-nutzer')!, kopf: {} } : null)));
    return app;
  };
  const post = (app: Hono, pfad: string, body: unknown, nutzer = 'hono@example') =>
    app.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nutzer': nutzer }, body: JSON.stringify(body) });

  it('liefert mit Accept: text/event-stream einen Strom: Schritt, Text, am Ende die Antwort', async () => {
    const app = bauen([ki('Ich schaue nach.', [['merke', { art: 'fakt', schluessel: 'strom-test', inhalt: 'x' }]]), ki('Fertig gelesen.')]);
    const res = await app.request('/api/agent/nachricht', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nutzer': 'hono@example', accept: 'text/event-stream' }, body: JSON.stringify({ text: 'Hi', ort: '/' }) });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const roh = await res.text();
    const ereignisse = [...roh.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((m) => ({ art: m[1]!, daten: JSON.parse(m[2]!) as Record<string, unknown> }));
    expect(ereignisse.find((e) => e.art === 'schritt')?.daten).toEqual({ art: 'schritt', text: 'merkt sich das' });
    expect(ereignisse.filter((e) => e.art === 'text').map((e) => e.daten.text).join('')).toContain('Fertig gelesen.');
    const antwort = ereignisse.at(-1)!;
    expect(antwort.art).toBe('antwort');
    expect(antwort.daten).toMatchObject({ text: 'Ich schaue nach.\n\nFertig gelesen.' });
  });

  it('meldet einen Hinweis des Kerns im Strom als fehler', async () => {
    const app = bauen([], async () => null);
    const res = await app.request('/api/agent/nachricht', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nutzer': 'hono@example', accept: 'text/event-stream' }, body: JSON.stringify({ text: 'Hi', ort: '/' }) });
    const roh = await res.text();
    expect(roh).toMatch(/event: fehler\ndata: .*kein Modell verfügbar/);
  });

  it('verlangt einen Nutzer', async () => {
    expect((await bauen().request('/api/agent/stand')).status).toBe(401);
    expect((await bauen().request('/api/agent/stand', { headers: { 'x-nutzer': 'a' } })).status).toBe(200);
  });

  it('prüft die Eingabe und antwortet mit dem Vertrag', async () => {
    const app = bauen();
    expect((await post(app, '/api/agent/nachricht', { text: '' })).status).toBe(400);
    const res = await post(app, '/api/agent/nachricht', { text: 'Hi', ort: '/deals' });
    expect(res.status).toBe(200);
    const antwort = (await res.json()) as { text: string; sitzungId: string };
    expect(antwort.text).toBe('Hallo!');
    expect(antwort.sitzungId).toBeTruthy();
    const sitzung = (await (await app.request(`/api/agent/sitzung?sitzungId=${antwort.sitzungId}`, { headers: { 'x-nutzer': 'hono@example' } })).json()) as { verlauf: { rolle: string }[] };
    expect(sitzung.verlauf.map((v: { rolle: string }) => v.rolle)).toEqual(['nutzer', 'agent']);
    // Ein anderer Nutzer sieht die Sitzung nicht
    const fremd = (await (await app.request(`/api/agent/sitzung?sitzungId=${antwort.sitzungId}`, { headers: { 'x-nutzer': 'x@example' } })).json()) as { verlauf: unknown[] };
    expect(fremd.verlauf).toEqual([]);
  });

  it('Entscheidung ohne wartende Frage → 409; Ereignis → Vorschlag', async () => {
    const app = bauen();
    const antwort = (await (await post(app, '/api/agent/nachricht', { text: 'Hi' })).json()) as { sitzungId: string };
    expect((await post(app, '/api/agent/entscheidung', { sitzungId: antwort.sitzungId, wert: 'ja' })).status).toBe(409);
    expect((await post(app, '/api/agent/ereignis', { art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Rückruf Montag', sitzungId: antwort.sitzungId })).status).toBe(200);
    const v = (await (await app.request('/api/agent/vorschlaege?ziel=deal.kommentar', { headers: { 'x-nutzer': 'hono@example' } })).json()) as { vorschlaege: string[] };
    expect(v.vorschlaege).toContain('Rückruf Montag');
    const g = (await (await app.request('/api/agent/gedaechtnis', { headers: { 'x-nutzer': 'hono@example' } })).json()) as { eintraege: unknown[] };
    expect(g.eintraege.length).toBeGreaterThan(0);
    expect(((await (await app.request('/api/agent/gedaechtnis', { method: 'DELETE', headers: { 'x-nutzer': 'hono@example' } })).json()) as { geloescht: number }).geloescht).toBeGreaterThan(0);
  });
  it('POST /morgen fasst auf Wunsch zusammen; POST /kontext prüft die Eingabe und fragt am Tagesbeginn', async () => {
    const app = bauen([ki('Guten Morgen, heute ist wenig los.')]);
    const erst = (await (await post(app, '/api/agent/morgen', {})).json()) as { antwort: { text: string } };
    expect(erst.antwort.text).toBe('Guten Morgen, heute ist wenig los.');
    expect((await post(app, '/api/agent/kontext', { ort: '/', heute: 'gestern' })).status).toBe(400);
    const k = (await (await post(app, '/api/agent/kontext', { ort: '/deals', heute: einmaligerTag() })).json()) as { art: string; chips: { wert: string }[] };
    expect(k.art).toBe('tagesbeginn');
    expect(k.chips.map((c) => c.wert)).toContain('morgen');
  });

  it('Einstellungen: GET zeigt die Grundregeln, PUT prüft die Eingabe und speichert', async () => {
    const app = bauen();
    const put = (body: unknown) => app.request('/api/agent/einstellungen', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-nutzer': 'hono@example' }, body: JSON.stringify(body) });
    expect((await put({ regeln: [''], nie: [] })).status).toBe(400);
    expect((await put({ regeln: Array.from({ length: 31 }, (_, i) => `Regel ${i}`), nie: [] })).status).toBe(400);
    const ok = await put({ regeln: ['Immer kurz antworten'], nie: ['Nie duzen'], anbieter: 'openai', modell: 'gpt-x' });
    expect(ok.status).toBe(200);
    const e = (await (await app.request('/api/agent/einstellungen', { headers: { 'x-nutzer': 'hono@example' } })).json()) as { grundregeln: string[]; regeln: string[]; nie: string[]; anbieter: string };
    expect(e.grundregeln.length).toBeGreaterThan(0);
    expect(e).toMatchObject({ regeln: ['Immer kurz antworten'], nie: ['Nie duzen'], anbieter: 'openai' });
  });

  it('ohne Modell für den gewählten Anbieter: 409 mit verständlicher Meldung statt 500', async () => {
    const app = bauen([], async () => null);
    const res = await post(app, '/api/agent/nachricht', { text: 'Hi' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { fehler: string }).fehler).toMatch(/kein Modell/);
  });

  it('Werkzeuge: Liste mit Quelle und Recht; Freigabe nur für MCP; MCP-Server mit ungültiger Adresse → Meldung', async () => {
    const app = bauen();
    const liste = (await (await app.request('/api/agent/werkzeuge', { headers: { 'x-nutzer': 'hono@example' } })).json()) as { werkzeuge: { name: string; quelle: string; recht: string }[] };
    expect(liste.werkzeuge.find((w) => w.name === 'steuere')).toMatchObject({ quelle: 'agent', recht: 'fragt' });
    const put = (pfad: string, body: unknown, method = 'PUT') => app.request(pfad, { method, headers: { 'content-type': 'application/json', 'x-nutzer': 'hono@example' }, body: JSON.stringify(body) });
    expect((await put('/api/agent/werkzeuge/frei', { name: 'steuere', frei: true })).status).toBe(409);
    expect((await put('/api/agent/mcp', { name: 'Post', url: 'keine adresse' }, 'POST')).status).toBe(400);
    const intern = await put('/api/agent/mcp', { name: 'Post', url: 'https://localhost/mcp' }, 'POST');
    expect(intern.status).toBe(409);
    expect(((await intern.json()) as { fehler: string }).fehler).toMatch(/öffentliche https-Adresse/);
    expect((await app.request('/api/agent/mcp/Post', { method: 'DELETE', headers: { 'x-nutzer': 'hono@example' } })).status).toBe(200);
  });

  it('Ergebnisse: Liste und Anzahl zu einem Objekt, Löschen — Typ und ID sind Pflicht für die Anzahl', async () => {
    const app = bauen();
    const h = { headers: { 'x-nutzer': 'hono@example' } };
    expect((await app.request('/api/agent/ergebnisse/zaehlen', h)).status).toBe(400);
    const id = `hono-${Date.now()}`;
    expect(await (await app.request(`/api/agent/ergebnisse/zaehlen?typ=deal&id=${id}`, h)).json()).toEqual({ anzahl: 0 });
    expect(await (await app.request(`/api/agent/ergebnisse?typ=deal&id=${id}`, h)).json()).toEqual({ ergebnisse: [] });
    expect(((await (await app.request('/api/agent/ergebnisse/gibtesnicht', { method: 'DELETE', ...h })).json()) as { geloescht: boolean }).geloescht).toBe(false);
  });
});
