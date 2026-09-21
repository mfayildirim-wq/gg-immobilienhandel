import type { KalkStandard } from './engine.ts';

/**
 * Fehlende Kalkulationsfelder aus den Standardwerten vorbelegen — `ensure()` aus `dealKalkHTML` der alten App
 * („Settings-Defaults bilden IMMER die Basis", 05.05.2026). Die alte App tut das beim Öffnen eines Deals und rechnet
 * erst danach; der Rechenkern (`berechneAnkauf`) selbst kennt für den Risikopuffer nur die wörtliche `10`.
 *
 * Ohne diesen Schritt rechnet der Neubau bei einem gespeicherten Standard-Puffer von 0 % mit 10 %: die
 * Parallelprüfung fand das am 21.09.2026 mit dem echten Bestand (16.500 € statt 15.000 € Sanierung). Mit den
 * ausgelieferten Standards fällt es nie auf — dort sind beide Werte gleich.
 *
 * Bewusst NICHT im Rechenkern: der ist gegen den Golden Master der alten Rechenfunktion festgeschrieben.
 */
const VORBELEGTE_FELDER = ['notar', 'gest', 'makler', 'fk_p', 'ek_p', 'euribor', 'margeB', 'bank_abgeb', 'ek_r', 'halt', 'vprov', 'glo_m', 'rp_pct', 'auf_h', 'auf_e'] as const satisfies readonly (keyof KalkStandard)[];

export function kalkMitStandard<K extends object>(kalk: K, standard: KalkStandard): K {
  const k = { ...kalk } as Record<string, unknown>;
  for (const feld of VORBELEGTE_FELDER) {
    if (k[feld] === undefined || k[feld] === null || k[feld] === '') k[feld] = standard[feld];
  }
  return k as K;
}
