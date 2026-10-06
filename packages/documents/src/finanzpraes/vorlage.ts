// Wörtliche Kopie von gg-immohandel src/lib/finanzpraesTemplate.ts (Golden Master: packages/documents/test/golden/finanzpraesentation.json).
// Abweichungen nur technisch: Importpfade.
// ──────────────────────────────────────────────────────────────
// Bank-Finanzierungspräsentation — HTML-Renderer (PDF + Preview)
// ──────────────────────────────────────────────────────────────
// Single Source of Truth für die HTML-Darstellung pro Slide.
// Dasselbe HTML wird im Editor für die Preview UND von Puppeteer
// für den PDF-Export verwendet (mit unterschiedlichem Mode-Flag
// für Page-Break / Margin-Verhalten).
//
// Format: A4 Querformat (1123 × 794 px @ 96dpi = 297 × 210 mm).
//
// Phase A2: Skelett mit Slide-Renderern für 1 Test-Typ (Deckblatt).
// Phase B füllt die übrigen 15 Slide-Renderer.
// ──────────────────────────────────────────────────────────────

import { IVT_LOGO_DATA_URL } from '../logo.ts';
// Reine Rechenlogik ohne DOM — deshalb auch vom Server benutzbar, der dieses
// Template für den PDF-Druck lädt (server/finanzpraes-pdf.ts).
import { objektFakten, teileTabellenzeilen, istSektionsZeile, type FinanzPraes, type Slide, type SlideTyp } from '@gg/domain';

export type RenderMode = 'preview' | 'pdf';

export interface RenderContext {
  praes: FinanzPraes;
  pageNumber?: number;
  totalPages?: number;
}

/** HTML-Escape (für untrusted Daten in Templates). */
function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c] || c));
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer-Lookup
// ──────────────────────────────────────────────────────────────

type SlideRenderer = (slide: Slide, ctx: RenderContext) => string;

const SLIDE_RENDERERS: Partial<Record<SlideTyp, SlideRenderer>> = {
  deckblatt: renderDeckblatt,
  objektbeschreibung: renderObjekt,
  lagebeschreibung: renderLage,
  projektbeschreibung: renderProjekt,
  geschaeftsmodell: renderGeschaeftsmodell,
  // Wrapper statt direkter Referenz: renderEinzelbild nimmt Seitennummern
  // entgegen, kein RenderContext.
  projektkalkulation: (s) => renderEinzelbild(s),
  verkaufspreise: (s) => renderEinzelbild(s),
  mietenaufstellung: (s) => renderEinzelbild(s),
  finanzierungsstruktur: renderFinanzierung,
  organigramm: renderOrganigramm,
  abschluss: renderAbschluss,
  impressionen: renderImpressionen,
  referenz: renderReferenz,
  kundenliste: renderKundenliste,
  marktvergleich: renderMarktvergleich,
  // Grundrisse: Sonderfall — wird in finanzpraesFullHtml direkt behandelt
};

/** Rendert eine einzelne Slide als HTML-Section.
 *  Zwei Sonderfälle erzeugen mehrere <section>s: Grundrisse (ein Bild je Seite)
 *  und lange Tabellen (siehe renderTabellenSeiten). */
export function renderSlide(slide: Slide, ctx: RenderContext): string {
  const renderer = SLIDE_RENDERERS[slide.typ];
  if (slide.typ === 'grundrisse') {
    return renderer ? renderer(slide, ctx) : '';
  }
  if (tabellenSeiten(slide).length > 1) return renderTabellenSeiten(slide, ctx);
  const inner = renderer ? renderer(slide, ctx) : renderPlaceholder(slide);
  return wrapSlide(slide.typ, inner, ctx);
}

/** Eine Tabelle, die nicht auf eine Folie passt, wird zu mehreren Folien —
 *  fortlaufend nummeriert, mit wiederholtem Tabellenkopf. Vorher schnitt die
 *  Folie unten einfach ab: bei der Aufteiler-Kalkulation genau GIK, Gewinn und
 *  Marge, ohne dass irgendwo etwas davon stand. */
function renderTabellenSeiten(slide: Slide, ctx: RenderContext): string {
  const gesamt = tabellenSeiten(slide).length;
  const teile: string[] = [];
  for (let i = 0; i < gesamt; i++) {
    const seitenCtx: RenderContext = ctx.pageNumber === undefined
      ? ctx
      : { ...ctx, pageNumber: ctx.pageNumber + i };
    teile.push(wrapSlide(slide.typ, renderEinzelbild(slide, i, gesamt), seitenCtx));
  }
  return teile.join('\n');
}

/** Die Tabellenzeilen dieser Folie, auf Seiten verteilt.
 *  Leeres Array = die Folie zeigt keine Tabelle (Bild oder Platzhalter). */
function tabellenSeiten(slide: Slide): string[][][] {
  if (!EINZELBILD_TITEL[slide.typ as string]) return [];
  const rows = slide.data?.tableRows;
  if (!Array.isArray(rows) || rows.length === 0) return [];
  return teileTabellenzeilen(rows);
}

/** Wie viele Druckseiten diese Folie belegt — die Seitenzählung im Fußbereich
 *  hängt daran und muss vor dem Rendern feststehen. */
export function seitenAnzahlDerSlide(slide: Slide): number {
  if (slide.typ === 'grundrisse') {
    const bilder = Array.isArray(slide.data?.bilder) ? slide.data.bilder : [];
    return Math.max(1, bilder.length);
  }
  return Math.max(1, tabellenSeiten(slide).length);
}

/** Hüllt eine Slide in Logo (oben rechts) + Footer (Pagination) ein.
 *  ctx.pageNumber + ctx.totalPages werden über die calling-Schleife verwaltet. */
export function wrapSlide(typ: string, inner: string, ctx: RenderContext): string {
  const pageInfo = (ctx.pageNumber !== undefined && ctx.totalPages !== undefined)
    ? `${ctx.pageNumber} / ${ctx.totalPages}`
    : '';
  const bank = ctx.praes.bankName ? esc(ctx.praes.bankName) : '';
  return `<section class="fp-slide" data-typ="${esc(typ)}">
    <div class="fp-page-logo"><img src="${IVT_LOGO_DATA_URL}" alt="IVT"></div>
    ${inner}
    <div class="fp-page-footer">
      <span>${bank}</span>
      <span>${pageInfo}</span>
    </div>
  </section>`;
}

// ──────────────────────────────────────────────────────────────
// Helper für Bullet-Listen (multi-line String → <ul>)
// ──────────────────────────────────────────────────────────────

function bullets(s: any): string {
  const text = String(s ?? '').trim();
  if (!text) return '';
  const items = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (items.length === 0) return '';
  return `<ul class="fp-bullets">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

/** Wandelt photo:objId/photoId → /api/photos/objId/photoId, lässt Data-URLs unverändert. */
function resolveImg(src: any): string {
  if (!src || typeof src !== 'string') return '';
  if (src.startsWith('photo:')) {
    return '/api/photos/' + src.substring('photo:'.length);
  }
  return src;
}

function imgBg(src: any): string {
  const resolved = resolveImg(src);
  if (!resolved) return '';
  return `style="background-image:url('${esc(resolved)}')"`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Deckblatt (Phase A2 Test-Slide)
// ──────────────────────────────────────────────────────────────

function renderDeckblatt(slide: Slide): string {
  const titel = slide.data.titel || 'ANKAUF';
  const untertitel = slide.data.untertitel || '';
  // 2026-05-15: bildPath ist neuer Single-Slot. Backward-Compat zu altem
  // bilder[]-Array: wenn bildPath leer, nutze erstes Element von bilder[].
  const bilderLegacy: string[] = Array.isArray(slide.data.bilder) ? slide.data.bilder : [];
  const hauptbild = (slide.data.bildPath as string) || bilderLegacy[0] || '';
  return `
    <div class="fp-deckblatt-split">
      <div class="fp-deckblatt-textcol">
        <div class="fp-deckblatt-titel">${esc(titel)}</div>
        ${untertitel ? `<div class="fp-deckblatt-untertitel">${esc(untertitel)}</div>` : ''}
      </div>
      <div class="fp-deckblatt-bildcol">
        ${hauptbild
          ? `<div class="fp-deckblatt-bild" style="background-image:url('${esc(resolveImg(hauptbild))}')"></div>`
          : '<div class="fp-deckblatt-bild fp-deckblatt-bild-empty">Kein Hauptbild hinterlegt</div>'}
      </div>
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Objektbeschreibung (Key-Facts + Beschreibung + Bild)
// ──────────────────────────────────────────────────────────────

function renderObjekt(slide: Slide): string {
  const d = slide.data;
  const facts = objektFakten(d);
  return `
    <div class="fp-content">
      <div class="fp-title">Objektbeschreibung</div>
      <div class="fp-2col">
        <div class="fp-col-left">
          <table class="fp-keytable">
            ${facts.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
          </table>
          ${d.beschreibung ? `<div class="fp-prose">${esc(d.beschreibung).replace(/\n/g, '<br>')}</div>` : ''}
        </div>
        <div class="fp-col-right">
          ${d.bildPath ? `<div class="fp-bigimg" ${imgBg(d.bildPath)}></div>` : '<div class="fp-img-placeholder">Kein Bild</div>'}
        </div>
      </div>
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Lagebeschreibung (Bullets + Bild)
// ──────────────────────────────────────────────────────────────

function renderLage(slide: Slide): string {
  const d = slide.data;
  return `
    <div class="fp-content">
      <div class="fp-title">Lagebeschreibung</div>
      <div class="fp-2col">
        <div class="fp-col-left">
          <h3 class="fp-h3">Standort</h3>
          ${bullets(d.standortBullets) || '<div class="fp-empty">—</div>'}
          <h3 class="fp-h3" style="margin-top:8mm">Anbindung</h3>
          ${bullets(d.anbindungBullets) || '<div class="fp-empty">—</div>'}
        </div>
        <div class="fp-col-right">
          ${d.bildPath ? `<div class="fp-bigimg" ${imgBg(d.bildPath)}></div>` : '<div class="fp-img-placeholder">Karte / Foto</div>'}
        </div>
      </div>
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Projektbeschreibung (3 Sektionen)
// ──────────────────────────────────────────────────────────────

function renderProjekt(slide: Slide): string {
  const d = slide.data;
  return `
    <div class="fp-content">
      <div class="fp-title">Projektbeschreibung</div>
      <div class="fp-stack">
        <div class="fp-block">
          <h3 class="fp-h3">Aktueller Stand</h3>
          <div class="fp-prose">${esc(d.aktuellerStand || '—').replace(/\n/g, '<br>')}</div>
        </div>
        <div class="fp-block">
          <h3 class="fp-h3">Geplante Maßnahmen</h3>
          <div class="fp-prose">${esc(d.geplanteMassnahmen || '—').replace(/\n/g, '<br>')}</div>
        </div>
        <div class="fp-block">
          <h3 class="fp-h3">Vertrieb</h3>
          <div class="fp-prose">${esc(d.vertrieb || '—').replace(/\n/g, '<br>')}</div>
        </div>
      </div>
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Geschäftsmodell (4 Quadranten)
// ──────────────────────────────────────────────────────────────

function renderGeschaeftsmodell(slide: Slide): string {
  const d = slide.data;
  const block = (title: string, content: any) => content ? `
    <div class="fp-block">
      <h3 class="fp-h3">${esc(title)}</h3>
      ${bullets(content) || `<div class="fp-prose">${esc(content).replace(/\n/g, '<br>')}</div>`}
    </div>` : '';
  return `
    <div class="fp-content">
      <div class="fp-title">Geschäftsmodell</div>
      <div class="fp-stack">
        ${block('Zielgruppe', d.zielgruppe)}
        ${block('Angebot der IVT', d.angebot)}
        ${block('Kundengewinnung', d.kundengewinnung)}
        ${block('Vorteile für die Kunden', d.vorteile)}
        ${block('Vorteile für die IVT', d.vorteileIvt)}
      </div>
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Einzelbild-Slides (Kalkulation, Verkaufspreise, Mieten)
// ──────────────────────────────────────────────────────────────

const EINZELBILD_TITEL: Record<string, string> = {
  projektkalkulation: 'Projektkalkulation',
  verkaufspreise: 'Verkaufspreise',
  mietenaufstellung: 'Mietenaufstellung',
};

/** Eine Seite einer Einzelbild-/Tabellen-Folie.
 *  `seite` zählt ab 0; bei mehreren Seiten trägt der Titel die Zählung, der
 *  Tabellenkopf wiederholt sich und der Beschreibungstext steht nur am Ende. */
function renderEinzelbild(slide: Slide, seite = 0, seitenGesamt = 1): string {
  const d = slide.data;
  const basisTitel = EINZELBILD_TITEL[slide.typ as string] || 'Detail';
  const titel = seitenGesamt > 1 ? `${basisTitel} (${seite + 1} / ${seitenGesamt})` : basisTitel;
  // Tabelle hat Vorrang vor Bild
  const seiten = tabellenSeiten(slide);
  let body = '';
  if (seiten.length > 0) {
    // Der Untertitel („Aufteiler-Kalkulation") steht einmal, nicht auf jeder Seite.
    body = renderDataTable(d.tableHeaders, seiten[seite] || [], seite === 0 ? d.tableTitle : '');
  } else if (d.bildPath) {
    body = `<div class="fp-fullimg" ${imgBg(d.bildPath)}></div>`;
  } else {
    body = '<div class="fp-img-placeholder fp-img-large">Bild oder Tabelle fehlt</div>';
  }
  const istLetzteSeite = seite >= seitenGesamt - 1;
  return `
    <div class="fp-content">
      <div class="fp-title">${esc(titel)}</div>
      ${body}
      ${(istLetzteSeite && d.beschreibung) ? `<div class="fp-prose" style="margin-top:4mm">${esc(d.beschreibung).replace(/\n/g, '<br>')}</div>` : ''}
    </div>`;
}

/** Tabelle für Projektkalkulation/Verkaufspreise/Mietenaufstellung.
 *  Letzte Zeile (wenn 'GESAMT' enthalten) wird hervorgehoben. */
function renderDataTable(headers: any, rows: any, subtitle: any): string {
  const hdrs: string[] = Array.isArray(headers) ? headers : [];
  const rs: string[][] = Array.isArray(rows) ? rows : [];
  if (rs.length === 0) return '';
  const isLastRowSummary = (r: string[]) => r.some((c) => /GESAMT|TOTAL|SUMME/i.test(String(c)));
  // Sektion-Header-Zeilen: dieselbe Erkennung, die auch über den Seitenumbruch
  // entscheidet — deshalb liegt sie in finanzpraes-tabelle.ts, nicht hier.
  const isSectionHeader = istSektionsZeile;
  const isGikSum = (r: string[]) => /Gesamt-Investitionskosten|GIK\s*\(/i.test(String(r[0] || ''));
  const isExitSum = (r: string[]) => /Gewinn\s+(Aufteiler|Global)/i.test(String(r[0] || ''));
  return `
    <div class="fp-data-table-wrap">
      ${subtitle ? `<div class="fp-data-table-subtitle">${esc(subtitle)}</div>` : ''}
      <table class="fp-data-table">
        ${hdrs.length > 0 ? `<thead><tr>${hdrs.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}
        <tbody>
          ${rs.map((r, i) => {
            const isSum = (i === rs.length - 1) && isLastRowSummary(r);
            const isSec = isSectionHeader(r);
            const isGik = isGikSum(r);
            const isExit = isExitSum(r);
            const cls = isSum ? 'fp-data-table-sum'
              : isSec ? 'fp-data-table-section'
              : isGik ? 'fp-data-table-gik'
              : isExit ? 'fp-data-table-exit'
              : '';
            return `<tr${cls ? ` class="${cls}"` : ''}>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Finanzierungsstruktur (Bullet-Werte-Tabelle)
// ──────────────────────────────────────────────────────────────

function renderFinanzierung(slide: Slide): string {
  const d = slide.data;
  // Zusammengesetzte Eigenmittel/Fremdmittel-Anzeigen (so wie in den Original-Pitches)
  const emCombined = [d.ekAnteil, d.em].filter(Boolean).join(' ');
  const fmCombined = [d.fkAnteil, d.fm].filter(Boolean).join(' ');
  const rows = [
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
  ].filter(([, v]) => v);
  return `
    <div class="fp-content">
      <div class="fp-title">Finanzierungsstruktur</div>
      <table class="fp-fintable">
        ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
      </table>
      ${d.zusatzBullets ? `<div style="margin-top:6mm"><h3 class="fp-h3">Weitere Konditionen</h3>${bullets(d.zusatzBullets)}</div>` : ''}
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Grundrisse (N Seiten — Sonderfall)
// ──────────────────────────────────────────────────────────────

// Grundrisse werden direkt in finanzpraesFullHtml + renderGrundrissPage erzeugt

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Organigramm (4 Quadranten — Konzern)
// ──────────────────────────────────────────────────────────────

function renderOrganigramm(slide: Slide): string {
  const d = slide.data;
  const bild = d.bild || '';
  const beschreibung = d.beschreibung || '';
  return `
    <div class="fp-content">
      <div class="fp-title">Organigramm</div>
      ${bild
        ? `<div class="fp-fullimg" style="background-image:url('${esc(resolveImg(bild))}');flex:${beschreibung ? '1 1 70%' : '1'}"></div>`
        : '<div class="fp-img-placeholder fp-img-large">Kein Organigramm hinterlegt — bitte in den Einstellungen hochladen</div>'}
      ${beschreibung ? `<div class="fp-prose" style="margin-top:6mm;text-align:center">${esc(beschreibung).replace(/\n/g, '<br>')}</div>` : ''}
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Abschluss "Ein Projekt der" (Text + 2 Portraits)
// ──────────────────────────────────────────────────────────────

function renderAbschluss(slide: Slide): string {
  const d = slide.data;
  const bild = d.bild || '';
  const untertitel = d.untertitel || '';
  return `
    <div class="fp-content fp-content-center">
      <div class="fp-title-big">Ein Projekt der IVT AG</div>
      <div class="fp-abschluss-foto">
        ${bild
          ? `<img src="${esc(resolveImg(bild))}" alt="">`
          : '<div class="fp-img-placeholder" style="width:100%;height:100mm">Kein Foto hinterlegt — bitte in den Einstellungen hochladen</div>'}
      </div>
      ${untertitel ? `<div class="fp-abschluss-untertitel">${esc(untertitel).replace(/\n/g, '<br>')}</div>` : ''}
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Impressionen (4-8 Bilder Galerie)
// ──────────────────────────────────────────────────────────────

function renderImpressionen(slide: Slide): string {
  const bilder: string[] = Array.isArray(slide.data.bilder) ? slide.data.bilder : [];
  const captions: string[] = Array.isArray(slide.data.captions) ? slide.data.captions : [];
  return `
    <div class="fp-content">
      <div class="fp-title">Impressionen</div>
      ${bilder.length === 0
        ? '<div class="fp-img-placeholder fp-img-large">Keine Bilder hinterlegt</div>'
        : `<div class="fp-impressionen-grid">${bilder.slice(0, 8).map((b, i) => `
            <div class="fp-imp-cell">
              <div class="fp-imp-img" style="background-image:url('${esc(resolveImg(b))}')"></div>
              ${captions[i] ? `<div class="fp-imp-caption">${esc(captions[i])}</div>` : ''}
            </div>`).join('')}</div>`}
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Referenz Abwicklung (Termin-Tabelle)
// ──────────────────────────────────────────────────────────────

function renderReferenz(slide: Slide): string {
  const d = slide.data;
  const lines = String(d.zeilen || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return `
    <div class="fp-content">
      <div class="fp-title">Referenz Abwicklung${d.projektName ? ` — ${esc(d.projektName)}` : ''}</div>
      ${lines.length === 0
        ? '<div class="fp-empty">Keine Termine erfasst</div>'
        : `<table class="fp-table">
            <thead><tr><th>Phase</th><th>Datum</th><th>Wert</th></tr></thead>
            <tbody>${lines.map((l) => {
              const parts = l.split('|').map((p) => p.trim());
              return `<tr><td>${esc(parts[0] || '')}</td><td>${esc(parts[1] || '')}</td><td>${esc(parts[2] || '')}</td></tr>`;
            }).join('')}</tbody>
          </table>`}
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Kundenliste (2 Tabellen)
// ──────────────────────────────────────────────────────────────

function renderKundenliste(slide: Slide): string {
  const d = slide.data;
  return `
    <div class="fp-content">
      <div class="fp-title">Kundenliste</div>
      <div class="fp-2col">
        <div>
          <h3 class="fp-h3">Einzelverkauf</h3>
          ${bullets(d.einzelverkauf) || '<div class="fp-empty">—</div>'}
        </div>
        <div>
          <h3 class="fp-h3">Globalansprachen</h3>
          ${bullets(d.globalansprachen) || '<div class="fp-empty">—</div>'}
        </div>
      </div>
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Marktvergleich (2 Karten mit Bild + Text)
// ──────────────────────────────────────────────────────────────

function renderMarktvergleich(slide: Slide): string {
  const d = slide.data;
  const col = (titel: any, bild: any, text: any) => `
    <div class="fp-col">
      <h3 class="fp-h3">${esc(titel || '—')}</h3>
      ${bild ? `<div class="fp-mvimg" ${imgBg(bild)}></div>` : '<div class="fp-img-placeholder">Kein Bild</div>'}
      <div class="fp-prose" style="margin-top:4mm">${esc(text || '').replace(/\n/g, '<br>')}</div>
    </div>`;
  return `
    <div class="fp-content">
      <div class="fp-title">Marktvergleich</div>
      <div class="fp-2col">
        ${col(d.titel1, d.bild1, d.text1)}
        ${col(d.titel2, d.bild2, d.text2)}
      </div>
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Slide-Renderer: Platzhalter (für Slide-Typen ohne Renderer)
// ──────────────────────────────────────────────────────────────

function renderPlaceholder(slide: Slide): string {
  return `
    <div class="fp-placeholder">
      <div class="fp-placeholder-icon">🚧</div>
      <div class="fp-placeholder-titel">Slide-Typ „${esc(slide.typ)}"</div>
      <div class="fp-placeholder-text">Renderer folgt in Phase B</div>
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// CSS — A4 Querformat
// ──────────────────────────────────────────────────────────────

export function finanzpraesCss(mode: RenderMode): string {
  // A4 Querformat = 297mm × 210mm = 1123px × 794px @ 96dpi
  // PDF: page-break-after: always pro Slide
  // Preview: scroll, kein Pagebreak
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${mode === 'pdf' ? 'white' : '#f0f0f0'};
      color: #1a1a1a;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @page {
      size: A4 landscape;
      margin: 0;
    }
    .fp-slide {
      width: 297mm;
      height: 210mm;
      background: white;
      ${mode === 'pdf' ? 'page-break-after: always; page-break-inside: avoid;' : 'margin: 12px auto; box-shadow: 0 2px 12px rgba(0,0,0,.15);'}
      position: relative;
      overflow: hidden;
    }
    .fp-slide:last-child { page-break-after: auto; }

    /* ── Logo oben rechts (auf JEDER Slide) ───────────────── */
    .fp-page-logo {
      position: absolute; top: 6mm; right: 14mm;
      height: 12mm; z-index: 10;
    }
    .fp-page-logo img {
      height: 100%; width: auto;
    }
    /* ── Footer (auf JEDER Slide) ────────────────────────── */
    .fp-page-footer {
      position: absolute; bottom: 5mm; left: 14mm; right: 14mm;
      display: flex; justify-content: space-between;
      font-size: 8pt; color: #888;
      z-index: 10;
    }

    /* ── Deckblatt: Titel links, Bild rechts vertikal ────── */
    .fp-deckblatt-split {
      width: 100%; height: 100%;
      display: grid; grid-template-columns: 45% 55%;
    }
    .fp-deckblatt-textcol {
      padding: 35mm 16mm 25mm 22mm;
      display: flex; flex-direction: column; justify-content: center;
      background: linear-gradient(180deg, #fafbfc 0%, #eaeff4 100%);
    }
    .fp-deckblatt-titel {
      font-size: 30pt; font-weight: 700; color: #2a2a2a;
      letter-spacing: 0.5pt; line-height: 1.15;
    }
    .fp-deckblatt-untertitel {
      font-size: 17pt; color: #3d5a80; margin-top: 6mm; font-weight: 500;
      line-height: 1.3;
    }
    .fp-deckblatt-bildcol {
      position: relative;
    }
    .fp-deckblatt-bild {
      position: absolute; inset: 0;
      background-size: cover;
      background-position: center;
      background-color: #dde2e8;
    }
    .fp-deckblatt-bild-empty {
      display: flex; align-items: center; justify-content: center;
      color: #888; font-style: italic; font-size: 11pt;
    }

    /* ── Generischer Content-Wrapper ─────────────────────── */
    /* Padding: top 22mm (Platz für Logo), bottom 18mm (Platz für Footer + Sicherheits-Gap) */
    .fp-content {
      width: 100%; height: 100%;
      padding: 22mm 18mm 18mm 18mm;
      display: flex; flex-direction: column;
      box-sizing: border-box;
      overflow: hidden;
    }
    .fp-content-center {
      align-items: center; justify-content: center;
    }
    .fp-title {
      font-size: 22pt; font-weight: 700; color: #2a2a2a;
      border-bottom: 2px solid #1e3a5f;
      padding-bottom: 4mm; margin-bottom: 8mm;
    }
    .fp-title-big {
      font-size: 36pt; font-weight: 700; color: #2a2a2a;
      text-align: center; margin-bottom: 6mm;
    }
    .fp-h3 {
      font-size: 12pt; font-weight: 600; color: #3d5a80;
      margin-bottom: 4mm;
      text-transform: uppercase; letter-spacing: 0.3pt;
    }
    .fp-prose {
      font-size: 10pt; line-height: 1.55; color: #333;
      margin-top: 4mm;
    }
    .fp-empty {
      color: #aaa; font-style: italic; font-size: 10pt;
    }
    .fp-bullets {
      font-size: 10pt; line-height: 1.6; color: #333;
      padding-left: 6mm; margin: 0;
    }
    .fp-bullets li { margin-bottom: 2mm; }

    /* ── Layouts ─────────────────────────────────────────── */
    .fp-2col {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10mm;
      flex: 1; min-height: 0;
    }
    .fp-col {
      display: flex; flex-direction: column; min-height: 0;
    }
    /* Stack: Sektionen untereinander, ohne Hintergrund/Rahmen */
    .fp-stack {
      display: flex; flex-direction: column; gap: 7mm;
      flex: 1; min-height: 0;
    }
    .fp-block {
      padding: 0; min-height: 0;
    }
    .fp-block .fp-h3 {
      margin-bottom: 2mm;
    }
    .fp-block .fp-prose {
      margin-top: 0;
    }

    /* ── Bilder (klean, ohne Hintergrund/Rahmen) ──────────── */
    .fp-bigimg {
      width: 100%; height: 100%; min-height: 100mm;
      background-size: cover; background-position: center;
    }
    .fp-fullimg {
      width: 100%; flex: 1;
      background-size: contain; background-repeat: no-repeat;
      background-position: center;
    }
    /* Grundriss-Page: deterministische Box + echtes <img> mit object-fit:contain.
       Garantiert dass das Bild KOMPLETT sichtbar bleibt — kein Crop durch
       overflow:hidden der Slide. min-height:0 ist wichtig für korrekten
       Flexbox-Shrink. */
    .fp-grundriss-box {
      flex: 1 1 0; min-height: 0; width: 100%;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
    }
    .fp-grundriss-img {
      max-width: 100%; max-height: 100%;
      width: auto; height: auto;
      object-fit: contain;
      display: block;
    }
    /* Placeholder behält dezenten Rand nur wenn KEIN Bild — als Hint für User */
    .fp-img-placeholder {
      width: 100%; min-height: 60mm; flex: 1;
      display: flex; align-items: center; justify-content: center;
      color: #aaa; font-style: italic; font-size: 9pt;
      border: 1px dashed #d8dde2;
    }
    .fp-img-large { min-height: 130mm; }

    /* ── Tabellen ────────────────────────────────────────── */
    .fp-keytable, .fp-fintable, .fp-table {
      border-collapse: collapse; width: 100%;
      font-size: 10pt;
    }
    .fp-keytable th, .fp-fintable th {
      text-align: left; padding: 2.5mm 4mm 2.5mm 0;
      color: #3d5a80; font-weight: 600; vertical-align: top;
      border-bottom: 1px solid #cfd9e2;
      width: 40%;
    }
    .fp-keytable td, .fp-fintable td {
      padding: 2.5mm 0; color: #1a1a1a;
      border-bottom: 1px solid #cfd9e2;
    }
    /* Finanzierungsstruktur kann bis zu 15 Zeilen haben → kompakter */
    .fp-fintable { font-size: 9.5pt; }
    .fp-fintable th { font-weight: 500; padding: 1.6mm 4mm 1.6mm 0; width: 38%; }
    .fp-fintable td {
      font-weight: 700; font-size: 10.5pt; text-align: right;
      padding: 1.6mm 0;
    }
    .fp-table th, .fp-table td {
      padding: 3mm 4mm; border-bottom: 1px solid #cfd9e2;
      text-align: left;
    }
    .fp-table th {
      color: #3d5a80; font-weight: 600;
      border-bottom: 2px solid #1e3a5f;
    }

    /* ── Daten-Tabelle (Projektkalk/Verkaufspreise/Mieten) ──── */
    .fp-data-table-wrap {
      flex: 1; min-height: 0;
      display: flex; flex-direction: column;
    }
    .fp-data-table-subtitle {
      font-size: 12pt; font-weight: 600; color: #3d5a80;
      margin-bottom: 4mm;
    }
    .fp-data-table {
      width: 100%; border-collapse: collapse;
      font-size: 8.5pt; color: #1a1a1a;
    }
    .fp-data-table thead th {
      text-align: left; padding: 1.5mm 3mm;
      color: #3d5a80; font-weight: 600;
      border-bottom: 2px solid #1e3a5f;
      font-size: 9pt;
    }
    .fp-data-table tbody td {
      padding: 0.8mm 3mm; border-bottom: 1px solid #e6ebf0;
      vertical-align: top;
      line-height: 1.25;
    }
    .fp-data-table tbody tr:last-child td { border-bottom: none; }
    .fp-data-table tbody tr.fp-data-table-sum td {
      font-weight: 700; color: #1e3a5f;
      border-top: 2px solid #1e3a5f;
      padding-top: 1.5mm;
    }
    /* Sektion-Header (PROJEKTKOSTEN, HERSTELLUNGSKOSTEN, EXIT…) */
    .fp-data-table tbody tr.fp-data-table-section td {
      background: #eef2f6;
      color: #3d5a80;
      font-weight: 700;
      font-size: 7.5pt;
      letter-spacing: 0.06em;
      padding: 1.2mm 3mm 1mm;
      border-bottom: 1px solid #cfd9e2;
    }
    /* GIK-Summenzeile (petrol-akzent) */
    .fp-data-table tbody tr.fp-data-table-gik td {
      background: #dde7f0;
      font-weight: 700;
      color: #1e3a5f;
      border-top: 1.5px solid #1e3a5f;
      padding: 1.2mm 3mm;
    }
    /* Exit-Gewinn-Zeile (grün-akzent) */
    .fp-data-table tbody tr.fp-data-table-exit td {
      background: #e6f4e6;
      font-weight: 700;
      color: #15803d;
      border-top: 1.5px solid #15803d;
      padding: 1.2mm 3mm;
    }
    /* Zahlen-Spalten rechtsbündig (alles ab 4. Spalte) */
    .fp-data-table tbody td:nth-child(n+4) {
      text-align: right;
    }
    .fp-data-table thead th:nth-child(n+4) {
      text-align: right;
    }

    /* ── Impressionen-Galerie (klean, ohne BG-Farbe) ─────── */
    .fp-impressionen-grid {
      display: grid; grid-template-columns: repeat(4, 1fr);
      grid-template-rows: repeat(2, 1fr);
      gap: 4mm; flex: 1; min-height: 0;
    }
    .fp-imp-cell {
      display: flex; flex-direction: column;
      min-height: 0;
    }
    .fp-imp-img {
      flex: 1;
      background-size: cover; background-position: center;
      min-height: 0;
    }
    .fp-imp-caption {
      font-size: 9pt; color: #3d5a80; text-align: center;
      padding: 1.5mm 0 0; font-weight: 500;
    }

    /* ── Abschluss "Ein Projekt der" ─────────────────────── */
    .fp-abschluss-foto {
      width: 60%; max-width: 150mm; margin: 8mm auto 6mm;
    }
    .fp-abschluss-foto img {
      width: 100%; height: auto; display: block;
      border-radius: 3mm;
    }
    .fp-abschluss-untertitel {
      font-size: 13pt; color: #2a2a2a; text-align: center;
      max-width: 200mm; line-height: 1.5; font-weight: 500;
    }

    /* ── Marktvergleich (klean, ohne Karten-Look) ────────── */
    .fp-mvimg {
      width: 100%; height: 70mm;
      background-size: cover; background-position: center;
      background-color: transparent; border-radius: 0;
    }

    /* ── Placeholder ────────────────────────────────────── */
    .fp-placeholder {
      width: 100%; height: 100%;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 4mm; color: #888;
    }
    .fp-placeholder-icon { font-size: 48pt; }
    .fp-placeholder-titel { font-size: 18pt; font-weight: 600; color: #555; }
    .fp-placeholder-text { font-size: 12pt; color: #888; }
  `;
}

// ──────────────────────────────────────────────────────────────
// Vollständiges HTML-Dokument (für Puppeteer)
// ──────────────────────────────────────────────────────────────

export function finanzpraesFullHtml(praes: FinanzPraes): string {
  const visibleSlides = praes.slides.filter((s) => s.visible);
  // Total-Pages vorab berechnen (Grundrisse mit N Bildern = N Pages,
  // lange Tabellen = so viele Seiten wie ihre Zeilen brauchen)
  let totalPages = 0;
  for (const s of visibleSlides) totalPages += seitenAnzahlDerSlide(s);
  let pageNumber = 0;
  const sections: string[] = [];
  for (const s of visibleSlides) {
    if (s.typ === 'grundrisse') {
      // Sonderfall: pro Bild eine Page
      const bilder: any[] = Array.isArray(s.data.bilder) ? s.data.bilder : [];
      const captions: any[] = Array.isArray(s.data.captions) ? s.data.captions : [];
      const numPages = Math.max(1, bilder.length);
      for (let i = 0; i < numPages; i++) {
        pageNumber += 1;
        const ctx: RenderContext = { praes, pageNumber, totalPages };
        const total = numPages;
        const inner = renderGrundrissPage(bilder[i] || '', captions[i] || '', i + 1, total);
        sections.push(wrapSlide('grundrisse', inner, ctx));
      }
    } else {
      // renderSlide liefert bei einer langen Tabelle mehrere <section>s —
      // der Zähler muss deshalb um die volle Seitenzahl weiterspringen.
      const ctx: RenderContext = { praes, pageNumber: pageNumber + 1, totalPages };
      sections.push(renderSlide(s, ctx));
      pageNumber += seitenAnzahlDerSlide(s);
    }
  }
  const slidesHtml = sections.join('\n');

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Bank-Präsentation${praes.bankName ? ' – ' + esc(praes.bankName) : ''}</title>
  <style>${finanzpraesCss('pdf')}</style>
</head>
<body>
  ${slidesHtml || '<div style="padding:48mm;text-align:center;color:#888">Keine sichtbaren Slides</div>'}
</body>
</html>`;
}

/** Inhalt für eine einzelne Grundriss-Page (wird von wrapSlide eingehüllt). */
function renderGrundrissPage(bild: string, caption: string, num: number, total: number): string {
  const titel = caption ? `Grundriss ${caption}` : `Grundriss ${num} / ${total}`;
  if (!bild) {
    return `<div class="fp-content"><div class="fp-title">${esc(titel)}</div>
      <div class="fp-img-placeholder fp-img-large">Kein Grundriss hinterlegt</div></div>`;
  }
  // 2026-05-16: Deterministisches Rendering via <img> + object-fit:contain.
  // Vorher: <div class="fp-fullimg"> mit background-size:contain — bei manchen
  // Bild-Aspect-Ratios floss der Flex-Container über die Slide-Grenzen hinaus
  // und Teile des Grundrisses wurden vom overflow:hidden der Slide abgeschnitten.
  // Mit <img> + object-fit:contain garantiert der Browser, dass das Bild
  // KOMPLETT in die Container-Box passt (kein Crop, ggf. weißer Rand).
  return `<div class="fp-content">
    <div class="fp-title">${esc(titel)}</div>
    <div class="fp-grundriss-box">
      <img src="${esc(resolveImg(bild))}" alt="${esc(titel)}" class="fp-grundriss-img">
    </div>
  </div>`;
}

// ──────────────────────────────────────────────────────────────
// Preview HTML (für Frontend-Editor — Phase B)
// ──────────────────────────────────────────────────────────────

export function finanzpraesPreviewHtml(praes: FinanzPraes): string {
  const ctx: RenderContext = { praes };
  const visibleSlides = praes.slides.filter((s) => s.visible);
  const slidesHtml = visibleSlides.map((s) => renderSlide(s, ctx)).join('\n');

  return `
    <style>${finanzpraesCss('preview')}</style>
    <div class="fp-preview-container">${slidesHtml}</div>
  `;
}

/** Rendert NUR eine einzelne Slide für Live-Vorschau im Editor.
 *  Skaliert die Slide auf die Container-Breite (transform: scale).
 *  CSS-Inline damit es im Editor-Bereich isoliert bleibt. */
export function renderSlideLivePreview(praes: FinanzPraes, slide: Slide): string {
  // Eine lange Tabelle wird auch hier zu mehreren Folien — die Vorschau zeigt
  // sonst genau das, was das PDF nicht mehr tut.
  const ctx: RenderContext = { praes, pageNumber: 1, totalPages: seitenAnzahlDerSlide(slide) };
  let sectionHtml: string;
  if (slide.typ === 'grundrisse') {
    // Live-Preview: zeigt nur erstes Bild
    const bilder: any[] = Array.isArray(slide.data.bilder) ? slide.data.bilder : [];
    const captions: any[] = Array.isArray(slide.data.captions) ? slide.data.captions : [];
    const inner = bilder.length > 0
      ? `<div class="fp-content">
          <div class="fp-title">${esc(captions[0] ? `Grundriss ${captions[0]}` : 'Grundriss 1 / ' + bilder.length)}</div>
          <div class="fp-grundriss-box">
            <img src="${esc(resolveImg(bilder[0]))}" alt="Grundriss" class="fp-grundriss-img">
          </div>
        </div>`
      : `<div class="fp-content"><div class="fp-title">Grundrisse</div>
        <div class="fp-img-placeholder fp-img-large">Keine Grundrisse hinterlegt</div></div>`;
    sectionHtml = wrapSlide('grundrisse', inner, ctx);
  } else {
    sectionHtml = renderSlide(slide, ctx);
  }
  return `
    <style>${finanzpraesCss('preview')}</style>
    <div class="fp-live-wrap">${sectionHtml}</div>
    <style>
      .fp-live-wrap {
        width: 100%;
        max-width: 100%;
        overflow: hidden;
        padding: 0;
      }
      .fp-live-wrap .fp-slide {
        margin: 0 auto;
        transform-origin: top center;
        transform: scale(var(--fp-scale, 0.55));
        box-shadow: 0 4px 16px rgba(0,0,0,.2);
      }
    </style>`;
}

// (Header/Footer für Puppeteer entfernt — wird stattdessen pro Slide via wrapSlide() gerendert)
