// Bilder aus dem Exposé (Protokoll 30, P5): eingebettete Fotos herauslösen, Logos/Symbole/Duplikate filtern.
// pdfjs liefert die Bilder je Seite über die Operatorliste (paintImageXObject / paintInlineImageXObject); Rohpixel werden
// mit @napi-rs/canvas zu JPEG. Gefiltert wird nach Mindestgröße, Seitenverhältnis, Einfarbigkeit, Duplikat (Pixel-Fingerabdruck)
// und Wiederkehr auf ≥ 3 Seiten (Logo, Kopfzeile).
import { createHash } from 'node:crypto';

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let geladen: Promise<Pdfjs> | undefined;
const pdfjsLaden = () => (geladen ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

export interface ExposeBild { seite: number; breite: number; hoehe: number; mime: 'image/jpeg'; bytes: Uint8Array; hash: string }

export interface BilderOptionen { minBreite?: number; minHoehe?: number; maxBilder?: number }

const MAX_KANTE = 2400;
const MAX_SEITEN = 80;
const JPEG_QUALITAET = 85;
/** Ein Bild, das auf so vielen Seiten (oder mehr) wiederkehrt, ist Logo/Kopfzeile. */
const WIEDERKEHR_SEITEN = 3;
const MAX_VERHAELTNIS = 6;
/** Standardabweichung der Helligkeit (0–255) unter der eine Fläche als einfarbig gilt. */
const MIN_STREUUNG = 6;
const OBJEKT_WARTEZEIT_MS = 5000;
const FINGERABDRUCK = 32;

interface Roh { width: number; height: number; data?: Uint8Array | Uint8ClampedArray; kind?: number; bitmap?: any }

/** Kandidat: JPEG der ersten Fundstelle plus alle Seiten, auf denen das Bild vorkam. */
interface Kandidat { bild: Omit<ExposeBild, 'seite'>; seite: number; seiten: Set<number> }

function objektHolen(objs: any, name: string): Promise<Roh | null> {
  return new Promise((ok) => {
    const t = setTimeout(() => ok(null), OBJEKT_WARTEZEIT_MS);
    try {
      objs.get(name, (o: Roh | null) => { clearTimeout(t); ok(o ?? null); });
    } catch { clearTimeout(t); ok(null); }
  });
}

/** Rohbild → RGBA (Uint8ClampedArray) oder null, wenn das Format nicht lesbar ist. */
function alsRgba(r: Roh): Uint8ClampedArray | null {
  const { width: b, height: h, data } = r;
  if (!data || !b || !h) return null;
  const n = b * h;
  if (r.kind === 3 || data.length === n * 4) return new Uint8ClampedArray(data.buffer, data.byteOffset, n * 4).slice();
  const aus = new Uint8ClampedArray(n * 4);
  if (r.kind === 2 || data.length === n * 3) {
    for (let i = 0, j = 0; i < n; i++, j += 4) { aus[j] = data[i * 3]!; aus[j + 1] = data[i * 3 + 1]!; aus[j + 2] = data[i * 3 + 2]!; aus[j + 3] = 255; }
    return aus;
  }
  if (r.kind === 1) {
    const zeile = Math.ceil(b / 8);
    if (data.length < zeile * h) return null;
    for (let y = 0; y < h; y++) for (let x = 0; x < b; x++) {
      const v = (data[y * zeile + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 255 : 0;
      const j = (y * b + x) * 4;
      aus[j] = aus[j + 1] = aus[j + 2] = v; aus[j + 3] = 255;
    }
    return aus;
  }
  return null;
}

async function verarbeiten(roh: Roh, seite: number, vorhandene: Map<string, Kandidat>): Promise<void> {
  const { createCanvas, ImageData } = await import('@napi-rs/canvas');
  let quelle: any;
  if (roh.bitmap) {
    quelle = createCanvas(roh.width, roh.height);
    quelle.getContext('2d').drawImage(roh.bitmap, 0, 0);
  } else {
    const rgba = alsRgba(roh);
    if (!rgba) return;
    quelle = createCanvas(roh.width, roh.height);
    quelle.getContext('2d').putImageData(new ImageData(rgba, roh.width, roh.height), 0, 0);
  }
  // Fingerabdruck: 32 × 32 Helligkeit, auf 4 Bit gerundet — übersteht Neukodierung und leichte Skalierung
  const klein = createCanvas(FINGERABDRUCK, FINGERABDRUCK);
  const kctx = klein.getContext('2d');
  kctx.fillStyle = '#ffffff';
  kctx.fillRect(0, 0, FINGERABDRUCK, FINGERABDRUCK);
  kctx.drawImage(quelle, 0, 0, FINGERABDRUCK, FINGERABDRUCK);
  const px = kctx.getImageData(0, 0, FINGERABDRUCK, FINGERABDRUCK).data;
  const hell: number[] = [];
  for (let i = 0; i < px.length; i += 4) hell.push(0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!);
  const mittel = hell.reduce((s, v) => s + v, 0) / hell.length;
  const streuung = Math.sqrt(hell.reduce((s, v) => s + (v - mittel) ** 2, 0) / hell.length);
  if (streuung < MIN_STREUUNG) return;
  const hash = createHash('sha256').update(Uint8Array.from(hell, (v) => v >> 4)).digest('hex');
  const bekannt = vorhandene.get(hash);
  if (bekannt) { bekannt.seiten.add(seite); return; }

  const lang = Math.max(roh.width, roh.height);
  const f = lang > MAX_KANTE ? MAX_KANTE / lang : 1;
  const breite = Math.max(1, Math.round(roh.width * f));
  const hoehe = Math.max(1, Math.round(roh.height * f));
  const ziel = createCanvas(breite, hoehe);
  const zctx = ziel.getContext('2d');
  zctx.fillStyle = '#ffffff';
  zctx.fillRect(0, 0, breite, hoehe);
  zctx.drawImage(quelle, 0, 0, breite, hoehe);
  const bytes = new Uint8Array(ziel.toBuffer('image/jpeg', JPEG_QUALITAET));
  vorhandene.set(hash, { bild: { breite, hoehe, mime: 'image/jpeg', bytes, hash }, seite, seiten: new Set([seite]) });
}

/** Alle brauchbaren Fotos des PDFs in Dokumentreihenfolge, als JPEG; wirft nicht (Fehler → bisherige Ergebnisse). */
export async function bilderAusPdf(pdf: Uint8Array, optionen: BilderOptionen = {}): Promise<ExposeBild[]> {
  const minB = optionen.minBreite ?? 600;
  const minH = optionen.minHoehe ?? 400;
  const maxBilder = optionen.maxBilder ?? 60;
  const kandidaten = new Map<string, Kandidat>();
  let doc: any;
  try {
    const pdfjs = await pdfjsLaden();
    doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 }).promise;
    const { OPS } = pdfjs;
    const limit = Math.min(doc.numPages, MAX_SEITEN);
    for (let nr = 1; nr <= limit; nr++) {
      let page: any;
      try {
        page = await doc.getPage(nr);
        const ops = await page.getOperatorList();
        const gesehen = new Set<string>();
        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject) continue;
          try {
            const arg = ops.argsArray[i]?.[0];
            let roh: Roh | null;
            if (fn === OPS.paintInlineImageXObject) roh = arg as Roh;
            else {
              if (typeof arg !== 'string' || gesehen.has(arg)) continue;
              gesehen.add(arg);
              roh = await objektHolen(arg.startsWith('g_') ? page.commonObjs : page.objs, arg);
            }
            if (!roh?.width || !roh.height) continue;
            const { width: b, height: h } = roh;
            const grossGenug = (b >= minB && h >= minH) || (b >= minH && h >= minB);
            if (!grossGenug || Math.max(b / h, h / b) > MAX_VERHAELTNIS) continue;
            await verarbeiten(roh, nr, kandidaten);
          } catch (e) {
            console.warn('[pdf-bilder] Bild auf Seite', nr, 'übersprungen:', e instanceof Error ? e.message : e);
          }
        }
      } catch (e) {
        console.warn('[pdf-bilder] Seite', nr, 'nicht lesbar:', e instanceof Error ? e.message : e);
      } finally {
        try { page?.cleanup(); } catch { /* fertig */ }
      }
    }
  } catch (e) {
    console.warn('[pdf-bilder] PDF nicht lesbar:', e instanceof Error ? e.message.slice(0, 200) : e);
  } finally {
    try { await doc?.destroy(); } catch { /* fertig */ }
  }
  return [...kandidaten.values()]
    .filter((k) => k.seiten.size < WIEDERKEHR_SEITEN)
    .sort((a, b) => a.seite - b.seite)
    .slice(0, maxBilder)
    .map((k) => ({ seite: k.seite, ...k.bild }));
}
