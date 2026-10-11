import { describe, expect, it } from 'vitest';
import { angabenAusImport, notizText, uebernahmeWert, vergleichsStatus, zahlDe, zieleMitStand } from '../src/index.ts';
import { exposeV2Beispiel } from './fixtures/expose-v2-beispiel.ts';

const imp = () => ({ id: 'imp-1', datum: '2026-10-11', rohdaten: exposeV2Beispiel(), belegt: null });
const finde = (zeilen: ReturnType<typeof angabenAusImport>, feld: string) => zeilen.find((z) => z.feld === feld)!;

describe('Exposé v2: Angaben-Zeilen (Protokoll 28)', () => {
  it('Objekt: jede Angabe wörtlich mit Standard-Bezeichnung, Ziel aus dem Mapping und Vergleich', () => {
    const zeilen = angabenAusImport(imp(), 'objekt', { angebotspreis: 1_250_000, wohnflaeche: 230, details: {} });
    const kaufpreis = finde(zeilen, 'angaben.2');
    expect(kaufpreis).toMatchObject({
      bezeichnung: 'Kaufpreis', wert: '1.250.000,00 €', standard: 'Kaufpreis', seite: 1, gruppe: 'preise',
      ziel: { feld: 'objekt.angebotspreis', wert: 1_250_000, status: 'gleich', quelle: 'mapping' },
    });
    expect(finde(zeilen, 'angaben.6').ziel).toMatchObject({ feld: 'objekt.wohnflaeche', status: 'abweichend', aktuell: 230 });
    expect(finde(zeilen, 'angaben.7').ziel).toMatchObject({ feld: 'objekt.grundstueck', status: 'leer' });
    // ohne Mapping, mit KI-Vorschlag
    expect(finde(zeilen, 'angaben.18')).toMatchObject({ pfad: null, gruppe: 'ohne', zuordnung: 'keinMapping', ziel: { feld: 'details.instandhaltungsruecklage', quelle: 'vorschlag', wert: 12_000, status: 'leer' } });
    // doppelt: das Mapping-Ziel wird vorgeschlagen
    expect(finde(zeilen, 'angaben.20')).toMatchObject({ zuordnung: 'doppelt', ziel: { feld: 'objekt.angebotspreis', quelle: 'vorschlag', wert: 1_300_000, status: 'abweichend' } });
    // ohne Ziel
    expect(finde(zeilen, 'angaben.19').ziel.status).toBe('keinFeld');
    // keine Kontaktzeilen beim Objekt, dafür Einheiten am Ende
    expect(zeilen.some((z) => z.pfad?.startsWith('kontaktperson.'))).toBe(false);
    expect(zeilen.at(-1)).toMatchObject({ feld: 'einheiten.3', gruppe: 'einheiten', bezeichnung: 'Einheit TG 1 (Stellplatz)', wert: 'Tiefgarage · 60 €', seite: 4 });
  });

  it('Makler: Kontaktzeilen, Telefon nach Ziffern, weitere Kontakte', () => {
    const zeilen = angabenAusImport(imp(), 'makler', { name: 'Anna Beispiel', tel: '+49 171 1234567', weitereKontakte: { namen: ['Max Zweit'], telefonnummern: [], emails: [] } });
    expect(zeilen.every((z) => z.gruppe === 'kontaktperson')).toBe(true);
    expect(finde(zeilen, 'angaben.22').ziel).toMatchObject({ feld: 'makler.name', wert: 'Anna Beispiel', status: 'gleich' });
    expect(finde(zeilen, 'angaben.24').ziel).toMatchObject({ feld: 'makler.mobiltel', status: 'gleich' });
    expect(finde(zeilen, 'angaben.28').ziel).toMatchObject({ feld: 'makler.weitereKontakte', status: 'gleich' });
    expect(finde(zeilen, 'angaben.29').ziel).toMatchObject({ feld: 'makler.weitereKontakte', status: 'leer' });
  });

  it('Dropdown: Ziele der Art mit Stand; Listen-Ziele sind immer wählbar', () => {
    const ziele = zieleMitStand('objekt', { angebotspreis: 1, notizen: 'x', details: { provision: '3 %' } });
    expect(ziele.find((z) => z.schluessel === 'objekt.angebotspreis')).toMatchObject({ leer: false, aktuell: 1 });
    expect(ziele.find((z) => z.schluessel === 'details.provision')).toMatchObject({ leer: false });
    expect(ziele.find((z) => z.schluessel === 'objekt.notizen')).toMatchObject({ leer: true });
    expect(ziele.some((z) => z.schluessel.startsWith('makler.') || z.schluessel.startsWith('kalkulation.'))).toBe(false);
  });

  it('Übernahme: Spalte, details, Liste, Notiz; falsche Art oder unlesbarer Wert → null', () => {
    const zeilen = angabenAusImport(imp(), 'objekt', { details: {} });
    expect(uebernahmeWert(finde(zeilen, 'angaben.2'), 'objekt.angebotspreis', 'objekt')).toEqual({ spalte: 'angebotspreis', wert: 1_250_000 });
    expect(uebernahmeWert(finde(zeilen, 'angaben.18'), 'details.instandhaltungsruecklage', 'objekt')).toEqual({ detailsSchluessel: 'instandhaltungsruecklage', wert: 12_000 });
    expect(uebernahmeWert(finde(zeilen, 'angaben.19'), 'details.sanierungen', 'objekt')).toEqual({ detailsSchluessel: 'sanierungen', wert: 'Besichtigung: nach Vereinbarung', liste: true });
    expect(uebernahmeWert(finde(zeilen, 'angaben.19'), 'objekt.angebotspreis', 'objekt')).toBeNull();
    expect(uebernahmeWert(finde(zeilen, 'angaben.2'), 'makler.name', 'objekt')).toBeNull();
    expect(uebernahmeWert(finde(zeilen, 'angaben.19'), 'notizen', 'objekt')).toEqual({ notizText: 'Besichtigung: nach Vereinbarung (Exposé S. 3)', wert: 'nach Vereinbarung' });
    const makler = angabenAusImport(imp(), 'makler', {});
    expect(uebernahmeWert(finde(makler, 'angaben.29'), 'makler.weitereKontakte', 'makler')).toEqual({ spalte: 'weitereKontakte', wert: { namen: [], telefonnummern: ['0731 555'], emails: [] } });
  });

  it('Hilfen', () => {
    expect(zahlDe(1_250_000)).toBe('1.250.000');
    expect(zahlDe(85.5)).toBe('85,5');
    expect(vergleichsStatus('Gas', 'Gas-Zentralheizung')).toBe('gleich');
    expect(vergleichsStatus(1, null)).toBe('leer');
    expect(notizText({ bezeichnung: 'A', wert: 'b', seite: null })).toBe('A: b');
  });
});
