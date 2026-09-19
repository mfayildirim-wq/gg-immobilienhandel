// Wörtliche Kopie von gg-immohandel src/modules/finanzpraes/finanzpraes-bilder.ts (einzige Abweichung: `!` wegen noUncheckedIndexedAccess)
// ──────────────────────────────────────────────────────────────
// Bank-Präsentation: Bilder und ihre Beschriftungen umsortieren
// ──────────────────────────────────────────────────────────────
// `bilder` und `captions` sind zwei Arrays, die über den Index zusammengehören.
// Wer nur eines davon anfasst, verschiebt stillschweigend die Zuordnung: das
// Bild wandert, die Beschriftung bleibt stehen. Im Editor fällt das nicht auf —
// dort ist die Beschriftung nur ein Eingabefeld unter dem Bild. Sichtbar wird es
// erst im Export, wo aus der Beschriftung eines Grundrisses der Seitentitel wird
// („Grundriss 1. OG" über dem Erdgeschoss).
//
// Deshalb liegen beide Bewegungen hier zusammen und nicht an vier Aufrufstellen
// verteilt — dort ist dreimal richtig und einmal falsch schwer zu sehen.
// ──────────────────────────────────────────────────────────────

export interface BildListe {
  bilder: string[];
  captions: string[];
}

/** Beschriftungen auf die Länge der Bilderliste bringen — nur auffüllen.
 *  Kürzen würde Text wegwerfen, den eine spätere Bild-Ergänzung wieder braucht. */
function angeglichen(captions: string[] | undefined, anzahl: number): string[] {
  const c = Array.isArray(captions) ? [...captions] : [];
  while (c.length < anzahl) c.push('');
  return c;
}

/** Verschiebt Bild `von` an Position `nach` — Beschriftung fährt mit.
 *  Deckt beide Bedienwege ab: Ziehen (beliebiger Sprung) und ▲/▼ (Sprung um 1). */
export function verschiebeBild(
  bilder: string[] | undefined,
  captions: string[] | undefined,
  von: number,
  nach: number,
): BildListe {
  const b = Array.isArray(bilder) ? [...bilder] : [];
  const c = angeglichen(captions, b.length);
  if (von < 0 || von >= b.length || nach < 0 || nach >= b.length || von === nach) {
    return { bilder: b, captions: c };
  }
  const [bild] = b.splice(von, 1);
  const [text] = c.splice(von, 1);
  b.splice(nach, 0, bild!);
  c.splice(nach, 0, text ?? '');
  return { bilder: b, captions: c };
}

/** Entfernt Bild `idx` samt seiner Beschriftung. */
export function entferneBild(
  bilder: string[] | undefined,
  captions: string[] | undefined,
  idx: number,
): BildListe {
  const b = Array.isArray(bilder) ? [...bilder] : [];
  const c = angeglichen(captions, b.length);
  if (idx < 0 || idx >= b.length) return { bilder: b, captions: c };
  b.splice(idx, 1);
  c.splice(idx, 1);
  return { bilder: b, captions: c };
}
