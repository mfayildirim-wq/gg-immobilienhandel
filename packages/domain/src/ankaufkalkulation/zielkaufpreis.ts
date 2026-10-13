/**
 * Kaufpreis rückwärts aus einer Zielmarge: „Was dürfen wir höchstens zahlen, damit die Aufteilerkalkulation 15 %
 * bzw. die Globalkalkulation 20 % Marge zeigt?“ — Neuerung gegenüber der alten App (dort gibt es das nicht).
 *
 * Keine eigene Kostenformel: Die GIK hängt in `berechneAnkauf` linear vom Kaufpreis ab (Nebenkosten in % vom
 * Kaufpreis, Finanzierung als fester Faktor auf die Kosten). Zwei Rechnungen mit dem bestehenden Rechenkern liefern
 * Achsenabschnitt und Steigung, daraus folgt der Kaufpreis. So bleibt der Rechenkern (Golden Master) unberührt und
 * Sanierung, Puffer, Provision und Mietabzug sind automatisch mit drin.
 *
 * Verkaufspreis je Exit-Weg:
 *  - Aufteiler: Summe der Einheiten-Verkaufspreise (wie in der Kalkulation, unabhängig vom Kaufpreis)
 *  - Global: Jahresnettokaltmiete SOLL ÷ Soll-Rendite (5 % → Faktor 20). Die Global-Box der Kalkulation rechnet
 *    weiter mit GIK × (1 + Ziel-Marge); dort hinge die Marge gar nicht vom Kaufpreis ab.
 * Marge jeweils auf den Verkaufspreis, wie „Marge auf Verkaufserlöse“ in der Kalkulation.
 */
import { berechneAnkauf, type EinheitEingabe, KALK_STANDARD, type KalkStandard, type KalkWerte, type SanierungEingabe } from './engine.ts';

export type ZielWeg = 'aufteiler' | 'global';

/** Werkseinstellung der Zielwerte; eigene Werte über die Einstellungen (`ziel_auf`, `ziel_glo`, `rend_glo`). */
export const ZIEL_STANDARD = { ziel_auf: KALK_STANDARD.ziel_auf, ziel_glo: KALK_STANDARD.ziel_glo, rend_glo: KALK_STANDARD.rend_glo };

export type ZielKaufpreis =
  | { ok: true; kaufpreis: number; verkaufspreis: number; gik: number; marge: number }
  | { ok: false; grund: string };

/** Zielwerte eines Deals: eigener Wert in der Kalkulation, sonst Standard aus den Einstellungen, sonst Werkseinstellung. */
export function zielWerte(k: KalkWerte, D: Partial<KalkStandard> = KALK_STANDARD) {
  const w = (feld: keyof typeof ZIEL_STANDARD) => {
    const v = k[feld];
    return typeof v === 'number' && Number.isFinite(v) ? v : (D[feld] ?? ZIEL_STANDARD[feld]);
  };
  return { margeAufteiler: w('ziel_auf'), margeGlobal: w('ziel_glo'), sollRenditeGlobal: w('rend_glo') };
}

/** Verkaufspreis Global aus der Soll-Rendite: Jahresnettokaltmiete SOLL ÷ Rendite. */
export const verkaufspreisAusRendite = (jahresmieteSoll: number, sollRendite: number) =>
  sollRendite > 0 ? Math.round(jahresmieteSoll / (sollRendite / 100)) : 0;

/** Ergebnis Global, wenn zur Soll-Rendite verkauft wird (Zusatzzeile der Global-Box). */
export function globalBeiSollRendite(gik: number, jahresmieteSoll: number, sollRendite: number) {
  const verkaufspreis = verkaufspreisAusRendite(jahresmieteSoll, sollRendite);
  const gewinn = verkaufspreis - gik;
  return { verkaufspreis, gewinn, marge: verkaufspreis ? (gewinn / verkaufspreis) * 100 : 0, faktor: sollRendite > 0 ? 100 / sollRendite : 0 };
}

export function zielKaufpreis(
  weg: ZielWeg,
  k: KalkWerte,
  einheiten: readonly EinheitEingabe[],
  sanierungen: readonly SanierungEingabe[],
  D: KalkStandard = KALK_STANDARD,
): ZielKaufpreis {
  const ziel = zielWerte(k, D);
  const zielMarge = weg === 'aufteiler' ? ziel.margeAufteiler : ziel.margeGlobal;
  if (!(zielMarge < 100)) return { ok: false, grund: 'Die Zielmarge muss unter 100 % liegen.' };

  const rechne = (kaufpreis: number) => berechneAnkauf({ ...k, kaufpreis }, einheiten, sanierungen, D);
  const gikBei = (kaufpreis: number) => (weg === 'aufteiler' ? rechne(kaufpreis).aufteiler.gik : rechne(kaufpreis).global.gik);

  const ohneKaufpreis = rechne(0);
  const verkaufspreis = weg === 'aufteiler'
    ? ohneKaufpreis.aufteiler.verkaufspreis
    : verkaufspreisAusRendite(ohneKaufpreis.jahresnettokaltmieteSoll, ziel.sollRenditeGlobal);
  if (!verkaufspreis) {
    return {
      ok: false,
      grund: weg === 'aufteiler'
        ? 'Keine Verkaufspreise der Einheiten — erst Miete und Rendite (oder VKP) der Einheiten erfassen.'
        : 'Keine Soll-Miete (oder Soll-Rendite 0) — erst die Mieten der Einheiten erfassen.',
    };
  }

  const gik0 = gikBei(0);
  const steigung = gikBei(1_000_000) - gik0; // GIK je 1 Mio. € Kaufpreis
  if (!(steigung > 0)) return { ok: false, grund: 'Mit diesen Finanzierungswerten lässt sich der Kaufpreis nicht zurückrechnen.' };

  const zielGik = verkaufspreis * (1 - zielMarge / 100);
  // Abrunden auf volle Euro: die Marge liegt dann nie unter dem Ziel, höchstens um Bruchteile eines Cents darüber
  const kaufpreis = Math.floor(((zielGik - gik0) / steigung) * 1_000_000);
  if (kaufpreis <= 0) {
    return { ok: false, grund: `Schon ohne Kaufpreis liegt die Marge unter ${zielMarge.toLocaleString('de-DE')} % — die übrigen Kosten sind zu hoch.` };
  }
  const gik = gikBei(kaufpreis);
  return { ok: true, kaufpreis, verkaufspreis, gik, marge: ((verkaufspreis - gik) / verkaufspreis) * 100 };
}
