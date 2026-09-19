// Wörtlich aus gg-immohandel src/lib/deutscheZahlEingabe.ts (nur die reine Regel; das Verhalten im Feld setzt die Oberfläche um).
// ──────────────────────────────────────────────────────────────
// Zahleneingabe: deutsche Schreibweise erzwingen
// ──────────────────────────────────────────────────────────────
// Beim Speichern räumen die Zahlenfelder die Eingabe nach deutscher Lesart auf:
// Punkte sind Tausenderzeichen und fallen weg, das Komma wird zum Dezimalpunkt
// (`vertriebslisten.ts`, `settings.ts`, `kundenkalk.ts`). Das ist richtig und
// bleibt so — die Werte stammen aus Excel-Listen, und dort trennt der Punkt die
// Tausender.
//
// Nur: die Regel ist nicht sichtbar. Wer `85.5` tippt, meint fünfundachtzig
// Komma fünf und bekommt kommentarlos **855** — den Zehnfachen. In einer
// Verkaufspreisspalte fällt das erst auf, wenn jemand die Summe prüft.
//
// Den Punkt bloß abzuweisen löst das NICHT: wer `85.5` tippt und dessen Punkt
// verschluckt wird, tippt die `5` trotzdem weiter und steht wieder bei `855`.
// Genau das hat der Browser-Test gezeigt. Es hilft nur, die Eingabe in die
// deutsche Schreibweise zu überführen und sie dem Nutzer zu zeigen, bevor sie
// gespeichert wird.
//
// Deshalb: beim Verlassen des Feldes wird der Inhalt normalisiert und
// zurückgeschrieben. Was im Feld steht, ist ab dann das, was gespeichert wird —
// kein stiller Unterschied zwischen Anzeige und Wert.
//
// Ein einziger Zuhörer am Dokument, nicht einer je Feld: die Vertriebslisten-
// Tabelle wird bei jeder Zelländerung komplett neu gebaut, und Zuhörer an den
// Feldern wären danach weg. In der Capture-Phase, damit die Normalisierung vor
// dem onchange-Attribut des Feldes läuft — sonst speicherte die App den alten
// Text und die Anzeige liefe auseinander.
// ──────────────────────────────────────────────────────────────

/**
 * Zahleneingabe in deutsche Schreibweise überführen.
 *
 * Der Punkt ist mehrdeutig, deshalb entscheidet der Zusammenhang:
 *
 *   `1.234,56`  Komma vorhanden  → Punkte sind Tausenderzeichen  → `1234,56`
 *   `1.234.567` mehrere Punkte   → Tausenderzeichen              → `1234567`
 *   `1.234`     ein Punkt, 3 Ziffern dahinter → Tausenderzeichen → `1234`
 *   `85.5`      ein Punkt, sonst dahinter     → Dezimalzeichen   → `85,5`
 *
 * Die dritte Zeile ist die einzige, die raten muss. Sie folgt der deutschen
 * Lesart und damit dem, was die Umrechnung beim Speichern ohnehin täte — der
 * Wert ändert sich dadurch nicht, er wird nur sichtbar.
 */
export function normalisiereDeutscheZahl(text: string): string {
  if (!text || !text.includes('.')) return text;
  // Nur was wie eine Zahl aussieht. Sonst würde aus einem „k. A." ein „k A" —
  // die Umrechnung beim Speichern macht daraus ohnehin NaN, und ein Text, den
  // niemand als Zahl gemeint hat, soll unangetastet bleiben.
  if (!/^-?[\d.,\s]+$/.test(text)) return text;

  const punkte = (text.match(/\./g) || []).length;
  const hatKomma = text.includes(',');

  if (hatKomma || punkte > 1) return text.replace(/\./g, '');

  const nach = text.slice(text.lastIndexOf('.') + 1);
  if (/^\d{3}$/.test(nach)) return text.replace('.', '');   // Tausenderzeichen

  return text.replace('.', ',');                            // Dezimalzeichen
}

