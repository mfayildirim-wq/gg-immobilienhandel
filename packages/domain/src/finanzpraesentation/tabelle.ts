// Wörtliche Kopie von gg-immohandel src/modules/finanzpraes/finanzpraes-tabelle.ts (einzige Abweichung: `!` wegen noUncheckedIndexedAccess)
// ──────────────────────────────────────────────────────────────
// Bank-Präsentation: was auf eine Tabellenseite passt
// ──────────────────────────────────────────────────────────────
// Eine Folie ist 297 × 210 mm groß und schneidet ab, was nicht hineinpasst
// (`overflow:hidden` in finanzpraesTemplate.ts). Abgeschnitten wird von unten —
// bei der Aufteiler-Kalkulation also genau die drei Zeilen, wegen derer die Bank
// das Papier überhaupt bekommt: GIK, Gewinn, Marge. Ab etwa sieben
// Sanierungsposten war das der Normalfall, und zwar lautlos: die Vorschau im
// Editor schnitt genauso ab wie das PDF, es fehlte also kein sichtbarer Hinweis.
//
// Die Rechnung dahinter steht hier und nicht im Renderer. Sie ist die einzige
// Stelle des Ausgabewegs, die sich ohne Browser prüfen lässt — und damit die
// einzige, an der ein Test den Abriss überhaupt bemerken kann.
// ──────────────────────────────────────────────────────────────

/** Zeilen, die neben Überschrift und Tabellenkopf auf eine Folie passen.
 *
 *  Rechnung aus dem CSS in finanzpraesTemplate.ts: 210 mm Höhe − 22 mm oben
 *  − 18 mm unten = 170 mm Inhalt. Davon gehen Titel (~22 mm), Untertitel
 *  (~9 mm) und Tabellenkopf (~8 mm) ab, bleiben ~131 mm. Eine Zeile ist
 *  8,5 pt bei Zeilenabstand 1,25 plus zweimal 0,8 mm Innenabstand ≈ 5,7 mm —
 *  rechnerisch also 23. Das deckt sich mit dem Befund, dass der Abriss ab
 *  etwa sieben Sanierungsposten (≈ 27 Zeilen) einsetzte.
 *
 *  Wir nehmen 22: eine Zelle mit langem Text („+ Sanierung Dach inkl. Dämmung
 *  und Gaubenanschluss") bricht auf zwei Zeilen um, und eine Folie zu früh
 *  umzubrechen kostet Papier — zu spät kostet die Gewinnzeile. */
export const FP_ZEILEN_PRO_TABELLENSEITE = 22;

/** Erkennt Sektions-Überschriften („PROJEKTKOSTEN", „EXIT AUFTEILER"):
 *  erste Spalte gefüllt und in Großbuchstaben, alle weiteren leer.
 *  Einzige Definition — der Renderer in finanzpraesTemplate.ts liest sie hier. */
export function istSektionsZeile(row: string[]): boolean {
  if (!Array.isArray(row) || row.length < 2) return false;
  const erste = String(row[0] ?? '').trim();
  if (!erste) return false;
  const restLeer = row.slice(1).every((c) => !String(c ?? '').trim());
  return restLeer && (erste === erste.toUpperCase() || /[📊💰🔨💼🏢]/.test(erste));
}

/** Verteilt die Zeilen einer Tabelle auf so viele Folien, wie sie braucht.
 *  Leere Eingabe → leeres Ergebnis (die Folie zeigt dann Bild oder Platzhalter). */
export function teileTabellenzeilen(
  rows: string[][],
  maxProSeite: number = FP_ZEILEN_PRO_TABELLENSEITE,
): string[][][] {
  const zeilen = Array.isArray(rows) ? rows : [];
  if (zeilen.length === 0) return [];
  const grenze = Math.max(1, Math.floor(maxProSeite));
  if (zeilen.length <= grenze) return [zeilen];

  // Gleichmäßig verteilen statt „erste Seite voll, Rest hinterher": sonst steht
  // auf der letzten Seite womöglich eine einzelne Zeile — und wenn das die
  // Marge ist, sieht sie aus wie ein nachgereichter Zettel.
  const seitenAnzahl = Math.ceil(zeilen.length / grenze);
  const proSeite = Math.ceil(zeilen.length / seitenAnzahl);

  const seiten: string[][][] = [];
  let von = 0;
  while (von < zeilen.length) {
    let bis = Math.min(von + proSeite, zeilen.length);
    // Eine Sektions-Überschrift als letzte Zeile einer Seite kündigt an, was
    // erst auf der nächsten steht — sie wandert mit. Nie so weit, dass die
    // Seite leer bliebe.
    while (bis > von + 1 && bis < zeilen.length && istSektionsZeile(zeilen[bis - 1]!)) bis--;
    seiten.push(zeilen.slice(von, bis));
    von = bis;
  }
  return seiten;
}

/** Flächensumme als Text.
 *  45,5 + 60,3 ergibt in Fließkomma-Arithmetik 105.80000000000001. Die
 *  Summenzeile bildete diese Zahl mit `String(n).replace('.', ',')` ab und
 *  trug den Schwanz bis auf das Papier, das zur Bank geht. Die Begrenzung der
 *  Nachkommastellen ist der Punkt der Funktion, nicht die Lokalisierung. */
export function formatiereFlaeche(n: number): string {
  const zahl = Number(n);
  if (!isFinite(zahl)) return '–';
  return zahl.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}
