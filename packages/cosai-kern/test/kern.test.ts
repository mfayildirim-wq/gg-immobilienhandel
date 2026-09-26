import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentKern, type Nutzer } from '../src/kern.ts';
import { drehbuchModell, ki } from '../src/modell.ts';
import type { OpenapiDokument } from '../src/katalog.ts';
import { testDb, url } from './db.ts';

const openapi: OpenapiDokument = {
  paths: {
    '/api/ankauf': { get: { responses: { 200: { description: 'Cockpit: fällige Deals und Makler' } } } },
    '/api/deals/{id}': { get: { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Deal' } } } },
    '/api/deals/{id}/kommentare': { post: { responses: { 201: { description: 'angelegt' } } } },
  },
};
const ziele = [
  { ziel: 'nav.ankauf', beschreibung: 'Seite Ankauf (Cockpit)' },
  { ziel: 'ankauf.deals.erster', beschreibung: 'Erster Deal in der Liste' },
  { ziel: 'deal.reiter.kommunikation', beschreibung: 'Reiter Kommunikation im Deal' },
  { ziel: 'deal.kommentar.text', beschreibung: 'Feld: neue Gesprächsnotiz' },
  { ziel: 'deal.kommentar.senden', beschreibung: 'Knopf: Notiz abschicken' },
];

describe.skipIf(!url)('Kern', () => {
  const { db, client } = url ? testDb() : ({} as ReturnType<typeof testDb>);
  const nutzer: Nutzer = { id: 'test-kern@example', kopf: { authorization: 'Bearer t' } };
  const aufrufe: string[] = [];
  const aufruf = async (n: Nutzer, methode: string, pfad: string) => {
    aufrufe.push(`${n.kopf?.authorization} ${methode} ${pfad}`);
    return { status: 200, text: JSON.stringify({ deals: [{ id: 'd1', objekt: 'Weraststraße 12', makler: 'Huber' }] }) };
  };
  beforeAll(async () => { if (url) await agentKern({ db, modell: drehbuchModell([]), openapi, ziele, aufruf }).gedaechtnis(nutzer).leeren(); });
  afterAll(async () => { await client?.end(); });

  it('liest über ein Host-Werkzeug im Namen des Nutzers und antwortet mit Chips', async () => {
    const modell = drehbuchModell([
      ki('', [['get_api_ankauf', {}]]),
      ki('Heute ist ein Deal fällig: Weraststraße 12, Makler Huber.', [['chips', { liste: [{ label: 'Anrufen', wert: 'Ruf den Makler an' }, { label: 'Nächster', wert: 'nächster' }] }]]),
      ki('Was möchtest du tun?'),
    ]);
    const kern = agentKern({ db, modell, openapi, ziele, aufruf });
    const a = await kern.nachricht(nutzer, { text: 'Was ist heute fällig?', ort: '/', kontext: {} });
    expect(aufrufe).toEqual(['Bearer t GET /api/ankauf']);
    // Die Antwort neben dem Chips-Aufruf gehört dazu — das echte Modell legt die Auskunft oft dorthin
    expect(a.text).toBe('Heute ist ein Deal fällig: Weraststraße 12, Makler Huber.\n\nWas möchtest du tun?');
    expect(a.chips.map((c) => c.label)).toEqual(['Anrufen', 'Nächster']);
    expect(a.steuerung).toEqual([]);
    expect(a.wartetAuf).toBeUndefined();
    expect(kern.werkzeuge.map((w) => w.name)).toEqual(['get_api_ankauf', 'get_api_deals_id']);
  });

  it('bedient die Oberfläche sichtbar und wartet vor dem Senden auf die Bestätigung — auch über einen neuen Kern', async () => {
    const aktionen = [
      { art: 'navigiere', ziel: 'nav.ankauf', text: 'öffnet Ankauf' },
      { art: 'oeffne', ziel: 'ankauf.deals.erster', text: 'öffnet den ersten Deal' },
      { art: 'oeffne', ziel: 'deal.reiter.kommunikation', text: 'öffnet Reiter Kommunikation' },
      { art: 'fuelle', ziel: 'deal.kommentar.text', wert: 'Mailbox besprochen, Rückruf Montag', text: 'schreibt die Notiz' },
      { art: 'sende', ziel: 'deal.kommentar.senden', text: 'Notiz abschicken?' },
    ];
    const drehbuch = [ki('Ich erfasse die Notiz.', [['steuere', { aktionen }]]), ki('Erledigt — die Notiz ist drin.')];
    const erster = agentKern({ db, modell: drehbuchModell(drehbuch), openapi, ziele, aufruf });
    const a = await erster.nachricht(nutzer, { text: 'Ankauf, erster Deal, Kommentar: Mailbox besprochen, Rückruf Montag. Abschicken.', ort: '/', kontext: {} });
    expect(a.wartetAuf?.aktion.ziel).toBe('deal.kommentar.senden');
    expect(a.wartetAuf?.frage).toBe('Notiz abschicken?');
    expect(a.steuerung.map((s) => s.art)).toEqual(['navigiere', 'oeffne', 'oeffne', 'fuelle']);
    expect(a.chips.map((c) => c.wert)).toEqual(['ja', 'nein']);
    expect(a.text).toBe('Ich erfasse die Notiz.');

    // Ein neuer Function-Aufruf: eigener Kern, eigenes Drehbuch — der Zustand kommt aus der Datenbank
    const zweiter = agentKern({ db, modell: drehbuchModell(drehbuch.slice(1)), openapi, ziele, aufruf });
    const b = await zweiter.entscheidung(nutzer, { sitzungId: a.sitzungId, wert: 'ja' });
    expect(b.steuerung).toEqual([{ art: 'sende', ziel: 'deal.kommentar.senden', text: 'Notiz abschicken?' }]);
    expect(b.wartetAuf).toBeUndefined();
    expect(b.text).toBe('Erledigt — die Notiz ist drin.');

    const verlauf = await zweiter.verlauf(nutzer, a.sitzungId);
    expect(verlauf.map((v) => v.rolle)).toEqual(['nutzer', 'agent', 'nutzer', 'agent']);
    expect(await zweiter.wartetAuf(nutzer, a.sitzungId)).toBeUndefined();
  });

  it('lehnt ab, wenn der Nutzer nicht „ja“ sagt, und merkt sich gespeicherte Formulierungen', async () => {
    const drehbuch = [ki('', [['steuere', { aktionen: [{ art: 'sende', ziel: 'deal.kommentar.senden' }] }]]), ki('Gut, nicht gesendet.')];
    const kern = agentKern({ db, modell: drehbuchModell(drehbuch), openapi, ziele, aufruf });
    const a = await kern.nachricht(nutzer, { text: 'schick ab', ort: '/deals', kontext: { dealId: 'd1' } });
    expect(a.wartetAuf).toBeTruthy();
    // Vor der Antwort weiß auch ein frischer Kern, dass diese Sitzung wartet (Neuladen der Seite)
    const frisch = agentKern({ db, modell: drehbuchModell([]), openapi, ziele, aufruf });
    expect((await frisch.wartetAuf(nutzer, a.sitzungId))?.aktion.ziel).toBe('deal.kommentar.senden');
    expect(await frisch.wartetAuf({ id: 'fremd@example' }, a.sitzungId)).toBeUndefined();
    const b = await kern.nachricht(nutzer, { sitzungId: a.sitzungId, text: 'lieber nicht', ort: '/deals', kontext: { dealId: 'd1' } });
    expect(b.steuerung).toEqual([]);
    expect(b.text).toBe('Gut, nicht gesendet.');

    await kern.ereignis(nutzer, { art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Mailbox besprochen, Rückruf Montag', kontext: { dealId: 'd1' } }, a.sitzungId);
    await kern.ereignis(nutzer, { art: 'gespeichert', ziel: 'deal.kommentar', wert: 'Mailbox besprochen, Rückruf Montag', kontext: { dealId: 'd2' } }, a.sitzungId);
    expect(await kern.vorschlaege(nutzer, 'deal.kommentar')).toEqual(['Mailbox besprochen, Rückruf Montag']);
    expect((await kern.gedaechtnis(nutzer).verlauf(10, a.sitzungId)).length).toBe(2);
  });

  it('weist unbekannte Ziele zurück, ohne sie auszuführen', async () => {
    const drehbuch = [ki('', [['steuere', { aktionen: [{ art: 'oeffne', ziel: 'deal.reiter.geheim' }] }]]), ki('Das Ziel kenne ich nicht.')];
    const kern = agentKern({ db, modell: drehbuchModell(drehbuch), openapi, ziele, aufruf });
    const a = await kern.nachricht(nutzer, { text: 'öffne geheim', ort: '/', kontext: {} });
    expect(a.steuerung).toEqual([]);
    expect(a.text).toBe('Das Ziel kenne ich nicht.');
  });
});
