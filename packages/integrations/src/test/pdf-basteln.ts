/**
 * Baut ein minimales, echtes PDF mit Textzeilen (für Tests und Klicktests).
 * Nach dem Vorbild von gg-immohandel server/pdf-text.test.ts (bastelPdf). Nur ASCII/Latin-1-Zeichen.
 */
export function pdfAusZeilen(zeilen: string[]): Uint8Array {
  const strom = zeilen
    .map((t, i) => `BT /F1 11 Tf 50 ${800 - i * 16} Td (${t.replace(/([()\\])/g, '\\$1')}) Tj ET`)
    .join('\n');
  const objekte = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    `5 0 obj\n<< /Length ${Buffer.byteLength(strom, 'latin1')} >>\nstream\n${strom}\nendstream\nendobj\n`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const o of objekte) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += o;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

/** Ein Test-Exposé im Zeilenformat der KI-Attrappe. */
export function testExpose(kennung: string): Uint8Array {
  return pdfAusZeilen([
    `Expose ${kennung} - Mehrfamilienhaus in guter Lage mit solidem Mietertrag und Entwicklungspotenzial`,
    `Adresse: ${kennung}strasse 12, 89073 Ulm`,
    'Kaufpreis: 1.250.000 EUR',
    'Wohnflaeche: 240 m2',
    'Baujahr: 1965',
    `Makler: Anna ${kennung} | Beispiel Immobilien GmbH | 0171 ${kennung.replace(/\D/g, '').slice(-7).padStart(7, '0')} | anna.${kennung.toLowerCase()}@beispiel.test`,
    'Einheit: Wohnung | EG links | 3 | 80 | 800',
    'Einheit: Wohnung | OG rechts | 3 | 80 | 820',
    'Einheit: Wohnung | DG | 2 | 80 | 700',
    'Die Liegenschaft befindet sich in ruhiger Wohnlage, Einkaufsmoeglichkeiten und Schulen sind fusslaeufig erreichbar.',
  ]);
}
