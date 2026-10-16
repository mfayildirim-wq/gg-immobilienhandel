// Ein PDF als Scan nachstellen: jede Seite wird gerastert und als Bild in ein neues PDF ohne Textlayer gelegt.
// Für Messungen und Tests des OCR-Wegs (Protokoll 31, E7): ein bekanntes Exposé als Scan — das Ergebnis des
// Textwegs ist dann die Wahrheit, gegen die der Scan-Weg gemessen wird.
import { PDFDocument } from 'pdf-lib';

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let geladen: Promise<Pdfjs> | undefined;
const pdfjsLaden = () => (geladen ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

export interface ScanOptionen {
  /** Auflösung in dpi (Standard 150 — wie ein einfacher Bürodrucker-Scan). */
  dpi?: number;
  /** JPEG-Qualität 0–1 (Standard 0,7). */
  qualitaet?: number;
  /** Höchstens so viele Seiten (Standard alle). */
  maxSeiten?: number;
}

/** Rastert `pdf` Seite für Seite und baut daraus ein Bild-PDF ohne Textlayer (Seitenmaße wie im Original, in Punkt). */
export async function pdfAlsScan(pdf: Uint8Array, optionen: ScanOptionen = {}): Promise<Uint8Array> {
  const dpi = optionen.dpi ?? 150;
  const qualitaet = optionen.qualitaet ?? 0.7;
  const { createCanvas } = await import('@napi-rs/canvas');
  const doc = await (await pdfjsLaden()).getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 }).promise;
  const ziel = await PDFDocument.create();
  try {
    const limit = Math.min(doc.numPages, optionen.maxSeiten ?? doc.numPages);
    for (let nr = 1; nr <= limit; nr++) {
      const page = await doc.getPage(nr);
      try {
        const vp = page.getViewport({ scale: dpi / 72 });
        const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx as any, viewport: vp, canvas: canvas as any }).promise;
        const jpeg = await ziel.embedJpg(canvas.toBuffer('image/jpeg', Math.round(qualitaet * 100)));
        const punkte = page.getViewport({ scale: 1 });
        const seite = ziel.addPage([punkte.width, punkte.height]);
        seite.drawImage(jpeg, { x: 0, y: 0, width: punkte.width, height: punkte.height });
      } finally {
        page.cleanup();
      }
    }
  } finally {
    try { await doc.destroy(); } catch { /* fertig */ }
  }
  return ziel.save();
}
