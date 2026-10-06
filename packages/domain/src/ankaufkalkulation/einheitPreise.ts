import type { EinheitDaten } from './engine.ts';

/** Welches der drei Verkaufspreis-Felder einer Einheit gerade eingegeben wurde. */
export type PreisFeld = 'rendite' | 'vkp' | 'kpm2';

/** Miete SOLL der Einheit (Monat): von Hand gesetzt, sonst die IST-Miete — wie im Rechenkern. */
const mieteSoll = (e: EinheitDaten) => (e.mieteNeuManuell ? e.mieteNeu ?? 0 : e.mieteIst ?? 0);
/** Rendite aus Jahresmiete und VKP, auf eine Nachkommastelle (alt: +(mn*12/vkp*100).toFixed(1)). */
const renditeAus = (e: EinheitDaten, vkp: number) => {
  const mn = mieteSoll(e);
  return mn && vkp ? +(((mn * 12) / vkp) * 100).toFixed(1) : e.renditeK;
};

/**
 * Rendite %, VKP € und KP/m² einer Einheit hängen zusammen: Wer eines davon eingibt, bekommt die beiden anderen errechnet.
 * Nach dealUEDirect (Rendite → manueller VKP fällt weg, VKP folgt aus der Rendite), dealUEFromVkp (VKP → Rendite) und
 * dealUEFromKpm2 (KP/m² → VKP = KP/m² × Fläche → Rendite) der alten App. KP/m² selbst wird nicht gespeichert, der
 * Rechenkern bildet es aus VKP und Fläche. Ohne Fläche (Stellplatz) bleibt eine KP/m²-Eingabe ohne Wirkung.
 */
export function einheitPreisSetzen(e: EinheitDaten, feld: PreisFeld, wert: number | null): Pick<EinheitDaten, 'renditeK' | 'verkaufspreis'> {
  if (feld === 'rendite') return { renditeK: wert, verkaufspreis: null };
  if (feld === 'vkp') {
    const vkp = wert ? Math.round(wert) : null;
    return { renditeK: vkp ? renditeAus(e, vkp) : e.renditeK, verkaufspreis: vkp };
  }
  const fl = e.typ === 'Stellplatz' ? 0 : e.flaeche ?? 0;
  if (!fl) return { renditeK: e.renditeK, verkaufspreis: e.verkaufspreis };
  if (!wert) return { renditeK: e.renditeK, verkaufspreis: null };
  const vkp = Math.round(wert * fl);
  return { renditeK: renditeAus(e, vkp), verkaufspreis: vkp };
}

/**
 * Miete geändert: Steht ein VKP fest, wird die Rendite aus der neuen Miete neu errechnet, damit die drei Werte
 * zusammenpassen. Fachentscheidung 06.10.2026 — die alte App ließ die Rendite dann veraltet stehen.
 */
export function einheitMieteGeaendert<T extends EinheitDaten>(e: T): T {
  if (!e.verkaufspreis || !mieteSoll(e)) return e;
  return { ...e, renditeK: renditeAus(e, e.verkaufspreis) };
}
