/**
 * Archiv-Spiegel: was ein Lauf tun WÜRDE — rein und ohne IO. Übernommen aus `server/archive-mirror.ts` der alten App.
 *
 * Die Sicherung (`sicherung/aufbewahrung.ts`) deckt die Tabellen ab; von Fotos, Exposés und Dokumenten wandern dabei
 * nur die Zeilen mit. Die Bytes selbst standen in keiner Sicherung: was jemand in der App löscht, war endgültig weg.
 * Der Spiegel kopiert, was im Archiv fehlt oder sich geändert hat, und **löscht dort niemals etwas**.
 *
 * Die Festlegungen, die nicht Geschmackssache sind:
 *  1. Der Arbeitsplan entsteht in JEDEM Lauf neu aus dem Vergleich „Bucket gegen Buch" — kein Fortsetzungszeiger, der
 *     nach einem Abbruch auf die falsche Stelle zeigen und Dateien überspringen könnte.
 *  2. Verschwundenes bleibt im Archiv und bekommt einen Zeitpunkt. Gemeldet wird nur, was auch gelistet wurde.
 *  3. Wird eine Datei in der Quelle ersetzt, wandert die Archivfassung nach `_superseded/…` statt überschrieben zu werden.
 *  4. Geändert heißt: andere Größe ODER andere Kennung/anderer Zeitstempel. Die Größe allein übersähe eine Änderung
 *     gleicher Länge, der Zeitstempel allein eine abgeschnittene Übertragung.
 */
export const ERSETZT_PRAEFIX = '_superseded';
/** Abgebrochene Direkt-Uploads: kein Bestand, gehört nicht ins Archiv (der Aufräumlauf nimmt sie mit). */
export const EINGANG_PRAEFIX = '_eingang/';

export const archivSchluessel = (bucket: string, key: string) => `${bucket}/${key}`;

/** Wohin die alte Fassung wandert. Zeitstempel hinten und in fester Breite: mehrere Fassungen stehen chronologisch. */
export function ersetztSchluessel(bucket: string, key: string, ts: Date): string {
  const iso = ts.toISOString();
  return `${ERSETZT_PRAEFIX}/${bucket}/${key}.${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

export interface QuellObjekt { key: string; groesse: number; /** Zeitstempel + Kennung der Quelle, als eine Zeichenkette */ stand: string }
export interface BuchZeile { key: string; groesse: number | null; stand: string | null; verschwundenSeit: number | null }

export interface SpiegelAufgabe { bucket: string; key: string; archivKey: string; groesse: number; stand: string; art: 'neu' | 'geändert' }
export interface BucketPlan { bucket: string; aufgaben: SpiegelAufgabe[]; verschwunden: string[]; zurueck: string[]; unveraendert: number }

export function spiegelPlanen(bucket: string, objekte: QuellObjekt[], buch: BuchZeile[]): BucketPlan {
  const jeKey = new Map(buch.map((z) => [z.key, z]));
  const plan: BucketPlan = { bucket, aufgaben: [], verschwunden: [], zurueck: [], unveraendert: 0 };
  const vorhanden = new Set<string>();
  for (const o of objekte) {
    if (o.key.startsWith(EINGANG_PRAEFIX)) continue;
    vorhanden.add(o.key);
    const zeile = jeKey.get(o.key);
    // Wieder aufgetaucht — unabhängig davon vermerkt, ob neu gespiegelt werden muss: sonst stünde im Buch weiter
    // „seit gestern weg" bei einer Datei, die längst wieder da ist.
    if (zeile && zeile.verschwundenSeit !== null) plan.zurueck.push(o.key);
    const aufgabe = (art: SpiegelAufgabe['art']): SpiegelAufgabe => ({ bucket, key: o.key, archivKey: archivSchluessel(bucket, o.key), groesse: o.groesse, stand: o.stand, art });
    if (!zeile) plan.aufgaben.push(aufgabe('neu'));
    else if (zeile.groesse !== o.groesse || zeile.stand !== o.stand) plan.aufgaben.push(aufgabe('geändert'));
    else plan.unveraendert++;
  }
  for (const z of buch) if (z.verschwundenSeit === null && !vorhanden.has(z.key)) plan.verschwunden.push(z.key);
  return plan;
}

export interface SpiegelBudget { maxBytes: number; maxMillis: number; maxObjekte: number }
/** Die Function hat 300 s; der Rest ist Luft für die Datei, die beim Erreichen der Grenze gerade läuft. */
export const SPIEGEL_BUDGET: SpiegelBudget = { maxBytes: 512 * 1024 * 1024, maxMillis: 210_000, maxObjekte: 400 };
export type SpiegelEnde = 'fertig' | 'zeitbudget' | 'datenbudget' | 'objektbudget';

/**
 * Wird VOR jeder Datei gefragt, nie danach. Eine Datei, die größer ist als das ganze Budget, wird trotzdem kopiert,
 * solange sie die erste ist — sonst bliebe sie für immer liegen und der Spiegel wäre dauerhaft unvollständig,
 * ohne dass irgendetwas fehlschlägt.
 */
export function budgetErschoepft(b: SpiegelBudget, stand: { bytes: number; objekte: number; millis: number }, naechste: number): SpiegelEnde | null {
  if (stand.millis >= b.maxMillis) return 'zeitbudget';
  if (stand.objekte >= b.maxObjekte) return 'objektbudget';
  if (stand.objekte > 0 && stand.bytes + naechste > b.maxBytes) return 'datenbudget';
  return null;
}

/** Abgebrochene Uploads: älter als ein Tag. Ohne lesbaren Zeitpunkt bleibt die Datei liegen — im Zweifel nicht löschen. */
export const EINGANG_MAX_ALTER_MS = 24 * 60 * 60 * 1000;
export function eingangAbgelaufen(geaendert: string, jetzt: number): boolean {
  const t = Date.parse(geaendert);
  return Number.isFinite(t) && jetzt - t > EINGANG_MAX_ALTER_MS;
}
