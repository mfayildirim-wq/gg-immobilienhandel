import { describe, expect, it } from 'vitest';
import { belegePruefen, vergleichsText } from '../src/index.ts';
import { BEISPIEL_SEITEN, exposeV2Beispiel } from './fixtures/expose-v2-beispiel.ts';

describe('Exposé v2: Belegprüfung (Protokoll 28)', () => {
  it('Wert auf der genannten Seite → belegt; andere Seite → belegt und berichtigt; fehlt → nicht belegt', () => {
    const v2 = exposeV2Beispiel();
    v2.angaben[6]!.seite = 1; // Wohnfläche steht auf Seite 2
    const r = belegePruefen(v2, BEISPIEL_SEITEN);
    expect(r.belegt[2]).toBe(true); // Kaufpreis S. 1
    expect(r.belegt[6]).toBe(true);
    expect(r.seiteBerichtigt[6]).toBe(2);
    expect(r.belegt[20]).toBe(false); // zweiter Kaufpreis S. 5 fehlt im Text
    expect(r.quote).toBeGreaterThan(0);
  });

  it('ohne Textlayer bleibt alles offen', () => {
    const r = belegePruefen(exposeV2Beispiel(), []);
    expect(r.belegt.every((b) => b === null)).toBe(true);
    expect(r.quote).toBeNull();
  });

  it('Vergleich ignoriert Leerraum, Trennstriche, Anführungszeichen', () => {
    expect(vergleichsText('„Gas‑ Zentral heizung“')).toBe('gas-zentralheizung');
  });
});
