// Auto-Tonwertkorrektur der Bank-Präsentation (nach autoEnhanceBrightness, gg-immohandel src/lib/photoStorage.ts)
import { describe, expect, it } from 'vitest';
import { helligkeitKorrigieren } from '../src/finanzpraesentation/helligkeit.ts';

/** Graustufenbild als RGBA: je Wert ein Bildpunkt, Deckkraft 200. */
const bild = (werte: number[]) => new Uint8ClampedArray(werte.flatMap((w) => [w, w, w, 200]));
const grau = (daten: Uint8ClampedArray) => Array.from({ length: daten.length / 4 }, (_, i) => daten[i * 4]!);

describe('Helligkeit (Auto-Levels)', () => {
  it('streckt ein flaues Bild auf den vollen Bereich und hellt die Mitten leicht auf', () => {
    const daten = bild([40, 80, 120]);
    expect(helligkeitKorrigieren(daten)).toBe(true);
    // 80 liegt in der Mitte von 40…120 → 0,5 hoch (1/1,05) × 255 = 132
    expect(grau(daten)).toEqual([0, 132, 255]);
  });

  it('lässt die Deckkraft unberührt und korrigiert alle drei Farbkanäle über dieselbe Kurve', () => {
    const daten = new Uint8ClampedArray([40, 80, 120, 77, 120, 120, 120, 99, 40, 40, 40, 55]);
    helligkeitKorrigieren(daten);
    expect(Array.from(daten)).toEqual([0, 132, 255, 77, 255, 255, 255, 99, 0, 0, 0, 55]);
  });

  it('einzelne Ausreißer (unter 1 % der Bildpunkte) bestimmen den Bereich nicht', () => {
    const werte = [...Array(5).fill(0), ...Array(495).fill(50), ...Array(495).fill(200), ...Array(5).fill(255)];
    const daten = bild(werte);
    helligkeitKorrigieren(daten);
    const neu = grau(daten);
    expect([neu[0], neu[5], neu[500], neu[999]]).toEqual([0, 0, 255, 255]);
  });

  it('ein einfarbiges Bild bleibt, wie es ist', () => {
    const daten = bild([90, 90, 90, 90]);
    expect(helligkeitKorrigieren(daten)).toBe(false);
    expect(grau(daten)).toEqual([90, 90, 90, 90]);
  });
});
