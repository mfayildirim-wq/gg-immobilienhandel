import type { KundenkalkulationDaten } from './bearbeitung.ts';
import { betrachtungsdauer, kaufpreisGesamt, nebenkostenAnteilAusEuro } from './bearbeitung.ts';
import { parseNum } from '../zahlen.ts';

/** Eingabefelder, die in Prozent angezeigt und als Bruchteil gespeichert werden. */
export const KK_PROZENTFELDER = [
  'notarPct', 'grundbuchPct', 'grundsteuerPct', 'maklerPct', 'sonstigePct', 'mieterhoehungJaehrlich',
  'kostensteigerungJaehrlich', 'wertsteigerungJaehrlich', 'afaSatz', 'anteilGebaeudeKaufpreis', 'grenzsteuersatz',
] as const;

type Stand = Pick<KundenkalkulationDaten, 'inputs' | 'kaufpreisWohnung' | 'kaufpreisStellplatz' | 'stellplaetzeAnzahl' | 'objSnapshot'>;

/**
 * Ein Eingabefeld ändern wie kkalkUpdateField: Kaufpreis-Splitting, Stellplätze, Betrachtungsdauer (ganze Jahre 1–50),
 * Mietfläche (Engine + Anzeige), Nebenkosten als € (`<feld>__eur`), Prozentfelder, sonst Zahl direkt.
 * Eingabe als Text wie im Formular (deutsche Schreibweise).
 */
export function kundenkalkFeldSetzen<T extends Stand>(k: T, feld: string, text: string | number): T {
  const wert = typeof text === 'number' ? text : parseNum(text);
  const n: T = { ...k, inputs: { ...k.inputs }, objSnapshot: { ...k.objSnapshot } };
  switch (feld) {
    case 'kaufpreisWohnung':
      n.kaufpreisWohnung = wert;
      n.kaufpreisStellplatz ??= 0;
      n.inputs.kaufpreis = kaufpreisGesamt(n.kaufpreisWohnung, n.kaufpreisStellplatz);
      return n;
    case 'kaufpreisStellplatz':
      n.kaufpreisStellplatz = wert;
      n.kaufpreisWohnung ??= k.inputs.kaufpreis || 0;
      n.inputs.kaufpreis = kaufpreisGesamt(n.kaufpreisWohnung, n.kaufpreisStellplatz);
      return n;
    case 'stellplaetzeAnzahl':
      n.stellplaetzeAnzahl = Math.max(0, Math.round(wert));
      return n;
    case 'betrachtungsdauerJahre':
      n.inputs.betrachtungsdauerJahre = betrachtungsdauer(wert);
      return n;
    case 'mietflaeche':
      n.inputs.wohnflaecheGesamt = Math.max(0, wert);
      n.objSnapshot.wohnflaecheGesamt = Math.max(0, wert);
      return n;
  }
  if (feld.endsWith('__eur')) {
    (n.inputs as unknown as Record<string, number>)[feld.slice(0, -5)] = nebenkostenAnteilAusEuro(wert, k.inputs.kaufpreis || 0);
    return n;
  }
  (n.inputs as unknown as Record<string, number>)[feld] = (KK_PROZENTFELDER as readonly string[]).includes(feld) ? wert / 100 : wert;
  return n;
}
