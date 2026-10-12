import { describe, expect, it, vi } from 'vitest';
import { type Ocr, pdfDokument } from '../src/pdf/dokument.ts';
import { pdfMitBildern } from '../src/test/pdf-basteln.ts';

const bildSeiten = (n: number) => pdfMitBildern(Array.from({ length: n }, (_, i) => ({ zeilen: [], bilder: [{ breite: 640 + i, hoehe: 420 }] })));

describe('pdfDokument: OCR-Zeitbudget', () => {
  const langsam = (ms: number): { ocr: Ocr; aufrufe: () => number } => {
    let n = 0;
    return {
      aufrufe: () => n,
      ocr: async () => { n++; await new Promise((r) => setTimeout(r, ms)); return { zeilen: [['Gelesen']], sicherheit: 90, woerter: 1 }; },
    };
  };

  it('liest ohne Überschreitung alle Bild-Seiten per OCR', async () => {
    const { ocr, aufrufe } = langsam(1);
    const d = await pdfDokument(bildSeiten(3), { ocr });
    expect(aufrufe()).toBe(3);
    expect(d.seiten.every((s) => s.typ === 'bild' && s.ocr !== null)).toBe(true);
  });

  it('keine weiteren OCR-Seiten, sobald das Budget überschritten ist; Warnung statt neuem Feld', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { ocr, aufrufe } = langsam(30);
      const d = await pdfDokument(bildSeiten(4), { ocr, ocrBudgetMs: 10 });
      // Seite 1 braucht länger als das Budget (10 ms) — danach kommt keine OCR mehr
      expect(aufrufe()).toBe(1);
      expect(d.seiten.map((s) => s.ocr !== null)).toEqual([true, false, false, false]);
      expect(d.seiten.map((s) => s.typ)).toEqual(['bild', 'bild', 'bild', 'bild']);
      expect(d.seitenGesamt).toBe(4);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('OCR-Zeitbudget'))).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });
});
