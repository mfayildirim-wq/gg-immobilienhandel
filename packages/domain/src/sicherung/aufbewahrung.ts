/**
 * Automatische Sicherungen: Dateiname, Stufe und Aufbewahrung — rein und ohne IO.
 * Übernommen aus `server/backup.ts` der alten App (Ticket 015); die Regel ist der gefährlichste Teil einer Sicherung
 * und muss ohne Bucket prüfbar sein.
 *
 * `safety` ist keine Großvater-Vater-Sohn-Stufe, sondern die Kopie vor einem riskanten Schritt (Wiederherstellen).
 * Sie hat einen eigenen Topf: läge sie bei `daily`, verdrängten drei Wiederherstellungsversuche hintereinander die
 * echten Tagessicherungen — ausgerechnet die, die man danach braucht.
 */
export const AUFBEWAHRUNG = { daily: 7, weekly: 4, monthly: 3, safety: 3 } as const;
export type SicherungsStufe = keyof typeof AUFBEWAHRUNG;

/** Die Kennzahlen, die im Dateinamen stehen — damit die Liste ohne einen einzigen Download auskommt. */
export interface SicherungsZahlen { deals: number; objekte: number; makler: number; zeilen: number }

export interface SicherungsKopf { key: string; stufe: SicherungsStufe; /** ISO-8601 in UTC */ ts: string; zahlen: SicherungsZahlen }
export interface SicherungsEintrag extends SicherungsKopf { groesseBytes: number }

// sicherung-2026-09-21-010000-daily-273d-285o-141m-9120z.json
// Zeitanteil in UTC und mit fester Breite: die alphabetische Reihenfolge des Buckets ist die zeitliche.
const SCHLUESSEL = /^sicherung-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})(\d{2})-([a-z]+)-(\d+)d-(\d+)o-(\d+)m-(\d+)z\.json$/;

export function sicherungSchluessel(ts: Date, stufe: SicherungsStufe, z: SicherungsZahlen): string {
  const iso = ts.toISOString();
  return `sicherung-${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, '')}-${stufe}-${z.deals}d-${z.objekte}o-${z.makler}m-${z.zeilen}z.json`;
}

/** `null` für alles, was nicht dem Muster entspricht — solche Objekte fasst die Aufbewahrung nie an. */
export function sicherungSchluesselLesen(key: string): SicherungsKopf | null {
  const m = SCHLUESSEL.exec(key);
  if (!m || !(m[5]! in AUFBEWAHRUNG)) return null;
  const ts = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.000Z`;
  if (Number.isNaN(Date.parse(ts))) return null;
  return { key, ts, stufe: m[5] as SicherungsStufe, zahlen: { deals: +m[6]!, objekte: +m[7]!, makler: +m[8]!, zeilen: +m[9]! } };
}

/**
 * Welche Stufe der tägliche Lauf erzeugt: am Monatsersten monatlich, montags wöchentlich, sonst täglich. Die stärkste
 * Stufe gewinnt, damit ein Monatserster, der auf einen Montag fällt, die Monatsstufe nicht verliert. Bezugszeit ist UTC.
 */
export function geplanteStufe(jetzt: Date): SicherungsStufe {
  if (jetzt.getUTCDate() === 1) return 'monthly';
  if (jetzt.getUTCDay() === 1) return 'weekly';
  return 'daily';
}

export interface AufbewahrungsPlan { behalten: SicherungsEintrag[]; entfernen: SicherungsEintrag[]; hinweise: string[] }

/**
 * Die Richtung ist entscheidend: erst die Behalten-Menge bilden, dann alles Übrige entfernen. Umgekehrt („alles über
 * der Grenze weg") wäre eine leere oder unvollständige Liste gleichbedeutend mit „alles ist überzählig".
 * Der jüngste Stand bleibt IMMER — auch wenn seine Stufe voll ist oder eine Obergrenze auf 0 stünde.
 */
export function aufbewahrungPlanen(eintraege: SicherungsEintrag[], grenzen: Record<string, number> = AUFBEWAHRUNG): AufbewahrungsPlan {
  const sortiert = [...eintraege].sort((a, b) => b.ts.localeCompare(a.ts));
  if (sortiert.length === 0) return { behalten: [], entfernen: [], hinweise: ['Keine Sicherung vorhanden — nichts zu entfernen.'] };
  const bleibt = new Set<string>([sortiert[0]!.key]);
  for (const [stufe, grenze] of Object.entries(grenzen)) {
    for (const e of sortiert.filter((x) => x.stufe === stufe).slice(0, Math.max(0, grenze))) bleibt.add(e.key);
  }
  const behalten = sortiert.filter((e) => bleibt.has(e.key));
  const entfernen = sortiert.filter((e) => !bleibt.has(e.key));
  const hinweise = behalten.length === 1 && entfernen.length > 0 ? [`Nur die jüngste Sicherung (${sortiert[0]!.key}) bleibt — die Regel gibt den letzten Stand nie frei.`] : [];
  return { behalten, entfernen, hinweise };
}
