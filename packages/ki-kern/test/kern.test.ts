import { describe, expect, it } from 'vitest';
import {
  attrappenModell, drehbuchModell, type KiGedaechtnisEintrag, kiAntworten, kiDienst, type KiEinstellungen, KiLeisteFehler,
  quelleAusMcp, verlaufImArbeitsspeicher, type WerkzeugQuelle,
} from '../src/index.ts';

const quelle = (aufrufe: { name: string; args: unknown }[] = []): WerkzeugQuelle => ({
  async liste() { return [{ name: 'read_entity', description: 'liest', inputSchema: { type: 'object' } }]; },
  async aufrufen(name, args) {
    aufrufe.push({ name, args });
    return name === 'read_entity' ? { text: '{"status":"Angebot abgegeben"}', fehler: false } : { text: 'unbekannt', fehler: true };
  },
});

describe('Agentenschleife', () => {
  it('ruft Werkzeuge auf, gibt die Ergebnisse zurück und liefert nur die Schlussantwort', async () => {
    const aufrufe: { name: string; args: unknown }[] = [];
    const modell = drehbuchModell([
      { content: [{ type: 'thinking', thinking: '…', signature: 's' }, { type: 'text', text: 'Ich schaue nach.' }, { type: 'tool_use', id: 't1', name: 'read_entity', input: { collection: 'deals', id: 'd1' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Der Deal steht auf **Angebot abgegeben**.' }], stop_reason: 'end_turn', model: 'claude-x' },
    ]);
    const r = await kiAntworten({ modell, system: 'S', verlauf: [], frage: 'Wie steht der Deal?', werkzeuge: await quelle().liste(), quelle: quelle(aufrufe), websuche: false });
    expect(r.text).toBe('Der Deal steht auf **Angebot abgegeben**.');
    expect(r.modell).toBe('claude-x');
    expect(aufrufe).toEqual([{ name: 'read_entity', args: { collection: 'deals', id: 'd1' } }]);
    expect(r.schritte).toEqual([{ art: 'werkzeug', name: 'read_entity', ok: true, kurz: '{"collection":"deals","id":"d1"}' }]);
    // zweite Anfrage: Denkblock bleibt erhalten, Werkzeugergebnis hängt an der richtigen Kennung
    const zweite = modell.anfragen[1]!;
    expect(zweite.messages[1]!.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'thinking' })]));
    expect(zweite.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"status":"Angebot abgegeben"}' }] });
    expect(zweite.tools).toEqual([{ name: 'read_entity', description: 'liest', input_schema: { type: 'object' } }]);
  });

  it('Websuche: als Server-Werkzeug angeboten, Suche und Quellen werden vermerkt, pause_turn läuft weiter', async () => {
    const modell = drehbuchModell([
      { content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'ETW Ulm Weststadt' } }], stop_reason: 'pause_turn' },
      { content: [{ type: 'text', text: 'Drei Angebote', citations: [{ type: 'web_search_result_location', url: 'https://a.example', title: 'A' }, { url: 'https://a.example', title: 'A' }] }], stop_reason: 'end_turn' },
    ]);
    const r = await kiAntworten({ modell, system: 'S', verlauf: [{ rolle: 'nutzer', text: 'vorher' }, { rolle: 'ki', text: 'ok' }], frage: 'Vergleich?', werkzeuge: [], quelle: quelle(), websuche: true });
    expect(r.text).toBe('Drei Angebote');
    expect(r.schritte).toEqual([{ art: 'websuche', name: 'web_search', ok: true, kurz: 'ETW Ulm Weststadt' }]);
    expect(r.quellen).toEqual([{ url: 'https://a.example', titel: 'A' }]);
    expect(modell.anfragen[0]!.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }]);
    expect(modell.anfragen[0]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('bricht nach der Höchstzahl an Runden ab', async () => {
    const endlos = { content: [{ type: 'tool_use', id: 't', name: 'read_entity', input: {} }], stop_reason: 'tool_use' };
    const r = await kiAntworten({ modell: drehbuchModell([endlos, endlos]), system: 'S', verlauf: [], frage: 'x', werkzeuge: [], quelle: quelle(), websuche: false, maxSchritte: 2 });
    expect(r.text).toContain('Keine abschließende Antwort nach 2 Schritten');
    expect(r.schritte).toHaveLength(2);
  });
});

describe('Werkzeuge aus MCP', () => {
  it('übersetzt tools/list und tools/call, Fehler werden zu Werkzeugfehlern', async () => {
    const q = quelleAusMcp(async (n) => {
      if (n.method === 'tools/list') return { jsonrpc: '2.0', id: n.id, result: { tools: [{ name: 'a', description: 'A', inputSchema: { type: 'object' } }] } };
      const p = n.params as { name: string };
      if (p.name === 'verboten') return { jsonrpc: '2.0', id: n.id, error: { code: -32003, message: 'Bereich fehlt' } };
      return { jsonrpc: '2.0', id: n.id, result: { content: [{ type: 'text', text: 'eins' }, { type: 'text', text: 'zwei' }], isError: p.name === 'kaputt' } };
    });
    expect(await q.liste()).toEqual([{ name: 'a', description: 'A', inputSchema: { type: 'object' } }]);
    expect(await q.aufrufen('a', {})).toEqual({ text: 'eins\nzwei', fehler: false });
    expect(await q.aufrufen('kaputt', {})).toEqual({ text: 'eins\nzwei', fehler: true });
    expect(await q.aufrufen('verboten', {})).toEqual({ text: 'Bereich fehlt', fehler: true });
  });
});

describe('KI-Dienst', () => {
  const aufbau = (o: { gedaechtnis?: KiGedaechtnisEintrag[] | 'kaputt' | null; modell?: ReturnType<typeof drehbuchModell> | null; aendern?: (nutzer: string) => WerkzeugQuelle } = {}) => {
    let einstellungen: KiEinstellungen = { modell: 'm1', websuche: false, gedaechtnis: true };
    const abgelegt: unknown[] = [];
    const verlauf = verlaufImArbeitsspeicher();
    let n = 0;
    const dienst = kiDienst({
      app: 'Test-App',
      modell: async () => (o.modell === null ? null : o.modell ?? attrappenModell()),
      modelle: [{ id: 'm1', label: 'Eins' }],
      werkzeuge: () => quelle(),
      ...(o.aendern ? { aendern: o.aendern } : {}),
      gedaechtnis: async () => (o.gedaechtnis === null ? null : {
        async eintraege() { if (o.gedaechtnis === 'kaputt') throw new Error('Dienst weg'); return o.gedaechtnis ?? []; },
        async ablegen(bezug, titel, text, von) { abgelegt.push({ bezug, titel, text, von }); return { ok: true }; },
      }),
      hatGedaechtnis: (b) => b.art !== 'liste',
      verlauf: async () => ({ speicher: verlauf, dauerhaft: true }),
      beschreiben: async (b) => (b.id === 'weg' ? null : { label: 'Deal', titel: `Musterweg ${b.id}`, kontext: { status: 'Neu' }, hinweis: 'read_entity mit collection "deals"' }),
      einstellungen: { lesen: async () => einstellungen, speichern: async (e) => (einstellungen = e) },
      jetzt: () => new Date('2026-10-26T10:00:00Z'),
      neueId: () => `g${++n}`,
    });
    return { dienst, abgelegt, verlauf };
  };

  it('Sicht auf den Dialog: Titel, Gedächtnis und Gespräche; ein ausgefallenes Gedächtnis hält nichts auf', async () => {
    const eintrag = { id: 'e1', text: 'Verkäufer will nach Weihnachten verhandeln', titel: null };
    expect(await aufbau({ gedaechtnis: [eintrag] }).dienst.bezug({ art: 'deal', id: '1' }))
      .toEqual({ bezug: { art: 'deal', id: '1' }, label: 'Deal', titel: 'Musterweg 1', gedaechtnis: { verbunden: true, eintraege: [eintrag] }, gespraeche: [] });
    expect((await aufbau({ gedaechtnis: 'kaputt' }).dienst.bezug({ art: 'deal', id: '1' })).gedaechtnis).toEqual({ verbunden: true, eintraege: [], fehler: 'Dienst weg' });
    expect((await aufbau({ gedaechtnis: null }).dienst.bezug({ art: 'deal', id: '1' })).gedaechtnis).toEqual({ verbunden: false, eintraege: [] });
    await expect(aufbau().dienst.bezug({ art: 'deal', id: 'weg' })).rejects.toThrow(KiLeisteFehler);
  });

  it('Senden: Gedächtnis und Dialog stehen im Systemtext, das Gespräch wird gespeichert und fortgesetzt', async () => {
    const modell = drehbuchModell([
      { content: [{ type: 'text', text: 'Antwort 1' }], stop_reason: 'end_turn' },
      { content: [{ type: 'text', text: 'Antwort 2' }], stop_reason: 'end_turn' },
    ]);
    const { dienst } = aufbau({ gedaechtnis: [{ id: 'e1', text: 'Verkäufer will nach Weihnachten verhandeln', titel: 'Absprache', am: '2026-10-20T00:00:00Z' }], modell });
    const g1 = await dienst.senden({ bezug: { art: 'deal', id: '7' }, text: '  Was weißt du?  ' }, 'anna@example.de');
    expect(g1).toMatchObject({ id: 'g1', bezug: { art: 'deal', id: '7' }, titel: 'Was weißt du?', von: 'anna@example.de', anzahl: 2 });
    expect(g1.nachrichten[1]).toMatchObject({ rolle: 'ki', text: 'Antwort 1', gedaechtnis: 1 });
    const system = modell.anfragen[0]!.system;
    expect(system).toContain('Dialog: Deal „Musterweg 7“');
    expect(system).toContain('read_entity mit collection "deals"');
    expect(system).toContain('- [Absprache] Verkäufer will nach Weihnachten verhandeln (2026-10-20)');
    expect(system).toContain('{"status":"Neu"}');

    // Fortsetzen: bleibt am ursprünglichen Dialog, Vorgeschichte geht mit
    const g2 = await dienst.senden({ gespraechId: 'g1', bezug: { art: 'deal', id: 'anderer' }, text: 'Und weiter?' }, 'anna@example.de');
    expect(g2.bezug).toEqual({ art: 'deal', id: '7' });
    expect(g2.nachrichten.map((n) => n.text)).toEqual(['Was weißt du?', 'Antwort 1', 'Und weiter?', 'Antwort 2']);
    expect(modell.anfragen[1]!.messages.map((m) => m.content)).toEqual(['Was weißt du?', 'Antwort 1', 'Und weiter?']);
    expect((await dienst.bezug({ art: 'deal', id: '7' })).gespraeche).toEqual([expect.objectContaining({ id: 'g1', anzahl: 4 })]);
  });

  it('Attrappe nennt Dialog und Gedächtnis; ohne Modell klare Meldung', async () => {
    const { dienst } = aufbau({ gedaechtnis: [{ id: 'e', text: 'x' }] });
    const g = await dienst.senden({ bezug: { art: 'deal', id: '3' }, text: 'Hallo' }, 'u');
    expect(g.nachrichten[1]!.text).toContain('Dialog: Deal „Musterweg 3“ · Gedächtnis: 1 Einträge');
    const ohne = await dienst.senden({ text: 'Allgemein' }, 'u');
    expect(ohne.bezug).toBeNull();
    expect(ohne.nachrichten[1]!.text).toContain('Dialog: keiner');
    await expect(aufbau({ modell: null }).dienst.senden({ text: 'x' }, 'u')).rejects.toThrow('nicht eingerichtet');
  });

  it('Vorschlag: die KI schlägt vor (Karte an der Antwort), schreibt aber nichts; Ablegen und Verwerfen werden vermerkt', async () => {
    const modell = drehbuchModell([
      { content: [{ type: 'tool_use', id: 'v1', name: 'gedaechtnis_vorschlagen', input: { titel: 'Absprache', text: 'Verkäufer will warten' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Ich habe es zum Ablegen vorgeschlagen.' }], stop_reason: 'end_turn' },
      { content: [{ type: 'text', text: 'Hallo' }], stop_reason: 'end_turn' },
      { content: [{ type: 'text', text: 'Allgemein' }], stop_reason: 'end_turn' },
    ]);
    const { dienst, abgelegt } = aufbau({ gedaechtnis: [], modell });
    const g = await dienst.senden({ bezug: { art: 'deal', id: '1' }, text: 'Merk dir: Verkäufer will warten' }, 'anna');
    expect(g.nachrichten[1]).toMatchObject({ text: 'Ich habe es zum Ablegen vorgeschlagen.', vorschlag: { titel: 'Absprache', text: 'Verkäufer will warten' } });
    expect(abgelegt).toEqual([]);
    expect(modell.anfragen[0]!.tools.map((t) => t.name)).toContain('gedaechtnis_vorschlagen');
    expect(modell.anfragen[0]!.system).toContain('rufe gedaechtnis_vorschlagen auf');

    await dienst.ablegen({ bezug: { art: 'deal', id: '1' }, titel: 'Absprache', text: 'Verkäufer will warten', gespraechId: g.id, nachricht: 1 }, 'anna');
    expect(abgelegt).toHaveLength(1);
    expect((await dienst.gespraech(g.id)).nachrichten[1]).toMatchObject({ abgelegt: 'Absprache', vorschlag: { status: 'abgelegt' } });

    const g2 = await dienst.senden({ gespraechId: g.id, text: 'Hallo' }, 'anna');
    expect((await dienst.vorschlagVerwerfen({ gespraechId: g2.id, nachricht: 1 })).nachrichten[1]!.vorschlag?.status).toBe('verworfen');
    await expect(dienst.vorschlagVerwerfen({ gespraechId: g2.id, nachricht: 0 })).rejects.toThrow('Antwort nicht gefunden');

    // ohne Gedächtnis (Übersicht) wird nichts vorgeschlagen
    await dienst.senden({ text: 'Allgemein' }, 'anna');
    expect(modell.anfragen[3]!.tools.map((t) => t.name)).not.toContain('gedaechtnis_vorschlagen');
    expect(modell.anfragen[3]!.system).toContain('nur bei einem geöffneten Datensatz');
  });

  it('Änderungen: die KI schlägt vor (Karte), ausgeführt wird erst beim Übernehmen im Namen des Nutzers; je Karte einmal', async () => {
    const ausgefuehrt: { nutzer: string; name: string; args: unknown }[] = [];
    const aendern = (nutzer: string): WerkzeugQuelle => ({
      async liste() { return [{ name: 'update_makler', title: 'Makler ändern', description: 'ändert', inputSchema: { type: 'object' } }]; },
      async aufrufen(name, args) {
        ausgefuehrt.push({ nutzer, name, args });
        return (args as { version?: number }).version === 1 ? { text: '{"version":2}', fehler: false } : { text: 'Makler wurde zwischenzeitlich geändert', fehler: true };
      },
    });
    const modell = drehbuchModell([
      { content: [
        { type: 'tool_use', id: 'a1', name: 'update_makler', input: { id: 'm1', version: 1, prio: 'A' } },
        { type: 'tool_use', id: 'a2', name: 'update_makler', input: { id: 'm1', version: 0, mobil: '0171' } },
      ], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Zwei Änderungen vorgeschlagen.' }], stop_reason: 'end_turn' },
    ]);
    const { dienst } = aufbau({ gedaechtnis: [], modell, aendern });
    const g = await dienst.senden({ bezug: { art: 'makler', id: 'm1' }, text: 'Prio A und Mobil 0171' }, 'anna');
    expect(ausgefuehrt).toEqual([]);
    expect(g.nachrichten[1]!.aenderungen).toEqual([
      { werkzeug: 'update_makler', titel: 'Makler ändern', argumente: { id: 'm1', version: 1, prio: 'A' } },
      { werkzeug: 'update_makler', titel: 'Makler ändern', argumente: { id: 'm1', version: 0, mobil: '0171' } },
    ]);
    const angebot = modell.anfragen[0]!.tools.find((t) => t.name === 'update_makler')!;
    expect(angebot.description).toMatch(/^\[Führt nichts aus/);
    expect(modell.anfragen[0]!.system).toContain('Ändern geht nur per Vorschlag');
    expect(modell.anfragen[0]!.messages).toHaveLength(1);
    expect(modell.anfragen[1]!.messages[2]!.content).toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('erst, wenn der Nutzer „Übernehmen“') })]));

    const uebernommen = await dienst.aenderungEntscheiden({ gespraechId: g.id, nachricht: 1, aenderung: 0, aktion: 'uebernehmen' }, 'anna');
    expect(ausgefuehrt).toEqual([{ nutzer: 'anna', name: 'update_makler', args: { id: 'm1', version: 1, prio: 'A' } }]);
    expect(uebernommen.nachrichten[1]!.aenderungen![0]).toMatchObject({ status: 'uebernommen', ergebnis: '{"version":2}' });
    await expect(dienst.aenderungEntscheiden({ gespraechId: g.id, nachricht: 1, aenderung: 0, aktion: 'uebernehmen' }, 'anna')).rejects.toThrow('schon entschieden');
    // Fehler des Werkzeugs (z. B. veraltete Version) steht an der Karte
    const fehler = await dienst.aenderungEntscheiden({ gespraechId: g.id, nachricht: 1, aenderung: 1, aktion: 'uebernehmen' }, 'anna');
    expect(fehler.nachrichten[1]!.aenderungen![1]).toMatchObject({ status: 'fehler', ergebnis: 'Makler wurde zwischenzeitlich geändert' });
    await expect(dienst.aenderungEntscheiden({ gespraechId: g.id, nachricht: 1, aenderung: 5, aktion: 'verwerfen' }, 'anna')).rejects.toThrow('Vorschlag nicht gefunden');
  });

  it('Änderungen verwerfen führt nichts aus; ohne `aendern` werden keine Schreibwerkzeuge angeboten', async () => {
    const ausgefuehrt: string[] = [];
    const aendern = (): WerkzeugQuelle => ({
      async liste() { return [{ name: 'create_makler', description: 'legt an', inputSchema: { type: 'object' } }]; },
      async aufrufen(name) { ausgefuehrt.push(name); return { text: 'ok', fehler: false }; },
    });
    const { dienst } = aufbau({ gedaechtnis: [], aendern });
    const g = await dienst.senden({ bezug: { art: 'makler', id: 'm1' }, text: 'werkzeug:create_makler {"name":"Neu"}' }, 'u');
    expect(g.nachrichten[1]!.aenderungen).toEqual([{ werkzeug: 'create_makler', titel: 'create_makler', argumente: { name: 'Neu' } }]);
    const v = await dienst.aenderungEntscheiden({ gespraechId: g.id, nachricht: 1, aenderung: 0, aktion: 'verwerfen' }, 'u');
    expect(v.nachrichten[1]!.aenderungen![0]!.status).toBe('verworfen');
    expect(ausgefuehrt).toEqual([]);

    const modell = drehbuchModell([{ content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' }]);
    await aufbau({ gedaechtnis: [], modell }).dienst.senden({ text: 'x' }, 'u');
    expect(modell.anfragen[0]!.tools.map((t) => t.name)).toEqual(['read_entity']);
    expect(modell.anfragen[0]!.system).toContain('ändern kannst du nichts');
  });

  it('Attrappe schlägt „merk dir …“ vor; Gespräche lassen sich löschen', async () => {
    const { dienst } = aufbau({ gedaechtnis: [] });
    const g = await dienst.senden({ bezug: { art: 'deal', id: '1' }, text: 'merk dir: Termin am Montag' }, 'u');
    expect(g.nachrichten[1]!.vorschlag).toEqual({ titel: 'Notiz', text: 'Termin am Montag' });
    expect(await dienst.gespraechLoeschen(g.id)).toEqual({ id: g.id, geloescht: true });
    await expect(dienst.gespraech(g.id)).rejects.toThrow('nicht gefunden');
    await expect(dienst.gespraechLoeschen(g.id)).rejects.toThrow('nicht gefunden');
  });

  it('Ablegen geht mit Titel ins Gedächtnis des Dialogs; Einstellungen nur mit bekanntem Modell', async () => {
    const { dienst, abgelegt } = aufbau();
    await dienst.ablegen({ bezug: { art: 'deal', id: '1' }, titel: ' Vergleich ', text: '| a |' }, 'anna');
    expect(abgelegt).toEqual([{ bezug: { art: 'deal', id: '1' }, titel: 'Vergleich', text: '| a |', von: 'leiste:anna' }]);
    await expect(dienst.ablegen({ bezug: { art: 'liste', id: '1' }, titel: 't', text: 'x' }, 'a')).rejects.toThrow('kein Gedächtnis');
    await expect(dienst.einstellungenSpeichern({ modell: 'fremd', websuche: true, gedaechtnis: true })).rejects.toThrow('Unbekanntes Modell');
    expect(await dienst.einstellungenSpeichern({ modell: 'm1', websuche: true, gedaechtnis: false })).toEqual({ modell: 'm1', websuche: true, gedaechtnis: false });
    expect(await dienst.stand()).toMatchObject({ verfuegbar: true, gedaechtnis: true, verlaufDauerhaft: true, einstellungen: { websuche: true } });
  });
});
