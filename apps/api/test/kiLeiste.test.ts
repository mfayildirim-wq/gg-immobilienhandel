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
    // Systemtext: Dialog, Gedächtnis, Weg zum Datensatz; Werkzeuge: lesende aus dem MCP, schreibende nur als Vorschlag
    const erste = modell.anfragen[0]!;
    expect(erste.system).toContain(`Dialog: Objekt „${k}weg 3“`);
    expect(erste.system).toContain('- [Besichtigung] Dach muss neu');
    expect(erste.system).toContain(`read_entity (collection "objekte", id "${o.id}")`);
    const namen = erste.tools.map((t) => t.name);
    expect(namen).toContain('read_entity');
    expect(namen).toContain('web_search');
    expect(erste.tools.find((t) => t.name === 'update_objekt')?.description).toMatch(/^\[Führt nichts aus/);
    expect(erste.system).toContain('Ändern geht nur per Vorschlag');
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

  it('Ändern mit Bestätigung: die KI schlägt vor, erst „Übernehmen“ schreibt — im Namen des Nutzers und im Audit-Log', async () => {
    const app = createApp({ db, auth: offen, gedaechtnis });
    const o = await lies(senden(app, 'POST', '/api/objekte', { strasse: `${k}allee`, hausnr: '7', stadt: 'Ulm' }));
    angelegt.objekte.push(o.id);
    const modell = drehbuchModell([
      { content: [
        { type: 'tool_use', id: 'a', name: 'update_objekt', input: { id: o.id, version: o.version, baujahr: 1972 } },
        { type: 'tool_use', id: 'b', name: 'update_objekt', input: { id: o.id, version: o.version, wohnflaeche: 300 } },
      ], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Baujahr und Wohnfläche vorgeschlagen.' }], stop_reason: 'end_turn' },
    ]);
    const mitModell = createApp({ db, auth: offen, gedaechtnis, kiLeisteModell: modell });
    const g = await lies(senden(mitModell, 'POST', '/api/ki-leiste/senden', { bezug: { art: 'objekt', id: o.id }, text: 'Baujahr 1972, 300 m²' }));
    expect(g.nachrichten[1].aenderungen).toEqual([
      { werkzeug: 'update_objekt', titel: 'Objekt ändern', argumente: { id: o.id, version: o.version, baujahr: 1972 } },
      { werkzeug: 'update_objekt', titel: 'Objekt ändern', argumente: { id: o.id, version: o.version, wohnflaeche: 300 } },
    ]);
    // Noch nichts geschrieben
    expect((await lies(app.request(`/api/objekte/${o.id}`))).baujahr).toBeNull();

    const entscheiden = (aenderung: number, aktion: string) => senden(app, 'POST', '/api/ki-leiste/aenderung', { gespraechId: g.id, nachricht: 1, aenderung, aktion });
    const nach = await lies(entscheiden(0, 'uebernehmen'));
    expect(nach.nachrichten[1].aenderungen[0]).toMatchObject({ status: 'uebernommen' });
    expect(await lies(app.request(`/api/objekte/${o.id}`))).toMatchObject({ baujahr: 1972, version: o.version + 1 });
    expect((await entscheiden(0, 'uebernehmen')).status).toBe(422);
    // Die zweite Karte trägt die alte Version — die Prüfung des Servers greift, die Karte zeigt den Fehler
    const zweite = await lies(entscheiden(1, 'uebernehmen'));
    expect(zweite.nachrichten[1].aenderungen[1]).toMatchObject({ status: 'fehler', ergebnis: expect.stringContaining('zwischenzeitlich geändert') });
    expect((await lies(app.request(`/api/objekte/${o.id}`))).wohnflaeche).toBeNull();

    const audit = await lies(app.request(`/api/audit?entity=objekt&suche=${o.id}`));
    const eintrag = audit.zeilen.find((z: { source: string; entityId: string }) => z.source === 'mcp/update_objekt' && z.entityId === o.id);
    expect(JSON.parse(eintrag.metadata)).toEqual({ mcp: 'leiste:lokal', ueber: 'KI-Leiste (vom Nutzer übernommen)' });
    expect(JSON.parse(eintrag.newValue)).toEqual({ baujahr: 1972 });
  });

  it('Ohne Gedächtnis-Dienst liegt der Verlauf in der Datenbank: eine andere Instanz setzt fort und übernimmt (vorher „Gespräch nicht gefunden“)', async () => {
    const o = await lies(senden(createApp({ db, auth: offen }), 'POST', '/api/objekte', { strasse: `${k}ring`, hausnr: '2', stadt: 'Ulm' }));
    angelegt.objekte.push(o.id);
    const modell = drehbuchModell([
      { content: [{ type: 'tool_use', id: 'a', name: 'update_objekt', input: { id: o.id, version: o.version, baujahr: 1990 } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Baujahr vorgeschlagen.' }], stop_reason: 'end_turn' },
      { content: [{ type: 'text', text: 'Weiter.' }], stop_reason: 'end_turn' },
    ]);
    // Zwei Instanzen ohne Gedächtnis-Dienst — wie zwei Vercel-Funktionen
    const eins = createApp({ db, auth: offen, kiLeisteModell: modell });
    const zwei = createApp({ db, auth: offen, kiLeisteModell: modell });
    expect((await lies(eins.request('/api/ki-leiste/stand'))).verlaufDauerhaft).toBe(true);
    const g = await lies(senden(eins, 'POST', '/api/ki-leiste/senden', { bezug: { art: 'objekt', id: o.id }, text: 'Baujahr 1990' }));
    expect((await lies(zwei.request(`/api/ki-leiste/bezug/objekt/${o.id}`))).gespraeche).toEqual([expect.objectContaining({ id: g.id, titel: 'Baujahr 1990', anzahl: 2 })]);

    const nach = await lies(senden(zwei, 'POST', '/api/ki-leiste/aenderung', { gespraechId: g.id, nachricht: 1, aenderung: 0, aktion: 'uebernehmen' }));
    expect(nach.nachrichten[1].aenderungen[0].status).toBe('uebernommen');
    expect((await lies(eins.request(`/api/objekte/${o.id}`))).baujahr).toBe(1990);
    const weiter = await lies(senden(eins, 'POST', '/api/ki-leiste/senden', { gespraechId: g.id, text: 'Und jetzt?' }));
    expect(weiter.nachrichten.map((n: { text: string }) => n.text)).toEqual(['Baujahr 1990', 'Baujahr vorgeschlagen.', 'Und jetzt?', 'Weiter.']);
    expect(weiter.nachrichten[1].aenderungen[0].status).toBe('uebernommen');

    expect((await lies(senden(zwei, 'DELETE', `/api/ki-leiste/gespraeche/${g.id}`))).geloescht).toBe(true);
    expect((await eins.request(`/api/ki-leiste/gespraeche/${g.id}`)).status).toBe(404);
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
    // ohne Gedächtnis-Dienst: Verlauf in der gg-Datenbank (29.10.2026), also auch dauerhaft
    expect((await lies(app.request('/api/ki-leiste/stand'))).verlaufDauerhaft).toBe(true);
  });
});
