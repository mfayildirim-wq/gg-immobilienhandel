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

/**
 * Wie pdfAusZeilen, aber mit mehreren Seiten (je ein Zeilenblock). pdfText liefert daraus Seitenmarker „──────── Seite N“;
 * daran hängt in Tests, ob Belege und Einheiten die richtige Seite tragen.
 */
export function pdfAusSeiten(seiten: string[][]): Uint8Array {
  const stroeme = seiten.map((zeilen) => zeilen
    .map((t, i) => `BT /F1 11 Tf 50 ${800 - i * 16} Td (${t.replace(/([()\\])/g, '\\$1')}) Tj ET`)
    .join('\n'));
  // Objekte: 1 Katalog, 2 Seitenbaum, 3 Schrift, dann je Seite ein Page-Objekt (4, 6, …) und sein Inhalt (5, 7, …)
  const seitenNr = seiten.map((_, i) => 4 + i * 2);
  const objekte = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${seitenNr.map((n) => `${n} 0 R`).join(' ')}] /Count ${seiten.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    ...stroeme.flatMap((strom, i) => [
      `${seitenNr[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${seitenNr[i]! + 1} 0 R >>\nendobj\n`,
      `${seitenNr[i]! + 1} 0 obj\n<< /Length ${Buffer.byteLength(strom, 'latin1')} >>\nstream\n${strom}\nendstream\nendobj\n`,
    ]),
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

/**
 * Ein Test-Exposé für Schema v1 (Attrappe-Zweig extract_expose_v1): zwei Seiten, Seite 1 mit Kernwerten und Makler,
 * Seite 2 mit Einheitenliste, weiteren Angaben und zweitem Kontakt. `abgeschnitten` fügt die Steuerzeile ein, mit der die
 * Attrappe die erste Antwort an max_tokens abschneidet (Wiederholung + Einheiten-Nachfass).
 */
export function testExposeV1(kennung: string, optionen: { abgeschnitten?: boolean } = {}): Uint8Array {
  return pdfAusSeiten([
    [
      `Expose ${kennung} - Mehrfamilienhaus in guter Lage mit solidem Mietertrag und Entwicklungspotenzial`,
      `Adresse: ${kennung}strasse 12, 89073 Ulm`,
      'Kaufpreis: 1.250.000 EUR',
      'Wohnflaeche: 240 m2',
      'Grundstück: 480 m2',
      'Baujahr: 1965',
      'Hausgeld: 350 EUR',
      'Denkmalschutz: ja',
      `Makler: Anna ${kennung} | Beispiel Immobilien GmbH | 0171 ${kennung.replace(/\D/g, '').slice(-7).padStart(7, '0')} | anna.${kennung.toLowerCase()}@beispiel.test`,
      ...(optionen.abgeschnitten ? ['Attrappe: abgeschnitten'] : []),
    ],
    [
      'Mietaufstellung',
      'Einheit: Wohnung | EG links | 3 | 80 | 800',
      'Einheit: Wohnung | OG rechts | 3 | 80 | 820',
      'Einheit: Wohnung | DG | 2 | 80 | 700',
      'Weitere: zustand | Dach | 2015 neu gedeckt',
      'Weitere: vertrieb | Besichtigung | nach Vereinbarung',
      'Kontakt: Max Zweit | Geschäftsführer | 0711 123456 | max@beispiel.test',
      'Die Liegenschaft befindet sich in ruhiger Wohnlage, Einkaufsmoeglichkeiten und Schulen sind fusslaeufig erreichbar.',
    ],
  ]);
}
