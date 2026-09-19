/** Papierkorb: Bezeichnung, Restlaufzeit, Gruppen, Frist (nach trash.ts/trash-ui.ts der alten App). */
import { describe, expect, it } from 'vitest';
import { papierkorbAbgelaufen, papierkorbBezeichnung, papierkorbGruppen, papierkorbRestTage, papierkorbZeile, PAPIERKORB_TAGE } from '../src/index.ts';

const tage = (n: number) => new Date(Date.UTC(2026, 8, 17, 12) - n * 86_400_000).toISOString();
const jetzt = Date.UTC(2026, 8, 17, 12);

describe('Papierkorb', () => {
  it('Bezeichnung: erstes gefülltes Feld, sonst Kennung', () => {
    expect(papierkorbBezeichnung([null, '  ', 'Hauptstraße 1'], 'x')).toBe('Hauptstraße 1');
    expect(papierkorbBezeichnung([undefined, null], 'o1')).toBe('ohne Namen (o1)');
  });

  it('Restlaufzeit zählt angebrochene Tage und wird nicht negativ', () => {
    expect(papierkorbRestTage(tage(0), jetzt)).toBe(PAPIERKORB_TAGE);
    expect(papierkorbRestTage(tage(1), jetzt)).toBe(29);
    expect(papierkorbRestTage(tage(29.5), jetzt)).toBe(1);
    expect(papierkorbRestTage(tage(45), jetzt)).toBe(0);
  });

  it('Zeile warnt ab drei Tagen Restlaufzeit', () => {
    const z = papierkorbZeile({ bereich: 'deals', id: 'd1', bezeichnung: 'Weg 1', geloeschtAm: tage(28) }, jetzt);
    expect(z).toMatchObject({ tage: 2, dringend: true });
    expect(z.text).toBe('gelöscht am 20.8.2026 · noch 2 Tage');
    expect(papierkorbZeile({ bereich: 'deals', id: 'd2', bezeichnung: 'Weg 2', geloeschtAm: tage(29) }, jetzt).text).toMatch(/noch 1 Tag$/);
    expect(papierkorbZeile({ bereich: 'deals', id: 'd3', bezeichnung: 'Weg 3', geloeschtAm: tage(0) }, jetzt).dringend).toBe(false);
  });

  it('Gruppen folgen dem neuesten Eintrag, innerhalb neueste zuerst', () => {
    const g = papierkorbGruppen([
      { bereich: 'deals', id: 'd1', bezeichnung: 'Alt', geloeschtAm: tage(10) },
      { bereich: 'objekte', id: 'o1', bezeichnung: 'Objekt', geloeschtAm: tage(5) },
      { bereich: 'deals', id: 'd2', bezeichnung: 'Neu', geloeschtAm: tage(1) },
    ], jetzt);
    expect(g.map((x) => x.label)).toEqual(['Deals', 'Objekte']);
    expect(g[0]!.eintraege.map((e) => e.bezeichnung)).toEqual(['Neu', 'Alt']);
  });

  it('Frist: älter als 30 Tage wird endgültig entfernt', () => {
    expect(papierkorbAbgelaufen(tage(29), jetzt)).toBe(false);
    expect(papierkorbAbgelaufen(tage(31), jetzt)).toBe(true);
  });
});
