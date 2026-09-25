import { describe, expect, it } from 'vitest';
import { umformen } from '../src/umformen.ts';
import { ALTBESTAND } from './altbestand.ts';

const STICHTAG = '2026-09-17T12:00:00.000Z';
const u = umformen(ALTBESTAND, STICHTAG);
const arten = (art: string) => u.befunde.filter((b) => b.art === art);

describe('Einstellungen ohne eigenes Gegenstück in der Oberfläche', () => {
  it('übernimmt die DD-Dokumentenliste in Listenreihenfolge, nicht nach alter Laufnummer', () => {
    expect(u.zeilen.ddChecklisteVorlage).toEqual([
      { dokument: 'Grundbuchauszug', quelle: 'Notariat', sort: 0 },
      { dokument: 'Fotos (professionell)', quelle: '—', sort: 1 },
      { dokument: 'Mieterliste', quelle: null, sort: 2 },
    ]);
  });

  it('behält die Kennungen bereits übernommener Angebots-Mails', () => {
    expect(u.zeilen.einstellungen.find((e) => e.schluessel === 'angebote-importierte-uids')?.wert).toEqual(['AAMkAD-uid-1', '<msg-1@example.test>']);
  });
});

describe('Makler', () => {
  it('übernimmt Stammdaten, Frequenz und Erstellungsdatum', () => {
    expect(u.zeilen.makler.find((m) => m.id === 'mk-1')).toMatchObject({
      name: 'Anna Alt', prio: 'A', kontaktFrequenz: 'Monatlich', nextContact: '2026-09-01',
      createdAt: '2026-01-10T00:00:00.000Z', persoenlich: { geburtsdatum: '1970-05-01' },
    });
  });

  it('übernimmt Mobil, Festnetz und Anschrift; weitere Kontakte nur, soweit sie nicht schon am Makler stehen', () => {
    expect(u.zeilen.makler.find((m) => m.id === 'mk-1')).toMatchObject({
      tel: '+49 30 111', mobil: '+49 30 111', festnetz: '030 222', strasse: 'Maklerweg 3', plz: '10115', ort: 'Berlin',
      weitereKontakte: { namen: ['Bodo Büro'], telefonnummern: ['030 333'], emails: ['buero@example.test'] },
    });
    expect(u.zeilen.makler.find((m) => m.id === 'mk-3')).toMatchObject({ mobil: null, festnetz: null, ort: null, weitereKontakte: null });
  });

  it('macht aus komm[] Zeilen und behält eine abweichende Notiz', () => {
    const k = u.zeilen.maklerKommunikation.filter((x) => x.maklerId === 'mk-1');
    expect(k.map((x) => [x.id, x.zeitpunkt, x.kanal])).toEqual([
      ['k-neu', '2026-09-16T08:15:00.000Z', 'tel'],
      ['k-alt', null, 'notiz'],
      ['mk-1:notiz', null, 'notiz'],
    ]);
  });

  it('normalisiert Frequenzen und meldet unbekannte', () => {
    expect(u.zeilen.makler.find((m) => m.id === 'mk-2')?.kontaktFrequenz).toBe('Nie');
    expect(u.zeilen.makler.find((m) => m.id === 'mk-3')?.kontaktFrequenz).toBe('Wöchentlich');
    expect(arten('frequenz-unbekannt').map((b) => b.id)).toEqual(['mk-3']);
  });

  it('übernimmt Papierkorb-Marke und verwirft ungültige Prio mit Befund', () => {
    const m = u.zeilen.makler.find((x) => x.id === 'mk-2');
    expect(m).toMatchObject({ deletedAt: '2025-09-17T12:05:00.000Z', prio: null });
    expect(arten('wert-unlesbar').some((b) => b.id === 'mk-2' && b.feld === 'prio')).toBe(true);
  });

  it('meldet unbekannte Felder, nicht aber bewusst ausgelassene', () => {
    expect(u.unbekannteFelder.makler).toEqual({ lieblingsfarbe: 1 });
  });
});

describe('Objekte', () => {
  it('liest Text-Zahlen wie die alte App und legt Unbekanntes in details', () => {
    expect(u.zeilen.objekte.find((o) => o.id === 'obj-1')).toMatchObject({
      baujahr: 1978, einheitenAnzahl: 6, wohnflaeche: 480, angebotspreis: 1200000, istMiete: 5400,
      energieklasse: 'D', erfasstAm: '2026-03-23', details: { besonderheit: 'Denkmal' },
    });
  });

  it('meldet unlesbaren Preis statt 0 zu speichern', () => {
    expect(u.zeilen.objekte.find((o) => o.id === 'obj-2')?.angebotspreis).toBeNull();
    expect(arten('wert-unlesbar').some((b) => b.id === 'obj-2' && b.feld === 'angebotspreis')).toBe(true);
  });

  it('macht Einheiten-IDs global eindeutig', () => {
    expect(u.zeilen.objektEinheiten.map((e) => e.id)).toEqual(['obj-1:e1', 'obj-1:e2', 'obj-2:e1']);
  });
});

describe('Deals', () => {
  it('übernimmt Kern, Kalkulation und verknüpft Einheiten über Lage + Typ', () => {
    expect(u.zeilen.deals.find((d) => d.id === 'deal-1')).toMatchObject({
      objektId: 'obj-1', maklerId: 'mk-1', status: 'Angekauft', kalkulation: { kaufpreis: 1200000, notar: 2 },
      notizen: 'steht zusätzlich im Feld',
    });
    expect(u.zeilen.dealEinheiten[0]).toMatchObject({
      id: 'deal-1:de1', objektEinheitId: 'obj-1:e1', flaecheIst: 78, bewertung: { _psUnitId: 4711 },
    });
  });

  it('übernimmt Sanierungsbeträge so, wie die alte Kalkulation rechnete, und meldet Mehrdeutiges', () => {
    expect(u.zeilen.dealSanierungen.map((s) => [s.betrag, s.bereich])).toEqual([[45000, 'auf'], [38, null], [9000, 'glo']]);
    expect(u.befunde.some((b) => b.feld === 'sanierung.amt' && b.hinweis.startsWith('mehrdeutig'))).toBe(true);
  });

  it('übernimmt die Einheitenfelder der heutigen Kalkulation und merkt Altformat an', () => {
    expect(u.zeilen.dealEinheiten.map((e) => [e.id, e.flaeche, e.mieteIst, e.mieteNeu, e.mieteNeuManuell, e.renditeK, e.verkaufspreis, e.stueck, e.flaecheIst])).toEqual([
      ['deal-1:de1', null, 780, null, false, null, null, null, 78],
      ['deal-1:de2', 82.5, 820, 950, true, 4.5, null, null, null],
      ['deal-1:de3', null, 120, null, false, 5, 36000, 2, null],
    ]);
    expect(arten('einheit-altformat').map((b) => b.id)).toEqual(['deal-1']);
  });

  it('nummeriert Kommentare vom ältesten her (stabile IDs)', () => {
    expect(u.zeilen.dealKommentare.filter((k) => k.dealId === 'deal-1').map((k) => [k.id, k.zeitpunkt])).toEqual([
      ['deal-1:k1', '2026-09-17T07:00:00.000Z'],
      ['deal-1:k0', null],
    ]);
  });

  it('macht Notizen ohne Kommentare zum ersten Kommentar', () => {
    expect(u.zeilen.dealKommentare.find((k) => k.dealId === 'deal-2')).toMatchObject({ id: 'deal-2:notiz', text: 'nur Notiz' });
    expect(u.zeilen.deals.find((d) => d.id === 'deal-2')?.notizen).toBeNull();
  });

  it('legt fehlendes Objekt und fehlenden Makler aus den Kopien an', () => {
    expect(u.waisen).toEqual({ objekte: 1, makler: 1 });
    expect(u.zeilen.objekte.find((o) => o.id === 'obj-weg')).toMatchObject({ strasse: 'Verwaistgasse', stadt: 'Ulm' });
    expect(u.zeilen.makler.find((m) => m.id === 'mk-weg')).toMatchObject({ name: 'Max Waise', tel: '+49 1' });
  });

  it('setzt unbekannten Status auf „In Prüfung“ mit Befund und übernimmt altes Löschformat', () => {
    expect(u.zeilen.deals.find((d) => d.id === 'deal-2')).toMatchObject({ status: 'In Prüfung', deletedAt: '2025-09-17T12:05:00.000Z' });
    expect(arten('wert-unlesbar').some((b) => b.id === 'deal-2' && b.feld === 'status')).toBe(true);
  });

  it('erlaubt Deal ohne Makler und meldet reine Namens-Kopie', () => {
    expect(u.zeilen.deals.find((d) => d.id === 'deal-3')?.maklerId).toBeNull();
    expect(arten('makler-nur-kopie').map((b) => b.id)).toEqual(['deal-3']);
  });

  it('meldet abweichende Kopien und ignoriert berechnete Felder', () => {
    expect(arten('kopie-abweichend').some((b) => b.id === 'deal-1' && b.feld === 'maklerTel')).toBe(true);
    expect(u.unbekannteFelder.deals).toBeUndefined();
  });

  it('akzeptiert die Adress-Kopie als „Straße Hausnr.“', () => {
    const v = umformen({ ...ALTBESTAND, 'immo-deals': [{ id: 'd', objId: 'obj-1', adresse: 'Musterstraße 12' }] }, STICHTAG);
    expect(v.befunde.filter((b) => b.art === 'kopie-abweichend')).toEqual([]);
  });

  it('schreibt je Deal einen Status-Verlauf-Eintrag „umzug“', () => {
    expect(u.zeilen.dealStatusHistorie.map((h) => [h.id, h.nachStatus, h.am])).toEqual([
      ['umzug:deal-1', 'Angekauft', '2026-03-23T00:00:00.000Z'],
      ['umzug:deal-2', 'In Prüfung', STICHTAG],
      ['umzug:deal-3', 'Closing Path', STICHTAG],
    ]);
  });

  it('übernimmt Kundenkalkulationen mit neuen Einheiten-IDs und lässt Waisen weg', () => {
    expect(u.zeilen.kundenkalkulationen).toHaveLength(1);
    expect(u.zeilen.kundenkalkulationen[0]).toMatchObject({
      id: 'kk-1', dealId: 'deal-1', dealEinheitId: 'deal-1:de2', scope: 'aufteiler', kaufpreisWohnung: 400000, kaufpreisStellplatz: 0,
      stellplatzEinhIds: ['deal-1:de3'], wertsteigBullets: ['KfW'], createdAt: '2026-05-01T10:00:00.000Z',
    });
    expect(arten('waise-kundenkalkulation').map((b) => b.id)).toEqual(['kk-2']);
    expect(arten('kundenkalkulation-bild-eingebettet')).toHaveLength(1);
    expect(u.zeilen.einstellungen.filter((e) => !['finanzpraes-standard', 'vertriebslisten-spalten', 'textvorlagen-gespeichert', 'angebote-importierte-uids'].includes(e.schluessel))).toEqual([
      { schluessel: 'kalk-standard', wert: { rp: 10 } },
      { schluessel: 'kundenkalk-hinweise', wert: ['Mietsteigerung bei Neuvermietung'] },
    ]);
  });

  it('ist wiederholbar: gleicher Bestand → gleiche Zeilen', () => {
    expect(umformen(ALTBESTAND, STICHTAG).zeilen).toEqual(u.zeilen);
  });
});

describe('Objektfotos', () => {
  it('übernimmt Metadaten mit dem Speicherschlüssel der alten App und meldet Fotos ohne Objekt', () => {
    expect(u.zeilen.objektFotos).toEqual([
      { id: 'f-1', objektId: 'obj-1', storageKey: 'obj-1/f-1.jpg', dateiname: 'Fassade.jpg', mimeType: 'image/jpeg', groesseBytes: 123456, sort: 0, hochgeladenAm: '2025-09-17T12:05:00.000Z' },
      { id: 'f-2', objektId: 'obj-1', storageKey: 'obj-1/f-2.jpg', dateiname: 'Plan.png', mimeType: 'image/png', groesseBytes: 2048, sort: 1, hochgeladenAm: '2025-09-17T12:06:40.000Z' },
    ]);
    expect(arten('waise-foto').map((b) => b.id)).toEqual(['f-waise']);
  });
});

describe('Bank-Präsentationen', () => {
  it('übernimmt Präsentationen mit Folien in Reihenfolge, macht doppelte Folien-IDs eindeutig und meldet Waisen', () => {
    expect(u.zeilen.finanzpraesentationen.map((p) => [p.id, p.dealId, p.bankName, p.deletedAt ?? null])).toEqual([
      ['fp-1', 'deal-1', 'Kreissparkasse', null],
      ['fp-3', 'deal-1', 'Alt', '2025-09-17T12:05:00.000Z'],
    ]);
    expect(u.zeilen.praesentationFolien.map((f) => [f.id, f.praesentationId, f.typ, f.sichtbar, f.sort])).toEqual([
      ['sl-1', 'fp-1', 'deckblatt', true, 0],
      ['sl-1~2', 'fp-1', 'projektkalkulation', false, 1],
      ['sl-3', 'fp-1', 'altertyp', true, 2],
      ['sl-9', 'fp-3', 'abschluss', true, 0],
    ]);
    expect(u.zeilen.praesentationFolien[1]!.daten).toEqual({ tableRows: [['Kaufpreis', '1.200.000 €']], _scope: 'aufteiler', _snapshot: { gik: 1 } });
    expect(arten('waise-praesentation').map((b) => b.id)).toEqual(['fp-2']);
    expect(arten('folie-typ-unbekannt').map((b) => b.wert)).toEqual(['altertyp']);
  });

  it('ersetzt nur das mitgelieferte Standardbild durch den Platzhalter', () => {
    const e = u.zeilen.einstellungen.find((x) => x.schluessel === 'finanzpraes-standard')!;
    expect(e.wert).toEqual({
      geschaeftsmodell: { zielgruppe: 'Private Banking Kunden' },
      organigramm: { bild: 'standardbild:organigramm', beschreibung: '' },
      abschluss: { untertitel: 'Gerry & Sven', bild: 'data:image/jpeg;base64,EIGENES' },
    });
  });
});

describe('Begleitscheine', () => {
  it('übernimmt Begleitscheine mit Zeilen und Archivdatum, meldet Waisen und entfernt tote Deal-Verknüpfungen', () => {
    expect(u.zeilen.begleitscheine.map((b) => [b.id, b.vorlageTyp, b.objektId, b.dealId, b.archiviertAm, b.deletedAt ?? null])).toEqual([
      ['bs-1', 'ankauf', 'obj-1', 'deal-1', '2026-05-03T00:00:00.000Z', null],
      ['bs-3', 'verkauf', 'obj-2', null, null, '2025-09-17T12:05:00.000Z'],
    ]);
    expect((u.zeilen.begleitscheine[0]!.zeilen as { sub: unknown[] }[])[0]!.sub).toEqual([{ id: 'r12s1', text: 'Termin', status: 'In Progress' }]);
    expect(arten('waise-begleitschein').map((b) => b.id)).toEqual(['bs-2']);
    expect(arten('begleitschein-deal-fehlt').map((b) => b.id)).toEqual(['bs-3']);
  });

  it('nimmt gespeicherte Vorlagen und Aktionen, sonst den Auslieferungszustand wie beim ersten Öffnen', () => {
    const ankauf = u.zeilen.begleitscheinVorlagen.find((v) => v.typ === 'ankauf')!;
    expect(ankauf.kopf).toBe('Eigener Kopf');
    expect(u.zeilen.begleitscheinVorlagen.find((v) => v.typ === 'verkauf')!.zeilen).toEqual([{ id: 'bs-final', lvl: 1, text: 'vollständig abgearbeitet', verantwortung: '', status: 'offen', sub: [], fix: true }]);
    const aktionen = u.zeilen.begleitscheinAktionen;
    expect(aktionen.filter((a) => a.vorlageTyp === 'ankauf')).toHaveLength(38); // Auslieferung
    expect(aktionen.filter((a) => a.vorlageTyp === 'verkauf').map((a) => [a.id, a.vordruckId, a.sort, a.aktiv])).toEqual([['va1', 'vd-1', 0, true], ['va2', null, 1, false]]);
    expect(arten('bs-aktion-vordruck-fehlt').map((b) => b.wert)).toEqual(['vd-geloescht']);
    expect(u.zeilen.vordrucke).toEqual([{ id: 'vd-1', nummer: 'F065', titel: 'Anschreiben', art: 'brief', inhalt: 'Sehr geehrte … {adresse}', betreff: null, dateiName: null, aktiv: true, sort: 0 }]);
  });
});

describe('Vertriebslisten', () => {
  it('übernimmt Listen mit Spalten und Zeilen, verknüpft Einheiten und merkt fehlende Einheiten an', () => {
    expect(u.zeilen.vertriebslisten.map((v) => [v.id, v.dealId, v.versteckteSpalten])).toEqual([['vl-1', 'deal-1', ['garten']]]);
    expect(u.zeilen.vertriebslisteZeilen.map((r) => [r.id, r.dealEinheitId, r.istStellplatz, r.sort, r.daten])).toEqual([
      ['z1', 'deal-1:de1', false, 0, { lage: 'EG links', wohnflaeche: 78, kaltmiete_ist: 780, ampel: 'gruen' }],
      ['z2', null, true, 1, { te_nr_garage: 'Hof', _einheitIdAlt: 'weg' }],
    ]);
    expect(arten('waise-vertriebsliste').map((b) => b.id)).toEqual(['vl-2']);
    expect(u.zeilen.einstellungen.find((e) => e.schluessel === 'vertriebslisten-spalten')?.wert).toEqual([{ id: 'lage', label: 'Lage', type: 'text' }]);
  });
});

describe('Projektmanagement', () => {
  it('übernimmt Projekt, Globalverkauf und Papierkorb; ein fehlender Deal löst nur die Verknüpfung', () => {
    expect(u.zeilen.projekte.map((p) => [p.id, p.sort, p.dealId, p.adresse, p.datum, p.zielVkp, p.globalVstatus, p.globalIstKp, p.globalNotarDatum, p.globalReservDatum, p.deletedAt !== null])).toEqual([
      ['pj-1', 0, 'deal-1', 'Musterstraße 12', '2026-05-10', 1_507_778, 'notar', 1_400_000, '2026-10-01', null, false],
      ['pj-2', 1, null, 'Ohne Deal 1', null, 0, null, null, null, null, true],
    ]);
    expect(arten('projekt-deal-fehlt').map((b) => b.id)).toEqual(['pj-2']);
  });

  it('Einheiten mit Kaufpreisfeldern, Deal-Verknüpfung und Mietergesprächen in alter Reihenfolge', () => {
    expect(u.zeilen.projektEinheiten.map((e) => [e.id, e.dealEinheitId, e.typ, e.stueck, e.istKp, e.grundpreis, e.notarDatum, e.reservDatum, e.vstatus, e.pipTodos, e.mieterTodos, e.vermietet, e.sort])).toEqual([
      ['pj-1:de1', 'deal-1:de1', 'Wohnung', null, 250_000, 200_000, '2026-08-15', '2026-07-01', 'sold', 'Angebot Bad', 'Kaution klären', 'leer', 0],
      ['pj-1:de-weg', null, 'Stellplatz', 2, 0, null, null, null, 'none', null, null, null, 1],
    ]);
    expect(u.zeilen.projektMieterhistorie.map((h) => [h.id, h.projektEinheitId, h.sort, h.datum, h.inhalt])).toEqual([
      ['h2', 'pj-1:de1', 0, '2026-06-02', 'Mieterhöhung'],
      ['pj-1:de1:gespraech-1', 'pj-1:de1', 1, '2026-05-20', 'Erstkontakt'],
    ]);
    expect(arten('projekt-piptodos-liste').map((b) => b.id)).toEqual(['pj-1:de-weg']);
  });

  it('Checkliste wörtlich; done ohne Status wird erledigt, ohne beides offen', () => {
    expect(u.zeilen.projektAufgaben.map((t) => [t.id, t.kategorie, t.text, t.status, t.faellig, t.sort])).toEqual([
      ['t1', '📋 Kaufmännisch / Projekt', 'Kosten einholen:\n-\n-', 'in progress', '2026-09-17', 0],
      ['t2', '📋 Kaufmännisch / Projekt', 'Altpunkt', 'erledigt', null, 1],
      ['t3', '🧪 Eigene', 'Offen ohne Status', 'offen', null, 2],
    ]);
    expect(arten('projekt-aufgabe-done').map((b) => b.id)).toEqual(['t2']);
    expect(u.zeilen.projektGebaeudeMassnahmen).toEqual([{ id: 'pj-1:massnahme-0', projektId: 'pj-1', sort: 0, text: 'Dach', status: 'in Arbeit', verantwortlich: '' }]);
  });
});

describe('Gespeicherte Filter und Listenreihenfolge', () => {
  it('übernimmt Filter mit Kriterien und Zeitstempeln, exakte Doppel einmal, unbekannte Module nicht', () => {
    expect(u.zeilen.gespeicherteFilter.map((f) => [f.id, f.modul, f.name, f.kriterien, f.createdAt])).toEqual([
      ['sf-1', 'deals', '🔥 Heiße Pipeline', [{ field: 'status', op: 'in', value: ['Closing Path', 'Angebot abgegeben'] }], new Date(1_789_630_611_000).toISOString()],
      ['sf-3', 'makler', 'Eigene A', [{ field: 'prio', op: 'equals', value: 'A' }, { field: 'name', op: 'contains', value: 'an' }], new Date(1_789_630_611_000).toISOString()],
    ]);
    expect(arten('filter-doppelt').map((b) => b.id)).toEqual(['sf-2']);
    expect(arten('filter-modul-unbekannt').map((b) => b.id)).toEqual(['sf-4']);
  });

  it('Reihenfolge der alten Sammlung bleibt erhalten', () => {
    expect(u.zeilen.makler.map((m) => m.reihenfolge)).toEqual(u.zeilen.makler.map((_, i) => i));
    expect(u.zeilen.objekte.map((o) => o.reihenfolge)).toEqual(u.zeilen.objekte.map((_, i) => i));
    expect(u.zeilen.deals.map((d) => d.reihenfolge)).toEqual(u.zeilen.deals.map((_, i) => i));
  });
});

describe('Deal-Dokumente', () => {
  it('übernimmt Metadaten mit dem Speicherschlüssel der alten App, erkennt Exposés, meldet Dokumente ohne Deal', () => {
    expect(u.zeilen.dokumente.map((d) => [d.id, d.dealId, d.storageKey, d.label, d.istExpose, d.groesseBytes, d.hochgeladenAm])).toEqual([
      ['doc-1', 'deal-1', 'deal-1/doc-1_Expos_ Musterstra_e.pdf', '', true, 512000, new Date(1_758_110_700_000).toISOString()],
      ['doc-2', 'deal-1', 'deal-1/doc-2_Teilungserkl_rung _neu_.pdf', 'TE', false, 1024, new Date(1_758_110_800_000).toISOString()],
    ]);
    expect(arten('waise-dokument').map((b) => b.id)).toEqual(['doc-waise']);
    // Bezug zum Objekt aus dem Deal — so erscheinen Deal-Dokumente auch am Objekt (Protokoll 19)
    expect(u.zeilen.dokumente.map((d) => d.objektId)).toEqual(['obj-1', 'obj-1']);
  });
});

describe('Textvorlagen', () => {
  it('übernimmt Vorlagen in Reihenfolge und merkt, dass gespeichert wurde', () => {
    expect(u.zeilen.textvorlagen.map((v) => [v.id, v.sort, v.name, v.kanal, v.betreff, v.text])).toEqual([
      ['vl-a', 0, 'Erstanfrage', 'email', 'Anfrage: {adresse}', 'Guten Tag {maklerName},\n\n…'],
      ['vl-b', 1, 'WA kurz', 'whatsapp', null, 'Hallo {maklerName} 👋'],
    ]);
    expect(u.zeilen.einstellungen.find((e) => e.schluessel === 'textvorlagen-gespeichert')?.wert).toBe(true);
  });
});
