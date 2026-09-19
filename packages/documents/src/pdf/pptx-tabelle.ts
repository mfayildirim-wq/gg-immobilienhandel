// Wörtliche Kopie von gg-immohandel server/finanzpraes-pptx-tabelle.ts (Abweichung: Importpfade).
// ──────────────────────────────────────────────────────────────
// Bank-Finanzierungspräsentation: Datentabellen im PPTX-Export
// ──────────────────────────────────────────────────────────────
// Der HTML/PDF-Pfad schnitt lange Tabellen unten ab; behoben ist das über
// `teileTabellenzeilen()` in src/modules/finanzpraes/finanzpraes-tabelle.ts.
// Der PPTX-Pfad hatte denselben Fehler in anderer Mechanik:
//
// Verworfen wurde hier nie eine Zeile — pptxgenjs schreibt mit `autoPage:false`
// alle Zeilen in dieselbe Tabelle. Stattdessen rechnete der Renderer die
// Zeilenhöhe klein, bis die Tabelle rechnerisch passte: `availH * 0.95 /
// Zeilenanzahl`, ohne Untergrenze. Gemessen am erzeugten `<a:tr h="…">` waren
// das bei 35 Zeilen 0,16" und bei 81 Zeilen 0,07".
//
// Diese Höhe ist aber nur ein Wunsch. In OOXML ist `<a:tr h="…">` eine
// Mindesthöhe, und PowerPoint verkleinert Tabellentext nicht (die Zellen tragen
// kein `normAutofit`) — die Zeile wächst stattdessen auf das, was der Text
// braucht. Die Tabelle wurde also nicht dichter, sondern länger als die Folie,
// und der Überhang liegt beim Vorführen, Drucken und PDF-Export außerhalb des
// Folienrands. Abgeschnitten wurde damit wieder von unten: GIK, Gewinn, Marge.
//
// Konsequenz: derselbe Seitenumbruch wie im HTML-Pfad, aus derselben Quelle.
// Gleiche Zeilengrenze heißt gleiche Trennstellen — PDF und PPTX derselben
// Präsentation brechen an denselben Zeilen um, und die Bank bekommt zwei
// Dokumente, die sich decken.
// ──────────────────────────────────────────────────────────────

import type PptxGenJS from 'pptxgenjs';
import {
  type Slide,
  teileTabellenzeilen,
  FP_ZEILEN_PRO_TABELLENSEITE,
} from '@gg/domain';

type PptxSlide = ReturnType<PptxGenJS['addSlide']>;

/** Höhe, die eine Tabellenzeile in PowerPoint mindestens einnimmt (Inch).
 *
 *  9 pt Calibri bei Zeilenabstand ~1,2 sind 10,8 pt ≈ 0,15", dazu die
 *  Zellenränder `marT`/`marB` von je 0,02" aus `renderDataTablePptx` — macht
 *  0,19". Unter diesen Wert kann keine Zeile gedrückt werden, egal was `rowH`
 *  verlangt. Genau daran scheiterte die alte Rechnung. */
export const PPTX_ZEILENHOEHE_MIN = 0.19;

/** Slide-Typen, die eine Datentabelle tragen können, mit ihrer Überschrift.
 *  Einzige Definition — der Renderer liest sie hier. */
export const PPTX_TABELLEN_TITEL: Record<string, string> = {
  projektkalkulation: 'Projektkalkulation',
  verkaufspreise: 'Verkaufspreise',
  mietenaufstellung: 'Mietenaufstellung',
};

/** Die Tabellenzeilen dieser Folie, auf Seiten verteilt.
 *  Leeres Array = die Folie zeigt keine Tabelle, sondern Bild oder Platzhalter. */
export function pptxTabellenSeiten(slide: Slide): string[][][] {
  if (!slide || !PPTX_TABELLEN_TITEL[slide.typ as string]) return [];
  const rows = slide.data?.tableRows;
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return teileTabellenzeilen(rows);
}

/** Wie viele PPTX-Folien diese Slide belegt. Die Fußzeilen-Zählung hängt daran
 *  und muss feststehen, bevor die erste Folie gezeichnet wird. */
export function pptxSeitenAnzahl(slide: Slide): number {
  return Math.max(1, pptxTabellenSeiten(slide).length);
}

/** Überschrift einer Tabellenseite — ab zwei Seiten mit Zählung „(1 / 2)",
 *  wortgleich zum HTML-Pfad. */
export function pptxTabellenTitel(typ: string, seite: number, seitenGesamt: number): string {
  const basis = PPTX_TABELLEN_TITEL[typ] || 'Detail';
  return seitenGesamt > 1 ? `${basis} (${seite + 1} / ${seitenGesamt})` : basis;
}

/** Höhe, die eine Tabelle mit `zeilenMitKopf` Zeilen auf der Folie wirklich
 *  einnimmt — nicht die, die der Renderer sich wünscht. Die Prüfung, ob eine
 *  Seite passt, läuft über diese Zahl. */
export function pptxTabellenHoehe(zeilenMitKopf: number): number {
  return Math.max(0, zeilenMitKopf) * PPTX_ZEILENHOEHE_MIN;
}

/**
 * Passt eine Tabellenseite mit `zeilen` Datenzeilen (plus Kopfzeile) in die
 * Höhe `verfuegbar`, ohne die Fußzeile zu überlaufen?
 *
 * Ist bewusst eine eigene Funktion und keine Zusicherung im Renderer: sie ist
 * die einzige Stelle des PPTX-Wegs, die sich ohne PowerPoint prüfen lässt.
 */
export function pptxSeitePasst(zeilen: number, verfuegbar: number): boolean {
  return pptxTabellenHoehe(zeilen + 1) <= verfuegbar;
}

/** Zeilen, die pro PPTX-Tabellenseite ausgegeben werden.
 *
 *  Der PPTX-Folie stünden mehr zu als der HTML-Folie: von Tabellenoberkante
 *  (2,11") bis Fußzeile (7,87") sind 5,76" frei, geteilt durch 0,19" also 30
 *  Zeilen inklusive Kopf. Wir nehmen trotzdem die 22 aus dem HTML-Pfad — die
 *  Reserve deckt Zellen ab, die auf zwei Zeilen umbrechen (bei fünfspaltigen
 *  Tabellen ist eine Spalte nur ~2" breit), und identische Trennstellen in PDF
 *  und PPTX sind mehr wert als eine Folie weniger. */
export const PPTX_ZEILEN_PRO_SEITE = FP_ZEILEN_PRO_TABELLENSEITE;

export interface PptxTabelleOpts {
  headers: unknown;
  rows: unknown;
  subtitle: unknown;
  /** linke Kante und Breite des Inhaltsbereichs */
  x: number;
  w: number;
  /** Oberkante und verfügbare Höhe bis vor die Fußzeile */
  yStart: number;
  maxH: number;
}

/** Daten-Tabelle in PPTX zeichnen (mit Header-Zeile + GESAMT-Zeile bold). */
export function renderDataTablePptx(pptx: PptxSlide, opts: PptxTabelleOpts): void {
  const { headers, rows, subtitle, x, w, yStart, maxH } = opts;
  const hdrs: string[] = Array.isArray(headers) ? headers : [];
  const rs: string[][] = Array.isArray(rows) ? rows : [];
  if (rs.length === 0) return;
  let y = yStart;
  if (subtitle) {
    pptx.addText(String(subtitle), {
      x, y, w, h: 0.35,
      fontSize: 12, bold: true, color: '3D5A80', fontFace: 'Calibri',
    });
    y += 0.4;
  }
  // Pattern-Erkennung — analog zu HTML-Renderer (renderDataTable in finanzpraesTemplate.ts)
  const isSectionHeader = (r: string[]) => {
    if (r.length < 2) return false;
    const first = String(r[0] || '').trim();
    const restEmpty = r.slice(1).every((c) => !String(c || '').trim());
    return restEmpty && first.length > 0 && (first === first.toUpperCase() || /[📊💰🔨💼🏢]/.test(first));
  };
  const isGikSum  = (r: string[]) => /Gesamt-Investitionskosten|GIK\s*\(/i.test(String(r[0] || ''));
  const isExitSum = (r: string[]) => /Gewinn\s+(Aufteiler|Global)/i.test(String(r[0] || ''));
  const isLastRowSummary = (r: string[]) => r.some((c) => /GESAMT|TOTAL|SUMME/i.test(String(c)));

  // Border-Konfigurationen: nur untere Zeilen-Linien (kein Vollbox-Stil)
  // pptxgenjs nutzt 4-element border-Array: [top, right, bottom, left]
  // type:'none' für nicht-gewünschte Seiten
  const noneBorder = { type: 'none' as const, pt: 0, color: 'FFFFFF' };
  const borderHeader = [noneBorder, noneBorder, { type: 'solid' as const, pt: 1, color: '1E3A5F' }, noneBorder];
  const borderRow    = [noneBorder, noneBorder, { type: 'solid' as const, pt: 0.5, color: 'E6EBF0' }, noneBorder];
  const borderTop = (color: string) => [{ type: 'solid' as const, pt: 1, color }, noneBorder, noneBorder, noneBorder];

  // Build pptxgenjs-Table-Daten — kleinere Schrift+Margin damit auch volle Tabellen passen
  const tableData: { text: string; options: any }[][] = [];
  if (hdrs.length > 0) {
    tableData.push(hdrs.map((h, i) => ({
      text: h, options: {
        bold: true, color: '3D5A80', fontSize: 9, fontFace: 'Calibri',
        align: i >= 3 ? 'right' : 'left',
        valign: 'middle',
        margin: 0.03,
        border: borderHeader,
      },
    })));
  }
  rs.forEach((r, idx) => {
    const isSum = (idx === rs.length - 1) && isLastRowSummary(r);
    const isSec = isSectionHeader(r);
    const isGik = isGikSum(r);
    const isExit = isExitSum(r);
    let bg: string | undefined;
    let textColor = '1A1A1A';
    let bold = false;
    let fontSize = 9;
    let border = borderRow;
    if (isSec)       { bg = 'EEF2F6'; textColor = '3D5A80'; bold = true; fontSize = 8; border = borderRow; }
    else if (isGik)  { bg = 'DDE7F0'; textColor = '1E3A5F'; bold = true; border = borderTop('1E3A5F'); }
    else if (isExit) { bg = 'E6F4E6'; textColor = '15803D'; bold = true; border = borderTop('15803D'); }
    else if (isSum)  { textColor = '1E3A5F'; bold = true; border = borderTop('1E3A5F'); }
    tableData.push(r.map((c, i) => ({
      text: String(c), options: {
        bold, color: textColor,
        fontSize, fontFace: 'Calibri',
        align: i >= 3 ? 'right' : 'left',
        valign: 'middle',
        margin: 0.02,
        ...(bg ? { fill: { color: bg } } : {}),
        border,
      },
    })));
  });
  // Auto-Spaltenbreiten: erste Spalten schmal, letzte (Zahlen) breit
  const numCols = hdrs.length || (rs[0]?.length || 1);
  const colW: number[] = Array.from({ length: numCols }, () => w / numCols);
  const totalRows = tableData.length;
  const availH = maxH - (subtitle ? 0.4 : 0);
  // rowH verteilt die Höhe auf die Zeilen — aber nie unter das, was der Text
  // ohnehin braucht. Ohne diese Untergrenze log die Zahl: PowerPoint zog die
  // Zeile wieder auf und schob die Tabelle aus der Folie.
  const dynRowH = Math.max(
    PPTX_ZEILENHOEHE_MIN,
    Math.min(0.30, (availH * 0.95) / totalRows),
  );
  pptx.addTable(tableData, {
    x, y, w,
    h: Math.min(availH, totalRows * dynRowH),
    colW, fontFace: 'Calibri',
    rowH: dynRowH,
    autoPage: false,
  });
}
