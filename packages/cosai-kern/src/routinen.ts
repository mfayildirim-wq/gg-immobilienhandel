/**
 * Routinen erkennen: aus den Episoden des Nutzers die Abläufe, die er immer wieder gleich macht — z. B. im selben Deal
 * erst die Notiz, dann „Erledigt“. Rein gerechnet, ohne Modell und ohne Datenbank.
 *
 * - Episoden werden nach Kontext gruppiert (ohne `sitzungId`) und zeitlich sortiert; eine Pause über `pauseMin`
 *   trennt zwei Läufe.
 * - Gleiche Schritte direkt hintereinander zählen einmal; jede Folge der Länge 2–3 zählt je Lauf einmal.
 * - Eine kürzere Folge entfällt, wenn eine längere sie enthält und mindestens so oft vorkommt.
 */

export interface Episode {
  schluessel: string;
  kontext: Record<string, unknown>;
  /** ISO-Zeitpunkt */
  zeit: string;
}

export interface Routine {
  folge: string[];
  anzahl: number;
}

export function routinenAus(episoden: Episode[], opt: { mindestens?: number; pauseMin?: number } = {}): Routine[] {
  const mindestens = opt.mindestens ?? 3;
  const pause = (opt.pauseMin ?? 30) * 60_000;

  const gruppen = new Map<string, Episode[]>();
  for (const e of episoden) {
    const { sitzungId: _s, ...kontext } = e.kontext;
    const schluessel = JSON.stringify(Object.entries(kontext).sort(([a], [b]) => a.localeCompare(b)));
    gruppen.set(schluessel, [...(gruppen.get(schluessel) ?? []), e]);
  }

  const laeufe: string[][] = [];
  for (const liste of gruppen.values()) {
    const sortiert = [...liste].sort((a, b) => Date.parse(a.zeit) - Date.parse(b.zeit));
    let lauf: string[] = [];
    let zuletzt = Number.NEGATIVE_INFINITY;
    for (const e of sortiert) {
      const t = Date.parse(e.zeit);
      if (t - zuletzt > pause && lauf.length) { laeufe.push(lauf); lauf = []; }
      if (lauf.at(-1) !== e.schluessel) lauf.push(e.schluessel);
      zuletzt = t;
    }
    if (lauf.length) laeufe.push(lauf);
  }

  const zaehler = new Map<string, number>();
  for (const lauf of laeufe) {
    const gesehen = new Set<string>();
    for (let laenge = 2; laenge <= 3; laenge += 1) {
      for (let i = 0; i + laenge <= lauf.length; i += 1) gesehen.add(JSON.stringify(lauf.slice(i, i + laenge)));
    }
    for (const f of gesehen) zaehler.set(f, (zaehler.get(f) ?? 0) + 1);
  }

  const kandidaten = [...zaehler].map(([f, anzahl]) => ({ folge: JSON.parse(f) as string[], anzahl })).filter((r) => r.anzahl >= mindestens);
  const enthaelt = (lang: string[], kurz: string[]) => lang.length > kurz.length && lang.some((_, i) => kurz.every((s, j) => lang[i + j] === s));
  return kandidaten
    .filter((r) => !kandidaten.some((l) => enthaelt(l.folge, r.folge) && l.anzahl >= r.anzahl))
    .sort((a, b) => b.anzahl - a.anzahl || b.folge.length - a.folge.length);
}
