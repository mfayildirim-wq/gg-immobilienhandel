import { describe, expect, it } from 'vitest';
import { anlegenTrotzTreffern, feldAenderungen, maklerKandidaten, maklerSuchen, objektKandidaten } from '../src/index.ts';

const bestand = [
  { id: 'm1', name: 'Anna Berger', firma: 'Berger Immobilien', email: 'anna@berger.de', tel: '+49 711 123456' },
  { id: 'm2', name: 'Bernd Krause', firma: 'Krause & Co', email: null, tel: '0170 9988776' },
  { id: 'm3', name: 'Anne Berger', firma: null, email: 'info@anne.de', tel: null },
];

describe('MCP-Schreiben: Dubletten vor dem Anlegen', () => {
  it('gleiche E-Mail oder Telefonnummer ist sicher und sperrt immer', () => {
    const t = maklerKandidaten({ name: 'Irgendwer', email: 'ANNA@berger.de' }, bestand);
    expect(t.map((k) => [k.eintrag.id, k.sicherheit])).toEqual([['m1', 'exact']]);
    expect(anlegenTrotzTreffern(t, true)).toMatchObject({ ok: false });
    expect(maklerKandidaten({ name: 'X', tel: '+49711123456' }, bestand)[0]).toMatchObject({ sicherheit: 'exact', grund: 'Gleiche Telefonnummer' });
  });

  it('ähnlicher Name sperrt, bis „trotzdemAnlegen“ gesetzt ist; Vorname und Name zählen zusammen', () => {
    const t = maklerKandidaten({ vorname: 'Anna', name: 'Berger' }, bestand);
    expect(t.map((k) => k.eintrag.id)).toEqual(['m1', 'm3']);
    expect(t.every((k) => k.sicherheit === 'fuzzy')).toBe(true);
    expect(anlegenTrotzTreffern(t, false)).toMatchObject({ ok: false });
    expect(anlegenTrotzTreffern(t, true)).toEqual({ ok: true });
    expect(anlegenTrotzTreffern(maklerKandidaten({ name: 'Carla Neu' }, bestand), false)).toEqual({ ok: true });
  });

  it('Objekte: gleiche Adresse sicher, ohne Straße kein Vergleich', () => {
    const objekte = [{ id: 'o1', strasse: 'Hauptstraße', hausnr: '5', stadt: 'Ulm' }];
    expect(objektKandidaten({ strasse: 'Hauptstr.', hausnr: '5', stadt: 'Ulm' }, objekte)[0]).toMatchObject({ eintrag: { id: 'o1' } });
    expect(objektKandidaten({ strasse: 'Hauptstraße', hausnr: '5', stadt: 'Ulm' }, objekte)[0]).toMatchObject({ sicherheit: 'exact' });
    expect(objektKandidaten({ stadt: 'Ulm' }, objekte)).toEqual([]);
  });
});

describe('MCP-Schreiben: Makler suchen', () => {
  it('jedes Wort in Name, Firma, E-Mail oder Telefon; Telefon auch mit +49', () => {
    expect(maklerSuchen(bestand, 'berger').map((m) => m.id)).toEqual(['m1', 'm3']);
    expect(maklerSuchen(bestand, 'anna berger').map((m) => m.id)).toEqual(['m1']);
    expect(maklerSuchen(bestand, 'krause co').map((m) => m.id)).toEqual(['m2']);
    expect(maklerSuchen(bestand, '0711 123456').map((m) => m.id)).toEqual(['m1']);
    expect(maklerSuchen(bestand, '+49170 9988776').map((m) => m.id)).toEqual(['m2']);
    expect(maklerSuchen(bestand, '   ')).toEqual([]);
    expect(maklerSuchen(bestand, 'e', 2)).toHaveLength(2);
  });
});

describe('MCP-Schreiben: Änderungen fürs Audit-Log', () => {
  it('nur mitgegebene und tatsächlich geänderte Felder, ohne Version; leer und null gelten gleich', () => {
    expect(feldAenderungen(
      { email: 'a@b.de', tel: null, prio: 'B', webseite: '' },
      { version: 3, email: 'neu@b.de', tel: '', prio: 'B', webseite: null, mobil: '0171' },
    )).toEqual([
      { feld: 'email', alt: 'a@b.de', neu: 'neu@b.de' },
      { feld: 'mobil', alt: null, neu: '0171' },
    ]);
  });
});
