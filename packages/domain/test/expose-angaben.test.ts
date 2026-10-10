import { describe, expect, it } from 'vitest';
import { ANGABE_GRUPPEN, angabenAusImport, angabenAusImportMakler, exposeV1Leer, uebernahmeWert, type Angabe } from '../src/index.ts';
import { beispielV1 } from './fixtures/expose-v1-beispiel.ts';

const imp = () => ({ id: 'imp-1', datum: '2026-10-10', rohdaten: beispielV1(), belegt: { kaufpreis: true, istmiete: false, wohnflaeche: true } });
const feld = (liste: Angabe[], pfad: string) => liste.find((a) => a.feld === pfad)!;

describe('angabenAusImport (Objekt)', () => {
  it('jede nicht-leere v1-Angabe wird eine Zeile mit Bezeichnung, Einheit, Fundstelle und Beleg', () => {
    const a = angabenAusImport(imp(), {});
    expect(a.every((z) => z.importId === 'imp-1' && z.datum === '2026-10-10')).toBe(true);
    expect(feld(a, 'preise.kaufpreis')).toMatchObject({ gruppe: 'preise', bezeichnung: 'Kaufpreis', wert: 1_250_000, einheit: '€', seite: 2, zitat: 'Kaufpreis: 1.250.000 €', konfidenz: 'hoch', belegt: true });
    expect(feld(a, 'preise.mieteinnahmen_ist_monat')).toMatchObject({ bezeichnung: 'Ist-Miete je Monat', einheit: '€', seite: 3, konfidenz: 'mittel', belegt: false });
    expect(feld(a, 'preise.hausgeld_monat')).toBeUndefined();
    expect(feld(a, 'flaechen.wohnflaeche')).toMatchObject({ bezeichnung: 'Wohnfläche', einheit: 'm²', wert: 480.5, belegt: true });
    expect(feld(a, 'preise.provision_prozent')).toMatchObject({ einheit: '%', seite: null, zitat: null, konfidenz: null, belegt: null });
    expect(feld(a, 'geo.ort')).toMatchObject({ gruppe: 'lage', bezeichnung: 'Ort', wert: 'Stuttgart', seite: 1, belegt: null });
    expect(feld(a, 'ausstattung.merkmale')).toMatchObject({ wert: 'Balkon, Keller' });
    expect(feld(a, 'zustand.sanierungen')).toMatchObject({ wert: '2015 Heizung erneuert' });
    expect(feld(a, 'zustand.denkmalschutz')).toMatchObject({ gruppe: 'recht', wert: false });
    expect(feld(a, 'zustand.erbpacht')).toBeUndefined();
    expect(feld(a, 'energiepass.kennwert')).toMatchObject({ gruppe: 'energie', einheit: 'kWh/(m²·a)', seite: 6 });
    expect(a.some((z) => z.feld.startsWith('kontaktperson') || z.feld.startsWith('belege'))).toBe(false);
  });

  it('Einheiten: eine Zeile je Einheit ohne Ziel; weitere Angaben je Zeile', () => {
    const a = angabenAusImport(imp(), {});
    expect(feld(a, 'einheiten.0')).toMatchObject({ gruppe: 'verwaltung', wert: 'EG links · 3 Zi · 85,5 m² · 780 €', seite: 4, ziel: { feld: null, status: 'keinFeld' } });
    expect(feld(a, 'einheiten.1').wert).toBe('EG rechts · 2 Zi · Leerstand');
    expect(feld(a, 'einheiten.2').wert).toBe('TG-01 · 40 €');
    expect(feld(a, 'einheiten.2').bezeichnung).toMatch(/Stellplatz/);
    expect(feld(a, 'weitere_angaben.0')).toMatchObject({ gruppe: 'verwaltung', bezeichnung: 'Instandhaltungsrücklage', wert: '12.000 €', einheit: '€', seite: 5, ziel: { status: 'keinFeld' } });
  });

  it('Status: leer, gleich (Zahl ±0,5 %, Text ohne Groß/Klein), abweichend, keinFeld', () => {
    const a = angabenAusImport(imp(), {
      strasse: ' musterweg ', angebotspreis: 1_254_000, wohnflaeche: 500, baujahr: null, stadt: 'Stuttgart',
      details: { bruttorendite: 4.8, energieausweis: { art: 'Bedarfsausweis' }, lagebeschreibung: null },
    });
    expect(feld(a, 'geo.strasse').ziel).toEqual({ feld: 'strasse', label: 'Straße', aktuell: ' musterweg ', status: 'gleich' });
    expect(feld(a, 'preise.kaufpreis').ziel).toMatchObject({ feld: 'angebotspreis', aktuell: 1_254_000, status: 'gleich' });
    expect(feld(a, 'flaechen.wohnflaeche').ziel).toMatchObject({ feld: 'wohnflaeche', aktuell: 500, status: 'abweichend' });
    expect(feld(a, 'zustand.baujahr').ziel).toMatchObject({ feld: 'baujahr', aktuell: null, status: 'leer' });
    expect(feld(a, 'geo.ort').ziel.status).toBe('gleich');
    expect(feld(a, 'preise.bruttorendite_angegeben').ziel).toMatchObject({ feld: 'details.bruttorendite', aktuell: 4.8, status: 'gleich' });
    expect(feld(a, 'energiepass.art').ziel).toMatchObject({ feld: 'details.energieausweis.art', aktuell: 'Bedarfsausweis', status: 'abweichend' });
    expect(feld(a, 'freitexte.lage').ziel).toMatchObject({ feld: 'details.lagebeschreibung', status: 'leer' });
    expect(feld(a, 'preise.x_fache_angegeben').ziel).toEqual({ feld: null, label: null, aktuell: null, status: 'keinFeld' });
    expect(feld(a, 'energiepass.klasse').ziel).toMatchObject({ feld: 'energieklasse', status: 'leer' });
  });

  it('Reihenfolge: Gruppen wie ANGABE_GRUPPEN, innerhalb zuerst Zeilen mit Ziel', () => {
    const a = angabenAusImport(imp(), {});
    const rang = a.map((z) => ANGABE_GRUPPEN.indexOf(z.gruppe as (typeof ANGABE_GRUPPEN)[number]));
    expect(rang.every((r) => r >= 0)).toBe(true);
    expect([...rang].sort((x, y) => x - y)).toEqual(rang);
    for (const g of ANGABE_GRUPPEN) {
      const zeilen = a.filter((z) => z.gruppe === g);
      const ersteOhne = zeilen.findIndex((z) => z.ziel.status === 'keinFeld');
      if (ersteOhne >= 0) expect(zeilen.slice(ersteOhne).every((z) => z.ziel.status === 'keinFeld'), g).toBe(true);
    }
    expect(a[0]!.gruppe).toBe('lage');
    expect(a.at(-1)!.gruppe).toBe('sonstiges');
  });

  it('leeres v1 ergibt keine Zeilen', () => {
    expect(angabenAusImport({ id: 'x', datum: 'd', rohdaten: exposeV1Leer() }, {})).toEqual([]);
  });
});

describe('angabenAusImportMakler', () => {
  const makler = { name: 'Anna Beispiel', firma: null, tel: '+49 171 1234567', mobil: null, festnetz: '0711/123456', email: 'ANNA@immo.test', webseite: null, strasse: null, plz: null, ort: null, weitereKontakte: { namen: ['Bodo Büro'], telefonnummern: [], emails: [] } };

  it('Name aus Vorname + Nachname, Telefon nach Ziffern verglichen, Fax und Position nur zur Anzeige', () => {
    const a = angabenAusImportMakler(imp(), makler);
    expect(a.some((z) => z.feld === 'kontaktperson.vorname')).toBe(false);
    expect(feld(a, 'kontaktperson.name')).toMatchObject({ bezeichnung: 'Name', wert: 'Anna Beispiel', ziel: { feld: 'name', aktuell: 'Anna Beispiel', status: 'gleich' } });
    expect(feld(a, 'kontaktperson.firma').ziel).toMatchObject({ feld: 'firma', status: 'leer' });
    expect(feld(a, 'kontaktperson.mobil').ziel).toMatchObject({ feld: 'mobil', aktuell: null, status: 'gleich' });
    expect(feld(a, 'kontaktperson.tel_zentrale').ziel).toMatchObject({ feld: 'festnetz', status: 'gleich' });
    expect(feld(a, 'kontaktperson.tel_durchwahl').ziel).toMatchObject({ feld: 'festnetz', status: 'abweichend' });
    expect(feld(a, 'kontaktperson.email').ziel.status).toBe('gleich');
    expect(feld(a, 'kontaktperson.fax')).toMatchObject({ bezeichnung: 'Fax', ziel: { status: 'keinFeld' } });
    expect(feld(a, 'kontaktperson.position')).toMatchObject({ bezeichnung: 'Position', ziel: { status: 'keinFeld' } });
    expect(feld(a, 'kontaktperson.web').ziel).toMatchObject({ feld: 'webseite', status: 'leer' });
  });

  it('weitere Kontakte: je Zeile; schon enthalten → gleich, sonst leer', () => {
    const a = angabenAusImportMakler(imp(), makler);
    expect(feld(a, 'weitere_kontakte.0')).toMatchObject({ wert: 'Bodo Büro · (Geschäftsführer) · 0711 999 · bodo@immo.test', ziel: { feld: 'weitereKontakte', status: 'gleich' } });
    expect(feld(a, 'weitere_kontakte.0').ziel.status).toBe('gleich');
    const b = angabenAusImportMakler(imp(), { ...makler, weitereKontakte: null });
    expect(feld(b, 'weitere_kontakte.0').ziel.status).toBe('leer');
    expect(a.findIndex((z) => z.feld === 'kontaktperson.fax')).toBeGreaterThan(a.findIndex((z) => z.feld === 'kontaktperson.web'));
  });
});

describe('uebernahmeWert: nur Ziele der Allowlist', () => {
  it('Spalte, Details, Notizen; Ganzzahl für baujahr und einheitenAnzahl', () => {
    const a = angabenAusImport(imp(), {});
    expect(uebernahmeWert(feld(a, 'preise.kaufpreis'), 'spalte')).toEqual({ spalte: 'angebotspreis', wert: 1_250_000 });
    expect(uebernahmeWert(feld(a, 'preise.kaufpreis'), 'details')).toBeNull();
    expect(uebernahmeWert(feld(a, 'preise.kaufpreis'), 'notizen')).toEqual({ notizText: 'Kaufpreis: 1.250.000 € (Exposé S. 2)', wert: 1_250_000 });
    expect(uebernahmeWert(feld(a, 'preise.bruttorendite_angegeben'), 'details')).toEqual({ detailsSchluessel: 'bruttorendite', wert: 4.8 });
    expect(uebernahmeWert(feld(a, 'preise.bruttorendite_angegeben'), 'spalte')).toBeNull();
    expect(uebernahmeWert(feld(a, 'energiepass.klasse'), 'spalte')).toEqual({ spalte: 'energieklasse', wert: 'D' });
    expect(uebernahmeWert(feld(a, 'energiepass.klasse'), 'details')).toEqual({ detailsSchluessel: 'energieausweis.klasse', wert: 'D' });
    expect(uebernahmeWert(feld(a, 'preise.x_fache_angegeben'), 'spalte')).toBeNull();
    expect(uebernahmeWert(feld(a, 'preise.x_fache_angegeben'), 'notizen')).toEqual({ notizText: 'Kaufpreisfaktor (angegeben): 20,8', wert: 20.8 });
    expect(uebernahmeWert(feld(a, 'einheiten.0'), 'spalte')).toBeNull();
    expect(uebernahmeWert(feld(a, 'zustand.denkmalschutz'), 'details')).toEqual({ detailsSchluessel: 'denkmalschutz', wert: false });
    expect(uebernahmeWert(feld(a, 'zustand.denkmalschutz'), 'notizen')!.notizText).toBe('Denkmalschutz: nein');

    const v1 = exposeV1Leer();
    v1.zustand.baujahr = 1962.4;
    v1.verwaltung.anzahl_wohneinheiten = 6.6;
    const b = angabenAusImport({ id: 'i', datum: 'd', rohdaten: v1 }, {});
    expect(uebernahmeWert(feld(b, 'zustand.baujahr'), 'spalte')).toEqual({ spalte: 'baujahr', wert: 1962 });
    expect(uebernahmeWert(feld(b, 'verwaltung.anzahl_wohneinheiten'), 'spalte')).toEqual({ spalte: 'einheitenAnzahl', wert: 7 });
  });

  it('Makler: Spalten und weitere Kontakte im Format der Spalte weitereKontakte', () => {
    const a = angabenAusImportMakler(imp(), { name: null, firma: null, tel: null, mobil: null, festnetz: null, email: null, webseite: null, strasse: null, plz: null, ort: null, weitereKontakte: null });
    expect(uebernahmeWert(feld(a, 'kontaktperson.tel_durchwahl'), 'spalte')).toEqual({ spalte: 'festnetz', wert: '0711 123457' });
    expect(uebernahmeWert(feld(a, 'kontaktperson.fax'), 'spalte')).toBeNull();
    expect(uebernahmeWert(feld(a, 'kontaktperson.fax'), 'details')).toBeNull();
    expect(uebernahmeWert(feld(a, 'kontaktperson.fax'), 'notizen')).toEqual({ notizText: 'Fax: 0711 123458', wert: '0711 123458' });
    expect(uebernahmeWert(feld(a, 'weitere_kontakte.0'), 'spalte')).toEqual({
      spalte: 'weitereKontakte', wert: { namen: ['Bodo Büro'], telefonnummern: ['0711 999'], emails: ['bodo@immo.test'] },
    });
  });
});
