import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { EXPOSE_V0_SCHEMA, EXPOSE_V2_SCHEMA, type ExposeV2, exposeVorbereiten, zuordnen } from '@gg/domain';
import { kiAttrappe, speicherImSpeicher, testExpose } from '@gg/integrations';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exposeV2Beispiel } from '../../../packages/domain/test/fixtures/expose-v2-beispiel.ts';
import { createApp } from '../src/app.ts';
import { mitAusgeliefertenStandards } from './standardwerte.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

/**
 * Beispiel-Erfassung (Fixture der Domain) mit eigener Adresse. Indizes der Angaben, die unten vorkommen:
 * 2 Kaufpreis · 7 Grundstück · 18 Instandhaltungsrücklage (nur KI-Vorschlag) · 19 Besichtigung (ohne Ziel) ·
 * 25 Telefon Zentrale (Kontakt 1) · 28 Max Zweit (Kontakt 2)
 */
function erfassung(kennung: string): ExposeV2 {
  const v2 = exposeV2Beispiel();
  return { ...v2, angaben: v2.angaben.map((a) => ({ ...a, wert: a.wert.replace('Musterweg', `${kennung}weg`) })) };
}

describe.skipIf(!url)('Reiter „Aus dem Exposé“: Angaben lesen und übernehmen (Erfassung v2)', () => {
  const { db, client } = createDb(url!);
  const app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, expose: { speicher: speicherImSpeicher(), ki: kiAttrappe(), attrappe: true, texterkennung: null } });
  const kennung = `Ang${Date.now()}`;
  mitAusgeliefertenStandards(url!);
  const importId = crypto.randomUUID();
  const altImportId = crypto.randomUUID();
  let objektId = '';
  let maklerId = '';
  let dealId = '';

  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const post = (pfad: string, body: unknown) => app.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const objektVersion = async () => (await lies(app.request(`/api/objekte/${objektId}`))).version as number;
  const maklerVersion = async () => (await lies(app.request(`/api/makler/${maklerId}`))).version as number;
  const angabe = async (art: 'objekte' | 'makler', id: string, feld: string) =>
    ((await lies(app.request(`/api/${art}/${id}/expose-angaben`))).angaben as any[]).find((a) => a.feld === feld);
  const korrekturen = (feld: string) => db.select().from(schema.importKorrekturen).where(and(eq(schema.importKorrekturen.importId, importId), eq(schema.importKorrekturen.feld, feld)));
  const uebernahme = (art: 'objekte' | 'makler', id: string, body: Record<string, unknown>) => post(`/api/${art}/${id}/expose-uebernahme`, { importId, ...body });

  beforeAll(async () => {
    const v2 = erfassung(kennung);
    const belegt = v2.angaben.map((_, i) => (i === 2 ? true : null));
    await db.insert(schema.exposeImporte).values({
      id: importId, dateiname: `${kennung}.pdf`, schemaVersion: EXPOSE_V2_SCHEMA, promptVersion: 'test-v2', status: 'analysiert',
      rohdaten: v2, analyse: { belegt, belegQuote: 1, warnungen: [] },
    });
    const { key } = await lies(app.request('/api/expose/eingang', { method: 'POST', body: testExpose(kennung) }));
    const v = exposeVorbereiten(zuordnen(v2, belegt).pruefdaten);
    // Grundstück auf der Prüfseite geleert → Spalte bleibt leer
    const r = await lies(post('/api/expose/uebernehmen', {
      key, dateiname: `${kennung}.pdf`, extrahiert: {}, importId,
      objekt: { daten: { ...v.objekt, grundstueck: null } }, makler: { daten: v.makler }, deal: v.deal,
    }));
    ({ objektId, maklerId, dealId } = r);
    // Altimport (v0) am selben Objekt: erscheint in der Liste, liefert aber keine Angaben
    await db.insert(schema.exposeImporte).values({
      id: altImportId, dateiname: 'alt.pdf', schemaVersion: EXPOSE_V0_SCHEMA, status: 'uebernommen', objektId, rohdaten: { objekt: {} },
      createdAt: '2020-01-01T00:00:00Z',
    });
  });

  afterAll(async () => {
    await db.delete(schema.importKorrekturen).where(inArray(schema.importKorrekturen.importId, [importId, altImportId]));
    await db.delete(schema.exposeImporte).where(inArray(schema.exposeImporte.id, [importId, altImportId]));
    if (dealId) await db.delete(schema.deals).where(eq(schema.deals.id, dealId));
    if (objektId) await db.delete(schema.objekte).where(eq(schema.objekte.id, objektId));
    if (maklerId) await db.delete(schema.makler).where(eq(schema.makler.id, maklerId));
    await db.delete(schema.auditLog).where(and(eq(schema.auditLog.type, 'expose-uebernahme'), inArray(schema.auditLog.entityId, [objektId, maklerId].filter(Boolean))));
    await client.end();
  });

  it('Angaben-Liste: Importe neueste zuerst (Altimport ohne Angaben), Mapping, KI-Vorschlag, ohne Ziel, Dropdown-Ziele', async () => {
    const r = await lies(app.request(`/api/objekte/${objektId}/expose-angaben`));
    expect(r.importe).toEqual([
      expect.objectContaining({ id: importId, dateiname: `${kennung}.pdf`, dealId, schemaVersion: EXPOSE_V2_SCHEMA }),
      expect.objectContaining({ id: altImportId, schemaVersion: EXPOSE_V0_SCHEMA }),
    ]);
    expect(r.angaben.every((a: any) => a.importId === importId)).toBe(true);
    const nach = (feld: string) => r.angaben.find((a: any) => a.feld === feld);
    expect(nach('angaben.2')).toMatchObject({
      wert: '1.250.000,00 €', bezeichnung: 'Kaufpreis', pfad: 'preise.kaufpreis', seite: 1, belegt: true, zuordnung: 'zugeordnet',
      ziel: { feld: 'objekt.angebotspreis', wert: 1_250_000, aktuell: 1_250_000, status: 'gleich', quelle: 'mapping' },
    });
    expect(nach('angaben.7')).toMatchObject({ wert: '480 m²', belegt: null, ziel: { feld: 'objekt.grundstueck', wert: 480, status: 'leer' } });
    expect(nach('angaben.18')).toMatchObject({ zuordnung: 'keinMapping', ziel: { feld: 'details.instandhaltungsruecklage', wert: 12_000, status: 'leer', quelle: 'vorschlag' } });
    expect(nach('angaben.19')).toMatchObject({ bezeichnung: 'Besichtigung', ziel: { feld: null, status: 'keinFeld' } });
    expect(nach('angaben.25')).toBeUndefined(); // Kontaktangaben stehen am Makler
    expect(r.angaben.filter((a: any) => a.gruppe === 'einheiten')).toHaveLength(4);
    expect(r.ziele).toEqual(expect.arrayContaining([
      { schluessel: 'objekt.grundstueck', label: 'Grundstück', einheit: 'm²', aktuell: null, leer: true },
      expect.objectContaining({ schluessel: 'objekt.angebotspreis', aktuell: 1_250_000, leer: false }),
      expect.objectContaining({ schluessel: 'details.sanierungen', leer: true }),
    ]));
    expect(r.ziele.some((z: any) => z.schluessel.startsWith('makler.') || z.schluessel.startsWith('kalkulation.'))).toBe(false);
    // über den Deal gefunden, auch ohne direkte Verknüpfung
    await db.update(schema.exposeImporte).set({ objektId: null }).where(eq(schema.exposeImporte.id, importId));
    expect((await lies(app.request(`/api/objekte/${objektId}/expose-angaben`))).importe).toHaveLength(2);
    await db.update(schema.exposeImporte).set({ objektId }).where(eq(schema.exposeImporte.id, importId));
    expect((await app.request('/api/objekte/gibt-es-nicht/expose-angaben')).status).toBe(404);
  });

  it('Übernehmen hat aus der Zuordnung geschrieben: Makler-Anschrift, details des Objekts, Einheiten-details', async () => {
    const m = await lies(app.request(`/api/makler/${maklerId}`));
    expect(m).toMatchObject({ strasse: 'Hafenstraße 3', plz: '89073', ort: 'Ulm', name: 'Anna Beispiel', mobil: '0171 1234567' });
    expect(m.weitereKontakte).toMatchObject({ namen: ['Max Zweit'], telefonnummern: ['0731 555'] });
    const o = await lies(app.request(`/api/objekte/${objektId}`));
    expect(o).toMatchObject({ istMiete: 2320, sollMiete: null });
    expect(o.details).toMatchObject({
      titel: 'Gepflegtes Mehrfamilienhaus in Ulm', provision: '3,57 % inkl. MwSt.', kaufpreisfaktor: 22.9, sanierungen: ['Dach: 2015 neu eingedeckt'],
      heizungsbaujahr: 2018, energieausweis: { art: 'Verbrauchsausweis', klasse: 'D', kennwert: 128.4 }, importId,
    });
    const einheiten = await db.select().from(schema.objektEinheiten).where(eq(schema.objektEinheiten.objektId, objektId)).orderBy(schema.objektEinheiten.sort);
    expect(einheiten.map((e) => e.typ)).toEqual(['Wohnung', 'Wohnung', 'Wohnung', 'Stellplatz']);
    expect(einheiten[0]!.details).toEqual({ nr: '1', nebenkosten: 150, mietbeginn: '01.01.2020', seite: 4, weitere: { Kaution: '2.400 €' } });
  });

  it('Übernahme in eine leere Spalte: Wert gesetzt, version + 1, Korrektur-Zeile und Audit', async () => {
    const v = await objektVersion();
    const r = await uebernahme('objekte', objektId, { version: v, feld: 'angaben.7', ziel: 'objekt.grundstueck' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: objektId, version: v + 1 });
    expect((await lies(app.request(`/api/objekte/${objektId}`))).grundstueck).toBe(480);
    expect(await korrekturen('angaben.7')).toEqual([
      expect.objectContaining({ art: 'objekt', bezugId: objektId, ziel: 'objekt.grundstueck', kiWert: '480 m²', handWert: null, aktion: 'uebernommen', promptVersion: 'test-v2' }),
    ]);
    const [audit] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.type, 'expose-uebernahme'), eq(schema.auditLog.entityId, objektId)));
    expect(audit).toMatchObject({ entity: 'objekt', fieldName: 'objekt.grundstueck', action: 'uebernommen' });
    expect((await angabe('objekte', objektId, 'angaben.7')).ziel.status).toBe('gleich');
  });

  it('abweichender Wert: ohne ersetzen 409 mit aktuellem Wert, mit ersetzen überschrieben', async () => {
    await db.update(schema.objekte).set({ angebotspreis: 1_000_000 }).where(eq(schema.objekte.id, objektId));
    expect((await angabe('objekte', objektId, 'angaben.2')).ziel).toMatchObject({ status: 'abweichend', aktuell: 1_000_000 });
    const v = await objektVersion();
    const ohne = await uebernahme('objekte', objektId, { version: v, feld: 'angaben.2', ziel: 'objekt.angebotspreis' });
    expect(ohne.status).toBe(409);
    expect((await lies(ohne)).details).toEqual({ aktuell: 1_000_000 });
    expect(await objektVersion()).toBe(v); // nichts geschrieben

    const mit = await uebernahme('objekte', objektId, { version: v, feld: 'angaben.2', ziel: 'objekt.angebotspreis', ersetzen: true });
    expect(mit.status).toBe(200);
    expect((await lies(app.request(`/api/objekte/${objektId}`))).angebotspreis).toBe(1_250_000);
    expect(await korrekturen('angaben.2')).toEqual([expect.objectContaining({ aktion: 'ersetzt', kiWert: '1.250.000,00 €', handWert: 1_000_000, ziel: 'objekt.angebotspreis' })]);
  });

  it('veraltete version → 409 mit aktuelleVersion', async () => {
    const v = await objektVersion();
    const r = await uebernahme('objekte', objektId, { version: v - 1, feld: 'angaben.2', ziel: 'objekt.angebotspreis' });
    expect(r.status).toBe(409);
    expect((await lies(r)).details).toEqual({ aktuelleVersion: v });
  });

  it('details: Schlüssel gemergt (Nachbarn bleiben), abweichend → 409; Liste wird angehängt; Notiz als neue Zeile', async () => {
    await db.update(schema.objekte).set({ details: { herkunft: 'Exposé-Import', importId, energieausweis: { klasse: 'C' }, sanierungen: ['Dach: 2015 neu eingedeckt'] }, notizen: 'Alte Notiz' })
      .where(eq(schema.objekte.id, objektId));
    let v = await objektVersion();
    expect((await uebernahme('objekte', objektId, { version: v, feld: 'angaben.18', ziel: 'details.instandhaltungsruecklage' })).status).toBe(200);
    let o = await lies(app.request(`/api/objekte/${objektId}`));
    expect(o.details).toEqual({ herkunft: 'Exposé-Import', importId, energieausweis: { klasse: 'C' }, sanierungen: ['Dach: 2015 neu eingedeckt'], instandhaltungsruecklage: 12_000 });
    expect((await angabe('objekte', objektId, 'angaben.18')).ziel.status).toBe('gleich');

    await db.update(schema.objekte).set({ details: { ...o.details, instandhaltungsruecklage: 5000 } }).where(eq(schema.objekte.id, objektId));
    v = await objektVersion();
    const konflikt = await uebernahme('objekte', objektId, { version: v, feld: 'angaben.18', ziel: 'details.instandhaltungsruecklage' });
    expect(konflikt.status).toBe(409);
    expect((await lies(konflikt)).details).toEqual({ aktuell: 5000 });
    expect((await uebernahme('objekte', objektId, { version: v, feld: 'angaben.18', ziel: 'details.instandhaltungsruecklage', ersetzen: true })).status).toBe(200);

    // Liste: anhängen statt ersetzen, kein 409
    v = await objektVersion();
    expect((await uebernahme('objekte', objektId, { version: v, feld: 'angaben.19', ziel: 'details.sanierungen' })).status).toBe(200);
    o = await lies(app.request(`/api/objekte/${objektId}`));
    expect(o.details.sanierungen).toEqual(['Dach: 2015 neu eingedeckt', 'Besichtigung: nach Vereinbarung']);
    expect(o.details.instandhaltungsruecklage).toBe(12_000);

    expect((await uebernahme('objekte', objektId, { version: o.version, feld: 'angaben.19', ziel: 'notizen' })).status).toBe(200);
    o = await lies(app.request(`/api/objekte/${objektId}`));
    expect(o.notizen).toBe('Alte Notiz\nBesichtigung: nach Vereinbarung (Exposé S. 3)');
    expect(await korrekturen('angaben.19')).toEqual(expect.arrayContaining([
      expect.objectContaining({ ziel: 'details.sanierungen', aktion: 'uebernommen' }), expect.objectContaining({ ziel: 'notizen', aktion: 'uebernommen' }),
    ]));
  });

  it('unlesbarer Wert oder fremdes Ziel → 422; unbekannte Angabe oder fremder Import → 404', async () => {
    const v = await objektVersion();
    const r = await uebernahme('objekte', objektId, { version: v, feld: 'angaben.19', ziel: 'objekt.grundstueck' }); // „nach Vereinbarung“ als Zahl
    expect(r.status).toBe(422);
    expect((await lies(r)).fehler).toBe('Wert passt nicht zu diesem Feld');
    expect((await uebernahme('objekte', objektId, { version: v, feld: 'angaben.2', ziel: 'makler.firma' })).status).toBe(422);
    expect((await uebernahme('objekte', objektId, { version: v, feld: 'angaben.2', ziel: 'gibt.es.nicht' })).status).toBe(422);
    expect((await uebernahme('objekte', objektId, { version: v, feld: 'angaben.999', ziel: 'objekt.angebotspreis' })).status).toBe(404);
    expect((await post(`/api/objekte/${objektId}/expose-uebernahme`, { version: v, importId: altImportId, feld: 'angaben.2', ziel: 'objekt.angebotspreis' })).status).toBe(404);
    expect((await post(`/api/objekte/${objektId}/expose-uebernahme`, { version: v, importId: 'fremd', feld: 'angaben.2', ziel: 'objekt.angebotspreis' })).status).toBe(404);
    expect(await objektVersion()).toBe(v);
  });

  it('Makler: weiterer Kontakt wird mit dem Bestand zusammengeführt; Telefon mit 409/ersetzen; Notizen gibt es am Makler nicht', async () => {
    const r = await lies(app.request(`/api/makler/${maklerId}/expose-angaben`));
    expect(r.angaben.every((a: any) => Number(a.feld.split('.')[1]) >= 21)).toBe(true);
    expect(r.ziele.every((z: any) => z.schluessel.startsWith('makler.'))).toBe(true);

    await db.update(schema.makler).set({ weitereKontakte: { namen: ['Alt Kontakt'], telefonnummern: ['0711 999999'], emails: [] }, festnetz: '0711 111111' }).where(eq(schema.makler.id, maklerId));
    expect(await angabe('makler', maklerId, 'angaben.28')).toMatchObject({ wert: 'Max Zweit', ziel: { feld: 'makler.weitereKontakte', status: 'leer' } });
    let v = await maklerVersion();
    const k = await uebernahme('makler', maklerId, { version: v, feld: 'angaben.28', ziel: 'makler.weitereKontakte' });
    expect(k.status).toBe(200);
    expect(await k.json()).toEqual({ id: maklerId, version: v + 1 });
    let m = await lies(app.request(`/api/makler/${maklerId}`));
    expect(m.weitereKontakte).toEqual({ namen: ['Alt Kontakt', 'Max Zweit'], telefonnummern: ['0711 999999'], emails: [] });
    expect((await angabe('makler', maklerId, 'angaben.28')).ziel.status).toBe('gleich');
    expect(await korrekturen('angaben.28')).toEqual([expect.objectContaining({ art: 'makler', bezugId: maklerId, ziel: 'makler.weitereKontakte', kiWert: 'Max Zweit', aktion: 'uebernommen' })]);

    v = m.version;
    const ohne = await uebernahme('makler', maklerId, { version: v, feld: 'angaben.25', ziel: 'makler.festnetztel' });
    expect(ohne.status).toBe(409);
    expect((await lies(ohne)).details).toEqual({ aktuell: '0711 111111' });
    expect((await uebernahme('makler', maklerId, { version: v, feld: 'angaben.25', ziel: 'makler.festnetztel', ersetzen: true })).status).toBe(200);
    m = await lies(app.request(`/api/makler/${maklerId}`));
    expect(m.festnetz).toBe('0731 98765-0');

    expect((await uebernahme('makler', maklerId, { version: m.version, feld: 'angaben.24', ziel: 'notizen' })).status).toBe(422);
    expect((await uebernahme('makler', maklerId, { version: m.version, feld: 'angaben.24', ziel: 'objekt.stadt' })).status).toBe(422);
    expect((await app.request('/api/makler/gibt-es-nicht/expose-angaben')).status).toBe(404);
  });

  it('verwerfen ändert einen übernommenen Import nicht', async () => {
    expect((await post(`/api/expose/importe/${importId}/verwerfen`, {})).status).toBe(200);
    const [imp] = await db.select({ status: schema.exposeImporte.status }).from(schema.exposeImporte).where(eq(schema.exposeImporte.id, importId));
    expect(imp!.status).toBe('uebernommen');
  });
});
