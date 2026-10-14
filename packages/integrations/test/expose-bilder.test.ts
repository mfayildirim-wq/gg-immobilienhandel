import { describe, expect, it } from 'vitest';
import { bilderAusPdf } from '../src/pdf/bilder.ts';
import { pdfAusZeilen, pdfMitBildern } from '../src/test/pdf-basteln.ts';

const istJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8;

describe('Exposé-Bilder aus dem PDF (Protokoll 30, P5)', () => {
  it('liefert Fotos als JPEG in Seitenreihenfolge', async () => {
    const pdf = pdfMitBildern([
      { zeilen: ['Seite 1'], bilder: [{ breite: 800, hoehe: 600 }] },
      { zeilen: ['Seite 2'], bilder: [{ breite: 900, hoehe: 500 }, { breite: 700, hoehe: 700 }] },
    ]);
    const r = await bilderAusPdf(pdf);
    expect(r.map((b) => b.seite)).toEqual([1, 2, 2]);
    expect(r[0]).toMatchObject({ breite: 800, hoehe: 600, mime: 'image/jpeg' });
    expect(r.every((b) => istJpeg(b.bytes) && b.hash.length === 64)).toBe(true);
    expect(new Set(r.map((b) => b.hash)).size).toBe(3);
  });

  it('filtert zu kleine Bilder, schmale Streifen und lässt sich die Mindestgröße einstellen', async () => {
    const pdf = pdfMitBildern([{ zeilen: ['x'], bilder: [{ breite: 300, hoehe: 200 }, { breite: 1400, hoehe: 200 }, { breite: 800, hoehe: 600 }] }]);
    expect((await bilderAusPdf(pdf)).map((b) => b.breite)).toEqual([800]);
    expect((await bilderAusPdf(pdf, { minBreite: 200, minHoehe: 150 })).map((b) => b.breite)).toEqual([300, 800]);
  });

  it('wirft Duplikate auf einer Seite weg und Bilder, die auf mindestens 3 Seiten wiederkehren (Logo)', async () => {
    const logo = { breite: 640, hoehe: 420 };
    const pdf = pdfMitBildern([
      { zeilen: ['1'], bilder: [logo, { breite: 800, hoehe: 600 }] },
      { zeilen: ['2'], bilder: [logo, { breite: 810, hoehe: 610 }] },
      { zeilen: ['3'], bilder: [logo] },
    ]);
    expect((await bilderAusPdf(pdf)).map((b) => `${b.seite}:${b.breite}`)).toEqual(['1:800', '2:810']);
    // auf nur zwei Seiten bleibt es ein Bild (einmal, bei der ersten Fundstelle)
    const zwei = pdfMitBildern([{ zeilen: ['1'], bilder: [logo] }, { zeilen: ['2'], bilder: [logo] }]);
    expect((await bilderAusPdf(zwei)).map((b) => b.seite)).toEqual([1]);
  });

  it('begrenzt die Anzahl und kommt mit PDFs ohne Bild oder ohne PDF zurecht', async () => {
    const pdf = pdfMitBildern([{ zeilen: ['x'], bilder: [{ breite: 700, hoehe: 500 }, { breite: 710, hoehe: 500 }, { breite: 720, hoehe: 500 }] }]);
    expect(await bilderAusPdf(pdf, { maxBilder: 2 })).toHaveLength(2);
    expect(await bilderAusPdf(pdfAusZeilen(['nur Text']))).toEqual([]);
    const warn = console.warn;
    console.warn = () => {};
    try { expect(await bilderAusPdf(new Uint8Array([1, 2, 3]))).toEqual([]); } finally { console.warn = warn; }
  });
});
