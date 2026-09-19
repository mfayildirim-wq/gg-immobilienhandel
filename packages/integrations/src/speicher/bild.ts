/**
 * Bildtyp aus den ersten Bytes (Upload-Prüfung). Strenger als `mimeAusSignatur` im Export (dort Rückfall jpeg):
 * was hier nicht erkannt wird, ist kein Bild und wird abgelehnt.
 * HEIC/HEIF zählt mit, weil die alte App iPhone-Fotos ungewandelt speicherte, wenn der Browser sie nicht umrechnen konnte.
 */
export type BildTyp = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/heic';

const ascii = (b: Uint8Array, von: number, bis: number) => String.fromCharCode(...b.subarray(von, bis));

export function bildTypErkennen(b: Uint8Array): BildTyp | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 6 && ascii(b, 0, 4) === 'GIF8') return 'image/gif';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && ['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heif'].includes(ascii(b, 8, 12))) return 'image/heic';
  return null;
}

/** Höchstgröße eines Fotos nach der Komprimierung im Browser (alte App: 8 MB). */
export const MAX_FOTO_BYTES = 8 * 1024 * 1024;
