import { describe, expect, it } from 'vitest';
import { pdfDokument } from '../src/pdf/dokument.ts';
import { pdfText } from '../src/pdf/text.ts';
import { pdfAusSeiten } from '../src/test/pdf-basteln.ts';
import { pdfAlsScan } from '../src/test/pdf-scan.ts';

describe('pdfAlsScan', () => {
  it('macht aus einem Text-PDF ein Bild-PDF mit gleicher Seitenzahl und ohne Textlayer', async () => {
    const original = pdfAusSeiten([['Kaufpreis: 1.250.000 EUR', 'Baujahr: 1965'], ['Wohnflaeche: 240 m2']]);
    const vorher = await pdfText(Buffer.from(original));
    expect(vorher.seitenGesamt).toBe(2);
    expect(vorher.charsTotal).toBeGreaterThan(30);

    const scan = await pdfAlsScan(original, { dpi: 72 });
    const nachher = await pdfDokument(scan);
    expect(nachher.seitenGesamt).toBe(2);
    expect(nachher.seiten.map((s) => s.typ)).toEqual(['bild', 'bild']);
    expect(nachher.seiten.every((s) => s.zeilen.length === 0)).toBe(true);
  }, 30_000);
});
