// Übernommen aus gg-immohandel server/pdf-text.test.ts (Stand 9d693b8). Inhaltlich unverändert; Anpassungen sind markiert.
// ──────────────────────────────────────────────────────────────
// Text-Layer lesen — an einem echten PDF, nicht an einem Mock
// ──────────────────────────────────────────────────────────────
// Die Zeilenstruktur ist hier der eigentliche Gegenstand. pdfjs liefert
// Textstücke mit Koordinaten und ohne jede Ordnung; hintereinandergehängt wird
// aus einer Mietaufstellung eine Zahlenwurst, in der keine Fläche mehr zu ihrer
// Wohnung gehört. Genau die Tabellen sind aber das, wofür der Import da ist.
//
// Deshalb wird hier ein PDF gebaut, dessen Textstücke in vertauschter
// Reihenfolge im Datenstrom stehen — so wie es ein echter Erzeuger tut, der
// spaltenweise schreibt. Ein Test gegen einen Mock hätte das nie gefunden.
// ──────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { pdfText, pdfSeitenzahl } from '../src/pdf/text.ts';

/**
 * Baut ein PDF mit den angegebenen Textstücken.
 *
 * `stuecke` sind Tripel aus x, y und Text — in der Reihenfolge, in der sie im
 * Datenstrom stehen sollen, nicht in der Lesereihenfolge.
 */
function bastelPdf(seiten: Array<Array<[number, number, string]>>): Buffer {
  const objekte: string[] = [];
  const seitenIds: number[] = [];

  // 1 = Katalog, 2 = Seitenbaum, 3 = Schrift; ab 4 abwechselnd Seite und Inhalt
  let id = 4;
  const inhalte: string[] = [];
  for (const stuecke of seiten) {
    const seitenId = id++;
    const inhaltId = id++;
    seitenIds.push(seitenId);
    const strom = stuecke
      .map(([x, y, t]) => `BT /F1 12 Tf ${x} ${y} Td (${t.replace(/([()\\])/g, '\\$1')}) Tj ET`)
      .join('\n');
    inhalte.push(
      `${seitenId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] `
      + `/Resources << /Font << /F1 3 0 R >> >> /Contents ${inhaltId} 0 R >>\nendobj\n`,
      `${inhaltId} 0 obj\n<< /Length ${strom.length} >>\nstream\n${strom}\nendstream\nendobj\n`,
    );
  }

  objekte.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objekte.push(
    `2 0 obj\n<< /Type /Pages /Kids [${seitenIds.map(i => `${i} 0 R`).join(' ')}] `
    + `/Count ${seitenIds.length} >>\nendobj\n`,
  );
  objekte.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objekte.push(...inhalte);

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const o of objekte) { offsets.push(pdf.length); pdf += o; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`
    + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

describe('pdfText', () => {
  it('liest den Text einer Seite', async () => {
    const erg = await pdfText(bastelPdf([[[50, 700, 'Mehrfamilienhaus Musterweg 12']]]));
    expect(erg.text).toContain('Mehrfamilienhaus Musterweg 12');
    expect(erg.pageCount).toBe(1);
    expect(erg.seitenGesamt).toBe(1);
    expect(erg.charsTotal).toBeGreaterThan(20);
  });

  it('DIE MIETERLISTE: eine Tabellenzeile bleibt eine Zeile, in Leserichtung', async () => {
    // Die Stücke stehen absichtlich in falscher Reihenfolge im Datenstrom —
    // erst die rechte Spalte, dann die linke. Genau so schreibt ein Erzeuger,
    // der spaltenweise arbeitet. Ohne Sortierung stünde die Miete vor der
    // Wohnung, und die Zuordnung wäre verloren.
    const erg = await pdfText(bastelPdf([[
      [400, 700, '720'],
      [300, 700, '85'],
      [50,  700, 'Whg 1 EG'],
    ]]));
    const zeile = erg.text.split('\n').find(z => z.includes('Whg 1'))!;
    expect(zeile.indexOf('Whg 1')).toBeLessThan(zeile.indexOf('85'));
    expect(zeile.indexOf('85')).toBeLessThan(zeile.indexOf('720'));
  });

  it('trennt Zeilen, die untereinander stehen', async () => {
    const erg = await pdfText(bastelPdf([[
      [50, 700, 'Whg 1'],
      [50, 680, 'Whg 2'],
    ]]));
    const zeilen = erg.text.split('\n').filter(z => z.startsWith('Whg'));
    expect(zeilen).toEqual(['Whg 1', 'Whg 2']);   // von oben nach unten
  });

  it('fasst leicht versetzte Zellen derselben Zeile zusammen', async () => {
    // Zellen einer Tabellenzeile sitzen selten exakt auf derselben Grundlinie.
    const erg = await pdfText(bastelPdf([[
      [50,  700, 'Whg'],
      [200, 701, '85'],
    ]]));
    expect(erg.text).toContain('Whg  85');
  });

  it('DER RASTERFEHLER: ein Punkt Versatz zerreißt keine Tabellenzeile', async () => {
    // Gefunden am 17.08. beim Umbau. Die Gruppierung lief über ein festes
    // Raster (`Math.round(y / 3) * 3`); y=700 und y=701 landeten auf 699 und
    // 702 und damit in zwei Zeilen. Eine Mietaufstellung verlor dabei die
    // Zuordnung von Fläche und Miete zur Wohnung — und sah danach immer noch
    // aus wie eine Tabelle, weshalb es nie auffiel.
    //
    // Der Test prüft mehrere Höhen rund um eine solche Rasterlinie: bei einem
    // Raster reißt mindestens eine davon.
    for (const [y1, y2] of [[700, 701], [701, 702], [702, 703], [698, 700]] as [number, number][]) {
      const erg = await pdfText(bastelPdf([[
        [50, y1, 'Whg1'],
        [200, y2, '85'],
        [350, y1, '720'],
      ]]));
      const zeile = erg.text.split('\n').find(z => z.includes('Whg1'));
      expect(zeile, `y=${y1}/${y2} auseinandergefallen`).toBe('Whg1  85  720');
    }
  });

  it('trennt aber weiterhin, was wirklich untereinander steht', async () => {
    // Die Gegenprobe: eine großzügige Toleranz darf nicht die ganze Seite zu
    // einer Zeile verschmelzen.
    const erg = await pdfText(bastelPdf([[
      [50, 700, 'Whg1'],
      [50, 696, 'Whg2'],
      [50, 692, 'Whg3'],
    ]]));
    expect(erg.text.split('\n').filter(z => z.startsWith('Whg'))).toEqual(['Whg1', 'Whg2', 'Whg3']);
  });

  it('zählt Seiten und markiert sie', async () => {
    const erg = await pdfText(bastelPdf([
      [[50, 700, 'Seite eins']],
      [[50, 700, 'Seite zwei']],
    ]));
    expect(erg.seitenGesamt).toBe(2);
    expect(erg.text).toContain('Seite 1');
    expect(erg.text).toContain('Seite 2');
  });

  it('hört bei der Seitengrenze auf und sagt trotzdem, wie viele es sind', async () => {
    const erg = await pdfText(bastelPdf(Array.from({ length: 4 }, (_, i) => [[50, 700, `S${i}`]] as any)), 2);
    expect(erg.pageCount).toBe(2);
    expect(erg.seitenGesamt).toBe(4);
  });

  it('EIN SCAN LIEFERT NICHTS — und genau daran wird er erkannt', async () => {
    const erg = await pdfText(bastelPdf([[]]));
    expect(erg.charsTotal).toBeLessThan(20);   // nur die Seitenmarke
  });

  it('WIRFT NICHT: ein unlesbares PDF ist ein Fall für den Bildweg, kein Abbruch', async () => {
    const erg = await pdfText(Buffer.from('das ist kein PDF'));
    expect(erg.text).toBe('');
    expect(erg.pageCount).toBe(0);
    expect(erg.seitenGesamt).toBe(0);
    expect(erg.charsTotal).toBe(0);
  });

  // Der Test zum 18.08.: vier Wochen lang gab diese Funktion für JEDES PDF ein
  // leeres Ergebnis zurück, weil im Function-Bündel `pdf.worker.mjs` fehlte —
  // und schwieg dazu. Erst fiel das Exposé-Titelbild aus (unbemerkt), dann der
  // ganze Import, mit der Meldung „bitte die Datei prüfen" für Dateien, die in
  // Ordnung waren. Ein leeres Ergebnis ohne Grund darf es nicht mehr geben.
  it('SAGT WARUM: ein leeres Ergebnis trägt immer einen Grund', async () => {
    const erg = await pdfText(Buffer.from('das ist kein PDF'));
    expect(erg.grund).toBeTruthy();
    expect(erg.grund!.length).toBeGreaterThan(5);
  });

  it('und ein gelesenes Ergebnis trägt keinen', async () => {
    const erg = await pdfText(bastelPdf([[[70, 700, 'Hallo']]]));
    expect(erg.seitenGesamt).toBe(1);
    expect(erg.grund).toBeUndefined();
  });
});

describe('pdfSeitenzahl', () => {
  it('zählt, ohne zu rendern', async () => {
    expect(await pdfSeitenzahl(bastelPdf([[], [], []]))).toBe(3);
  });

  it('liefert 0 statt zu werfen', async () => {
    expect(await pdfSeitenzahl(Buffer.from('kaputt'))).toBe(0);
  });
});
