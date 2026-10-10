import { describe, expect, it } from 'vitest';
import {
  berechneAnkauf, dealEinheitenAusExpose, einheitAlsEingabe, EXPOSE_V1_SCHEMA, exposeV1Leer, exposeVorbereiten, KALK_STANDARD, maklerHatDaten, telefonErsetzen,
  v1AlsV0, v1Traegt, wizardKalkSpeichern, wizardKalkVorbelegen, ZIEL_OBJEKT,
} from '../src/index.ts';

describe('Exposé-Import: bewusste Korrekturen gegenüber der alten App', () => {
  it('importierte Einheiten tragen die Fläche so, dass die Ankaufskalkulation sie liest', () => {
    const einheiten = dealEinheitenAusExpose([{ typ: 'Wohnung', lage: 'EG', flaeche: 80, kaltmiete: 800 }], 4.5);
    expect(einheiten[0]).toMatchObject({ flaeche: 80, flaecheIst: 80, mieteIst: 800, renditeK: 4.5 });
    const r = berechneAnkauf({ kaufpreis: 400000 }, einheiten.map((e) => einheitAlsEingabe({ ...e, mieteNeu: null, mieteNeuManuell: false, verkaufspreis: null, stueck: null })), []);
    expect(r.einheiten.wohnflaeche).toBe(80);
  });

  it('Risikopuffer landet in rp_pct (alte App: rp, wirkungslos)', () => {
    expect(wizardKalkVorbelegen({ rp: 15 }, KALK_STANDARD).rp_pct).toBe(15);
    expect(wizardKalkVorbelegen({}, KALK_STANDARD).rp_pct).toBe(KALK_STANDARD.rp_pct);
    expect(wizardKalkSpeichern({ rp_pct: 20 }, KALK_STANDARD)).toMatchObject({ rp_pct: 20 });
  });

  it('eine eingegebene 0 bleibt 0, nur leere Felder werden Standard', () => {
    expect(wizardKalkSpeichern({ makler: 0, notar: null }, KALK_STANDARD)).toMatchObject({ makler: 0, notar: KALK_STANDARD.notar, kaufpreis: 0 });
  });
});

describe('Exposé-Import: Schema v1 (Fachentscheidung 10.10.2026, Protokoll 26)', () => {
  it('Schema v1 statt wörtlichem Prompt: das zod-Schema ist der Vertrag, v1 wird deterministisch auf die heutigen Spalten abgebildet', () => {
    const v1 = exposeV1Leer();
    expect(v1.schema).toBe(EXPOSE_V1_SCHEMA);
    v1.geo.ort = 'Stuttgart';
    v1.preise.kaufpreis = 1_250_000;
    v1.preise.x_fache_angegeben = 20.8;
    const v = exposeVorbereiten(v1AlsV0(v1));
    expect(v.objekt).toMatchObject({ stadt: 'Stuttgart', angebotspreis: 1_250_000 });
    expect(v.deal.kalk.kaufpreis).toBe(1_250_000);
    // Allowlist: nur abgebildete Pfade schreiben Spalten; der Kaufpreisfaktor wird nur angezeigt
    expect(ZIEL_OBJEKT['preise.kaufpreis']?.spalte).toBe('angebotspreis');
    expect(ZIEL_OBJEKT['preise.x_fache_angegeben']).toBeUndefined();
  });

  it('trägt = Ort ∧ Preis ∧ Einheiten ∧ nicht abgeschnitten', () => {
    const v1 = exposeV1Leer();
    expect(v1Traegt(v1)).toBe(false);
    v1.geo.ort = 'Stuttgart';
    v1.preise.kaufpreis = 1_250_000;
    expect(v1Traegt(v1)).toBe(false);
    v1.einheiten = [{ typ: 'Wohnung', lage: 'EG', zimmer: 3, flaeche: 80, kaltmiete: 700, nebenkosten: null, sollmiete: null, vermiet: 'Vermietet', mietbeginn: null, _seite: 4 }];
    expect(v1Traegt(v1)).toBe(true);
    v1.verwaltung.einheiten_vollstaendig = false;
    expect(v1Traegt(v1)).toBe(false);
    v1.verwaltung.einheiten_vollstaendig = null;
    v1.geo.ort = ' ';
    expect(v1Traegt(v1)).toBe(false);
  });
});

describe('Exposé-Import: Ist-Regeln', () => {
  it('Mobilnummer wird nicht durch Festnetz ersetzt', () => {
    expect(telefonErsetzen('0171 1234567', '0711 123456')).toBe(false);
    expect(telefonErsetzen('0711 123456', '0171 1234567')).toBe(true);
    expect(telefonErsetzen('0711 1', '0711 2')).toBe(true);
    expect(telefonErsetzen('0711 1', '')).toBe(false);
  });

  it('Ghost-Guard: ohne Name, Firma, E-Mail oder Telefon kein Makler', () => {
    expect(maklerHatDaten({ name: ' ', webseite: 'x' } as never)).toBe(false);
    expect(maklerHatDaten({ firma: 'Immo GmbH' })).toBe(true);
  });
});
