import { describe, expect, it } from 'vitest';
import { unternehmenDomain, unternehmenErgaenzen, unternehmenSchluessel, unternehmenUebernahmePlan } from '../src/index.ts';

describe('unternehmenSchluessel: nur Schreibweisen zusammenfassen (18.10.2026)', () => {
  it('Groß/Klein, Leerzeichen, „&“ und Bindestriche', () => {
    expect(unternehmenSchluessel('elephas Immobilien GmbH')).toBe(unternehmenSchluessel('ELEPHAS IMMOBILIEN GMBH'));
    expect(unternehmenSchluessel('E & G Private Immobilien GmbH')).toBe(unternehmenSchluessel('E&G  Private Immobilien GmbH '));
    expect(unternehmenSchluessel('Volksbank Leonberg-Strohgäu')).toBe(unternehmenSchluessel('Volksbank Leonberg Strohgäu'));
  });

  it('Rechtsform und Standort bleiben unterscheidend', () => {
    expect(unternehmenSchluessel('Volksbank Leonberg-Strohgäu eG')).not.toBe(unternehmenSchluessel('Volksbank Leonberg Strohgäu'));
    expect(unternehmenSchluessel('LINK Immobilien GmbH Stuttgart')).not.toBe(unternehmenSchluessel('LINK Immobilien GmbH Ostfildern-Nellingen'));
  });

  it('leer bleibt leer', () => {
    expect(unternehmenSchluessel('  ')).toBeNull();
    expect(unternehmenSchluessel(null)).toBeNull();
  });
});

describe('unternehmenDomain', () => {
  it('aus der Webseite, sonst aus der Mail — Freemailer zählen nicht', () => {
    expect(unternehmenDomain('https://www.Heinzimmobilien.com/kontakt')).toBe('heinzimmobilien.com');
    expect(unternehmenDomain('www.engelvoelkers.com/karlsruhecommercial')).toBe('engelvoelkers.com');
    expect(unternehmenDomain(null, 'p.fein@realestate.bnpparibas')).toBe('realestate.bnpparibas');
    expect(unternehmenDomain('', 'max@gmx.de')).toBeNull();
  });
});

describe('unternehmenUebernahmePlan', () => {
  const plan = unternehmenUebernahmePlan([
    { id: 'm1', name: 'Anna', firma: 'elephas Immobilien GmbH', webseite: 'www.elephas.de', email: 'anna@elephas.de', weitereKontakte: { namen: ['Mario Lukić', 'Bernd'], telefonnummern: [], emails: [] } },
    { id: 'm2', name: 'Bernd', firma: 'ELEPHAS IMMOBILIEN GMBH', webseite: 'https://elephas.de', strasse: 'Hauptstr. 1', plz: '70173', ort: 'Stuttgart' },
    { id: 'm3', name: 'Clara', firma: 'elephas Immobilien GmbH' },
    { id: 'm4', name: 'Dora', firma: 'Volksbank Stuttgart Immobilien GmbH', webseite: 'www.volksbank-stuttgart.de' },
    { id: 'm5', name: 'Emil', firma: 'Volksbank Stuttgart Immobilien GmbH', webseite: 'www.vbs-immo.de' },
    { id: 'm6', name: 'Fritz', firma: 'Baden-Württembergische Bank / Immobilienvermittlung BW GmbH', email: 'f@immobilienvermittlung-bw.de' },
    { id: 'm7', name: 'Gabi', firma: 'Immobilienvermittlung BW GmbH / Baden-Württembergische Bank', email: 'g@immobilienvermittlung-bw.de' },
    { id: 'm8', name: 'Angebote von Privat', firma: '' },
  ]);
  const elephas = plan.unternehmen.find((u) => u.maklerIds.includes('m1'))!;

  it('eine Firma je Schlüssel, häufigste Schreibweise als Name', () => {
    expect(plan.unternehmen).toHaveLength(4);
    expect(elephas).toMatchObject({ name: 'elephas Immobilien GmbH', maklerIds: ['m1', 'm2', 'm3'], domain: 'elephas.de', webseite: 'www.elephas.de' });
  });

  it('bei Gleichstand die normal geschriebene Form, nicht die in Großbuchstaben', () => {
    const p = unternehmenUebernahmePlan([{ id: 'x1', firma: 'ELEPHAS IMMOBILIEN GMBH' }, { id: 'x2', firma: 'elephas Immobilien GmbH' }]);
    expect(p.unternehmen[0]!.name).toBe('elephas Immobilien GmbH');
  });

  it('Anschrift als Ganzes vom ersten Makler, der eine hat', () => {
    expect(elephas).toMatchObject({ strasse: 'Hauptstr. 1', plz: '70173', ort: 'Stuttgart' });
  });

  it('weitere Kontakte am Unternehmen — ohne Kollegen, die selbst Makler sind', () => {
    expect(elephas.weitereKontakte).toEqual({ namen: ['Mario Lukić'], telefonnummern: [], emails: [] });
  });

  it('ohne Firma: kein Unternehmen', () => {
    expect(plan.ohneFirma).toEqual(['m8']);
  });

  it('Bericht: gleiche Domain, mehrteilige Namen, widersprüchliche Webseiten', () => {
    expect(plan.pruefen.gleicheDomain).toEqual([{ domain: 'immobilienvermittlung-bw.de', namen: [
      'Baden-Württembergische Bank / Immobilienvermittlung BW GmbH', 'Immobilienvermittlung BW GmbH / Baden-Württembergische Bank'] }]);
    expect(plan.pruefen.mehrteilig).toHaveLength(2);
    expect(plan.pruefen.webseitenKonflikt).toEqual([{ name: 'Volksbank Stuttgart Immobilien GmbH', webseiten: ['www.volksbank-stuttgart.de', 'www.vbs-immo.de'] }]);
  });
});

describe('unternehmenErgaenzen: ein neuer Makler füllt nur Lücken', () => {
  it('Webseite und Domain nur, wenn leer; Anschrift nur als Ganzes', () => {
    expect(unternehmenErgaenzen({ webseite: 'www.a.de', domain: 'a.de', ort: 'Ulm' }, { webseite: 'www.b.de', strasse: 'X 1', ort: 'Stuttgart' })).toEqual({});
    expect(unternehmenErgaenzen({}, { webseite: 'www.b.de', strasse: 'X 1', plz: '70173', ort: 'Stuttgart' }))
      .toEqual({ webseite: 'www.b.de', domain: 'b.de', strasse: 'X 1', plz: '70173', ort: 'Stuttgart' });
  });

  it('Kontakte kommen hinzu, Bekanntes und Makler der Firma fallen weg', () => {
    const alt = { weitereKontakte: { namen: ['Max'], telefonnummern: [], emails: [] } };
    expect(unternehmenErgaenzen(alt, { weitereKontakte: { namen: ['MAX', 'Anna', 'Lisa'], telefonnummern: [], emails: [] } }, [{ id: 'm1', name: 'Anna' }]))
      .toEqual({ weitereKontakte: { namen: ['Max', 'Lisa'], telefonnummern: [], emails: [] } });
    expect(unternehmenErgaenzen(alt, { weitereKontakte: { namen: ['max'], telefonnummern: [], emails: [] } })).toEqual({});
  });
});
