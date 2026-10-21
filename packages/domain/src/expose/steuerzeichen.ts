/**
 * Manche PDFs codieren Aufzählungspunkte als Nullzeichen (U+0000) — so das McMakler-Exposé Pfaudlerstraße („Objekt ID␀“,
 * „␀ Zwei Mehrfamilienhäuser …“). Postgres nimmt U+0000 in Text und JSON nicht an (22P05), das Speichern der Analyse
 * scheiterte. Hier werden solche Zeichen vor dem Speichern bereinigt: ein Nullzeichen zwischen Wörtern wird zum
 * Aufzählungspunkt, am Rand fällt es weg; andere Steuerzeichen (außer Tab und Zeilenumbruch) fallen weg.
 */
// eslint-disable-next-line no-control-regex
const STEUER = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function textBereinigen(s: string): string {
  if (!s.includes('\u0000') && !STEUER.test(s)) return s;
  STEUER.lastIndex = 0;
  return s
    .replace(STEUER, '')
    .replace(/^[\s\u0000]+|[\s\u0000]+$/g, (rand) => rand.replace(/\u0000/g, ''))
    .replace(/\s*\u0000+\s*/g, ' • ')
    .trim();
}

/** Bereinigt alle Texte in einem Wert (Objekte, Listen) — Schlüssel eingeschlossen */
export function steuerzeichenEntfernen<T>(wert: T): T {
  if (typeof wert === 'string') return textBereinigen(wert) as T;
  if (Array.isArray(wert)) return wert.map((x) => steuerzeichenEntfernen(x)) as T;
  if (wert && typeof wert === 'object') return Object.fromEntries(Object.entries(wert).map(([k, v]) => [textBereinigen(k), steuerzeichenEntfernen(v)])) as T;
  return wert;
}
