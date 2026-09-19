// Übernommen aus gg-immohandel server/pdf-text.ts (Stand 9d693b8). Inhaltlich unverändert; Anpassungen sind markiert.
// ──────────────────────────────────────────────────────────────
// Text-Layer eines PDFs lesen — serverseitig
// ──────────────────────────────────────────────────────────────
// Gegenstück zu pdf-split.ts: dort werden Seiten gerastert, hier wird der
// eingebettete Text gelesen. Beides über dasselbe pdfjs, das ohnehin schon
// Dependency ist.
//
// Die Funktion stand bis zum 17.08. nur im Browser (src/lib/photoStorage.ts,
// `pdfFileToText`) — und musste dorthin, weil der Server das PDF während der
// Analyse gar nicht hatte: hochgeladen wurde es erst nach dem Anlegen des
// Deals. Seit die Reihenfolge umgedreht ist (server/expose-analyse.ts), liegt
// das PDF im Bucket, bevor die Analyse beginnt, und der Text lässt sich hier
// lesen, wo es niemandem den Browser blockiert.
//
// Der Zeilenaufbau ist nicht Kosmetik. Ein Exposé trägt seine wichtigsten
// Zahlen in Tabellen — Mieterlisten, Wohnflächenaufstellungen. pdfjs liefert
// Textstücke mit Koordinaten, ohne jede Zeilenstruktur; hintereinandergehängt
// ergibt eine Mietaufstellung eine Zahlenwurst, in der keine Fläche mehr zu
// ihrer Wohnung gehört. Deshalb wird nach Y-Position gruppiert und innerhalb
// der Zeile nach X sortiert.
// ──────────────────────────────────────────────────────────────

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfTextResult {
  /** Der gesamte Text, zeilenweise aufgebaut, Seiten durch eine Marke getrennt. */
  text: string;
  /** Gelesene Seiten — nicht zwingend alle, siehe `maxPages`. */
  pageCount: number;
  /** Seiten im Dokument insgesamt. */
  seitenGesamt: number;
  /** Zeichen ohne Whitespace. Das Maß für die Frage, ob überhaupt ein
   *  Text-Layer da ist: ein Scan liefert hier nahe null. */
  charsTotal: number;
  /**
   * Warum nichts gelesen wurde — gesetzt genau dann, wenn `seitenGesamt` 0 ist.
   *
   * Der Grund gehört hierher und nicht in ein `throw`: ein unlesbares PDF soll
   * den Bildweg gehen. Verschwinden darf er aber nicht. Bis zum 18.08. fing
   * diese Funktion jeden Fehler ab und gab ein leeres Ergebnis zurück, ohne
   * eine Zeile zu hinterlassen — und im Function-Bündel fehlte
   * `pdf.worker.mjs`. Vier Wochen lang fehlte deshalb das Exposé-Titelbild,
   * ohne dass es auffiel; als die Exposé-Auswertung am 17.08. auf diese
   * Funktion gestellt wurde, meldete die Oberfläche für **jedes** Exposé „Das
   * PDF ließ sich nicht öffnen — bitte die Datei prüfen". Die Datei war nie das
   * Problem. Ein verschluckter Fehler kostet mehr Zeit als jeder laute.
   */
  grund?: string;
}

/**
 * Bis hierhin wird Text gelesen.
 *
 * Die Grenze schützt nicht vor Kosten — gelesener Text ist kostenlos —, sondern
 * vor Laufzeit: bei einem 300-seitigen Dokument kostet jede weitere Seite Zeit
 * in einer Function, an deren Ende ein Mensch wartet. 50 Seiten decken jedes
 * Exposé ab, das hier je aufgeschlagen ist; was darüber liegt, ist ein
 * Ankaufsdatenraum als PDF und wird über den Bildweg ohnehin besser gelesen.
 */
const MAX_SEITEN = 50;

/**
 * Wie weit zwei Textstücke senkrecht auseinanderliegen dürfen und trotzdem
 * derselben Zeile angehören.
 *
 * Zellen einer Tabellenzeile sitzen selten exakt auf derselben Grundlinie —
 * ein Punkt Versatz ist der Normalfall, nicht die Ausnahme.
 */
const ZEILEN_TOLERANZ = 3;

/**
 * Gruppiert Textstücke zu Zeilen.
 *
 * Nicht über ein festes Raster (`Math.round(y / 3) * 3`), obwohl das kürzer
 * wäre und bis zum 17.08. genau so im Browser stand. Ein Raster trennt, was
 * zufällig beidseits einer Rasterlinie liegt: y=700 und y=701 fallen auf 699
 * und 702 und werden zu zwei Zeilen, obwohl ein einziger Punkt dazwischen
 * liegt. In einer Mietaufstellung heißt das, dass die Fläche ihre Wohnung
 * verliert — und weil das Ergebnis danach immer noch nach einer Tabelle
 * aussieht, fällt es niemandem auf.
 *
 * Stattdessen: nach Höhe sortieren und benachbarte Stücke zusammenlegen,
 * solange der Abstand die Toleranz nicht reißt. Damit hängt die Zuordnung am
 * tatsächlichen Abstand, nicht an der Lage zu einer gedachten Linie.
 */
function zuZeilen(stuecke: Array<{ x: number; y: number; s: string }>): string[] {
  if (!stuecke.length) return [];
  const sortiert = [...stuecke].sort((a, b) => b.y - a.y);   // von oben nach unten

  const zeilen: Array<Array<{ x: number; s: string }>> = [];
  let aktuell: Array<{ x: number; s: string }> = [];
  let zeilenY = sortiert[0]!.y; // Neubau: ! für noUncheckedIndexedAccess

  for (const stueck of sortiert) {
    if (aktuell.length && zeilenY - stueck.y > ZEILEN_TOLERANZ) {
      zeilen.push(aktuell);
      aktuell = [];
      zeilenY = stueck.y;
    }
    aktuell.push({ x: stueck.x, s: stueck.s });
  }
  if (aktuell.length) zeilen.push(aktuell);

  // Innerhalb der Zeile links nach rechts — die Reihenfolge im Datenstrom sagt
  // darüber nichts: viele Erzeuger schreiben spaltenweise.
  return zeilen.map(z => z.sort((a, b) => a.x - b.x).map(i => i.s).join('  '));
}

/**
 * Kurzform eines Fehlers für `grund` und Log.
 *
 * Der Sonderfall ist „Setting up fake worker failed": das ist kein Befund über
 * die Datei, sondern über die Auslieferung — pdfjs lädt `pdf.worker.mjs` per
 * dynamischem Import über einen zur Laufzeit gebildeten absoluten Pfad, den der
 * Datei-Tracer von Vercel nicht sieht. Fehlt die Datei im Bündel, scheitert
 * jedes PDF gleich, und die naheliegende Deutung („die Datei ist kaputt") führt
 * in die falsche Richtung. Deshalb wird er hier ausdrücklich benannt.
 */
function fehlertext(e: unknown): string {
  const roh = e instanceof Error ? e.message : String(e);
  if (/fake worker/i.test(roh)) {
    return 'pdfjs konnte seinen Worker nicht laden — pdf.worker.mjs fehlt in der '
      + `Auslieferung, nicht im PDF (${roh.slice(0, 160)})`;
  }
  return roh.slice(0, 200);
}

/**
 * Liest den Text-Layer.
 *
 * Wirft nicht: ein Dokument, das sich nicht öffnen lässt, ist für den Aufrufer
 * dasselbe wie eines ohne Text — beides führt zum Bildweg. Ein `throw` hier
 * würde die Analyse abbrechen, statt sie den anderen Weg gehen zu lassen.
 *
 * Der Grund wird trotzdem festgehalten — in `grund` und in einer Logzeile.
 * Siehe die Begründung an `PdfTextResult.grund`.
 */
export async function pdfText(pdfBuffer: Buffer, maxPages = MAX_SEITEN): Promise<PdfTextResult> {
  const leer = (grund: string): PdfTextResult => {
    console.error('[pdf-text] PDF nicht lesbar:', grund);
    return { text: '', pageCount: 0, seitenGesamt: 0, charsTotal: 0, grund };
  };
  let doc: any;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      useSystemFonts: true,
      verbosity: 0,
    }).promise;
  } catch (e) {
    return leer(fehlertext(e));
  }

  try {
    const seitenGesamt = doc.numPages;
    const limit = Math.min(seitenGesamt, maxPages);
    const seiten: string[] = [];

    for (let p = 1; p <= limit; p++) {
      const page = await doc.getPage(p);
      try {
        const content = await page.getTextContent();
        const stuecke: Array<{ x: number; y: number; s: string }> = [];
        for (const item of (content.items as any[])) {
          const str = (item.str || '').trim();
          if (!str) continue;
          const tr = item.transform || [1, 0, 0, 1, 0, 0];
          stuecke.push({ x: tr[4] || 0, y: tr[5] || 0, s: str });
        }
        seiten.push(zuZeilen(stuecke).join('\n'));
      } catch {
        // Eine unlesbare Seite kostet ihre Seite, nicht das Dokument.
        seiten.push('');
      } finally {
        page.cleanup();
      }
    }

    const text = seiten.map((s, i) => `──────── Seite ${i + 1}\n${s}`).join('\n\n');
    return { text, pageCount: limit, seitenGesamt, charsTotal: text.replace(/\s/g, '').length };
  } catch (e) {
    return leer(fehlertext(e));
  } finally {
    try { await doc.destroy(); } catch { /* egal, das Dokument ist ohnehin fertig */ }
  }
}

/** Wie viele Seiten hat das PDF? 0, wenn es sich nicht öffnen lässt. */
export async function pdfSeitenzahl(pdfBuffer: Buffer): Promise<number> {
  try {
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer), verbosity: 0,
    }).promise;
    const n = doc.numPages;
    await doc.destroy();
    return n;
  } catch (e) {
    console.error('[pdf-text] Seitenzahl nicht ermittelbar:', fehlertext(e));
    return 0;
  }
}
