import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { KALK_STANDARD } from '@gg/domain';
import { KiDienstFehler, KiSchluesselFehler, kiAttrappe, speicherImSpeicher, testExpose, testExposeV2 } from '@gg/integrations';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { mitAusgeliefertenStandards } from './standardwerte.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

describe.skipIf(!url)('Exposé-Import gegen die lokale Datenbank (KI-Attrappe, Ablage im Speicher)', () => {
  const { db, client } = createDb(url!);
  const speicher = speicherImSpeicher();
  const app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, expose: { speicher, ki: kiAttrappe(), attrappe: true } });
  const kennung = `Imp${Date.now()}`;
  const angelegt = { deals: [] as string[], objekte: [] as string[], makler: [] as string[], importe: [] as string[] };
  mitAusgeliefertenStandards(url!);

  afterAll(async () => {
    if (angelegt.importe.length) {
      await db.delete(schema.importKorrekturen).where(inArray(schema.importKorrekturen.importId, angelegt.importe));
      await db.delete(schema.exposeImporte).where(inArray(schema.exposeImporte.id, angelegt.importe));
    }
    if (angelegt.deals.length) await db.delete(schema.deals).where(inArray(schema.deals.id, angelegt.deals));
    if (angelegt.objekte.length) await db.delete(schema.objekte).where(inArray(schema.objekte.id, angelegt.objekte));
    if (angelegt.makler.length) await db.delete(schema.makler).where(inArray(schema.makler.id, angelegt.makler));
    await db.delete(schema.auditLog).where(like(schema.auditLog.source, 'expose-analyse/%'));
    await client.end();
  });

  const lies = async (r: Response | Promise<Response>): Promise<any> => {
    const b: any = await (await r).json();
    if (typeof b?.importId === 'string' && !angelegt.importe.includes(b.importId)) angelegt.importe.push(b.importId);
    return b;
  };
  const json = (pfad: string, body: unknown) => app.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const eingang = (bytes: Uint8Array) => app.request('/api/expose/eingang', { method: 'POST', body: bytes });

  it('KI-Schlüssel aus Einstellungen → Zugänge gilt auch für den Exposé-Import — ohne Neustart, vor der Umgebung', async () => {
    // Wie online: keine Attrappe, kein Schlüssel in der Umgebung
    const online = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, expose: { speicher, ki: null, attrappe: false } });
    const zugang = (wert: string) => online.request('/api/zugaenge/anthropic-api-key', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wert }) });
    try {
      expect((await zugang('')).status).toBe(200);
      expect(await lies(online.request('/api/ki/status'))).toMatchObject({ verfuegbar: false, attrappe: false });
      const ohne = await online.request('/api/expose/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: '_eingang/00000000-0000-4000-8000-000000000000', dateiname: 'x.pdf' }) });
      expect(ohne.status).toBe(422);
      expect((await lies(ohne)).fehler).toContain('Einstellungen → Zugänge');

      expect((await zugang('sk-ant-test-nur-fuer-den-status-0000')).status).toBe(200);
      expect(await lies(online.request('/api/ki/status'))).toMatchObject({ verfuegbar: true, attrappe: false });
    } finally {
      await zugang('');
    }
  });

  it('abgelehnter KI-Schlüssel: klare Meldung mit Quelle statt „Interner Fehler“; „Schlüssel testen“ prüft den verwendeten Schlüssel', async () => {
    const abgelehnt = { nachricht: async () => { throw new KiSchluesselFehler(401, 'invalid x-api-key'); }, dateiHochladen: async () => { throw new KiSchluesselFehler(401, 'invalid x-api-key'); }, dateiLoeschen: async () => {} };
    let geprueft = '';
    const online = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, ki: abgelehnt, expose: { speicher, ki: null, attrappe: false },
      kiSchluesselPruefen: async (key: string) => { geprueft = key; return { gueltig: false, meldung: 'abgelehnt (Test)' }; } });
    const post = (pfad: string, body: unknown) => online.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const zugang = (wert: string) => online.request('/api/zugaenge/anthropic-api-key', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wert }) });
    try {
      await zugang('sk-ant-test-abgelehnt-9876');
      const e = await lies(online.request('/api/expose/eingang', { method: 'POST', body: testExpose('Schlüsseltest') }));
      const r = await post('/api/expose/analyse', { key: e.key, dateiname: 'schluessel.pdf' });
      expect(r.status).toBe(422);
      const f = (await lies(r)).fehler as string;
      expect(f).toContain('Anthropic-Schlüssel wird abgelehnt');
      expect(f).toContain('Einstellungen → Zugänge');
      expect(f).toContain('••••9876');

      const t = await lies(post('/api/zugaenge/anthropic-api-key/pruefen', {}));
      expect(t).toMatchObject({ gueltig: false, meldung: 'abgelehnt (Test)', quelle: 'einstellungen', maske: '••••9876' });
      expect(geprueft).toBe('sk-ant-test-abgelehnt-9876');
    } finally {
      await zugang('');
    }
  });

  it('Nutzungslimit, Überlast und unerwartete Fehler: die Ursache steht in der Antwort statt nur „Interner Fehler“', async () => {
    const mit = (fehler: Error) => {
      const ki = { nachricht: async () => { throw fehler; }, dateiHochladen: async () => 'f', dateiLoeschen: async () => {} };
      return createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, ki, expose: { speicher, ki: null, attrappe: false } });
    };
    const analysieren = async (app: ReturnType<typeof createApp>) => {
      const e = await lies(app.request('/api/expose/eingang', { method: 'POST', body: testExpose('Fehlertest') }));
      return app.request('/api/expose/analyse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: e.key, dateiname: 'f.pdf' }) });
    };
    const zugang = (app: ReturnType<typeof createApp>, wert: string) => app.request('/api/zugaenge/anthropic-api-key', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wert }) });
    const limit = mit(new KiDienstFehler(400, 'limit', 'Das Nutzungslimit des Anthropic-Kontos ist erreicht — die KI-Auswertung ist gesperrt. Wieder verfügbar ab 01.11.2026, 00:00 UTC.'));
    try {
      await zugang(limit, 'sk-ant-test-limit-0000');
      const r = await analysieren(limit);
      expect(r.status).toBe(503);
      expect(await lies(r)).toMatchObject({ fehler: expect.stringContaining('Nutzungslimit'), details: { quelle: 'anthropic', art: 'limit' } });
      const kaputt = mit(new Error('Verbindung zur Datenbank verloren'));
      const k = await analysieren(kaputt);
      expect(k.status).toBe(500);
      expect((await lies(k)).fehler).toBe('Interner Fehler: Verbindung zur Datenbank verloren');
    } finally {
      await zugang(limit, '');
    }
  });

  it('„Schlüssel testen“ mit KI-Attrappe: nichts wird geprüft', async () => {
    expect(await lies(json('/api/zugaenge/anthropic-api-key/pruefen', {}))).toMatchObject({ gueltig: true, meldung: expect.stringContaining('Test-Modus') });
  });

  it('nimmt nur echte PDFs an und analysiert nur eigene Eingänge', async () => {
    expect((await eingang(new TextEncoder().encode('kein pdf'))).status).toBe(422);
    expect((await json('/api/expose/analyse', { key: 'deal-docs/fremd.pdf', dateiname: 'x.pdf' })).status).toBe(422);
    expect((await json('/api/expose/analyse', { key: '_eingang/00000000-0000-4000-8000-000000000000', dateiname: 'x.pdf' })).status).toBe(404);
  });

  it('Direkt-Upload: Ticket, Datei liegt im Eingang, Übernahme prüft sie dort — und räumt ab, was kein PDF ist', async () => {
    const hochladen = async (bytes: Uint8Array) => {
      const t = await lies(json('/api/upload/ticket', { zweck: 'expose', groesse: bytes.byteLength }));
      await speicher.ablegen('pdfs', t.key, bytes, 'application/pdf');
      return t.key as string;
    };
    const gross = new Uint8Array(6 * 1024 * 1024).fill(0x20); // über den 4,5 MB einer Function
    gross.set(new TextEncoder().encode('%PDF-1.7\n'));
    const key = await hochladen(gross);
    const r = await json('/api/expose/eingang/uebernehmen', { key });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ key, groesse: gross.byteLength });
    expect(speicher.inhalt.has(`pdfs/${key}`)).toBe(true); // bleibt im Eingang, bis die Analyse es holt

    const keinPdf = await hochladen(new TextEncoder().encode('kein pdf'));
    expect((await json('/api/expose/eingang/uebernehmen', { key: keinPdf })).status).toBe(422);
    expect(speicher.inhalt.has(`pdfs/${keinPdf}`)).toBe(false);
    expect((await json('/api/expose/eingang/uebernehmen', { key: 'fremd/expose.pdf' })).status).toBe(400);
    expect((await json('/api/expose/eingang/uebernehmen', { key: '_eingang/00000000-0000-4000-8000-000000000000' })).status).toBe(404);
  });

  it('Upload → Analyse → Übernahme legt Objekt, Makler, Deal mit Einheiten und PDF an', async () => {
    const { key } = await lies(eingang(testExpose(kennung)));
    const a = await lies(json('/api/expose/analyse', { key, dateiname: `${kennung}.pdf` }));
    expect(a).toMatchObject({
      modus: 'text', attrappe: true,
      objekt: { strasse: `${kennung}strasse`, hausnr: '12', plz: '89073', stadt: 'Ulm', angebotspreis: 1_250_000, wohnflaeche: 240, einheiten: [{ lage: 'EG links', flaeche: 80 }, {}, {}] },
      makler: { name: `Anna ${kennung}`, prio: 'B', kontaktFreq: 'Monatlich' },
      deal: { status: 'In Prüfung', nachfassFreq: 'Wöchentlich', kalk: { kaufpreis: 1_250_000, rp_pct: KALK_STANDARD.rp_pct, notar: KALK_STANDARD.notar } },
      dubletten: { objekt: null, makler: null },
    });

    const r = await json('/api/expose/uebernehmen', {
      key, dateiname: `${kennung}.pdf`, extrahiert: a.extrahiert,
      objekt: { daten: a.objekt }, makler: { daten: { ...a.makler, tel: `0049 ${a.makler.tel.slice(1)}` } },
      deal: { ...a.deal, kalk: { ...a.deal.kalk, makler: 0 } },
    });
    expect(r.status).toBe(201);
    const erg = await lies(r);
    angelegt.deals.push(erg.dealId); angelegt.objekte.push(erg.objektId); angelegt.makler.push(erg.maklerId);
    expect(erg.pdfGespeichert).toBe(true);

    const deal = await lies(app.request(`/api/deals/${erg.dealId}`));
    expect(deal.einheiten.map((e: any) => [e.lage, e.flaeche, e.mieteIst, e.renditeK])).toEqual([['EG links', 80, 800, 4.5], ['OG rechts', 80, 820, 4.5], ['DG', 80, 700, 4.5]]);
    expect(deal.kalkulation).toMatchObject({ kaufpreis: 1_250_000, makler: 0, rp_pct: 10 });
    expect(deal.kalkulation.gik).toBeGreaterThan(1_250_000);
    const [makler] = await db.select().from(schema.makler).where(eq(schema.makler.id, erg.maklerId));
    expect(makler).toMatchObject({ tel: `+49 ${a.makler.tel.slice(1)}`, kontaktFrequenz: 'Monatlich', prio: 'B' });
    const verlauf = await lies(app.request(`/api/deals/${erg.dealId}/status-historie`));
    expect(verlauf[0]).toMatchObject({ nachStatus: 'In Prüfung', quelle: 'wizard' });
    const [dok] = await db.select().from(schema.dealDokumente).where(eq(schema.dealDokumente.dealId, erg.dealId));
    expect(dok).toMatchObject({ label: 'Exposé (Import)', istExpose: true, dateiname: `Exposé_${kennung}strasse 12.pdf` });
    expect(speicher.inhalt.has(`pdfs/${erg.dealId}.pdf`)).toBe(true);
    expect(speicher.inhalt.has(`pdfs/${key}`)).toBe(false);
    expect(await lies(app.request('/api/expose/bekannte-dateien'))).toContain(`${kennung}.pdf`.toLowerCase());
  });

  it('nimmt null für nicht gefundene Felder an (so liefert es die KI) und speichert sie als leer', async () => {
    // Echte Exposés belegen selten alle Felder. Claude gibt für jedes nicht gefundene Feld `null` zurück —
    // ein Vertrag, der nur `undefined` zuließe, wies solche Exposés mit „Eingabe ungültig" ab (Befund 18.09.2026).
    // Deutlich andere Adresse als die übrigen Tests: sonst hält die Dublettenprüfung sie für verwandt.
    const eigene = `Leerfeld${Date.now()}`;
    const { key } = await lies(eingang(testExpose(eigene)));
    const a = await lies(json('/api/expose/analyse', { key, dateiname: `${eigene}.pdf` }));

    const r = await json('/api/expose/uebernehmen', {
      key, dateiname: `${eigene}.pdf`, extrahiert: a.extrahiert,
      objekt: { daten: { ...a.objekt, bundesland: null, heizungsart: null, lagebeschreibung: null,
        energieausweis: { klasse: null, kennwert: null, art: null },
        einheiten: [{ typ: null, lage: null, zimmer: null, flaeche: 80, kaltmiete: 700, vermiet: null }] } },
      makler: { daten: { ...a.makler, name: null, firma: null, webseite: null, notizen: null, prio: null, kontaktFreq: null } },
      deal: a.deal,
    });
    expect(r.status).toBe(201);
    const erg = await lies(r);
    angelegt.deals.push(erg.dealId); angelegt.objekte.push(erg.objektId);
    if (erg.maklerId) angelegt.makler.push(erg.maklerId);

    // null wird zu „nicht gesetzt", nicht zum Text „null"
    const [objekt] = await db.select().from(schema.objekte).where(eq(schema.objekte.id, erg.objektId));
    expect(objekt).toMatchObject({ energieklasse: null, heizung: null });
    const deal = await lies(app.request(`/api/deals/${erg.dealId}`));
    expect(deal.einheiten).toHaveLength(1);
    expect(deal.einheiten[0]).toMatchObject({ flaeche: 80, mieteIst: 700 });
  });

  it('zweiter Import: erkennt Objekt und Makler als Dubletten, Deal-Dublette → 409 ohne neue Datensätze', async () => {
    const { key } = await lies(eingang(testExpose(kennung)));
    const a = await lies(json('/api/expose/analyse', { key, dateiname: 'nochmal.pdf' }));
    expect(a.dubletten.objekt).toMatchObject({ sicherheit: 'exact' });
    expect(a.dubletten.makler).toMatchObject({ sicherheit: 'exact' });
    const vorher = (await db.select().from(schema.deals)).length;
    const r = await json('/api/expose/uebernehmen', {
      key, dateiname: 'nochmal.pdf', extrahiert: a.extrahiert,
      objekt: { bestehendeId: a.dubletten.objekt.id, daten: a.objekt }, makler: { bestehendeId: a.dubletten.makler.id, daten: a.makler }, deal: a.deal,
    });
    expect(r.status).toBe(409);
    expect((await lies(r)).details.dealId).toBe(angelegt.deals[0]);
    expect((await db.select().from(schema.deals)).length).toBe(vorher);
  });

  it('Analyse (Erfassung v2) legt eine Import-Zeile mit Messwerten und Belegprüfung an und liefert Angaben und Ziele', async () => {
    const eigene = `Vein${Date.now()}`;
    const { key } = await lies(eingang(testExposeV2(eigene)));
    const a = await lies(json('/api/expose/analyse', { key, dateiname: `${eigene}.pdf` }));
    expect(a).toMatchObject({
      schemaVersion: 'gg-expose-v2', importId: expect.any(String),
      objekt: { strasse: `${eigene}strasse`, hausnr: '12', angebotspreis: 1_250_000, wohnflaeche: 240, grundstueck: 480 },
      extrahiert: { objekt: { angebotspreis: 1_250_000 } },
      makler: { name: `Anna ${eigene}` },
    });
    expect(a).not.toHaveProperty('v1');
    expect(a.belegQuote).toBeGreaterThan(0.5);
    expect(Array.isArray(a.warnungen)).toBe(true);

    // Angaben: Mapping, KI-Vorschlag, ohne Ziel; leerer Datensatz → Status „leer“
    const nach = (art: 'objekt' | 'makler', bezeichnung: string) => a.angaben[art].find((x: any) => x.bezeichnung === bezeichnung);
    expect(nach('objekt', 'Kaufpreis')).toMatchObject({
      importId: a.importId, feld: expect.stringMatching(/^angaben\.\d+$/), wert: '1.250.000 EUR', seite: 1, belegt: true, pfad: 'preise.kaufpreis',
      ziel: { feld: 'objekt.angebotspreis', wert: 1_250_000, aktuell: null, status: 'leer', quelle: 'mapping' },
    });
    expect(nach('objekt', 'Instandhaltungsrücklage')).toMatchObject({ seite: 2, ziel: { feld: 'details.instandhaltungsruecklage', quelle: 'vorschlag' } });
    expect(nach('objekt', 'Besichtigung')).toMatchObject({ wert: 'nach Vereinbarung', ziel: { feld: null, status: 'keinFeld' } });
    expect(nach('objekt', 'Ansprechpartner')).toBeUndefined();
    expect(nach('makler', 'Ansprechpartner')).toMatchObject({ wert: 'Max Zweit', ziel: { feld: 'makler.weitereKontakte' } });
    expect(a.angaben.objekt.filter((x: any) => x.gruppe === 'einheiten')).toHaveLength(3);

    // Ziele: Objekt mit Kalkulation (Prüfseite zeigt beides gemeinsam), Makler getrennt
    const schluessel = (art: 'objekt' | 'makler') => a.ziele[art].map((z: any) => z.schluessel as string);
    expect(schluessel('objekt')).toEqual(expect.arrayContaining(['objekt.angebotspreis', 'details.hausgeld_monat', 'kalkulation.kaufpreis']));
    expect(schluessel('objekt').some((s: string) => s.startsWith('makler.'))).toBe(false);
    expect(schluessel('makler').every((s: string) => s.startsWith('makler.'))).toBe(true);
    expect(a.ziele.objekt.find((z: any) => z.schluessel === 'objekt.wohnflaeche')).toEqual({ schluessel: 'objekt.wohnflaeche', label: 'Wohnfläche', einheit: 'm²', pruef: 'objekt.wohnflaeche' });
    expect(a.ziele.objekt.find((z: any) => z.schluessel === 'details.provision')).toMatchObject({ pruef: null, einheit: null });

    const [imp] = await db.select().from(schema.exposeImporte).where(eq(schema.exposeImporte.id, a.importId));
    expect(imp).toMatchObject({
      eingangKey: key, dateiname: `${eigene}.pdf`, schemaVersion: 'gg-expose-v2', weg: 'text', status: 'analysiert', seitenGesamt: 2, seitenGelesen: 2,
      dealId: null, objektId: null, maklerId: null,
      rohdaten: { schema: 'gg-expose-v2', einheiten_tabellen: [{ seite: 2 }] },
      analyse: { nachfass: false, wiederholung: false, belegQuote: a.belegQuote },
    });
    const roh = imp!.rohdaten as any;
    const analyse = imp!.analyse as any;
    expect(analyse.belegt).toHaveLength(roh.angaben.length);
    expect(roh.angaben.find((x: any) => x.bezeichnung === 'Kaufpreis')).toMatchObject({ wert: '1.250.000 EUR', seite: 1, pfad: 'preise.kaufpreis' });
    expect(imp!.promptVersion).toBeTruthy();
  });

  it('Übernehmen mit importId: Import verknüpft, details aus der Zuordnung, manuelle Zuordnungen samt Korrektur-Zeilen', async () => {
    const eigene = `Vueb${Date.now()}`;
    const { key } = await lies(eingang(testExposeV2(eigene)));
    const a = await lies(json('/api/expose/analyse', { key, dateiname: `${eigene}.pdf` }));
    const feld = (art: 'objekt' | 'makler', bezeichnung: string) => a.angaben[art].find((x: any) => x.bezeichnung === bezeichnung).feld as string;
    const ruecklage = feld('objekt', 'Instandhaltungsrücklage');
    const besichtigung = feld('objekt', 'Besichtigung');
    const position = feld('makler', 'Position');
    const r = await json('/api/expose/uebernehmen', {
      key, dateiname: `${eigene}.pdf`, extrahiert: a.extrahiert, importId: a.importId,
      zuordnungen: [
        { feld: ruecklage, ziel: 'details.instandhaltungsruecklage' },
        { feld: besichtigung, ziel: 'notizen' },
        { feld: besichtigung, ziel: 'details.sanierungen' },
        { feld: position, ziel: 'makler.weitereKontakte' },
        // werden übergangen: Formularfeld der Prüfseite, unbekanntes Ziel, unbekannte Angabe, unlesbarer Wert
        { feld: feld('objekt', 'Kaufpreis'), ziel: 'objekt.angebotspreis' },
        { feld: ruecklage, ziel: 'gibt.es.nicht' },
        { feld: 'angaben.999', ziel: 'details.titel' },
        { feld: besichtigung, ziel: 'details.stellplaetze' },
      ],
      objekt: { daten: { ...a.objekt, notizen: 'Von der Prüfseite' } }, makler: { daten: a.makler }, deal: a.deal,
    });
    expect(r.status).toBe(201);
    const erg = await lies(r);
    angelegt.deals.push(erg.dealId); angelegt.objekte.push(erg.objektId); if (erg.maklerId) angelegt.makler.push(erg.maklerId);

    const [imp] = await db.select().from(schema.exposeImporte).where(eq(schema.exposeImporte.id, a.importId));
    expect(imp).toMatchObject({ status: 'uebernommen', dealId: erg.dealId, objektId: erg.objektId, maklerId: erg.maklerId });
    const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, erg.dealId));
    expect(deal!.exposeRohdaten).toMatchObject({ importId: a.importId, originalFileName: `${eigene}.pdf`, objekt: { angebotspreis: 1_250_000 } });

    const o = await lies(app.request(`/api/objekte/${erg.objektId}`));
    expect(o.details).toMatchObject({
      hausgeld_monat: 350, denkmalschutz: 'ja', instandhaltungsruecklage: 12_000, sanierungen: ['Besichtigung: nach Vereinbarung'],
      herkunft: 'Exposé-Import', importId: a.importId,
    });
    expect(o.details).not.toHaveProperty('stellplaetze');
    expect(o.notizen).toBe(`Von der Prüfseite\nBesichtigung: nach Vereinbarung (Exposé S. 2)`);
    const [makler] = await db.select().from(schema.makler).where(eq(schema.makler.id, erg.maklerId));
    expect((makler!.weitereKontakte as any).namen).toEqual(expect.arrayContaining(['Max Zweit', 'Geschäftsführer']));

    const einheiten = await db.select().from(schema.objektEinheiten).where(eq(schema.objektEinheiten.objektId, erg.objektId)).orderBy(schema.objektEinheiten.sort);
    expect(einheiten).toHaveLength(3);
    expect(einheiten.map((x) => x.details)).toEqual([{ seite: 2 }, { seite: 2 }, { seite: 2 }]);

    const k = await db.select().from(schema.importKorrekturen).where(eq(schema.importKorrekturen.importId, a.importId));
    expect(k).toHaveLength(4);
    expect(k).toEqual(expect.arrayContaining([
      expect.objectContaining({ art: 'objekt', bezugId: erg.objektId, feld: ruecklage, ziel: 'details.instandhaltungsruecklage', kiWert: '12.000 EUR', aktion: 'zugeordnet', konfidenz: null, promptVersion: imp!.promptVersion }),
      expect.objectContaining({ art: 'objekt', feld: besichtigung, ziel: 'notizen', kiWert: 'nach Vereinbarung', aktion: 'zugeordnet' }),
      expect.objectContaining({ art: 'objekt', feld: besichtigung, ziel: 'details.sanierungen' }),
      expect.objectContaining({ art: 'makler', bezugId: erg.maklerId, feld: position, ziel: 'makler.weitereKontakte', kiWert: 'Geschäftsführer' }),
    ]));
  });

  it('Exposé überspringen: Import wird verworfen; unbekannt → 404; übernommene bleiben übernommen', async () => {
    const eigene = `Vverw${Date.now()}`;
    const { key } = await lies(eingang(testExposeV2(eigene)));
    const a = await lies(json('/api/expose/analyse', { key, dateiname: `${eigene}.pdf` }));
    const r = await json(`/api/expose/importe/${a.importId}/verwerfen`, {});
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: a.importId });
    const [imp] = await db.select({ status: schema.exposeImporte.status }).from(schema.exposeImporte).where(eq(schema.exposeImporte.id, a.importId));
    expect(imp!.status).toBe('verworfen');
    expect((await json('/api/expose/importe/gibt-es-nicht/verwerfen', {})).status).toBe(404);
  });
});
