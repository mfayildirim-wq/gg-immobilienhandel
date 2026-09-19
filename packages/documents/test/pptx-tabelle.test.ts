// Port von gg-immohandel server/finanzpraes-pptx-tabelle.test.ts
// Regressionstest für den Tabellenumbruch im PPTX-Export.
//
// Der Fehler war nicht, dass Zeilen verschwanden — pptxgenjs schreibt mit
// `autoPage:false` jede Zeile in die Datei. Der Fehler war, dass die Tabelle
// höher wurde als die Folie: die gewünschte Zeilenhöhe sank unter das, was
// 9-pt-Text braucht, PowerPoint zog die Zeilen wieder auf, und der Überhang
// lag beim Drucken und beim PDF-Export außerhalb des Folienrands. Weg waren
// damit die untersten Zeilen — GIK, Gewinn, Marge.
//
// Deshalb prüft dieser Test nicht „ist die Zeile im Dokument", sondern „bleibt
// die Tabelle jeder Folie innerhalb der Folienhöhe".

import { describe, it, expect } from 'vitest';
import {
  PPTX_ZEILEN_PRO_SEITE,
  PPTX_ZEILENHOEHE_MIN,
  pptxSeitePasst,
  pptxSeitenAnzahl,
  pptxTabellenHoehe,
  pptxTabellenSeiten,
  pptxTabellenTitel,
} from '../src/pdf/pptx-tabelle.ts';
import { renderFinanzPraesPptx } from '../src/pdf/pptx.ts';

/** Geometrie der PPTX-Folie, gespiegelt aus finanzpraes-pptx.ts.
 *  Oberkante der Tabelle (mit Untertitel) bis Oberkante der Fußzeile. */
const TABELLE_OBEN = 2.11;
const FUSSZEILE_OBEN = 8.27 - 0.4;
const PLATZ_FUER_TABELLE = FUSSZEILE_OBEN - TABELLE_OBEN;

/** Aufteiler-Kalkulation wie computeDealKalkSummary sie baut — mit `posten`
 *  Sanierungszeilen. GIK, Gewinn und Marge stehen ganz unten. */
function aufteilerZeilen(posten: number): string[][] {
  const rows: string[][] = [
    ['PROJEKTKOSTEN', ''],
    ['Kaufpreis', '1.200.000 €'],
    ['+ Notar & Grundbuch (1,50%)', '18.000 €'],
    ['+ Grunderwerbsteuer (5,00%)', '60.000 €'],
    ['+ Maklerprovision (3,57%)', '42.840 €'],
    ['= Anschaffungskosten', '1.320.840 €'],
    ['+ FK-Zinskosten (5,20% p.a. × 1,5 J. auf 85,00% FK)', '104.000 €'],
    ['+ Abschlussgebühr Bank (1,00% auf FK)', '13.300 €'],
    ['– Mieteinnahmen IST (Haltedauer)', '– 54.000 €'],
    ['HERSTELLUNGSKOSTEN', ''],
  ];
  for (let i = 1; i <= posten; i++) rows.push([`+ Sanierungsposten ${i}`, `${i * 10}.000 €`]);
  rows.push(['+ Risikopuffer (10,00%)', '28.000 €']);
  rows.push(['+ Vertriebsprovision (4,00% auf VKP)', '76.000 €']);
  rows.push(['+ Aufteilungskosten', '32.000 €']);
  rows.push(['= Gesamt-Investitionskosten (GIK)', '1.874.000 €']);
  rows.push(['  GIK pro m²', '2.680 €/m²']);
  rows.push(['EXIT AUFTEILER', '']);
  rows.push(['Verkaufserlöse (Σ KP Kunden)', '2.280.000 €']);
  rows.push(['  pro m²', '3.260 €/m²']);
  rows.push(['Gewinn Aufteiler', '406.000 €']);
  rows.push(['Marge auf Verkaufserlöse', '17,8%']);
  return rows;
}

function kalkSlide(posten: number): any {
  return {
    typ: 'projektkalkulation', visible: true,
    data: {
      tableHeaders: ['Position', 'Betrag'],
      tableRows: aufteilerZeilen(posten),
      tableTitle: 'Aufteiler-Kalkulation',
    },
  };
}

const ersteSpalten = (seite: string[][]) => seite.map((z) => z[0]);

describe('pptxTabellenSeiten', () => {
  it('lässt eine kurze Kalkulation auf einer Folie', () => {
    const slide = kalkSlide(1);
    expect(pptxTabellenSeiten(slide)).toEqual([slide.data.tableRows]);
    expect(pptxSeitenAnzahl(slide)).toBe(1);
  });

  it('bricht eine lange Kalkulation um und lässt GIK/Gewinn/Marge stehen', () => {
    const seiten = pptxTabellenSeiten(kalkSlide(14));
    expect(seiten.length).toBeGreaterThan(1);
    const letzte = ersteSpalten(seiten[seiten.length - 1]!);
    expect(letzte).toContain('= Gesamt-Investitionskosten (GIK)');
    expect(letzte).toContain('Gewinn Aufteiler');
    expect(letzte).toContain('Marge auf Verkaufserlöse');
  });

  it('verliert und vertauscht keine Zeile', () => {
    const slide = kalkSlide(30);
    expect(pptxTabellenSeiten(slide).flat()).toEqual(slide.data.tableRows);
  });

  it('gibt für Folien ohne Datentabelle keine Seite aus', () => {
    expect(pptxTabellenSeiten({ typ: 'deckblatt', data: { tableRows: [['a', 'b']] } } as any)).toEqual([]);
    expect(pptxTabellenSeiten({ typ: 'projektkalkulation', data: { bildPath: 'x' } } as any)).toEqual([]);
    expect(pptxSeitenAnzahl({ typ: 'projektkalkulation', data: {} } as any)).toBe(1);
  });
});

describe('pptxTabellenTitel', () => {
  it('zählt erst ab der zweiten Seite', () => {
    expect(pptxTabellenTitel('projektkalkulation', 0, 1)).toBe('Projektkalkulation');
    expect(pptxTabellenTitel('projektkalkulation', 0, 2)).toBe('Projektkalkulation (1 / 2)');
    expect(pptxTabellenTitel('projektkalkulation', 1, 2)).toBe('Projektkalkulation (2 / 2)');
    expect(pptxTabellenTitel('mietenaufstellung', 2, 3)).toBe('Mietenaufstellung (3 / 3)');
  });
});

describe('Folienhöhe', () => {
  it('rechnet mit der Höhe, die PowerPoint der Zeile mindestens gibt', () => {
    expect(pptxTabellenHoehe(10)).toBeCloseTo(10 * PPTX_ZEILENHOEHE_MIN, 6);
    expect(pptxTabellenHoehe(0)).toBe(0);
  });

  it('erkennt die zu lange Tabelle als zu lang', () => {
    // Ohne Umbruch landete die ganze Kalkulation auf einer Folie. 14 Posten
    // sind 34 Zeilen — die passen nicht, und zwar nicht knapp.
    expect(pptxSeitePasst(aufteilerZeilen(14).length, PLATZ_FUER_TABELLE)).toBe(false);
    expect(pptxSeitePasst(aufteilerZeilen(30).length, PLATZ_FUER_TABELLE)).toBe(false);
  });

  it('hält jede umgebrochene Seite innerhalb der Folie', () => {
    for (const posten of [1, 7, 8, 14, 30, 61]) {
      const seiten = pptxTabellenSeiten(kalkSlide(posten));
      expect(seiten.length).toBeGreaterThan(0);
      for (const seite of seiten) {
        expect(seite.length).toBeGreaterThan(0);
        // Der eigentliche Punkt zuerst: die Seite bleibt oberhalb der Fußzeile.
        expect(pptxSeitePasst(seite.length, PLATZ_FUER_TABELLE)).toBe(true);
        expect(seite.length).toBeLessThanOrEqual(PPTX_ZEILEN_PRO_SEITE);
      }
    }
  });
});

describe('renderFinanzPraesPptx', () => {
  /** Folienzahl aus dem .pptx lesen. Die Dateinamen im ZIP-Verzeichnis stehen
   *  unkomprimiert im Puffer — das reicht und spart eine ZIP-Abhängigkeit. */
  function folienAnzahl(buf: Buffer): number {
    const namen = buf.toString('latin1').match(/ppt\/slides\/slide\d+\.xml/g) || [];
    return new Set(namen).size;
  }

  it('legt für eine lange Kalkulation mehrere Folien an', async () => {
    const kurz = await renderFinanzPraesPptx({ bankName: 'Testbank', slides: [kalkSlide(1)] } as any);
    const lang = await renderFinanzPraesPptx({ bankName: 'Testbank', slides: [kalkSlide(14)] } as any);
    expect(folienAnzahl(kurz)).toBe(1);
    expect(folienAnzahl(lang)).toBe(pptxSeitenAnzahl(kalkSlide(14)));
    expect(folienAnzahl(lang)).toBeGreaterThan(1);
  }, 60000);

  it('zählt die Fußzeile über alle Tabellenseiten durch', async () => {
    const praes: any = { bankName: 'Testbank', slides: [kalkSlide(14), { typ: 'abschluss', visible: true, data: {} }] };
    const seitenDerTabelle = pptxSeitenAnzahl(kalkSlide(14));
    const buf = await renderFinanzPraesPptx(praes);
    expect(folienAnzahl(buf)).toBe(seitenDerTabelle + 1);
  }, 60000);

  // Die Verdrahtung, nicht der Auflöser: dass `loeseVerweiseAuf` in diesem
  // Renderer überhaupt aufgerufen wird. Dieser Weg ist der einzige der drei
  // Exportwege ohne Browser und damit die einzige Stelle, an der das ohne
  // laufendes Chromium prüfbar ist.
  //
  // Vor dem 05.08.2026 kam die Data-URL fertig vom Client — und riss dabei die
  // 4,5-MB-Grenze der Function. Nimmt man den Aufruf aus finanzpraes-pptx.ts
  // wieder heraus, landet der nackte Verweis „photo:…" in der Datei und dieser
  // Test wird rot.
  it('bettet ein Foto ein, das nur als Verweis hereinkommt', async () => {
    // Ein winziges, gültiges JPEG genügt — pptxgenjs prüft den Inhalt nicht.
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    let abrufe = 0;
    const buf = await renderFinanzPraesPptx(
      {
        bankName: 'Testbank',
        slides: [{ typ: 'abschluss', visible: true, data: { bild: 'photo:obj7/foto7' } }],
      } as any,
      {
        holeFoto: async (objId, photoId) => {
          abrufe++;
          expect([objId, photoId]).toEqual(['obj7', 'foto7']);
          return jpeg;
        },
      },
    );
    expect(abrufe).toBe(1);
    const inhalt = buf.toString('latin1');
    // pptxgenjs dekodiert die Data-URL und legt die rohen Bytes als eigene Datei
    // im ZIP ab; die Endung leitet es aus dem Mime-Typ ab. Ein `.jpeg` unter
    // ppt/media/ kann deshalb nur aus `data:image/jpeg;…` stammen — und das
    // wiederum nur aus dem Auflöser, der den Typ aus den Bytes gelesen hat.
    expect(inhalt).toMatch(/ppt\/media\/image-\d+-\d+\.jpeg/);
    expect(inhalt).not.toContain('photo:obj7/foto7');
  }, 60000);
});
