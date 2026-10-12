// OCR mit Tesseract (WebAssembly, deutsch) für Bild-Seiten (Protokoll 30, P1). Ein Worker je Analyse, danach beendet.
// Nur Wörter mit Sicherheit ≥ 60 zählen; Zeilen aus den Blöcken, Zellen per Abstand wie beim Textlayer.
import type { Ocr, OcrErgebnis } from './dokument.ts';

const MIN_SICHERHEIT = 60;

/** Erzeugt eine OCR-Funktion und eine Aufräumfunktion. Sprache wird beim ersten Aufruf geladen. */
export function tesseractOcr(): { ocr: Ocr; beenden: () => Promise<void> } {
  let worker: Promise<any> | undefined;
  const holen = () => (worker ??= import('tesseract.js').then((t) => t.createWorker('deu')));
  const ocr: Ocr = async (png) => {
    const w = await holen();
    const { data } = await w.recognize(Buffer.from(png), {}, { blocks: true });
    const zeilen: string[][] = [];
    const sicherheiten: number[] = [];
    for (const block of data.blocks ?? []) {
      for (const absatz of block.paragraphs ?? []) {
        for (const zeile of absatz.lines ?? []) {
          const woerter = (zeile.words ?? []).filter((x: any) => x.confidence >= MIN_SICHERHEIT && x.text.trim());
          if (!woerter.length) continue;
          sicherheiten.push(...woerter.map((x: any) => x.confidence));
          const zellen: string[] = [];
          let zelle = '';
          let ende = -Infinity;
          for (const x of woerter) {
            const hoehe = x.bbox.y1 - x.bbox.y0;
            if (zelle && x.bbox.x0 - ende > 1.5 * hoehe) { zellen.push(zelle); zelle = ''; }
            zelle += (zelle ? ' ' : '') + x.text;
            ende = x.bbox.x1;
          }
          if (zelle) zellen.push(zelle);
          zeilen.push(zellen);
        }
      }
    }
    const e: OcrErgebnis = { zeilen, woerter: sicherheiten.length, sicherheit: sicherheiten.length ? sicherheiten.reduce((a, b) => a + b, 0) / sicherheiten.length : 0 };
    return e;
  };
  return { ocr, beenden: async () => { if (worker) await (await worker).terminate(); } };
}
