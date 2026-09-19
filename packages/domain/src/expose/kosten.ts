/**
 * Kostenschätzung vor dem Exposé-Import (expose-wizard estimateFile): ~150 KB je Seite, ~1.500 Token je Seite
 * + 2.000 Token Prompt, 2.500 Token Antwort, Sonnet-Preise 3 $/15 $ je Million, 0,92 €/$.
 */
export function exposeKostenSchaetzung(dateigroesseBytes: number): { seiten: number; eur: number } {
  const seiten = Math.max(1, Math.round(dateigroesseBytes / 150_000));
  const ein = seiten * 1500 + 2000;
  return { seiten, eur: ((ein * 3 + 2500 * 15) / 1_000_000) * 0.92 };
}

/** Ab 3 Dateien oder mehr als 0,30 € muss die Schätzung bestätigt werden. */
export const exposeKostenBestaetigen = (dateien: number, eur: number) => dateien >= 3 || eur > 0.3;
