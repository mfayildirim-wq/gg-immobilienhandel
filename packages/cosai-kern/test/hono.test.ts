import { Hono } from 'hono';
import { afterAll, describe, expect, it } from 'vitest';
import { agentRouten } from '../src/hono.ts';
import { agentKern } from '../src/kern.ts';
import { drehbuchModell, ki } from '../src/modell.ts';
import { testDb, url } from './db.ts';

describe.skipIf(!url)('Hono-Routen', () => {
  const { db, client } = url ? testDb() : ({} as ReturnType<typeof testDb>);
  afterAll(async () => { await client?.end(); });
  const ziele = [{ ziel: 'deal.kommentar.senden', beschreibung: 'Knopf' }];
  const bauen = (drehbuch = [ki('Hallo!')]) => {
    const kern = agentKern({ db, modell: drehbuchModell(drehbuch), openapi: { paths: {} }, ziele, aufruf: async () => ({ status: 200, text: '{}' }) });
    const app = new Hono();
    app.route('/api/agent', agentRouten(kern, (c) => (c.req.header('x-nutzer') ? { id: c.req.header('x-nutzer')!, kopf: {} } : null)));
    return app;
  };
  const post = (app: Hono, pfad: string, body: unknown, nutzer = 'hono@example') =>
    app.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nutzer': nutzer }, body: JSON.stringify(body) });

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
});
