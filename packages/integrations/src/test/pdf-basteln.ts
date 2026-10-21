import { deflateSync } from 'node:zlib';

/**
 * Baut ein minimales, echtes PDF mit Textzeilen (für Tests und Klicktests).
 * Nach dem Vorbild von gg-immohandel server/pdf-text.test.ts (bastelPdf). Nur ASCII/Latin-1-Zeichen.
 */
export function pdfAusZeilen(zeilen: string[]): Uint8Array {
  const strom = zeilen
    // „a | b | c“ wird wie eine Tabellenzeile gesetzt: je Abschnitt eine eigene Spalte (echte Zellen im Textlayer)
    .map((t, i) => zeileSetzen(t, 800 - i * 16))
    .join('\n');
  const objekte = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [4 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    '4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1190 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>\nendobj\n',
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
/** Eine Zeile als PDF-Text; „a | b | c“ wird wie eine Tabellenzeile gesetzt (je Abschnitt eine Spalte, deutlicher Abstand). */
function zeileSetzen(t: string, y: number): string {
  let x = 50;
  return t.split(' | ').map((teil) => {
    const befehl = `BT /F1 11 Tf ${x} ${y} Td (${teil.replace(/([()\\])/g, '\\$1')}) Tj ET`;
    x += teil.length * 6.5 + 30;
    return befehl;
  }).join('\n');
}

export function pdfAusSeiten(seiten: string[][]): Uint8Array {
  const stroeme = seiten.map((zeilen) => zeilen
    // „a | b | c“ wird wie eine Tabellenzeile gesetzt: je Abschnitt eine eigene Spalte (echte Zellen im Textlayer)
    .map((t, i) => zeileSetzen(t, 800 - i * 16))
    .join('\n'));
  // Objekte: 1 Katalog, 2 Seitenbaum, 3 Schrift, dann je Seite ein Page-Objekt (4, 6, …) und sein Inhalt (5, 7, …)
  const seitenNr = seiten.map((_, i) => 4 + i * 2);
  const objekte = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${seitenNr.map((n) => `${n} 0 R`).join(' ')}] /Count ${seiten.length} >>\nendobj\n`,
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    ...stroeme.flatMap((strom, i) => [
      `${seitenNr[i]} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1190 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${seitenNr[i]! + 1} 0 R >>\nendobj\n`,
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
 * Ein Test-Exposé für die Erfassung v2 (Attrappe-Zweig erfasse_expose): zwei Seiten, Seite 1 mit Kernwerten und Makler,
 * Seite 2 mit Mietaufstellung, Angaben ohne Mapping (Erhaltungsreserve mit Vorschlag, Besichtigung ohne) und
 * zweitem Kontakt. `abgeschnitten` fügt die Steuerzeile ein, mit der die Attrappe die erste Antwort an max_tokens
 * abschneidet (Wiederholung ohne Mietliste + Nachfass).
 */
export function testExposeV2(kennung: string, optionen: { abgeschnitten?: boolean } = {}): Uint8Array {
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
      'Art | Lage | Zimmer | Fläche | Kaltmiete',
      'Einheit: Wohnung | EG links | 3 | 80 m2 | 800 EUR',
      'Einheit: Wohnung | OG rechts | 3 | 80 m2 | 820 EUR',
      'Einheit: Wohnung | DG | 2 | 80 m2 | 700 EUR',
      'Erhaltungsreserve: 12.000 EUR',
      'Besichtigung: nach Vereinbarung',
      'Kontakt: Max Zweit | Geschäftsführer | 0711 123456 | max@beispiel.test',
      'Die Liegenschaft befindet sich in ruhiger Wohnlage, Einkaufsmoeglichkeiten und Schulen sind fusslaeufig erreichbar.',
    ],
  ]);
}

/**
 * Wie pdfAusSeiten, aber mit eingebetteten Bildern (RGB, Flate) je Seite. Das Bild ist ein Farbverlauf; sein Muster hängt
 * von Breite, Höhe und Position in `bilder` ab — gleiche Größe an gleicher Position auf mehreren Seiten ergibt dasselbe Bild
 * (Logo-Test), andere Größe ein anderes. Die Bilder liegen untereinander auf der Seite (je ≤ 400 pt hoch dargestellt).
 */
export function pdfMitBildern(seiten: { zeilen: string[]; bilder?: { breite: number; hoehe: number }[] }[]): Uint8Array {
  const teile: Buffer[] = [];
  const offsets: number[] = [];
  let laenge = 0;
  const dazu = (b: Buffer | string) => { const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b; teile.push(buf); laenge += buf.length; };
  const objekt = (nr: number, inhalt: Buffer | string) => { offsets[nr] = laenge; dazu(`${nr} 0 obj\n`); dazu(inhalt); dazu('\nendobj\n'); };
  const strom = (woerterbuch: string, daten: Buffer) => Buffer.concat([
    Buffer.from(`<< ${woerterbuch} /Length ${daten.length} >>\nstream\n`, 'latin1'), daten, Buffer.from('\nendstream', 'latin1'),
  ]);

  // Nummern: 1 Katalog, 2 Seitenbaum, 3 Schrift; je Seite Page, Inhalt, dann je Bild ein XObject
  let nr = 4;
  const plan = seiten.map((s) => {
    const seiteNr = nr++;
    const inhaltNr = nr++;
    const bildNr = (s.bilder ?? []).map(() => nr++);
    return { s, seiteNr, inhaltNr, bildNr };
  });
  dazu('%PDF-1.4\n');
  objekt(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objekt(2, `<< /Type /Pages /Kids [${plan.map((p) => `${p.seiteNr} 0 R`).join(' ')}] /Count ${seiten.length} >>`);
  objekt(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  for (const p of plan) {
    const bilder = p.s.bilder ?? [];
    let y = 780;
    const malen = bilder.map((b, i) => {
      const h = Math.min(400, b.hoehe * (b.breite > 1000 ? 1000 / b.breite : 1));
      const w = b.hoehe ? (h * b.breite) / b.hoehe : h;
      y -= h + 10;
      return `q ${w.toFixed(1)} 0 0 ${h.toFixed(1)} 50 ${Math.max(0, y).toFixed(1)} cm /Im${i} Do Q`;
    }).join('\n');
    const text = p.s.zeilen.map((t, i) => zeileSetzen(t, 820 - i * 16)).join('\n');
    const inhalt = `${text}\n${malen}`;
    objekt(p.seiteNr, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1190 842] /Resources << /Font << /F1 3 0 R >> /XObject << ${bilder.map((_, i) => `/Im${i} ${p.bildNr[i]} 0 R`).join(' ')} >> >> /Contents ${p.inhaltNr} 0 R >>`);
    objekt(p.inhaltNr, strom('', Buffer.from(inhalt, 'latin1')));
    bilder.forEach((b, i) => {
      const roh = Buffer.alloc(b.breite * b.hoehe * 3);
      const seed = b.breite * 7 + b.hoehe * 13 + i * 101;
      for (let yy = 0; yy < b.hoehe; yy++) for (let xx = 0; xx < b.breite; xx++) {
        const o = (yy * b.breite + xx) * 3;
        roh[o] = (xx * 255 / b.breite + seed * 3) % 256;
        roh[o + 1] = (yy * 255 / b.hoehe + seed * 5) % 256;
        roh[o + 2] = ((xx + yy) * 127 / (b.breite + b.hoehe) * 2 + seed) % 256;
      }
      objekt(p.bildNr[i]!, strom(`/Type /XObject /Subtype /Image /Width ${b.breite} /Height ${b.hoehe} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`, deflateSync(roh)));
    });
  }
  const xref = laenge;
  const gesamt = nr;
  dazu(`xref\n0 ${gesamt}\n0000000000 65535 f \n${Array.from({ length: gesamt - 1 }, (_, i) => `${String(offsets[i + 1]).padStart(10, '0')} 00000 n \n`).join('')}`);
  dazu(`trailer\n<< /Size ${gesamt} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(teile));
}
