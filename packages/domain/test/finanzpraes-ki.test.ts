// Regeln der beiden KI-Texte der Bank-Präsentation (nach gg-immohandel src/modules/finanzpraes/finanzpraes-ki.ts)
import { describe, expect, it } from 'vitest';
import {
  kiFehlerHinweis, lageKiEingabe, lageKiHinweis, lageKiUebernehmen, objektKiEingabe, objektKiHinweis, objektKiUebernehmen,
  type Verortung, verortungMoeglich, verortungSchluessel, verortungWaehlen,
} from '../src/finanzpraesentation/ki.ts';

const objekt = { strasse: 'Aldinger Straße', hausnr: '86', plz: '70378', stadt: 'Stuttgart', baujahr: 1964, einheitenAnz: 6, wohnflaeche: 420, grundstueck: 610, energie: 'D', heizung: 'Gas-Etagenheizung' };

const ort = (stadtteil: string, plz: string, o = 'Stuttgart', viertel = ''): Verortung => ({ stadtteil, viertel, ort: o, plz });

describe('Verortung (Stadtteil aus dem Kartendienst, Fachentscheidung 13.10.2026)', () => {
  const anschrift = { strasse: 'Marktplatz', hausnr: '1', plz: '70173', stadt: 'Stuttgart' };

  it('nimmt nur einen Treffer mit derselben PLZ — der Marktplatz in Bad Cannstatt ist nicht der in Mitte', () => {
    expect(verortungWaehlen(anschrift, [ort('Bad Cannstatt', '70372'), ort('Mitte', '70173')])).toEqual(ort('Mitte', '70173'));
    expect(verortungWaehlen(anschrift, [ort('Bad Cannstatt', '70372')])).toBeNull();
  });

  it('ohne PLZ muss der Ort stimmen', () => {
    const ohnePlz = { ...anschrift, plz: '' };
    expect(verortungWaehlen(ohnePlz, [ort('Eltingen', '71229', 'Leonberg'), ort('Mitte', '70173')])).toEqual(ort('Mitte', '70173'));
    expect(verortungWaehlen(ohnePlz, [ort('Eltingen', '71229', 'Leonberg')])).toBeNull();
  });

  it('ein Treffer ohne Stadtteil zählt nicht', () => {
    expect(verortungWaehlen(anschrift, [ort('', '70173'), ort('Mitte', '70173', 'Stuttgart', 'Neue Vorstadt')])).toEqual(ort('Mitte', '70173', 'Stuttgart', 'Neue Vorstadt'));
    expect(verortungWaehlen(anschrift, [])).toBeNull();
  });

  it('Schlüssel ohne Rücksicht auf Groß/klein und Leerzeichen; ohne Straße keine Abfrage', () => {
    expect(verortungSchluessel({ strasse: ' Aldinger  Straße', hausnr: '86', plz: '70378', stadt: 'STUTTGART ' })).toBe('aldinger straße 86|70378|stuttgart');
    expect(verortungMoeglich({ strasse: '', hausnr: '', plz: '70378', stadt: 'Stuttgart' })).toBe(false);
    expect(verortungMoeglich(anschrift)).toBe(true);
  });
});

describe('KI-Lagebeschreibung', () => {
  it('nimmt die Adresse aus dem Objekt und erkennt Stuttgart an Stadt oder PLZ', () => {
    expect(lageKiEingabe({}, { id: 'd' }, objekt)).toEqual({
      fullAdresse: 'Aldinger Straße 86, 70378, Stuttgart', stadt: 'Stuttgart', plz: '70378', istStuttgart: true, bestandStandort: [], bestandAnbindung: [],
      anschrift: { strasse: 'Aldinger Straße', hausnr: '86', plz: '70378', stadt: 'Stuttgart' },
    });
    expect(lageKiEingabe({}, null, { ...objekt, stadt: 'Leonberg', plz: '71229' })!.istStuttgart).toBe(false);
    expect(lageKiEingabe({}, null, { strasse: 'Weg', plz: '70173' })!.istStuttgart).toBe(true);
  });

  it('ohne Straße und Stadt gibt es keine Eingabe', () => {
    expect(lageKiEingabe({}, null, { plz: '70173' })).toBeNull();
    expect(lageKiEingabe({}, null, null)).toBeNull();
  });

  it('was schon getippt ist, geht als Bestand mit — Leerzeilen zählen nicht', () => {
    const e = lageKiEingabe({ standortBullets: 'Ruhige Wohnlage\n\n  Nähe zum Max-Eyth-See ', anbindungBullets: '' }, null, objekt)!;
    expect(e.bestandStandort).toEqual(['Ruhige Wohnlage', 'Nähe zum Max-Eyth-See']);
    expect(e.bestandAnbindung).toEqual([]);
  });

  it('übernimmt die Punkte als Zeilen und zählt sie', () => {
    const r = lageKiUebernehmen({ bildPath: 'photo:a/b', standortBullets: 'alt' }, { standortBullets: ['Ruhige Wohnlage', ' '], anbindungBullets: ['U12 in 5 Minuten', 'B10 in der Nähe'] });
    expect(r.data).toEqual({ bildPath: 'photo:a/b', standortBullets: 'Ruhige Wohnlage', anbindungBullets: 'U12 in 5 Minuten\nB10 in der Nähe' });
    expect(r.bullets).toBe(3);
    expect(lageKiHinweis(r.bullets)).toBe('✅ Lagebeschreibung generiert (3 Bullets)');
  });

  it('eine leere Sektion ersetzt den getippten Bestand nicht; gar keine Punkte sind ein Ausfall', () => {
    expect(lageKiUebernehmen({ standortBullets: 'getippt' }, { standortBullets: [], anbindungBullets: ['Bus 42'] }).data).toEqual({ standortBullets: 'getippt', anbindungBullets: 'Bus 42' });
    expect(() => lageKiUebernehmen({}, { standortBullets: [], anbindungBullets: [''] })).toThrow('KI lieferte keine Punkte');
    expect(() => lageKiUebernehmen({}, { standortBullets: ['x'] })).toThrow('KI lieferte unerwartetes Format');
    expect(() => lageKiUebernehmen({}, undefined)).toThrow('KI lieferte unerwartetes Format');
  });
});

describe('KI-Objektbeschreibung', () => {
  it('sammelt nur bekannte Fakten; Werte der Folie haben Vorrang vor dem Objekt', () => {
    const e = objektKiEingabe({ baujahr: '1965', stellplaetze: '4', beschreibung: '  Solides Haus.  ' }, { kalk: { kaufpreis: 1_250_000 } }, objekt)!;
    expect(e.fakten).toEqual([
      'Adresse: Aldinger Straße 86, 70378 Stuttgart', 'Baujahr: 1965', 'Einheiten: 6', 'Wohnfläche: 420 m²', 'Grundstück: 610 m²', 'Stellplätze: 4',
      'Kaufpreis/GIK: 1.250.000 €', 'Energiekennwert: D', 'Heizung: Gas-Etagenheizung',
    ]);
    expect(e.aktuelleBeschreibung).toBe('Solides Haus.');
  });

  it('der Kaufpreis der Folie geht vor dem des Deals; ohne jede Angabe gibt es keine Eingabe', () => {
    expect(objektKiEingabe({ gik: '1,3 Mio. €' }, { kalk: { kaufpreis: 900_000 } }, null)!.fakten).toEqual(['Kaufpreis/GIK: 1,3 Mio. €']);
    expect(objektKiEingabe({}, { kalk: {} }, null)).toBeNull();
    expect(objektKiEingabe({ beschreibung: 'nur Text' }, null, null)).toBeNull();
  });

  it('übernimmt den Text und zählt die Wörter; zu kurzer Text ist ein Ausfall', () => {
    const text = 'Bei dem Objekt handelt es sich um ein 1964 gebautes Mehrfamilienhaus.';
    const r = objektKiUebernehmen({ baujahr: '1964', beschreibung: 'alt' }, { beschreibung: `  ${text} ` });
    expect(r.data).toEqual({ baujahr: '1964', beschreibung: text });
    expect(objektKiHinweis(r.woerter)).toBe('✅ Objektbeschreibung generiert (11 Wörter)');
    expect(() => objektKiUebernehmen({}, { beschreibung: 'zu kurz' })).toThrow('KI lieferte unerwartet kurzen Text');
    expect(() => objektKiUebernehmen({}, undefined)).toThrow('KI lieferte unerwartet kurzen Text');
  });

  it('Fehlermeldung wie in der alten App', () => {
    expect(kiFehlerHinweis('KI lieferte keine Punkte')).toBe('❌ KI-Generierung fehlgeschlagen: KI lieferte keine Punkte');
  });
});
