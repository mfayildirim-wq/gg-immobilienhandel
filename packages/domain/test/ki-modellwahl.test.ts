import { describe, expect, it } from 'vitest';
import { KI_BEREICHE, KI_MODELLE, KI_MODELLWAHL_STANDARD, kiModellFuer, kiModellwahlBereinigen } from '../src/ki/modellwahl.ts';

describe('KI-Modellwahl je Bereich', () => {
  it('ohne Einstellung bleibt jeder Bereich beim fest hinterlegten Modell', () => {
    const wahl = kiModellwahlBereinigen(null);
    expect(wahl).toEqual(KI_MODELLWAHL_STANDARD);
    for (const b of KI_BEREICHE) expect(kiModellFuer(wahl, b.id)).toBeNull();
  });

  it('übernimmt bekannte Modelle, Unbekanntes und Fremdes fällt auf „standard“ zurück', () => {
    const wahl = kiModellwahlBereinigen({ praesentation: 'claude-sonnet-5-5', expose: 'gpt-9', makler: 42, fremd: 'claude-opus-5-5' });
    expect(wahl).toEqual({ ...KI_MODELLWAHL_STANDARD, praesentation: 'claude-sonnet-5-5' });
    expect(kiModellFuer(wahl, 'praesentation')).toBe('claude-sonnet-5-5');
    expect(kiModellFuer(wahl, 'expose')).toBeNull();
  });

  it('bietet die Modelle mit eindeutiger Kennung an', () => {
    const ids = KI_MODELLE.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('claude-haiku-4-5-20251001');
  });
});
