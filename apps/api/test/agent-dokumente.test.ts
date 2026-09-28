import { describe, expect, it } from 'vitest';
import { dokumentAlsText } from '../src/services/agentDokumente.ts';

/** Ein kleines echtes PDF mit Textebene (wie in packages/integrations/test/pdf-text.test.ts). */
function pdfMitText(zeilen: string[]): Uint8Array {
  const strom = zeilen.map((t, i) => `BT /F1 12 Tf 50 ${750 - i * 20} Td (${t}) Tj ET`).join('\n');
  const objekte = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    `5 0 obj\n<< /Length ${strom.length} >>\nstream\n${strom}\nendstream\nendobj\n`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const o of objekte) { offsets.push(pdf.length); pdf += o; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

describe('dokumentAlsText (Werkzeug dokument_lesen)', () => {
  it('liest die Textebene eines PDFs', async () => {
    const text = await dokumentAlsText({ bytes: pdfMitText(['Mieterliste Musterweg 1', 'WE 1  62 m2  7,80 EUR/m2']), mime: 'application/pdf' });
    expect(text).toContain('Mieterliste Musterweg 1');
    expect(text).toContain('7,80 EUR/m2');
  });
  it('liest Textdateien direkt und meldet Bilder', async () => {
    expect(await dokumentAlsText({ bytes: new TextEncoder().encode('Kaltmiete;Fläche\n480;62'), mime: 'text/csv' })).toContain('480;62');
    expect(await dokumentAlsText({ bytes: new Uint8Array([1, 2]), mime: 'image/jpeg' })).toMatch(/nicht lesbar/);
  });
  it('erkennt ein PDF am Dateianfang, auch wenn die Ablage keinen Typ nennt (SharePoint-Download)', async () => {
    expect(await dokumentAlsText({ bytes: pdfMitText(['Teilungserklaerung Musterweg 1']), mime: 'application/octet-stream' })).toContain('Teilungserklaerung Musterweg 1');
  });
  it('meldet ein PDF ohne Textebene (Scan)', async () => {
    expect(await dokumentAlsText({ bytes: pdfMitText([]), mime: 'application/pdf' })).toMatch(/keine Textebene/);
  });
});
