/**
 * Pixelmaße eines Bildes aus seiner Data-URL (PNG, JPEG, WebP, GIF).
 *
 * pptxgenjs braucht für `sizing: cover/contain` die echten Maße des Bildes in `w`/`h` — der Rahmen gehört nur in
 * `sizing`. Bekommt es dort den Rahmen, hält es das Bild für schon passend, schneidet nichts ab und streckt es auf
 * den Rahmen: so waren die Bilder im PowerPoint-Export verzerrt (auch in der alten App, server/finanzpraes-pptx.ts).
 */
export interface Masse { w: number; h: number }

const u16be = (b: Buffer, i: number) => b.readUInt16BE(i);
const u24le = (b: Buffer, i: number) => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);

function ausBytes(b: Buffer): Masse | null {
  // PNG: Signatur, dann IHDR mit Breite/Höhe (je 4 Byte, big endian)
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  // GIF: „GIF8“, dann Breite/Höhe little endian
  if (b.length >= 10 && b.toString('ascii', 0, 4) === 'GIF8') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  // WebP: RIFF…WEBP, dann VP8 / VP8L / VP8X
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const art = b.toString('ascii', 12, 16);
    if (art === 'VP8X') return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
    if (art === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (art === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
    return null;
  }
  // JPEG: Blöcke bis zum ersten SOF (C0–CF außer C4, C8, CC) durchlaufen
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      if (marker === 0xff) { i++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: u16be(b, i + 7), h: u16be(b, i + 5) };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + u16be(b, i + 2);
    }
  }
  return null;
}

export function bildMasse(data: string): Masse | null {
  const m = /^data:[^;,]*;base64,/.exec(data);
  if (!m) return null;
  try {
    const masse = ausBytes(Buffer.from(data.slice(m[0].length), 'base64'));
    return masse && masse.w > 0 && masse.h > 0 ? masse : null;
  } catch { return null; }
}

/**
 * `w`/`h` für `addImage` neben `sizing`: Breite des Rahmens, Höhe im Seitenverhältnis des Bildes. Nur das Verhältnis
 * zählt (pptxgenjs setzt die Größe auf den Rahmen). Sind die Maße unbekannt, bleibt es beim Rahmen wie bisher.
 */
export function bildRahmen(data: string, w: number, h: number): Masse {
  const m = bildMasse(data);
  return m ? { w, h: (w * m.h) / m.w } : { w, h };
}
