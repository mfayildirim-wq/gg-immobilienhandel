import { describe, expect, it } from 'vitest';
import { einheitenDetails, exposeV1Leer, exposeVorbereiten, maklerHatDaten, v1AlsV0, ZIEL_MAKLER, ZIEL_OBJEKT } from '../src/index.ts';
import { beispielV1 } from './fixtures/expose-v1-beispiel.ts';

describe('Abbildung v1 → v0 (Adapter für Prüfseite und Übernahme)', () => {
  it('Allowlist: jeder Spaltenpfad trägt eine Spalte oder einen Details-Schlüssel und ein Label', () => {
    for (const [pfad, z] of Object.entries(ZIEL_OBJEKT)) {
      expect(z.label, pfad).toBeTruthy();
      expect(z.spalte || z.details, pfad).toBeTruthy();
    }
    expect(ZIEL_OBJEKT['preise.kaufpreis']).toMatchObject({ spalte: 'angebotspreis' });
    expect(ZIEL_OBJEKT['verwaltung.anzahl_wohneinheiten']).toMatchObject({ spalte: 'einheitenAnzahl' });
    expect(ZIEL_OBJEKT['preise.bruttorendite_angegeben']).toMatchObject({ details: 'bruttorendite' });
    expect(ZIEL_OBJEKT['freitexte.lage']).toMatchObject({ details: 'lagebeschreibung' });
    expect(ZIEL_OBJEKT['preise.x_fache_angegeben']).toBeUndefined();
    expect(ZIEL_MAKLER['kontaktperson.name']).toMatchObject({ spalte: 'name' });
    expect(ZIEL_MAKLER['kontaktperson.tel_zentrale']).toMatchObject({ spalte: 'festnetz' });
    expect(ZIEL_MAKLER['kontaktperson.tel_durchwahl']).toMatchObject({ spalte: 'festnetz' });
    expect(ZIEL_MAKLER['kontaktperson.web']).toMatchObject({ spalte: 'webseite' });
    expect(ZIEL_MAKLER['weitere_kontakte']).toMatchObject({ spalte: 'weitereKontakte' });
    expect(ZIEL_MAKLER['kontaktperson.fax']).toBeUndefined();
  });

  it('v1AlsV0 liefert das heutige Format; exposeVorbereiten verteilt Flächen wie bisher', () => {
    const v0 = v1AlsV0(beispielV1());
    expect(v0.objekt).toMatchObject({
      strasse: 'Musterweg', hausnr: '12', plz: '70173', stadt: 'Stuttgart', bundesland: 'Baden-Württemberg', baujahr: 1962,
      wohnflaeche: 480.5, grundstueck: 620, einheitenAnz: 6, angebotspreis: 1_250_000, istmiete: 5000, bruttorendite: 4.8,
      heizungsart: 'Gas-Zentralheizung', heizungsbaujahr: 2015, energieausweis: { klasse: 'D', kennwert: 118, art: 'Verbrauchsausweis' },
      lagebeschreibung: 'Ruhige Wohnlage', ausstattung: 'Balkon, Keller — Fenster 2015', notizen: 'Besichtigung nach Absprache',
    });
    expect(v0.objekt.einheiten).toEqual([
      { typ: 'Wohnung', lage: 'EG links', zimmer: 3, flaeche: 85.5, kaltmiete: 780, vermiet: 'Vermietet' },
      { typ: 'Wohnung', lage: 'EG rechts', zimmer: 2, flaeche: null, kaltmiete: null, vermiet: 'Leerstand' },
      { typ: 'Stellplatz', lage: 'TG-01', zimmer: null, flaeche: null, kaltmiete: 40, vermiet: 'Vermietet' },
    ]);
    expect(v0.makler).toMatchObject({
      name: 'Anna Beispiel', firma: 'Immo GmbH', mobiltel: '0171 1234567', festnetztel: '0711 123457', email: 'anna@immo.test', webseite: 'www.immo.test',
      alleNamen: ['Anna Beispiel', 'Bodo Büro'], alleEmails: ['anna@immo.test', 'bodo@immo.test'],
    });
    expect(v0.makler.alleTelefonnummern).toEqual(['0711 123456', '0711 123457', '0171 1234567', '0711 123458', '0711 999']);
    expect(v0.kalkulation).toMatchObject({ kaufpreis: 1_250_000, makler: 3.57, notar: null, gest: null, rp_pct: null });
    expect(v0._konfidenz).toEqual({
      angebotspreis: 'hoch', istmiete: 'mittel', wohnflaeche: 'hoch', grundstueck: 'hoch', baujahr: 'hoch', einheitenAnz: 'hoch', energiekennwert: 'hoch', strasse: 'hoch',
    });

    const v = exposeVorbereiten(v0);
    // Restfläche 480,5 − 85,5 = 395 geht an die eine Wohnung ohne Fläche; Stellplatz bleibt ohne
    expect(v.objekt.einheiten.map((e: { flaeche: unknown }) => e.flaeche)).toEqual([85.5, 395, null]);
    expect(v.makler.tel).toBe('0171 1234567');
    expect(v.deal.notizen).toBe('Besichtigung nach Absprache');
    expect(v.deal.kalk.kaufpreis).toBe(1_250_000);
  });

  it('Festnetz: Durchwahl vor Zentrale, sonst Zentrale; Name auch ohne Vorname', () => {
    const v1 = exposeV1Leer();
    v1.kontaktperson.name = 'Beispiel';
    v1.kontaktperson.tel_zentrale = '0711 1';
    expect(v1AlsV0(v1).makler).toMatchObject({ name: 'Beispiel', festnetztel: '0711 1', tel: '0711 1', mobiltel: null });
  });

  it('leeres v1 ergibt ein Objekt ohne Einheiten und einen Makler ohne Daten', () => {
    const v0 = v1AlsV0(exposeV1Leer());
    expect(v0.objekt.einheiten).toEqual([]);
    expect(v0.objekt.strasse).toBeNull();
    expect(v0.objekt.ausstattung).toBeNull();
    expect(v0.makler.alleNamen).toEqual([]);
    expect(v0.kalkulation.kaufpreis).toBeNull();
    const v = exposeVorbereiten(v0);
    expect(maklerHatDaten(v.makler)).toBe(false);
    expect(v.objekt.einheiten).toEqual([]);
    expect(Object.values(v0._konfidenz).every((k) => k === 'niedrig')).toBe(true);
  });

  it('einheitenDetails: nur gesetzte Werte, ohne Werte null', () => {
    const [eins, zwei, drei] = beispielV1().einheiten;
    expect(einheitenDetails(eins!)).toEqual({ nebenkosten: 180, mietbeginn: '01.03.2019', seite: 4 });
    expect(einheitenDetails(zwei!)).toEqual({ sollmiete: 650, seite: 4 });
    expect(einheitenDetails({ ...drei!, _seite: null })).toBeNull();
  });
});
