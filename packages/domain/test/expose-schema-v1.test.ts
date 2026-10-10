import { describe, expect, it } from 'vitest';
import { ExposeV1, exposeV1Bereinigen, exposeV1Leer, exposeV1ToolSchema, EXPOSE_V1_SCHEMA } from '../src/index.ts';

describe('Exposé-Schema v1', () => {
  it('das leere Gerüst ist gültig', () => {
    expect(ExposeV1.safeParse(exposeV1Leer()).success).toBe(true);
  });

  it('Tool-Schema: JSON-Schema mit allen Gruppen und Beschreibungen, keine Pflichtfelder außer schema', () => {
    const s = exposeV1ToolSchema() as { type: string; properties: Record<string, any>; required?: string[] };
    expect(s.type).toBe('object');
    for (const g of ['dokument', 'geo', 'preise', 'flaechen', 'ausstattung', 'zustand', 'energiepass', 'verwaltung', 'einheiten', 'freitexte', 'kontaktperson', 'weitere_kontakte', 'weitere_angaben', 'belege']) {
      expect(s.properties[g], g).toBeDefined();
    }
    expect(s.properties.preise.properties.kaufpreis.description).toMatch(/Kaufpreis/);
    expect(s.properties.weitere_angaben.description).toMatch(/KEIN Feld/);
    expect(JSON.stringify(s).length).toBeLessThan(40_000);
  });

  it('bereinigen: fehlende Gruppen ergänzt, Zahl als Text gelesen, zu lange Texte gekürzt, Unbekanntes verworfen', () => {
    const { v1, warnungen } = exposeV1Bereinigen({
      geo: { strasse: 'Musterweg', plz: 70173, unbekannt: 'x' },
      preise: { kaufpreis: '1.250.000 €' },
      einheiten: [{ typ: 'Wohnung', lage: 'EG', flaeche: '85,5' }, { typ: 'Garage' }],
      freitexte: { lage: 'x'.repeat(900) },
      belege: { kaufpreis: { seite: 3, zitat: 'Kaufpreis: 1.250.000 €', konfidenz: 'hoch' } },
    });
    expect(v1.schema).toBe(EXPOSE_V1_SCHEMA);
    expect(v1.geo.strasse).toBe('Musterweg');
    expect(v1.geo.plz).toBe('70173');
    expect(v1.preise.kaufpreis).toBe(1_250_000);
    expect(v1.einheiten).toHaveLength(1);
    expect(v1.einheiten[0]!.flaeche).toBe(85.5);
    expect(v1.freitexte.lage!.length).toBe(600);
    expect(v1.belege.kaufpreis).toEqual({ seite: 3, zitat: 'Kaufpreis: 1.250.000 €', konfidenz: 'hoch' });
    expect(v1.belege.istmiete).toEqual({ seite: null, zitat: null, konfidenz: 'niedrig' });
    expect(v1.kontaktperson.name).toBeNull();
    expect(warnungen.length).toBeGreaterThan(0);
  });

  it('bereinigen: Unlesbares ergibt das leere Gerüst mit Warnung', () => {
    const { v1, warnungen } = exposeV1Bereinigen('kaputt');
    expect(ExposeV1.safeParse(v1).success).toBe(true);
    expect(warnungen).toEqual([]);
  });
});
