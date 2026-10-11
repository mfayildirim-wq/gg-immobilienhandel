import { describe, expect, it } from 'vitest';
import {
  berechneAnkauf, dealEinheitenAusExpose, einheitAlsEingabe, EXPOSE_V2_SCHEMA, exposeV2Leer, exposeVorbereiten, KALK_STANDARD, maklerHatDaten, MAPPING,
  telefonErsetzen, wizardKalkSpeichern, wizardKalkVorbelegen, zuordnen,
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

describe('Exposé-Import: Vollerfassung v2 (Auftraggeber 11.10.2026, Protokoll 28)', () => {
  it('die KI liefert wörtliche Angaben; Zahlen und Zuordnung macht der Code über die Mapping-Tabelle', () => {
    const v2 = exposeV2Leer();
    expect(v2.schema).toBe(EXPOSE_V2_SCHEMA);
    v2.angaben = [
      { bezeichnung: 'Ort', wert: 'Stuttgart', seite: 1, pfad: 'geo.ort', kontakt: null, gg: null },
      { bezeichnung: 'Kaufpreis', wert: '1.250.000 €', seite: 1, pfad: 'preise.kaufpreis', kontakt: null, gg: null },
      { bezeichnung: 'Faktor', wert: '20,8-fach', seite: 1, pfad: 'preise.x_fache', kontakt: null, gg: null },
    ];
    const { pruefdaten, details } = zuordnen(v2);
    const v = exposeVorbereiten(pruefdaten);
    expect(v.objekt).toMatchObject({ stadt: 'Stuttgart', angebotspreis: 1_250_000 });
    expect(v.deal.kalk.kaufpreis).toBe(1_250_000);
    // der Kaufpreisfaktor landet in details, nicht in einer Spalte
    expect(MAPPING['preise.x_fache']).toEqual(['details.kaufpreisfaktor']);
    expect(details).toEqual({ kaufpreisfaktor: 20.8 });
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
