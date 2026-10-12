// Dokument ohne KI lesen (Protokoll 30, P1): Textlayer mit Positionen → Zeilen und Zellen; Seiten ohne Textlayer werden
// gerendert und per OCR (Tesseract, deutsch) gelesen. Gleiches Zeilenverfahren wie pdfText (nach Y gruppieren, nach X
// sortieren); zusätzlich trennt ein waagrechter Abstand die Zellen — daraus entstehen Tabellen und „Bezeichnung: Wert“.
import { DOKUMENT_VERSION, type Dokument, type DokumentSeite } from '@gg/domain';

type Pdfjs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let geladen: Promise<Pdfjs> | undefined;
const pdfjsLaden = () => (geladen ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

const MAX_SEITEN = 50;
const ZEILEN_TOLERANZ = 3;
/** Standard-Zeitbudget für OCR je Dokument. */
const OCR_BUDGET_MS = 120_000;
/** Unter so vielen Zeichen gilt eine Seite als Bild-Seite. */
export const BILDSEITE_ZEICHEN = 100;

export interface OcrErgebnis { zeilen: string[][]; sicherheit: number; woerter: number }
/** OCR für ein PNG; austauschbar (Tests, Werkzeuge). */
export type Ocr = (png: Uint8Array) => Promise<OcrErgebnis>;

interface Stueck { x: number; y: number; b: number; s: string; h: number }

/** Stücke zu Zeilen (wie pdfText) und Zeilen zu Zellen: Lücke > max(4 pt, 0,8 × Schrifthöhe) beginnt eine neue Zelle. */
export function zuZeilenUndZellen(stuecke: Stueck[]): string[][] {
  if (!stuecke.length) return [];
  const sortiert = [...stuecke].sort((a, b) => b.y - a.y);
  const zeilen: Stueck[][] = [];
  let aktuell: Stueck[] = [];
  let zeilenY = sortiert[0]!.y;
  for (const st of sortiert) {
    if (aktuell.length && zeilenY - st.y > ZEILEN_TOLERANZ) { zeilen.push(aktuell); aktuell = []; zeilenY = st.y; }
    aktuell.push(st);
  }
  if (aktuell.length) zeilen.push(aktuell);
  return zeilen.map((z) => {
    const reihe = z.sort((a, b) => a.x - b.x);
    const zellen: string[] = [];
    let zelle = '';
    let ende = -Infinity;
    for (const st of reihe) {
      const luecke = st.x - ende;
      const schwelle = Math.max(4, 1.2 * (st.h || 10));
      if (zelle && luecke > schwelle) { zellen.push(zelle.trim()); zelle = ''; }
      zelle += (zelle && luecke > 0.15 * (st.h || 10) ? ' ' : '') + st.s;
      ende = Math.max(ende, st.x + st.b);
    }
    if (zelle.trim()) zellen.push(zelle.trim());
    return fliesstextZusammen(zellen);
  }).filter((z) => z.length);
}

/**
 * Blocksatz dehnt Wortabstände so weit, dass sie wie Zellgrenzen aussehen. Viele einwortige Zellen mit Kleinwörtern
 * und ohne Zahlen sind Fließtext → eine Zelle.
 */
export function fliesstextZusammen(zellen: string[]): string[] {
  if (zellen.length < 5) return zellen;
  const einwortig = zellen.filter((z) => !/\s/.test(z)).length;
  const klein = zellen.filter((z) => /^[a-zäöüß]/.test(z)).length;
  const zahlen = zellen.filter((z) => /\d/.test(z)).length;
  return einwortig / zellen.length >= 0.7 && klein >= 2 && zahlen / zellen.length < 0.3 ? [zellen.join(' ')] : zellen;
}

/** Seite als PNG rendern (für OCR). */
async function seiteRendern(page: any, dpi = 200): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const vp = page.getViewport({ scale: dpi / 72 });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx as any, viewport: vp, canvas: canvas as any }).promise;
  return new Uint8Array(canvas.toBuffer('image/png'));
}

/**
 * Liest das PDF ohne KI. Wirft nicht: Unlesbares ergibt Seiten vom Typ „leer“ (der Aufrufer geht dann den PDF-Weg).
 * `ocr` fehlt → Bild-Seiten bleiben ohne Text. `ocrBudgetMs` (Standard 120 s): ist die bisher für OCR verbrauchte Zeit größer,
 * folgen keine weiteren OCR-Seiten (Seite bleibt `bild` ohne OCR; Hinweis per console.warn).
 */
export async function pdfDokument(pdf: Uint8Array, optionen: { ocr?: Ocr; maxSeiten?: number; ocrBudgetMs?: number } = {}): Promise<Dokument> {
  const seiten: DokumentSeite[] = [];
  let doc: any;
  try {
    doc = await (await pdfjsLaden()).getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 }).promise;
  } catch (e) {
    console.error('[pdf-dokument] PDF nicht lesbar:', e instanceof Error ? e.message.slice(0, 200) : e);
    return { version: DOKUMENT_VERSION, seitenGesamt: 0, seiten: [] };
  }
  const ocrBudget = optionen.ocrBudgetMs ?? OCR_BUDGET_MS;
  let ocrZeit = 0;
  let budgetGemeldet = false;
  try {
    const limit = Math.min(doc.numPages, optionen.maxSeiten ?? MAX_SEITEN);
    for (let nr = 1; nr <= limit; nr++) {
      const page = await doc.getPage(nr);
      try {
        const content = await page.getTextContent();
        const stuecke: Stueck[] = [];
        for (const item of content.items as any[]) {
          const s = (item.str || '').trim();
          if (!s) continue;
          const tr = item.transform || [1, 0, 0, 1, 0, 0];
          stuecke.push({ x: tr[4] || 0, y: tr[5] || 0, b: item.width || s.length * 5, h: Math.abs(item.height || tr[3] || 10), s });
        }
        const zeilen = zuZeilenUndZellen(stuecke);
        const zeichen = zeilen.flat().join('').replace(/\s/g, '').length;
        if (zeichen >= BILDSEITE_ZEICHEN) { seiten.push({ nr, typ: 'text', zeilen, ocr: null }); continue; }
        if (!optionen.ocr) { seiten.push({ nr, typ: zeichen ? 'text' : 'bild', zeilen, ocr: null }); continue; }
        if (ocrZeit > ocrBudget) {
          if (!budgetGemeldet) { budgetGemeldet = true; console.warn(`[pdf-dokument] OCR-Zeitbudget (${ocrBudget} ms) überschritten — ab Seite ${nr} keine OCR mehr`); }
          seiten.push({ nr, typ: 'bild', zeilen, ocr: null });
          continue;
        }
        const ocrStart = Date.now();
        try {
          const o = await optionen.ocr(await seiteRendern(page));
          // vorhandener Textlayer bleibt vorne, OCR-Zeilen danach
          seiten.push({ nr, typ: 'bild', zeilen: [...zeilen, ...o.zeilen], ocr: { sicherheit: Math.round(o.sicherheit), woerter: o.woerter } });
        } catch (e) {
          console.warn('[pdf-dokument] OCR Seite', nr, 'fehlgeschlagen:', e instanceof Error ? e.message : e);
          seiten.push({ nr, typ: 'bild', zeilen, ocr: null });
        } finally {
          ocrZeit += Date.now() - ocrStart;
        }
      } catch {
        seiten.push({ nr, typ: 'leer', zeilen: [], ocr: null });
      } finally {
        page.cleanup();
      }
    }
    return { version: DOKUMENT_VERSION, seitenGesamt: doc.numPages, seiten };
  } finally {
    try { await doc.destroy(); } catch { /* fertig */ }
  }
}
