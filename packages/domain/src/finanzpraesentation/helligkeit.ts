/**
 * „✨ Helligkeit“ der Bank-Präsentation: automatische Tonwertkorrektur (Auto-Levels), keine KI.
 * Rechenweg wörtlich nach autoEnhanceBrightness (gg-immohandel src/lib/photoStorage.ts); das Laden und Zurückschreiben
 * des Bildes übernimmt die Oberfläche (Canvas), hier steht nur die Rechnung auf den Bildpunkten.
 */
export const HELLIGKEIT_MAX_BREITE = 1280;
export const HELLIGKEIT_QUALITAET = 0.85;
export const HELLIGKEIT_KNOPF = '✨ Helligkeit';
export const HELLIGKEIT_TITEL = 'Helligkeit automatisch optimieren (Auto-Levels)';
export const HELLIGKEIT_LAEUFT = '⏳ Helligkeit wird optimiert…';
export const HELLIGKEIT_FERTIG = '✨ Helligkeit optimiert';
export const HELLIGKEIT_OHNE_OBJEKT = '❌ Kein Objekt mit Deal verknüpft';
export const helligkeitFehlerHinweis = (grund: string) => `❌ Helligkeit-Optimierung fehlgeschlagen: ${grund}`;

/**
 * Korrigiert RGBA-Bildpunkte an Ort und Stelle:
 *  1. Helligkeits-Histogramm (Y = 0,299 R + 0,587 G + 0,114 B)
 *  2. Unter- und Obergrenze beim 1. und 99. Perzentil — einzelne Ausreißer zählen nicht
 *  3. lineare Streckung auf 0…255 und sanfte Gamma-Korrektur (1/1,05)
 * `false`, wenn es nichts zu strecken gibt (einfarbiges Bild); die Deckkraft bleibt unberührt.
 */
export function helligkeitKorrigieren(daten: Uint8ClampedArray): boolean {
  const hist = new Uint32Array(256);
  const total = daten.length / 4;
  for (let i = 0; i < daten.length; i += 4) {
    const y = (daten[i]! * 0.299 + daten[i + 1]! * 0.587 + daten[i + 2]! * 0.114) | 0;
    hist[y]!++;
  }
  const lowCount = total * 0.01;
  const highCount = total * 0.99;
  let cum = 0; let minY = 0; let maxY = 255;
  for (let i = 0; i < 256; i++) { cum += hist[i]!; if (cum >= lowCount) { minY = i; break; } }
  cum = 0;
  for (let i = 0; i < 256; i++) { cum += hist[i]!; if (cum >= highCount) { maxY = i; break; } }
  if (maxY <= minY) return false;
  const range = maxY - minY;
  const gamma = 1 / 1.05;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const v = Math.max(0, Math.min(1, (i - minY) / range));
    lut[i] = Math.round(Math.pow(v, gamma) * 255);
  }
  for (let i = 0; i < daten.length; i += 4) {
    daten[i] = lut[daten[i]!]!;
    daten[i + 1] = lut[daten[i + 1]!]!;
    daten[i + 2] = lut[daten[i + 2]!]!;
  }
  return true;
}
