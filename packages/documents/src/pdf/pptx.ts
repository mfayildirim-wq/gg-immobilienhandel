// Wörtliche Kopie von gg-immohandel server/finanzpraes-pptx.ts (Abweichungen: Importpfade, Foto-Port ohne Storage-Standard).
// ──────────────────────────────────────────────────────────────
// Bank-Finanzierungspräsentation — PPTX-Export via pptxgenjs
// ──────────────────────────────────────────────────────────────
// Generiert eine .pptx Datei (PowerPoint) parallel zum PDF-Export.
// User kann nach dem Export in PowerPoint manuell nacharbeiten.
//
// Format: A4 Querformat (11.69" × 8.27" — pptxgenjs LAYOUT_WIDE
// ist nicht exakt A4, deshalb custom layout).
//
// Phase A3: Deckblatt-Renderer als Test-Implementierung.
// Phase B fügt 15 weitere Renderer hinzu — pro Slide-Typ einen
// pptxBuild-Renderer parallel zum HTML-Renderer.
// ──────────────────────────────────────────────────────────────

import { createRequire } from 'node:module';
import type PptxGenJSTyp from 'pptxgenjs';

/**
 * `pptxgenjs` wird bewusst über `createRequire` geholt und nicht importiert.
 *
 * Das Paket ist ein Doppelpaket: `exports.import` zeigt auf eine ESM-Datei,
 * `exports.require` auf eine CommonJS-Datei. Welche davon ankommt und wie sie
 * geladen wird, beantworten die drei Ladewege dieses Projekts verschieden —
 * alles am 05.08.2026 gemessen:
 *
 *   echtes Node-ESM in server/   `import X from` → X ist die Klasse
 *   tsx (dev:backend, E2E)       `import X from` → X ist ein Namensraum,
 *                                die Klasse liegt unter X.default
 *   Vercel-Function              löst mit der import-Bedingung auf (ESM-Datei)
 *                                und lädt sie dann als CommonJS:
 *                                „Cannot use import statement outside a module"
 *
 * Zwei Versuche sind daran gescheitert: der statische Default-Import (kaputt
 * unter tsx) und `await import('pptxgenjs')` (kaputt in der Function). Beide
 * überlassen dem jeweiligen Lader die Wahl der Datei — und die Lader sind sich
 * nicht einig.
 *
 * `createRequire` nimmt diese Wahl weg: es löst immer über die
 * require-Bedingung auf, bekommt also immer die CommonJS-Datei, und die lädt
 * überall. Unter Node-ESM und unter tsx nachgemessen.
 */
const verlange = createRequire(import.meta.url);
const PptxGenJSModul: unknown = verlange('pptxgenjs');
const PptxGenJSKlasse = (
  typeof PptxGenJSModul === 'function'
    ? PptxGenJSModul
    : (PptxGenJSModul as { default: unknown }).default
) as new () => PptxGenJSTyp;

type PptxGenJS = PptxGenJSTyp;
type BorderProps = PptxGenJSTyp.BorderProps;
import { objektFakten, type FinanzPraes, type Slide, type SlideTyp } from '@gg/domain';
import { loeseVerweiseAuf, type BilderDeps } from './bilder.ts';
import { IVT_LOGO_DATA_URL } from '../logo.ts';
import {
  pptxSeitenAnzahl,
  pptxTabellenSeiten,
  pptxTabellenTitel,
  renderDataTablePptx,
} from './pptx-tabelle.ts';

// A4 Querformat in Inch (pptxgenjs nutzt Inches)
const SLIDE_WIDTH = 11.69;
const SLIDE_HEIGHT = 8.27;

type PptxSlide = ReturnType<PptxGenJS['addSlide']>;
type SlidePptxRenderer = (slide: Slide, pptxSlide: PptxSlide, ctx: PptxRenderContext) => void;

interface PptxRenderContext {
  praes: FinanzPraes;
  pageNumber: number;
  totalPages: number;
  /** Welche Seite einer mehrseitigen Tabelle gerade gezeichnet wird (ab 0).
   *  Nur renderEinzelbildPptx liest das; alle anderen Renderer bekommen 0 / 1. */
  seite: number;
  seitenGesamt: number;
}

/** Ohne Foto-Port bleiben Verweise leere Stellen (alt: Standard war der Storage-Zugriff). */
const OHNE_FOTOS: BilderDeps = { holeFoto: async () => null };

const SLIDE_RENDERERS: Partial<Record<SlideTyp, SlidePptxRenderer>> = {
  deckblatt: renderDeckblattPptx,
  objektbeschreibung: renderObjektPptx,
  lagebeschreibung: renderLagePptx,
  projektbeschreibung: renderProjektPptx,
  geschaeftsmodell: renderGeschaeftsmodellPptx,
  projektkalkulation: renderEinzelbildPptx,
  verkaufspreise: renderEinzelbildPptx,
  mietenaufstellung: renderEinzelbildPptx,
  finanzierungsstruktur: renderFinanzierungPptx,
  organigramm: renderOrganigrammPptx,
  abschluss: renderAbschlussPptx,
  impressionen: renderImpressionenPptx,
  referenz: renderReferenzPptx,
  kundenliste: renderKundenlistePptx,
  marktvergleich: renderMarktvergleichPptx,
};

// ──────────────────────────────────────────────────────────────
// Hauptfunktion: erzeugt PPTX-Buffer
// ──────────────────────────────────────────────────────────────

// `deps` ist ausschliesslich für den Test da: dieser Renderer laeuft als
// einziger der drei ohne Browser und ist damit die einzige Stelle, an der sich
// die Verdrahtung „Verweis rein, Bild in der Datei" ueberhaupt pruefen laesst.
export async function renderFinanzPraesPptx(praesRoh: FinanzPraes, deps: BilderDeps = OHNE_FOTOS): Promise<Buffer> {
  // Fotos einbetten, bevor die Folien gebaut werden: pptxgenjs kennt nur
  // addImage({ data }), also eine Data-URL. Bis zum 05.08.2026 lieferte der
  // Browser sie fertig mit — und riss damit die 4,5-MB-Grenze der Function
  // (Begründung im Kopf von server/finanzpraes-bilder.ts).
  const praes = await loeseVerweiseAuf(praesRoh, deps);
  const pres = new PptxGenJSKlasse();
  // Custom Layout (A4 Querformat) — muss VOR layout-Zuweisung definiert sein
  pres.defineLayout({ name: 'A4_LANDSCAPE', width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
  pres.layout = 'A4_LANDSCAPE';
  pres.title = `Bank-Präsentation${praes.bankName ? ' – ' + praes.bankName : ''}`;
  pres.author = 'IVT Wohnen GmbH';
  pres.company = 'IVT Wohnen GmbH';

  const visibleSlides = praes.slides.filter((s) => s.visible);

  if (visibleSlides.length === 0) {
    // Mindestens eine leere Slide damit die Datei valide ist
    const slide = pres.addSlide();
    slide.addText('Keine sichtbaren Slides', {
      x: 1, y: 3.5, w: SLIDE_WIDTH - 2, h: 1,
      align: 'center', fontSize: 18, color: '888888',
    });
  } else {
    // Erst Total-Pages berechnen: Grundrisse mit N Bildern = N Seiten, lange
    // Tabellen ebenso N Seiten. Die Fußzeile zählt mit, also muss die Summe
    // feststehen, bevor die erste Folie entsteht.
    let totalPages = 0;
    for (const s of visibleSlides) {
      if (s.typ === 'grundrisse') {
        const bilder = Array.isArray(s.data.bilder) ? s.data.bilder : [];
        totalPages += Math.max(1, bilder.length);
      } else {
        totalPages += pptxSeitenAnzahl(s);
      }
    }
    let pageNumber = 0;
    visibleSlides.forEach((slide) => {
      // Sonderfall Grundrisse: pro Bild eine eigene PPTX-Slide
      if (slide.typ === 'grundrisse') {
        const bilder: string[] = Array.isArray(slide.data.bilder) ? slide.data.bilder : [];
        const captions: string[] = Array.isArray(slide.data.captions) ? slide.data.captions : [];
        if (bilder.length === 0) {
          pageNumber += 1;
          const pptxSlide = pres.addSlide();
          const ctx: PptxRenderContext = { praes, pageNumber, totalPages, seite: 0, seitenGesamt: 1 };
          renderGrundrissEmptyPptx(pptxSlide);
          addHeaderFooter(pptxSlide, ctx);
          return;
        }
        bilder.forEach((bild, i) => {
          pageNumber += 1;
          const pptxSlide = pres.addSlide();
          const ctx: PptxRenderContext = { praes, pageNumber, totalPages, seite: 0, seitenGesamt: 1 };
          renderGrundrissPagePptx(bild, captions[i] || '', i + 1, bilder.length, pptxSlide);
          addHeaderFooter(pptxSlide, ctx);
        });
        return;
      }
      // Eine Tabelle, die nicht auf eine Folie passt, wird zu mehreren Folien.
      // Vorher lief sie unten aus der Folie heraus — warum das lautlos passierte,
      // steht in finanzpraes-pptx-tabelle.ts.
      const seitenGesamt = pptxSeitenAnzahl(slide);
      for (let seite = 0; seite < seitenGesamt; seite++) {
        pageNumber += 1;
        const pptxSlide = pres.addSlide();
        const ctx: PptxRenderContext = { praes, pageNumber, totalPages, seite, seitenGesamt };
        const renderer = SLIDE_RENDERERS[slide.typ];
        if (renderer) renderer(slide, pptxSlide, ctx);
        else renderPlaceholderPptx(slide, pptxSlide);
        addHeaderFooter(pptxSlide, ctx);
      }
    });
  }

  // pptxgenjs liefert ArrayBuffer/Uint8Array zurück
  const data = await pres.write({ outputType: 'nodebuffer' });
  return Buffer.from(data as ArrayBuffer);
}

// ──────────────────────────────────────────────────────────────
// Footer (parallel zum PDF-Footer)
// ──────────────────────────────────────────────────────────────

/** Logo oben rechts + Footer unten auf jeder Slide. */
function addHeaderFooter(slide: PptxSlide, ctx: PptxRenderContext): void {
  // Logo oben rechts (Höhe ~12mm = ~0.47 Inch)
  slide.addImage({
    data: IVT_LOGO_DATA_URL,
    x: SLIDE_WIDTH - 1.7, y: 0.2,
    w: 1.4, h: 0.4,
    sizing: { type: 'contain', w: 1.4, h: 0.4 },
  });
  // Footer (nur Bankname links, keine "Bank-Präsentation"-Bezeichnung mehr)
  const bank = ctx.praes.bankName || '';
  if (bank) {
    slide.addText(bank, {
      x: 0.5, y: SLIDE_HEIGHT - 0.4, w: SLIDE_WIDTH - 2, h: 0.3,
      fontSize: 8, color: '888888', fontFace: 'Calibri',
    });
  }
  slide.addText(`${ctx.pageNumber} / ${ctx.totalPages}`, {
    x: SLIDE_WIDTH - 1.5, y: SLIDE_HEIGHT - 0.4, w: 1, h: 0.3,
    fontSize: 8, color: '888888', align: 'right', fontFace: 'Calibri',
  });
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Deckblatt (Phase A3 Test)
// ──────────────────────────────────────────────────────────────

function renderDeckblattPptx(slide: Slide, pptx: PptxSlide, _ctx: PptxRenderContext): void {
  const titel = slide.data.titel || 'ANKAUF';
  const untertitel = slide.data.untertitel || '';
  // Backward-Compat (2026-05-15): bildPath ist neu, bilder[]-Array war alt.
  const bilderLegacy: string[] = Array.isArray(slide.data.bilder) ? slide.data.bilder : [];
  const hauptbild = (slide.data.bildPath as string) || bilderLegacy[0] || '';

  pptx.background = { color: 'FAFBFC' };

  // Linke Spalte (45%): Titel + Untertitel vertikal zentriert
  const leftW = SLIDE_WIDTH * 0.45;
  // Hellgrauer Hintergrund linke Spalte
  pptx.addShape('rect', {
    x: 0, y: 0, w: leftW, h: SLIDE_HEIGHT,
    fill: { color: 'EAEFF4' },
    line: { color: 'EAEFF4', width: 0 },
  });
  pptx.addText(titel, {
    x: 0.6, y: 3.0, w: leftW - 1.0, h: 1.4,
    fontSize: 30, bold: true, color: '2A2A2A',
    fontFace: 'Calibri', valign: 'top',
  });
  if (untertitel) {
    pptx.addText(untertitel, {
      x: 0.6, y: 4.5, w: leftW - 1.0, h: 1.0,
      fontSize: 17, color: '3D5A80',
      fontFace: 'Calibri', valign: 'top',
    });
  }

  // Rechte Spalte (55%): Hauptbild vollformatig vertikal
  const rightX = leftW;
  const rightW = SLIDE_WIDTH - leftW;
  if (hauptbild) {
    pptx.addImage({
      data: hauptbild,
      x: rightX, y: 0, w: rightW, h: SLIDE_HEIGHT,
      sizing: { type: 'cover', w: rightW, h: SLIDE_HEIGHT },
    });
  } else {
    imgPlaceholder(pptx, rightX, 0, rightW, SLIDE_HEIGHT, 'Kein Hauptbild hinterlegt');
  }
}

// ──────────────────────────────────────────────────────────────
// Layout-Konstanten + Helpers
// ──────────────────────────────────────────────────────────────

const PAD_X = 0.71;            // ≈ 18mm
const PAD_Y_TOP = 0.86;        // ≈ 22mm (Platz für Logo oben rechts)
const PAD_Y_BOT = 0.85;        // ≈ 21mm Platz für Footer + Sicherheits-Gap
const CONTENT_W = SLIDE_WIDTH - 2 * PAD_X;
const CONTENT_H = SLIDE_HEIGHT - PAD_Y_TOP - PAD_Y_BOT; // Inhalt endet vor Footer

function bgWhite(pptx: PptxSlide): void {
  pptx.background = { color: 'FFFFFF' };
}

function addTitle(pptx: PptxSlide, text: string): void {
  pptx.addText(text, {
    x: PAD_X, y: PAD_Y_TOP, w: CONTENT_W, h: 0.55,
    fontSize: 22, bold: true, color: '2A2A2A', fontFace: 'Calibri',
  });
  // Goldene Linie
  pptx.addShape('line', {
    x: PAD_X, y: PAD_Y_TOP + 0.55, w: CONTENT_W, h: 0,
    line: { color: '1E3A5F', width: 2 },
  });
}

function bulletsList(text: any): { text: string; options: any }[] {
  const items = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  // Jeder Eintrag = eigene Zeile. breakLine sorgt für Newline zwischen Items.
  // Kein Bullet-Symbol — analog zum HTML-Renderer der nur Zeilen ohne Marker zeigt.
  return items.map((i, idx) => ({
    text: i,
    options: { bullet: false, breakLine: idx < items.length - 1 },
  }));
}

function imgPlaceholder(pptx: PptxSlide, x: number, y: number, w: number, h: number, label: string): void {
  // Klean: nur dezenter Rand, kein Füll-Hintergrund
  pptx.addText(label, {
    x, y, w, h, align: 'center', valign: 'middle',
    fontSize: 9, italic: true, color: 'AAAAAA',
    line: { color: 'D8DDE2', width: 0.5, dashType: 'dash' },
  });
}

const CONTENT_TOP = PAD_Y_TOP + 0.85;

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Objektbeschreibung
// ──────────────────────────────────────────────────────────────

function renderObjektPptx(slide: Slide, pptx: PptxSlide): void {
  bgWhite(pptx);
  addTitle(pptx, 'Objektbeschreibung');
  const d = slide.data;
  const facts = objektFakten(d);

  const colW = (CONTENT_W - 0.3) / 2;
  const noneBorder = { type: 'none' as const, pt: 0, color: 'FFFFFF' };
  // pptxgenjs erwartet hier ein 4er-Tupel (oben/rechts/unten/links), kein Array.
  const rowBorder: [BorderProps, BorderProps, BorderProps, BorderProps] =
    [noneBorder, noneBorder, { type: 'solid', pt: 0.5, color: 'CFD9E2' }, noneBorder];

  // Linke Spalte: Key-Facts-Tabelle (nur Bottom-Borders) + Beschreibung darunter
  let leftY = CONTENT_TOP;
  const rowHFacts = 0.32;
  if (facts.length > 0) {
    pptx.addTable(
      facts.map(([k, v]) => [
        { text: k, options: { color: '3D5A80', bold: true, fontSize: 10, fontFace: 'Calibri', valign: 'middle' as const, margin: 0.04, border: rowBorder } },
        { text: v, options: { color: '1A1A1A', fontSize: 10, fontFace: 'Calibri', valign: 'middle' as const, margin: 0.04, border: rowBorder } },
      ]),
      {
        x: PAD_X, y: leftY, w: colW, colW: [colW * 0.4, colW * 0.6],
        rowH: rowHFacts,
        fontFace: 'Calibri', autoPage: false,
      }
    );
    leftY += facts.length * rowHFacts + 0.2;
  }
  if (d.beschreibung) {
    const remH = (CONTENT_TOP + CONTENT_H - 0.2) - leftY;
    if (remH > 0.3) {
      pptx.addText(d.beschreibung, {
        x: PAD_X, y: leftY, w: colW, h: remH,
        fontSize: 10, color: '333333', fontFace: 'Calibri',
        valign: 'top', margin: 0,
      });
    }
  }
  // Rechte Spalte: Bild über volle Höhe
  if (d.bildPath) {
    pptx.addImage({
      data: d.bildPath, x: PAD_X + colW + 0.3, y: CONTENT_TOP,
      w: colW, h: CONTENT_H - 0.2,
      sizing: { type: 'cover', w: colW, h: CONTENT_H - 0.2 },
    });
  } else {
    imgPlaceholder(pptx, PAD_X + colW + 0.3, CONTENT_TOP, colW, CONTENT_H - 0.2, 'Kein Bild');
  }
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Lagebeschreibung
// ──────────────────────────────────────────────────────────────

function renderLagePptx(slide: Slide, pptx: PptxSlide): void {
  bgWhite(pptx);
  addTitle(pptx, 'Lagebeschreibung');
  const d = slide.data;
  const colW = (CONTENT_W - 0.3) / 2;
  // Standort
  let y = CONTENT_TOP;
  pptx.addText('STANDORT', {
    x: PAD_X, y, w: colW, h: 0.3,
    fontSize: 11, bold: true, color: '3D5A80', fontFace: 'Calibri',
    valign: 'top', margin: 0,
  });
  y += 0.35;
  const standortLines = String(d.standortBullets || '').split('\n').filter(Boolean).length;
  const standortH = Math.max(0.3, standortLines * 0.24);
  pptx.addText(bulletsList(d.standortBullets), {
    x: PAD_X, y, w: colW, h: standortH,
    fontSize: 10, color: '333333', fontFace: 'Calibri', valign: 'top', margin: 0,
  });
  y += standortH + 0.4;
  // Anbindung — auto-positioned nach Standort
  pptx.addText('ANBINDUNG', {
    x: PAD_X, y, w: colW, h: 0.3,
    fontSize: 11, bold: true, color: '3D5A80', fontFace: 'Calibri',
    valign: 'top', margin: 0,
  });
  y += 0.35;
  const anbindungLines = String(d.anbindungBullets || '').split('\n').filter(Boolean).length;
  const anbindungH = Math.max(0.3, anbindungLines * 0.24);
  pptx.addText(bulletsList(d.anbindungBullets), {
    x: PAD_X, y, w: colW, h: anbindungH,
    fontSize: 10, color: '333333', fontFace: 'Calibri', valign: 'top', margin: 0,
  });
  // Bild
  if (d.bildPath) {
    pptx.addImage({
      data: d.bildPath, x: PAD_X + colW + 0.3, y: CONTENT_TOP,
      w: colW, h: CONTENT_H - 0.2,
      sizing: { type: 'cover', w: colW, h: CONTENT_H - 0.2 },
    });
  } else {
    imgPlaceholder(pptx, PAD_X + colW + 0.3, CONTENT_TOP, colW, CONTENT_H - 0.2, 'Karte / Foto');
  }
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Projektbeschreibung (3 Sektionen)
// ──────────────────────────────────────────────────────────────

function renderProjektPptx(slide: Slide, pptx: PptxSlide): void {
  bgWhite(pptx);
  addTitle(pptx, 'Projektbeschreibung');
  const d = slide.data;
  // Natürlicher Fluss: Sektionen folgen aufeinander, jede Sektion nimmt
  // nur so viel Höhe wie nötig (basierend auf Zeilenanzahl)
  const sections: [string, string][] = [
    ['AKTUELLER STAND', d.aktuellerStand || '—'],
    ['GEPLANTE MASSNAHMEN', d.geplanteMassnahmen || '—'],
    ['VERTRIEB', d.vertrieb || '—'],
  ];
  let y = CONTENT_TOP;
  sections.forEach(([titel, body]) => {
    // Heading
    pptx.addText(titel, {
      x: PAD_X, y, w: CONTENT_W, h: 0.3,
      fontSize: 11, bold: true, color: '3D5A80', fontFace: 'Calibri',
      valign: 'top', margin: 0,
    });
    y += 0.32;
    // Body — Höhe nach Zeilenanzahl (auto-shrink macht pptxgenjs nicht, wir schätzen)
    const lines = String(body).split('\n').length;
    const bodyH = Math.max(0.3, lines * 0.22);
    pptx.addText(body, {
      x: PAD_X, y, w: CONTENT_W, h: bodyH,
      fontSize: 10, color: '333333', fontFace: 'Calibri',
      valign: 'top', margin: 0,
    });
    y += bodyH + 0.35;  // Abstand zur nächsten Sektion
  });
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Geschäftsmodell (4 Quadranten)
// ──────────────────────────────────────────────────────────────

function renderGeschaeftsmodellPptx(slide: Slide, pptx: PptxSlide): void {
  bgWhite(pptx);
  addTitle(pptx, 'Geschäftsmodell');
  const d = slide.data;
  // 5 Sektionen wie im Original-Pitch — leere Sektionen werden übersprungen
  const sections: [string, string][] = [
    ['ZIELGRUPPE', d.zielgruppe || ''],
    ['ANGEBOT DER IVT', d.angebot || ''],
    ['KUNDENGEWINNUNG', d.kundengewinnung || ''],
    ['VORTEILE FÜR DIE KUNDEN', d.vorteile || ''],
    ['VORTEILE FÜR DIE IVT', d.vorteileIvt || ''],
  ].filter(([, body]) => !!body) as [string, string][];

  // Verfügbare Höhe gleichmäßig auf alle Sektionen aufteilen
  const availH = CONTENT_H - 0.2;
  const totalLines = sections.reduce((sum, [, b]) => sum + String(b).split('\n').length, 0);
  const sectionGap = 0.2;
  const headerH = 0.3;
  // Geschätzte Höhe pro Bullet-Zeile, dynamisch je nach Anzahl
  const bulletH = Math.min(0.24, Math.max(0.18, (availH - sections.length * (headerH + sectionGap)) / Math.max(1, totalLines)));
  let y = CONTENT_TOP;
  sections.forEach(([titel, body]) => {
    pptx.addText(titel, {
      x: PAD_X, y, w: CONTENT_W, h: headerH,
      fontSize: 10, bold: true, color: '3D5A80', fontFace: 'Calibri',
      valign: 'top', margin: 0,
    });
    y += headerH + 0.02;
    const lines = String(body).split('\n').length;
    const bodyH = Math.max(0.3, lines * bulletH);
    pptx.addText(bulletsList(body), {
      x: PAD_X, y, w: CONTENT_W, h: bodyH,
      fontSize: 9.5, color: '333333', fontFace: 'Calibri',
      valign: 'top', margin: 0,
    });
    y += bodyH + sectionGap;
  });
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Einzelbild (Kalkulation/Verkaufspreise/Mieten)
// ──────────────────────────────────────────────────────────────

function renderEinzelbildPptx(slide: Slide, pptx: PptxSlide, ctx: PptxRenderContext): void {
  bgWhite(pptx);
  const d = slide.data;
  const seiten = pptxTabellenSeiten(slide);
  const seite = ctx?.seite || 0;
  const seitenGesamt = Math.max(1, seiten.length);
  addTitle(pptx, pptxTabellenTitel(slide.typ as string, seite, seitenGesamt));

  // Der Beschreibungstext gehört unter die vollständige Tabelle, steht also nur
  // auf der letzten Seite — sonst behauptet er auf jeder Folie ein Fazit.
  const istLetzteSeite = seite >= seitenGesamt - 1;
  const zeigtBeschreibung = istLetzteSeite && !!d.beschreibung;
  const beschH = zeigtBeschreibung ? 1.0 : 0;
  const bodyH = CONTENT_H - 0.2 - beschH;

  if (seiten.length > 0) {
    renderDataTablePptx(pptx, {
      headers: d.tableHeaders,
      rows: seiten[seite] || [],
      // Der Untertitel („Aufteiler-Kalkulation") steht einmal, nicht auf jeder
      // Seite — der Tabellenkopf dagegen wiederholt sich auf jeder.
      subtitle: seite === 0 ? d.tableTitle : '',
      x: PAD_X, w: CONTENT_W,
      yStart: CONTENT_TOP, maxH: bodyH,
    });
  } else if (d.bildPath) {
    pptx.addImage({
      data: d.bildPath, x: PAD_X, y: CONTENT_TOP, w: CONTENT_W, h: bodyH,
      sizing: { type: 'contain', w: CONTENT_W, h: bodyH },
    });
  } else {
    imgPlaceholder(pptx, PAD_X, CONTENT_TOP, CONTENT_W, bodyH, 'Bild oder Tabelle fehlt');
  }
  if (zeigtBeschreibung) {
    pptx.addText(d.beschreibung, {
      x: PAD_X, y: CONTENT_TOP + bodyH + 0.15, w: CONTENT_W, h: beschH,
      fontSize: 10, color: '333333', fontFace: 'Calibri', valign: 'top',
    });
  }
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Finanzierungsstruktur
// ──────────────────────────────────────────────────────────────

function renderFinanzierungPptx(slide: Slide, pptx: PptxSlide): void {
  bgWhite(pptx);
  addTitle(pptx, 'Finanzierungsstruktur');
  const d = slide.data;
  // Zusammengesetzte EM/FM-Anzeigen wie in den Original-Pitches: "18% 237.000 €"
  const emCombined = [d.ekAnteil, d.em].filter(Boolean).join(' ');
  const fmCombined = [d.fkAnteil, d.fm].filter(Boolean).join(' ');
  const rows: [string, string][] = [
    ['Gesamt-Investitionskosten (GIK)', d.gik],
    ['Eigenmittel', emCombined || d.em],
    ['Fremdmittel Bank', fmCombined || d.fm],
    ['Zinsbindung Bank', d.zinsbindung],
    ['Strukturierungsentgelt Bank', d.strukturierungsentgelt],
    ['Kreditlaufzeit', d.kreditlaufzeit],
    ['Kreditnehmer', d.kreditnehmer],
    ['Verwendungszweck', d.verwendungszweck],
    ['Bürgschaft', d.buergschaft],
    ['Grundschuldeintragung', d.grundschuldeintragung],
    ['Aufteilung Grundschuld', d.grundschuldAufteilung],
    ['Ausschüttung', d.ausschuettung],
    ['Verzinsung p.a.', d.verzinsung],
    ['Tilgung p.a.', d.tilgung],
    ['Bereitstellung', d.bereitstellung],
  ].filter(([, v]) => !!v) as [string, string][];

  // Verfügbare Höhe nach Title (-0.7) und vor Footer (Sicherheits-Gap)
  const tableY = CONTENT_TOP;
  const availH = CONTENT_H - 0.2 - (d.zusatzBullets ? 1.6 : 0);
  // Dynamische Zeilenhöhe je nach Anzahl, aber mit Min/Max-Klammer
  const rowH = rows.length > 0
    ? Math.min(0.42, Math.max(0.24, availH / rows.length))
    : 0.42;
  const tableW = Math.min(CONTENT_W, 9.5);
  // Schriftgröße kleiner wenn viele Zeilen
  const labelFs = rows.length > 12 ? 9 : 10;
  const valueFs = rows.length > 12 ? 10 : 11;
  if (rows.length > 0) {
    pptx.addTable(
      rows.map(([k, v]) => [
        { text: k, options: { color: '3D5A80', fontSize: labelFs, valign: 'middle', margin: 0.03 } },
        { text: v, options: { color: '1A1A1A', bold: true, fontSize: valueFs, align: 'right', valign: 'middle', margin: 0.03 } },
      ]),
      {
        x: PAD_X, y: tableY, w: tableW,
        colW: [tableW * 0.45, tableW * 0.55],
        fontFace: 'Calibri',
        border: [
          { type: 'none' as const, pt: 0, color: 'FFFFFF' },
          { type: 'none' as const, pt: 0, color: 'FFFFFF' },
          { type: 'solid' as const, pt: 0.5, color: 'CFD9E2' },
          { type: 'none' as const, pt: 0, color: 'FFFFFF' },
        ],
        rowH,
        autoPage: false,
      }
    );
  }
  if (d.zusatzBullets) {
    const bulletsY = tableY + rows.length * rowH + 0.2;
    pptx.addText('Weitere Konditionen', {
      x: PAD_X, y: bulletsY, w: CONTENT_W, h: 0.3,
      fontSize: 11, bold: true, color: '3D5A80', fontFace: 'Calibri',
    });
    pptx.addText(bulletsList(d.zusatzBullets), {
      x: PAD_X, y: bulletsY + 0.35, w: CONTENT_W,
      h: Math.max(0.4, CONTENT_H - (bulletsY + 0.35 - CONTENT_TOP)),
      fontSize: 10, color: '333333', fontFace: 'Calibri', valign: 'top',
    });
  }
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Grundrisse-Page (eine pro Bild — Sonderfall)
// ──────────────────────────────────────────────────────────────

function renderGrundrissPagePptx(bild: string, caption: string, num: number, total: number, pptx: PptxSlide): void {
  bgWhite(pptx);
  const titel = caption ? `Grundriss ${caption}` : `Grundriss ${num} / ${total}`;
  addTitle(pptx, titel);
  // 2026-05-16: Reserviere zusätzlichen Raum unter dem Titel (Titel ist ~0.55"
  // hoch). Wenn das Bild zu nah am Titel anfängt UND PPT cropping anwendet,
  // wird der obere Rand des Grundrisses unter den Titel geschoben. Mit
  // y = CONTENT_TOP + 0.6 und reduzierter Höhe stellt sicher dass das
  // Bild komplett in der Slide-Mitte landet.
  const imgTop = CONTENT_TOP + 0.6;
  const imgH = CONTENT_H - 0.8;  // Sicherheits-Reserve oben (Titel) + unten (Footer)
  pptx.addImage({
    data: bild,
    x: PAD_X, y: imgTop,
    w: CONTENT_W, h: imgH,
    sizing: { type: 'contain', w: CONTENT_W, h: imgH },
  });
}

function renderGrundrissEmptyPptx(pptx: PptxSlide): void {
  bgWhite(pptx);
  addTitle(pptx, 'Grundrisse');
  imgPlaceholder(pptx, PAD_X, CONTENT_TOP, CONTENT_W, CONTENT_H - 0.2, 'Keine Grundrisse hinterlegt');
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Organigramm (4 Quadranten)
// ──────────────────────────────────────────────────────────────

function renderOrganigrammPptx(slide: Slide, pptx: PptxSlide): void {
  bgWhite(pptx);
  addTitle(pptx, 'Organigramm');
  const d = slide.data;
  const bild = d.bild || '';
  const beschreibung = d.beschreibung || '';
  // Bild kleiner halten — nicht volle Breite, sondern zentriert mit max 60% der CONTENT_W
  // damit Höhe nicht über die Slide hinaus geht (default-Logo ist sehr breit/flach,
  // aber komplexe Grafiken mit großer Höhe würden sonst unten rauslaufen)
  const imgMaxW = CONTENT_W * 0.7;
  const imgMaxH = beschreibung ? CONTENT_H * 0.55 : CONTENT_H * 0.7;
  const imgX = PAD_X + (CONTENT_W - imgMaxW) / 2;
  // Mittig vertikal
  const imgY = CONTENT_TOP + ((CONTENT_H - imgMaxH - (beschreibung ? 0.6 : 0)) / 2);
  if (bild) {
    pptx.addImage({
      data: bild, x: imgX, y: imgY, w: imgMaxW, h: imgMaxH,
      sizing: { type: 'contain', w: imgMaxW, h: imgMaxH },
    });
  } else {
    imgPlaceholder(pptx, imgX, imgY, imgMaxW, imgMaxH, 'Kein Organigramm hinterlegt — bitte in den Einstellungen hochladen');
  }
  if (beschreibung) {
    pptx.addText(beschreibung, {
      x: PAD_X, y: imgY + imgMaxH + 0.2, w: CONTENT_W, h: 0.5,
      fontSize: 11, color: '333333', align: 'center', fontFace: 'Calibri', valign: 'top',
    });
  }
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Abschluss "Ein Projekt der"
// ──────────────────────────────────────────────────────────────

function renderAbschlussPptx(slide: Slide, pptx: PptxSlide): void {
  bgWhite(pptx);
  const d = slide.data;
  const bild = d.bild || '';
  const untertitel = d.untertitel || '';
  // Titel "Ein Projekt der" zentriert oben
  pptx.addText('Ein Projekt der IVT AG', {
    x: 0, y: PAD_Y_TOP + 0.2, w: SLIDE_WIDTH, h: 0.8,
    fontSize: 32, bold: true, color: '2A2A2A', align: 'center', fontFace: 'Calibri',
  });
  // Foto zentriert (max 60% Breite)
  const photoW = SLIDE_WIDTH * 0.55;
  const photoH = 4.0;
  const photoX = (SLIDE_WIDTH - photoW) / 2;
  const photoY = 2.0;
  if (bild) {
    pptx.addImage({
      data: bild, x: photoX, y: photoY, w: photoW, h: photoH,
      sizing: { type: 'contain', w: photoW, h: photoH },
    });
  } else {
    imgPlaceholder(pptx, photoX, photoY, photoW, photoH, 'Kein Foto hinterlegt — bitte in den Einstellungen hochladen');
  }
  // Untertitel zentriert unten
  if (untertitel) {
    pptx.addText(untertitel, {
      x: 1, y: photoY + photoH + 0.3, w: SLIDE_WIDTH - 2, h: 0.8,
      fontSize: 13, color: '2A2A2A', align: 'center', fontFace: 'Calibri', valign: 'top',
    });
  }
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Impressionen
// ──────────────────────────────────────────────────────────────

function renderImpressionenPptx(slide: Slide, pptx: PptxSlide): void {
  bgWhite(pptx);
  addTitle(pptx, 'Impressionen');
  const bilder: string[] = Array.isArray(slide.data.bilder) ? slide.data.bilder : [];
  const captions: string[] = Array.isArray(slide.data.captions) ? slide.data.captions : [];
  if (bilder.length === 0) {
    imgPlaceholder(pptx, PAD_X, CONTENT_TOP, CONTENT_W, CONTENT_H - 0.2, 'Keine Bilder hinterlegt');
    return;
  }
  // 4 × 2 Grid mit Caption unter jedem Bild
  const cols = 4;
  const rows = 2;
  const gap = 0.12;
  const captionH = 0.3;
  const colW = (CONTENT_W - (cols - 1) * gap) / cols;
  const cellH = (CONTENT_H - 0.2 - (rows - 1) * gap) / rows;
  const imgH = cellH - captionH;
  bilder.slice(0, cols * rows).forEach((b, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = PAD_X + col * (colW + gap);
    const y = CONTENT_TOP + row * (cellH + gap);
    pptx.addImage({
      data: b,
      x, y, w: colW, h: imgH,
      sizing: { type: 'cover', w: colW, h: imgH },
    });
    if (captions[i]) {
      pptx.addText(captions[i], {
        x, y: y + imgH, w: colW, h: captionH,
        fontSize: 9, color: '3D5A80', align: 'center', fontFace: 'Calibri', bold: true,
      });
    }
  });
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Referenz Abwicklung
// ──────────────────────────────────────────────────────────────

function renderReferenzPptx(slide: Slide, pptx: PptxSlide): void {
  bgWhite(pptx);
  const d = slide.data;
  addTitle(pptx, `Referenz Abwicklung${d.projektName ? ' — ' + d.projektName : ''}`);
  const lines = String(d.zeilen || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    pptx.addText('Keine Termine erfasst', {
      x: PAD_X, y: CONTENT_TOP, w: CONTENT_W, h: 0.5,
      fontSize: 11, italic: true, color: '888888', fontFace: 'Calibri',
    });
    return;
  }
  const headerRow = ['Phase', 'Datum', 'Wert'].map((h) => ({
    text: h,
    options: { bold: true, color: '3D5A80', fill: { color: 'DDE7F0' }, fontSize: 11 },
  }));
  const dataRows = lines.map((l) => {
    const parts = l.split('|').map((p) => p.trim());
    return [0, 1, 2].map((i) => ({
      text: parts[i] || '',
      options: { color: '1A1A1A', fontSize: 10 },
    }));
  });
  pptx.addTable([headerRow, ...dataRows], {
    x: PAD_X, y: CONTENT_TOP, w: CONTENT_W,
    colW: [CONTENT_W * 0.45, CONTENT_W * 0.25, CONTENT_W * 0.30],
    fontFace: 'Calibri',
    border: { type: 'solid', pt: 0.5, color: 'CFD9E2' },
    rowH: 0.4,
  });
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Kundenliste
// ──────────────────────────────────────────────────────────────

function renderKundenlistePptx(slide: Slide, pptx: PptxSlide): void {
  bgWhite(pptx);
  addTitle(pptx, 'Kundenliste');
  const d = slide.data;
  const colW = (CONTENT_W - 0.3) / 2;
  pptx.addText('EINZELVERKAUF', {
    x: PAD_X, y: CONTENT_TOP, w: colW, h: 0.3,
    fontSize: 11, bold: true, color: '3D5A80', fontFace: 'Calibri',
  });
  pptx.addText(bulletsList(d.einzelverkauf), {
    x: PAD_X, y: CONTENT_TOP + 0.35, w: colW, h: CONTENT_H - 0.6,
    fontSize: 10, color: '333333', fontFace: 'Calibri', valign: 'top',
  });
  pptx.addText('GLOBALANSPRACHEN', {
    x: PAD_X + colW + 0.3, y: CONTENT_TOP, w: colW, h: 0.3,
    fontSize: 11, bold: true, color: '3D5A80', fontFace: 'Calibri',
  });
  pptx.addText(bulletsList(d.globalansprachen), {
    x: PAD_X + colW + 0.3, y: CONTENT_TOP + 0.35, w: colW, h: CONTENT_H - 0.6,
    fontSize: 10, color: '333333', fontFace: 'Calibri', valign: 'top',
  });
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Marktvergleich (2 Karten)
// ──────────────────────────────────────────────────────────────

function renderMarktvergleichPptx(slide: Slide, pptx: PptxSlide): void {
  bgWhite(pptx);
  addTitle(pptx, 'Marktvergleich');
  const d = slide.data;
  const colW = (CONTENT_W - 0.3) / 2;
  const cards: [string, string, string][] = [
    [d.titel1, d.bild1, d.text1],
    [d.titel2, d.bild2, d.text2],
  ];
  cards.forEach(([titel, bild, text], i) => {
    const x = PAD_X + i * (colW + 0.4);
    // KEIN Hintergrund-Rechteck mehr — klean
    pptx.addText(titel || '—', {
      x, y: CONTENT_TOP, w: colW, h: 0.4,
      fontSize: 11, bold: true, color: '3D5A80', fontFace: 'Calibri',
    });
    const imgH = 2.8;
    if (bild) {
      pptx.addImage({
        data: bild, x, y: CONTENT_TOP + 0.45, w: colW, h: imgH,
        sizing: { type: 'cover', w: colW, h: imgH },
      });
    } else {
      imgPlaceholder(pptx, x, CONTENT_TOP + 0.45, colW, imgH, 'Kein Bild');
    }
    pptx.addText(text || '', {
      x, y: CONTENT_TOP + 0.45 + imgH + 0.15,
      w: colW, h: CONTENT_H - 0.8 - imgH,
      fontSize: 10, color: '333333', fontFace: 'Calibri', valign: 'top',
    });
  });
}

// ──────────────────────────────────────────────────────────────
// Placeholder für noch-nicht-implementierte Slide-Typen
// ──────────────────────────────────────────────────────────────

function renderPlaceholderPptx(slide: Slide, pptx: PptxSlide): void {
  pptx.background = { color: 'FFFFFF' };
  pptx.addText('🚧', {
    x: 0, y: SLIDE_HEIGHT / 2 - 1.3, w: SLIDE_WIDTH, h: 0.8,
    align: 'center', fontSize: 48, fontFace: 'Calibri',
  });
  pptx.addText(`Slide-Typ "${slide.typ}"`, {
    x: 0, y: SLIDE_HEIGHT / 2 - 0.4, w: SLIDE_WIDTH, h: 0.5,
    align: 'center', fontSize: 18, bold: true, color: '555555', fontFace: 'Calibri',
  });
  pptx.addText('Renderer folgt in Phase B', {
    x: 0, y: SLIDE_HEIGHT / 2 + 0.2, w: SLIDE_WIDTH, h: 0.4,
    align: 'center', fontSize: 12, color: '888888', fontFace: 'Calibri',
  });
}
