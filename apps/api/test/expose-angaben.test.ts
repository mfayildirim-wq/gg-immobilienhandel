import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { kiAttrappe, speicherImSpeicher, testExposeV1 } from '@gg/integrations';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { mitAusgeliefertenStandards } from './standardwerte.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

describe.skipIf(!url)('Reiter „Aus dem Exposé“: Angaben lesen und übernehmen', () => {
  const { db, client } = createDb(url!);
  const app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, expose: { speicher: speicherImSpeicher(), ki: kiAttrappe(), attrappe: true } });
  const kennung = `Ang${Date.now()}`;
  mitAusgeliefertenStandards(url!);
  let importId = '';
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

  beforeAll(async () => {
    const { key } = await lies(app.request('/api/expose/eingang', { method: 'POST', body: testExposeV1(kennung) }));
    const a = await lies(post('/api/expose/analyse', { key, dateiname: `${kennung}.pdf` }));
    importId = a.importId;
    // Grundstück auf der Prüfseite geleert → Spalte bleibt leer
    const r = await lies(post('/api/expose/uebernehmen', {
      key, dateiname: `${kennung}.pdf`, extrahiert: a.extrahiert, importId,
      objekt: { daten: { ...a.objekt, grundstueck: null } }, makler: { daten: a.makler }, deal: a.deal,
    }));
    ({ objektId, maklerId, dealId } = r);
  });

  afterAll(async () => {
    await db.delete(schema.importKorrekturen).where(eq(schema.importKorrekturen.importId, importId));
    await db.delete(schema.exposeImporte).where(eq(schema.exposeImporte.id, importId));
    if (dealId) await db.delete(schema.deals).where(eq(schema.deals.id, dealId));
    if (objektId) await db.delete(schema.objekte).where(eq(schema.objekte.id, objektId));
    if (maklerId) await db.delete(schema.makler).where(eq(schema.makler.id, maklerId));
    await db.delete(schema.auditLog).where(and(eq(schema.auditLog.type, 'expose-uebernahme'), inArray(schema.auditLog.entityId, [objektId, maklerId].filter(Boolean))));
    await db.delete(schema.auditLog).where(eq(schema.auditLog.source, `expose-analyse/${kennung}.pdf`));
    await client.end();
  });

  it('Angaben-Liste: Import neueste zuerst, Status gleich / leer / keinFeld, details-Ziele', async () => {
    const r = await lies(app.request(`/api/objekte/${objektId}/expose-angaben`));
    expect(r.importe).toEqual([expect.objectContaining({ id: importId, dateiname: `${kennung}.pdf`, dealId, schemaVersion: 'gg-expose-v1' })]);
    const nach = (feld: string) => r.angaben.find((a: any) => a.feld === feld);
    expect(nach('preise.kaufpreis')).toMatchObject({ importId, wert: 1_250_000, ziel: { feld: 'angebotspreis', status: 'gleich' }, belegt: true, seite: 1 });
    expect(nach('flaechen.grundstuecksflaeche')).toMatchObject({ wert: 480, ziel: { feld: 'grundstueck', status: 'leer' } });
    expect(nach('preise.hausgeld_monat')).toMatchObject({ wert: 350, ziel: { feld: 'details.hausgeld_monat', status: 'gleich' } });
    expect(nach('weitere_angaben.0')).toMatchObject({ bezeichnung: 'Dach', ziel: { feld: null, status: 'keinFeld' } });
    // über den Deal gefunden, auch ohne direkte Verknüpfung
    await db.update(schema.exposeImporte).set({ objektId: null }).where(eq(schema.exposeImporte.id, importId));
    expect((await lies(app.request(`/api/objekte/${objektId}/expose-angaben`))).importe).toHaveLength(1);
    await db.update(schema.exposeImporte).set({ objektId }).where(eq(schema.exposeImporte.id, importId));
    expect((await app.request('/api/objekte/gibt-es-nicht/expose-angaben')).status).toBe(404);
  });

  it('Übernahme in eine leere Spalte: Wert gesetzt, version + 1, Korrektur-Zeile und Audit', async () => {
    const v = await objektVersion();
    const r = await post(`/api/objekte/${objektId}/expose-uebernahme`, { version: v, importId, feld: 'flaechen.grundstuecksflaeche', ziel: 'spalte' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: objektId, version: v + 1 });
    const o = await lies(app.request(`/api/objekte/${objektId}`));
    expect(o.grundstueck).toBe(480);
    expect(await korrekturen('flaechen.grundstuecksflaeche')).toEqual([
      expect.objectContaining({ art: 'objekt', bezugId: objektId, ziel: 'grundstueck', kiWert: 480, handWert: null, aktion: 'uebernommen' }),
    ]);
    const [audit] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.type, 'expose-uebernahme'), eq(schema.auditLog.entityId, objektId)));
    expect(audit).toMatchObject({ entity: 'objekt', fieldName: 'grundstueck', action: 'uebernommen' });
    expect((await angabe('objekte', objektId, 'flaechen.grundstuecksflaeche')).ziel.status).toBe('gleich');
  });

  it('abweichender Wert: ohne ersetzen 409 mit aktuellem Wert, mit ersetzen überschrieben', async () => {
    await db.update(schema.objekte).set({ angebotspreis: 1_000_000 }).where(eq(schema.objekte.id, objektId));
    expect((await angabe('objekte', objektId, 'preise.kaufpreis')).ziel).toMatchObject({ status: 'abweichend', aktuell: 1_000_000 });
    const v = await objektVersion();
    const ohne = await post(`/api/objekte/${objektId}/expose-uebernahme`, { version: v, importId, feld: 'preise.kaufpreis', ziel: 'spalte' });
    expect(ohne.status).toBe(409);
    expect((await lies(ohne)).details).toEqual({ aktuell: 1_000_000 });
    expect(await objektVersion()).toBe(v); // nichts geschrieben

    const mit = await post(`/api/objekte/${objektId}/expose-uebernahme`, { version: v, importId, feld: 'preise.kaufpreis', ziel: 'spalte', ersetzen: true });
    expect(mit.status).toBe(200);
    expect((await lies(app.request(`/api/objekte/${objektId}`))).angebotspreis).toBe(1_250_000);
    expect(await korrekturen('preise.kaufpreis')).toEqual([expect.objectContaining({ aktion: 'ersetzt', kiWert: 1_250_000, handWert: 1_000_000 })]);
  });

  it('veraltete version → 409 mit aktuelleVersion', async () => {
    const v = await objektVersion();
    const r = await post(`/api/objekte/${objektId}/expose-uebernahme`, { version: v - 1, importId, feld: 'preise.kaufpreis', ziel: 'spalte' });
    expect(r.status).toBe(409);
    expect((await lies(r)).details).toEqual({ aktuelleVersion: v });
  });

  it('details: Schlüssel wird gemergt (Nachbarn bleiben); notizen: Zeile angehängt; kein Ziel → 422; unbekannte Angabe → 404', async () => {
    await db.update(schema.objekte).set({ details: { herkunft: 'Exposé-Import', importId, energieausweis: { klasse: 'C' } }, notizen: 'Alte Notiz' }).where(eq(schema.objekte.id, objektId));
    expect((await angabe('objekte', objektId, 'preise.hausgeld_monat')).ziel.status).toBe('leer');
    let v = await objektVersion();
    expect((await post(`/api/objekte/${objektId}/expose-uebernahme`, { version: v, importId, feld: 'preise.hausgeld_monat', ziel: 'details' })).status).toBe(200);
    let o = await lies(app.request(`/api/objekte/${objektId}`));
    expect(o.details).toEqual({ herkunft: 'Exposé-Import', importId, energieausweis: { klasse: 'C' }, hausgeld_monat: 350 });
    expect((await angabe('objekte', objektId, 'preise.hausgeld_monat')).ziel.status).toBe('gleich');

    v = o.version;
    expect((await post(`/api/objekte/${objektId}/expose-uebernahme`, { version: v, importId, feld: 'weitere_angaben.0', ziel: 'notizen' })).status).toBe(200);
    o = await lies(app.request(`/api/objekte/${objektId}`));
    expect(o.notizen).toBe('Alte Notiz\nDach: 2015 neu gedeckt (Exposé S. 2)');

    expect((await post(`/api/objekte/${objektId}/expose-uebernahme`, { version: o.version, importId, feld: 'weitere_angaben.0', ziel: 'spalte' })).status).toBe(422);
    expect((await post(`/api/objekte/${objektId}/expose-uebernahme`, { version: o.version, importId, feld: 'gibt.es.nicht', ziel: 'spalte' })).status).toBe(404);
    expect((await post(`/api/objekte/${objektId}/expose-uebernahme`, { version: o.version, importId: 'fremd', feld: 'preise.kaufpreis', ziel: 'spalte' })).status).toBe(404);
  });

  it('Makler: weiterer Kontakt wird mit dem Bestand zusammengeführt; notizen gibt es am Makler nicht', async () => {
    await db.update(schema.makler).set({ weitereKontakte: { namen: ['Alt Kontakt'], telefonnummern: ['0711 999999'], emails: [] } }).where(eq(schema.makler.id, maklerId));
    const zeile = await angabe('makler', maklerId, 'weitere_kontakte.0');
    expect(zeile).toMatchObject({ wert: expect.stringContaining('Max Zweit'), ziel: { feld: 'weitereKontakte', status: 'leer' } });
    const v = await maklerVersion();
    const r = await post(`/api/makler/${maklerId}/expose-uebernahme`, { version: v, importId, feld: 'weitere_kontakte.0', ziel: 'spalte' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: maklerId, version: v + 1 });
    const m = await lies(app.request(`/api/makler/${maklerId}`));
    expect(m.weitereKontakte).toEqual({ namen: ['Alt Kontakt', 'Max Zweit'], telefonnummern: ['0711 999999', '0711 123456'], emails: ['max@beispiel.test'] });
    expect((await angabe('makler', maklerId, 'weitere_kontakte.0')).ziel.status).toBe('gleich');
    expect(await korrekturen('weitere_kontakte.0')).toEqual([expect.objectContaining({ art: 'makler', bezugId: maklerId, ziel: 'weitereKontakte', aktion: 'uebernommen' })]);

    expect((await post(`/api/makler/${maklerId}/expose-uebernahme`, { version: v + 1, importId, feld: 'kontaktperson.firma', ziel: 'notizen' })).status).toBe(422);
    expect((await app.request('/api/makler/gibt-es-nicht/expose-angaben')).status).toBe(404);
  });

  it('verwerfen ändert einen übernommenen Import nicht', async () => {
    expect((await post(`/api/expose/importe/${importId}/verwerfen`, {})).status).toBe(200);
    const [imp] = await db.select({ status: schema.exposeImporte.status }).from(schema.exposeImporte).where(eq(schema.exposeImporte.id, importId));
    expect(imp!.status).toBe('uebernommen');
  });
});
