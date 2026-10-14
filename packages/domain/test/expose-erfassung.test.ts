import { describe, expect, it } from 'vitest';
import { EXPOSE_V2_SCHEMA, ExposeV2, exposeV2Bereinigen, exposeV2ToolSchema, KATALOG_PFADE } from '../src/index.ts';
import { exposeV2Beispiel } from './fixtures/expose-v2-beispiel.ts';

describe('Exposé v2: Erfassungsschema (Protokoll 28)', () => {
  it('das Beispiel erfüllt das Schema', () => {
    expect(ExposeV2.safeParse(exposeV2Beispiel()).success).toBe(true);
  });

  it('Werkzeug-Schema: Pfade und gg-Ziele als Aufzählung, ohne `schema`; Nachfass nur Einheiten', () => {
    const s = exposeV2ToolSchema() as any;
    expect(Object.keys(s.properties)).toEqual(['angaben', 'einheiten_tabellen', 'einheiten_im_dokument', 'einheiten_vollstaendig']);
    const pfad = s.properties.angaben.items.properties.pfad;
    expect(JSON.stringify(pfad)).toContain('preise.kaufpreis');
    expect(KATALOG_PFADE.length).toBeGreaterThan(150);
    expect(Object.keys((exposeV2ToolSchema(true) as any).properties)).toEqual(['einheiten_tabellen', 'einheiten_im_dokument', 'einheiten_vollstaendig']);
  });

  it('Bereinigen: unbekannte Pfade/Ziele → null, leere Werte fallen weg, Zeilen auf Spaltenzahl, nichts gekürzt', () => {
    const lang = 'x'.repeat(8000);
    const { v2, warnungen } = exposeV2Bereinigen({
      angaben: [
        { bezeichnung: 'Lage', wert: lang, seite: 2, pfad: 'freitexte.lage', kontakt: null, gg: 'objekt.lagebeschreibung' },
        { bezeichnung: 'X', wert: '  ', seite: 1, pfad: null },
        { bezeichnung: '', wert: 12, seite: '3', pfad: 'erfunden.pfad', kontakt: 0, gg: 'nix' },
      ],
      einheiten_tabellen: [{ seite: 4, titel: null, spalten: [{ ueberschrift: 'Lage', feld: 'lage' }, { ueberschrift: 'NKM', feld: 'falsch' }], zeilen: [['EG', '700 €', 'zu viel'], ['', ''], ['OG']] }],
      einheiten_im_dokument: 2,
    });
    expect(v2.schema).toBe(EXPOSE_V2_SCHEMA);
    expect(v2.angaben).toHaveLength(2);
    expect(v2.angaben[0]!.wert).toHaveLength(8000);
    expect(v2.angaben[1]).toEqual({ bezeichnung: 'Angabe', wert: '12', seite: null, pfad: null, kontakt: null, gg: null });
    expect(warnungen).toEqual(['Unbekannter Standard-Pfad „erfunden.pfad“ → ohne Pfad']);
    expect(v2.einheiten_tabellen[0]!.spalten[1]!.feld).toBeNull();
    expect(v2.einheiten_tabellen[0]!.zeilen).toEqual([['EG', '700 €'], ['OG', '']]);
    expect(v2.einheiten_vollstaendig).toBe(true);
  });
});
