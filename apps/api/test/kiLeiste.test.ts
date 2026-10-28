import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { gedaechtnisAttrappe } from '@gg/integrations';
import { drehbuchModell } from '@gg/ki-kern';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { kompakt } from '../src/services/kiLeiste.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;
const offen = { lokalOffen: true, produktion: false, erlaubteEmails: [] };

describe('KI-Leiste: Kontext kompakt', () => {
  it('lässt Leeres weg und kürzt lange Listen und Texte', () => {
    expect(kompakt({ a: null, b: '', c: [], d: { e: undefined }, f: 'x'.repeat(500), g: Array.from({ length: 10 }, (_, i) => i), h: 0, i: false }))
      .toEqual({ f: `${'x'.repeat(400)}…`, g: [0, 1, 2, 3, 4, 5, 6, 7, '… 2 weitere'], h: 0, i: false });
  });
});

describe.skipIf(!url)('KI-Leiste: Chat zum Dialog über die API (26.10.2026)', () => {
  const { db, client } = createDb(url!);
  const k = `KiLeiste${Date.now()}`;
  const angelegt = { objekte: [] as string[] };
  const gedaechtnis = gedaechtnisAttrappe();

  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const senden = (app: ReturnType<typeof createApp>, methode: string, pfad: string, body?: unknown) =>
    app.request(pfad, { method: methode, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  afterAll(async () => {
    await db.delete(schema.objekte).where(inArray(schema.objekte.id, angelegt.objekte));
    await client.end();
  });

  it('Objekt: Sicht mit Titel und Gedächtnis; die KI liest per MCP-Werkzeug nach; Verlauf und Ablegen', async () => {
    const modell = drehbuchModell([
      { content: [{ type: 'tool_use', id: 't1', name: 'read_entity', input: { collection: 'objekte', id: 'OBJ' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: '## Lage\n\nRuhige Seitenstraße.' }], stop_reason: 'end_turn', model: 'claude-test' },
    ]);
    const app = createApp({ db, auth: offen, gedaechtnis, kiLeisteModell: modell });
    const o = await lies(senden(app, 'POST', '/api/objekte', { strasse: `${k}weg`, hausnr: '3', stadt: 'Ulm' }));
    angelegt.objekte.push(o.id);
    await gedaechtnis.ablegen({ titel: 'Besichtigung', text: 'Dach muss neu', objekt: `gg:objekt:${o.id}` });

    const sicht = await lies(app.request(`/api/ki-leiste/bezug/objekt/${o.id}`));
    expect(sicht).toMatchObject({ label: 'Objekt', titel: `${k}weg 3`, gedaechtnis: { verbunden: true }, gespraeche: [] });
    expect(sicht.gedaechtnis.eintraege.map((e: { text: string }) => e.text)).toEqual(['Dach muss neu']);

    const g = await lies(senden(app, 'POST', '/api/ki-leiste/senden', { bezug: { art: 'objekt', id: o.id }, text: 'Wie ist die Lage?' }));
    expect(g).toMatchObject({ bezug: { art: 'objekt', id: o.id }, titel: 'Wie ist die Lage?', von: 'lokal', anzahl: 2 });
    expect(g.nachrichten[1]).toMatchObject({ rolle: 'ki', text: '## Lage\n\nRuhige Seitenstraße.', gedaechtnis: 1, modell: 'claude-test' });
    expect(g.nachrichten[1].schritte).toEqual([{ art: 'werkzeug', name: 'read_entity', ok: false, kurz: '{"collection":"objekte","id":"OBJ"}' }]);
    // Systemtext: Dialog, Gedächtnis, Weg zum Datensatz; Werkzeuge: nur lesende aus dem MCP
    const erste = modell.anfragen[0]!;
    expect(erste.system).toContain(`Dialog: Objekt „${k}weg 3“`);
    expect(erste.system).toContain('- [Besichtigung] Dach muss neu');
    expect(erste.system).toContain(`read_entity (collection "objekte", id "${o.id}")`);
    const namen = erste.tools.map((t) => t.name);
    expect(namen).toContain('read_entity');
    expect(namen).toContain('web_search');
    expect(namen).not.toContain('add_note');
    expect(namen).not.toContain('gedaechtnis_merken');

    // Der Verlauf liegt im Gedächtnis-Dienst — als Gespräch, nicht als Wissen
    expect((await gedaechtnis.gespraech(g.id)).titel).toBe('Wie ist die Lage?');
    expect(gedaechtnis.alle().map((e) => e.text)).toEqual(['Dach muss neu']);
    expect((await lies(app.request(`/api/ki-leiste/bezug/objekt/${o.id}`))).gespraeche).toEqual([expect.objectContaining({ id: g.id, titel: 'Wie ist die Lage?' })]);
    expect((await lies(app.request(`/api/ki-leiste/gespraeche/${g.id}`))).nachrichten).toHaveLength(2);

    const abgelegt = await senden(app, 'POST', '/api/ki-leiste/ablegen', { bezug: { art: 'objekt', id: o.id }, titel: 'Lage', text: g.nachrichten[1].text, gespraechId: g.id, nachricht: 1 });
    expect(abgelegt.status).toBe(201);
    const nachher = (await lies(app.request(`/api/ki-leiste/bezug/objekt/${o.id}`))).gedaechtnis.eintraege;
    expect(nachher.find((e: { titel?: string }) => e.titel === 'Lage')).toMatchObject({ von: 'leiste:lokal', quelle: 'ablage' });
    expect((await lies(app.request(`/api/ki-leiste/gespraeche/${g.id}`))).nachrichten[1].abgelegt).toBe('Lage');

    expect((await lies(senden(app, 'DELETE', `/api/ki-leiste/gespraeche/${g.id}`))).geloescht).toBe(true);
    expect((await app.request(`/api/ki-leiste/gespraeche/${g.id}`)).status).toBe(404);
  });

  it('„merk dir …“: die KI schlägt vor, gespeichert wird erst nach Bestätigung; Verwerfen wird vermerkt', async () => {
    const app = createApp({ db, auth: offen, gedaechtnis });
    const modell = drehbuchModell([
      { content: [{ type: 'tool_use', id: 'v', name: 'gedaechtnis_vorschlagen', input: { titel: 'Termin', text: 'Besichtigung Montag 10 Uhr' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Vorgeschlagen.' }], stop_reason: 'end_turn' },
    ]);
    const mitModell = createApp({ db, auth: offen, gedaechtnis, kiLeisteModell: modell });
    const o = await lies(senden(app, 'POST', '/api/objekte', { strasse: `${k}gasse`, hausnr: '1' }));
    angelegt.objekte.push(o.id);
    const vorher = gedaechtnis.alle().length;
    const g = await lies(senden(mitModell, 'POST', '/api/ki-leiste/senden', { bezug: { art: 'objekt', id: o.id }, text: 'Merk dir: Besichtigung Montag 10 Uhr' }));
    expect(g.nachrichten[1].vorschlag).toEqual({ titel: 'Termin', text: 'Besichtigung Montag 10 Uhr' });
    expect(gedaechtnis.alle()).toHaveLength(vorher);
    const verworfen = await lies(senden(app, 'POST', '/api/ki-leiste/vorschlag-verwerfen', { gespraechId: g.id, nachricht: 1 }));
    expect(verworfen.nachrichten[1].vorschlag.status).toBe('verworfen');
    expect(gedaechtnis.alle()).toHaveLength(vorher);
  });

  it('Stand, Einstellungen (Modell in der Modellwahl), Fehler für unbekannte Dialoge', async () => {
    const app = createApp({ db, auth: offen, gedaechtnis: null, kiLeisteModell: drehbuchModell([]) });
    const vorher = await lies(app.request('/api/ki-leiste/stand'));
    try {
      expect(vorher).toMatchObject({ verfuegbar: true, gedaechtnis: false });
      expect(vorher.modelle.map((m: { id: string }) => m.id)).toContain('claude-sonnet-5-5');
      const neu = await lies(senden(app, 'PUT', '/api/ki-leiste/einstellungen', { modell: 'claude-haiku-5-5', websuche: false, gedaechtnis: true }));
      expect(neu).toEqual({ modell: 'claude-haiku-5-5', websuche: false, gedaechtnis: true });
      expect((await lies(app.request('/api/einstellungen/ki-modelle'))).assistent).toBe('claude-haiku-5-5');
      expect((await senden(app, 'PUT', '/api/ki-leiste/einstellungen', { modell: 'gpt-9', websuche: true, gedaechtnis: true })).status).toBe(400);
    } finally {
      await senden(app, 'PUT', '/api/ki-leiste/einstellungen', vorher.einstellungen);
    }
    expect((await app.request('/api/ki-leiste/bezug/objekt/gibt-es-nicht')).status).toBe(404);
    expect((await app.request('/api/ki-leiste/bezug/papierkorb/1')).status).toBe(404);
    expect((await senden(app, 'POST', '/api/ki-leiste/ablegen', { bezug: { art: 'deal', id: 'x' }, titel: 't', text: 'x' })).status).toBe(503);
    // ohne Gedächtnis-Dienst: Verlauf nur bis zum Neustart
    expect((await lies(app.request('/api/ki-leiste/stand'))).verlaufDauerhaft).toBe(false);
  });
});
