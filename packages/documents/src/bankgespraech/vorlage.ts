// Wörtliche Kopie von gg-immohandel src/lib/bankgespraechTemplate.ts (Golden Master: packages/documents/test/golden).
// Abweichungen nur technisch: Import-Pfad des Logos und ein `!` in der Steuerzeile (noUncheckedIndexedAccess).
// ──────────────────────────────────────────────────────────────
// Bankgespräch-Template — Single Source of Truth für PDF + Live-Preview
// ──────────────────────────────────────────────────────────────
// Spiegelt das Excel-Sheet "Bankgespräch" 1:1.
// Wird sowohl im Frontend (Live-Preview im KKalk-Editor) als auch
// im Server (Puppeteer-PDF-Export) verwendet → garantiert identisches Layout.
// ──────────────────────────────────────────────────────────────

import { IVT_LOGO_DATA_URL } from '../logo.ts';

export interface BankgespraechCashflowYear {
  year: number;
  kaltmiete: number;
  bewirtschaftung: number;       // negativ
  investitionsmassnahme: number; // negativ
  tilgungszuschuss: number;      // positiv
  bewirtschaftungSumme: number;
  zinsen: number;                // negativ
  tilgung: number;               // negativ
  cashflowVorSteuer: number;
  steuerErstattungLast: number;  // positiv = Erstattung
  cashflowNachSteuern: number;
  kumuliert: number;
  // Steuerkalkulation-Detail (User-Wunsch 2026-05-01: nachvollziehbare Subrechnung)
  tax_zuVersteuerndesEinkommen: number;  // = miete + bewirt + zinsen - afa - (sanSofort wenn J1)
}

export interface BankgespraechPayload {
  // Header (oben, Excel B3-I5)
  projektTitel: string;          // z.B. "IVT AG Projekt: Entwicklung 9-Familienhaus"
  adresse: string;
  scope: 'global' | 'aufteiler';
  headerSubtitle: string;        // z.B. "Stand 10.04.2026"
  ersteller: string;
  erstelltAm: string;

  // Top-Block 1 (Excel C19-D28): Kaufpreis + Mittelherkunft
  kaufpreis: number;             // = kaufpreisWohnung + kaufpreisStellplatz
  kaufpreisWohnung: number;      // (User-Wunsch 2026-05-03)
  kaufpreisStellplatz: number;   // (User-Wunsch 2026-05-03)
  nebenkosten: number;
  // Aufschlüsselung der Nebenkosten in € (für PDF-Anzeige, User-Wunsch 2026-05-03)
  nebenkosten_notar: number;
  nebenkosten_grundbuch: number;
  nebenkosten_grunderwerbsteuer: number;
  nebenkosten_makler: number;
  nebenkosten_sonstige: number;
  renovierung: number;              // käuferfinanzierte Sanierung (in GIK)
  renovierungWegRuecklage: number;  // aus WEG-Rücklage (nicht in GIK, sofort abzugsf.)
  gik: number;
  fremdkapital: number;
  eigenkapital: number;

  // Top-Block 2 (Excel F19-G29): Cashflow Jahr 1 + ab Jahr 2
  cf_jahr1_zuzahlungProMonat: number;
  cf_jahr1_zuzahlungProJahr: number;
  cf_jahr1_rueckerstattung: number;
  cf_jahr1_nachSteuer: number;
  cf_jahr1_tilgungProMonat: number;  // Tilgung pro Monat im Jahr 1 (User-Wunsch 2026-05-02)
  // Jahr-1 Monatswerte für aufgeschlüsselte Anzeige (User-Wunsch 2026-05-04):
  cf_jahr1_kaltmieteMonat: number;          // positiv
  cf_jahr1_zinsMonat: number;               // negativ
  cf_jahr1_nichtUmlagefaehigMonat: number;  // negativ
  cf_jahr1_einnahmenVorSteuerMonat: number; // = miete + zins + tilg + nu
  cf_jahr1_steuerrueckerstattungMonat: number;  // positiv = Erstattung
  cf_jahr1_einnahmenNachSteuerMonat: number;
  cf_jahr2_zuzahlungProMonat: number;
  cf_jahr2_zuzahlungProJahr: number;
  cf_jahr2_rueckerstattung: number;
  cf_jahr2_nachSteuer: number;
  cf_jahr2_tilgungProMonat: number;  // Tilgung pro Monat im Jahr 2

  // Performance-Box: Rendite auf Restschuld (User-Wunsch 2026-05-02)
  hv_renditeAufRestschuld: number;   // = Jahresnettokaltmiete Endjahr / Restschuld bei Verkauf

  // Eckdaten erweitert: Stellplätze (User-Wunsch 2026-05-02)
  stellplaetzeAnzahl: number;
  stellplatzKaufpreis: number;

  // Top-Block 2 unten (Excel I20-J21): Durchschnittswerte N Jahre
  durchschnitt_cashflowProMonat: number;
  durchschnitt_tilgungProMonat: number;       // Tilgung im Schnitt /Mo (User-Wunsch 2026-05-01)
  durchschnitt_vermoegensaufbauProMonat: number;

  // Top-Block 3 (Excel I23-J29): Hochrechnung Verkauf
  hv_dauerJahre: number;
  hv_verkaufspreis: number;
  hv_restschuld: number;          // positiv
  hv_erloes: number;
  hv_eingesetztesEK: number;      // = -EK + ΣCF (zur Diagnose, nicht zur Kennzahl-Berechnung)
  kumul_cashflow_summe: number;   // Σ CF n.St. über N Jahre (negativ = Zuzahlung) — User-Wunsch 2026-05-01: transparente Berechnung
  hv_steuerfreierVermoegenszuwachs: number;  // = Erlös + ΣCF − EK_initial (Total Return)
  hv_eigenkapitalRenditePA: number | null;  // IRR
  hv_mieteEndjahr: number;

  // Wertsteigerungsstrategie (Excel B32-C41) — Bullets, editierbar
  wertsteigerungBullets: string[];

  // Disclaimer (Excel B43-C44) — editierbar mit Default
  disclaimer: string;

  // Cashflow-Tabelle (Excel R51-AC62)
  cashflowYears: BankgespraechCashflowYear[];

  // Steuerkalkulations-Detail-Block (User-Wunsch 2026-05-01)
  tax_afaProJahrTotal: number;  // jährliche AfA gesamt (Gebäude + ggf. Denkmal)
  tax_sanSofort: number;        // Σ sofort abzugsfähige Sanierung Jahr 1 = Sofort + WEG-Rücklage

  // Kennzahlen — Eckdaten (Excel C75-D90)
  wohnflaeche: number;
  kaufpreisProQm: number;            // = kaufpreisWohnung / wohnflaeche (User-Wunsch 2026-05-03)

  // Kennzahlen — Monatliche Investitionen ab 2.J (Excel F77-G84)
  basisjahr2_zinsMonat: number;          // negativ
  basisjahr2_tilgungMonat: number;       // negativ
  basisjahr2_nichtUmlagefaehigMonat: number; // negativ
  basisjahr2_kaltmieteMonat: number;     // positiv
  basisjahr2_einnahmenVorSteuerMonat: number;
  basisjahr2_steuerrueckerstattungMonat: number;
  basisjahr2_einnahmenNachSteuerMonat: number;

  // Kennzahlen — Annahmen (Excel F87-G92)
  zins: number;
  tilgung: number;
  wertzuwachsPa: number;
  mietentwicklungPa: number;
  steuersatz: number;
  // AfA-Annahmen (User-Wunsch 2026-05-04: für Investor sichtbar machen)
  afaSatz: number;              // % auf AfA-Bemessungsgrundlage p.a.
  afaBemessungsgrundlage: number; // €-Betrag (Anteil Gebäude × (KP+NK) + akt. Sanierung)

  // Footer
  kalkName: string;

  // Impressionen: Foto-Galerie (User-Wunsch 2026-05-02)
  // Bilder als Data-URLs (base64) — eingebettet in HTML/PDF
  impressionen?: string[];

  // Anhänge: Liste von PDF-Dateinamen für Sektion (Platzhalter — Logik in V2)
  anhaengeNamen?: string[];
}

const fmt = (n: number) => Math.round(n).toLocaleString('de-DE');
const fmtD = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (n: number) => (n * 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %';
const cls = (n: number) => n < 0 ? 'bg-red' : n > 0 ? 'bg-grn' : '';
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const DEFAULT_BULLETS = [
  'Mieten werden bei Mieterwechsel auf Marktmiete angepasst',
  'Anpassung Marktmiete bei Bestandsmietern in §-Grenzen',
  'Optimierung der Bewirtschaftungskosten',
];

// Original-Disclaimer aus Excel-Bankgespräch (Real-Case 9-FH, Cell C44).
// 1:1 übernommen 2026-05-02 (User-Wunsch).
export const DEFAULT_DISCLAIMER =
  'Wir weisen ausdrücklich darauf hin, dass wir keinerlei Rechts-, Steuer- oder Finanzberatung erbringen und die ' +
  'geschilderte Rechtslage zum Teil zur besseren Verständlichkeit und Lesbarkeit außerdem auch vereinfacht ' +
  'dargestellt wurde. Alle von uns erteilten Ratschläge fußen ausschließlich auf unserer persönlichen Erfahrung ' +
  'und unserer persönlichen Meinung. Auch wenn wir jede unserer Empfehlungen mit größtmöglicher Sorgfalt und ' +
  'umfangreicher Recherche entwickelt und fortlaufend kritisch hinterfragt haben, können wir hierfür keinerlei ' +
  'Gewähr bieten. Gleiches gilt auch für die Vollständigkeit und Richtigkeit der dargestellten Rechtslage. Die ' +
  'erteilten Ratschläge können ferner auch keine fundierte und auf den Einzelfall zugeschnittene Rechts-, ' +
  'Steuer- oder Finanzberatung ersetzen. Wir können daher weder eine Erfolgsgarantie für die von uns abgegebenen ' +
  'Empfehlungen noch eine Haftung für evtl. Folgen ihrer Anwendung übernehmen.\n\n' +
  'Auch sämtliche Kalkulationstools wurden mit größter Sorgfalt erstellt. Wir haben durch mehrfache Überprüfungen ' +
  'bestmöglich versucht, Berechnungsfehler auszuschließen. Trotzdem können Fehler nicht vollständig ausgeschlossen ' +
  'werden. Daher können wir keine juristische Verantwortung und keinerlei Haftung für eventuell verbliebene ' +
  'Fehler und deren Folgen übernehmen.\n\n' +
  'Um etwaige Fehler so weit wie möglich auszuschließen, empfehlen wir dringend und in jedem Fall eigenständige ' +
  'Kontrollrechnungen durchzuführen und ggf. zusätzlichen Fachrat eines Rechts-, Steuer- oder Finanzberaters ' +
  'einzuholen.';

/**
 * CSS für beide Modi.
 * mode='preview' nutzt px-Units, ist optimiert für Bildschirm-Anzeige im Frontend.
 * mode='pdf' nutzt mm-Units, ist optimiert für A4-Hochformat-Druck via Puppeteer.
 */
function bankgespraechCss(mode: 'preview' | 'pdf'): string {
  if (mode === 'pdf') {
    return `
      /* A4-Hochformat mit Innenrändern. Header/Footer kommen via Puppeteer-
         displayHeaderFooter mit headerTemplate/footerTemplate (siehe kkalk-pdf.ts). */
      @page { size: A4 portrait; margin: 38mm 12mm 18mm 12mm; }
      body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 8.5pt; color: #1a1a1a; margin: 0; line-height: 1.35; }
      .bg-doc { width: 100%; }
      .bg-doc > .bg-hdr, .bg-doc > .bg-foot { display: none; }  /* Inline-Header nicht im PDF — kommt von Puppeteer */
      .bg-doc-body { width: 100%; }
      /* Page-Break-Regeln: Nichts mittendrin reißen, Überschriften bleiben mit Inhalt zusammen */
      .bg-h2 { page-break-after: avoid; break-after: avoid; }
      table { page-break-inside: avoid; break-inside: avoid; }
      .bg-box { page-break-inside: avoid; break-inside: avoid; }
      .bg-grid3, .bg-grid4, .bg-grid2 { page-break-inside: avoid; break-inside: avoid; }
      .bg-img-wrap { page-break-inside: avoid; break-inside: avoid; }
      .bg-key { page-break-inside: avoid; break-inside: avoid; }
      .bg-strat { page-break-inside: avoid; break-inside: avoid; }
      .bg-disclaimer { page-break-inside: avoid; break-inside: avoid; }
      .bg-h1 { font-size: 14pt; font-weight: 700; color: #003366; margin: 0; letter-spacing: -.01em; }
      .bg-projekt { font-size: 11pt; font-weight: 600; color: #003366; margin-top: 1mm; }
      .bg-h2 { font-size: 11pt; font-weight: 600; color: #003366; margin: 4mm 0 1.5mm; border-bottom: 1.5px solid #003366; padding-bottom: 0.5mm; }
      .bg-sub { font-size: 9pt; color: #555; margin-top: 1mm; }
      .bg-meta { text-align: right; font-size: 7.5pt; color: #777; }
      .bg-hdr { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #003366; padding-bottom: 2mm; margin-bottom: 3mm; }
      .bg-badge { display: inline-block; padding: 0.5mm 2mm; background: #003366; color: #fff; border-radius: 2px; font-size: 7pt; margin-left: 2mm; vertical-align: middle; }
      .bg-logo-box { padding: 0; min-width: 38mm; display: flex; align-items: center; justify-content: center; }
      .bg-logo-img { width: 36mm; height: auto; display: block; }
      .bg-group-title { font-size: 9.5pt; font-weight: 600; color: #003366; margin-bottom: 1.5mm; padding-bottom: 0.5mm; border-bottom: 1px solid #d0dae5; text-transform: uppercase; letter-spacing: 0.04em; }
      .bg-grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4mm; margin-bottom: 3mm; }
      .bg-grid4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 3mm; margin-bottom: 3mm; }
      .bg-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-bottom: 3mm; }
      .bg-box { background: #f5f8fb; border: 1px solid #d0dae5; border-radius: 2px; padding: 3mm; }
      .bg-box-t { font-size: 9pt; font-weight: 600; color: #003366; margin: 0 0 2mm; padding-bottom: 1mm; border-bottom: 1px solid #d0dae5; }
      .bg-box-t-sub { font-size: 8pt; font-weight: 600; color: #003366; margin: 2mm 0 1mm; }
      table { width: 100%; border-collapse: collapse; }
      td, th { padding: 1mm 1.5mm; vertical-align: top; }
      th { font-weight: 600; background: #e8f0f6; border-bottom: 1px solid #003366; font-size: 7.5pt; text-align: right; }
      th.bg-lbl { text-align: left; }
      td.bg-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .bg-bold { font-weight: 600; }
      .bg-sum td { background: #e8f0f6; font-weight: 700; border-top: 1px solid #003366; }
      .bg-grn { color: #1e6e2e; }
      .bg-red { color: #b03030; }
      .bg-key { background: #f0f8e8; border: 1px solid #6b9e3e; padding: 2.5mm 3mm; margin-top: 3mm; border-radius: 3px; text-align: center; }
      .bg-key .v { font-size: 14pt; font-weight: 700; color: #1e6e2e; }
      .bg-key .l { font-size: 8pt; color: #444; }
      .bg-cf10 td, .bg-cf10 th { padding: 0.8mm 1mm; font-size: 7pt; }
      .bg-cf10 th.bg-lbl { text-align: left; min-width: 38mm; }
      /* Fixed-Layout für Cashflow + Steuerkalkulation, damit Spalten exakt untereinander stehen */
      .bg-cf10-fixed { table-layout: fixed; }
      .bg-cf10-fixed col.bg-col-lbl { width: 60mm; }
      .bg-cf10-fixed col.bg-col-yr { width: auto; }
      .bg-strat { background: #fafbfc; border-left: 3px solid #003366; padding: 2mm 3mm; margin: 3mm 0; font-size: 8pt; }
      .bg-strat ul { margin: 1mm 0 0 4mm; padding: 0; }
      .bg-strat li { margin-bottom: 0.5mm; }
      .bg-disclaimer { margin-top: 3mm; padding: 2mm 3mm; background: #fff8e0; border-left: 3px solid #c97818; font-size: 6.5pt; color: #555; line-height: 1.3; }
      .bg-disclaimer p { margin: 1.5mm 0 0; }
      .bg-impressionen { display: grid; gap: 3mm; margin-top: 2mm; }
      .bg-impressionen-1 { grid-template-columns: 1fr; }
      .bg-impressionen-2 { grid-template-columns: repeat(2, 1fr); }
      .bg-impressionen-3, .bg-impressionen-5, .bg-impressionen-6, .bg-impressionen-9 { grid-template-columns: repeat(3, 1fr); }
      .bg-impressionen-4, .bg-impressionen-7, .bg-impressionen-8 { grid-template-columns: repeat(4, 1fr); }
      .bg-img-wrap { aspect-ratio: 4 / 3; overflow: hidden; border: 1px solid #d0dae5; border-radius: 2px; background: #f5f8fb; }
      .bg-img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .bg-anhang-list { margin: 2mm 0 0 4mm; padding: 0; font-size: 8pt; }
      .bg-anhang-list li { margin-bottom: 0.5mm; }
      .bg-foot { flex-shrink: 0; margin-top: 4mm; padding-top: 1.5mm; border-top: 1px solid #ccc; font-size: 6.5pt; color: #888; text-align: left; }
    `;
  }
  // preview-mode (Bildschirm) — durchgängiger A4-Dokument-Fluss
  return `
    .bg-pv { background:transparent; color:#1a1a1a; font-family:'Helvetica Neue',Arial,sans-serif; font-size:11.5px; line-height:1.35; max-width:840px; margin:0 auto; }
    .bg-pv .bg-doc {
      background:#fff; box-shadow:0 4px 14px rgba(0,0,0,.18);
      width:210mm; max-width:100%; padding:12mm 12mm 14mm 12mm;
      box-sizing:border-box; margin:0 auto;
      border:1px solid #d0dae5;
    }
    .bg-pv .bg-doc-body { width:100%; }
    /* Sektionen die nicht mittendrin gerissen werden sollen */
    .bg-pv .bg-h2 { break-after:avoid }
    .bg-pv table, .bg-pv .bg-box, .bg-pv .bg-grid3, .bg-pv .bg-grid4, .bg-pv .bg-grid2,
    .bg-pv .bg-img-wrap, .bg-pv .bg-key, .bg-pv .bg-strat, .bg-pv .bg-disclaimer { break-inside:avoid }
    .bg-pv .bg-h1 { font-size:18px; font-weight:700; color:#003366; margin:0; letter-spacing:-.01em }
    .bg-pv .bg-projekt { font-size:14px; font-weight:600; color:#003366; margin-top:2px }
    .bg-pv .bg-h2 { font-size:13px; font-weight:600; color:#003366; margin:14px 0 6px; border-bottom:1.5px solid #003366; padding-bottom:2px }
    .bg-pv .bg-sub { font-size:10.5px; color:#555; margin-top:2px }
    .bg-pv .bg-meta { text-align:right; font-size:9px; color:#777 }
    .bg-pv .bg-hdr { display:flex; justify-content:space-between; align-items:baseline; border-bottom:2px solid #003366; padding-bottom:6px; margin-bottom:10px }
    .bg-pv .bg-badge { display:inline-block; padding:1px 7px; background:#003366; color:#fff; border-radius:3px; font-size:9px; margin-left:6px; vertical-align:middle }
    .bg-pv .bg-logo-box { padding:0; min-width:140px; display:flex; align-items:center; justify-content:center }
    .bg-pv .bg-logo-img { width:140px; height:auto; display:block }
    .bg-pv .bg-group-title { font-size:11px; font-weight:600; color:#003366; margin-bottom:5px; padding-bottom:2px; border-bottom:1px solid #d0dae5; text-transform:uppercase; letter-spacing:0.04em }
    .bg-pv .bg-grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:8px }
    .bg-pv .bg-grid4 { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:6px; margin-bottom:8px }
    .bg-pv .bg-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px }
    .bg-pv .bg-box { background:#f5f8fb; border:1px solid #d0dae5; border-radius:3px; padding:8px 10px }
    .bg-pv .bg-box-t { font-size:11px; font-weight:600; color:#003366; margin:0 0 4px; padding-bottom:3px; border-bottom:1px solid #d0dae5 }
    .bg-pv .bg-box-t-sub { font-size:10px; font-weight:600; color:#003366; margin:6px 0 2px }
    .bg-pv table { width:100%; border-collapse:collapse }
    .bg-pv td, .bg-pv th { padding:1.5px 3px; vertical-align:top }
    .bg-pv th { font-weight:600; background:#e8f0f6; border-bottom:1px solid #003366; font-size:9.5px; text-align:right }
    .bg-pv th.bg-lbl { text-align:left }
    .bg-pv td.bg-num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap }
    .bg-pv .bg-bold { font-weight:600 }
    .bg-pv .bg-sum td { background:#e8f0f6; font-weight:700; border-top:1px solid #003366 }
    .bg-pv .bg-grn { color:#1e6e2e }
    .bg-pv .bg-red { color:#b03030 }
    .bg-pv .bg-key { background:#f0f8e8; border:1px solid #6b9e3e; padding:6px 8px; margin-top:6px; border-radius:4px; text-align:center }
    .bg-pv .bg-key .v { font-size:18px; font-weight:700; color:#1e6e2e }
    .bg-pv .bg-key .l { font-size:10px; color:#444 }
    .bg-pv .bg-cf10 td, .bg-pv .bg-cf10 th { padding:1.5px 3px; font-size:9.5px }
    .bg-pv .bg-cf10 th.bg-lbl { min-width:170px }
    .bg-pv .bg-cf10-fixed { table-layout:fixed }
    .bg-pv .bg-cf10-fixed col.bg-col-lbl { width:200px }
    .bg-pv .bg-cf10-fixed col.bg-col-yr { width:auto }
    .bg-pv .bg-strat { background:#fafbfc; border-left:3px solid #003366; padding:6px 10px; margin:8px 0; font-size:10.5px }
    .bg-pv .bg-strat ul { margin:2px 0 0 14px; padding:0 }
    .bg-pv .bg-disclaimer { margin-top:10px; padding:6px 10px; background:#fff8e0; border-left:3px solid #c97818; font-size:9px; color:#555; line-height:1.3 }
    .bg-pv .bg-disclaimer p { margin:6px 0 0 }
    .bg-pv .bg-impressionen { display:grid; gap:8px; margin-top:6px }
    .bg-pv .bg-impressionen-1 { grid-template-columns:1fr }
    .bg-pv .bg-impressionen-2 { grid-template-columns:repeat(2,1fr) }
    .bg-pv .bg-impressionen-3, .bg-pv .bg-impressionen-5, .bg-pv .bg-impressionen-6, .bg-pv .bg-impressionen-9 { grid-template-columns:repeat(3,1fr) }
    .bg-pv .bg-impressionen-4, .bg-pv .bg-impressionen-7, .bg-pv .bg-impressionen-8 { grid-template-columns:repeat(4,1fr) }
    .bg-pv .bg-img-wrap { aspect-ratio:4/3; overflow:hidden; border:1px solid #d0dae5; border-radius:3px; background:#f5f8fb }
    .bg-pv .bg-img { width:100%; height:100%; object-fit:cover; display:block }
    .bg-pv .bg-anhang-list { margin:6px 0 0 16px; padding:0; font-size:10.5px }
    .bg-pv .bg-anhang-list li { margin-bottom:1px }
    .bg-pv .bg-foot { flex-shrink:0; margin-top:auto; padding-top:6px; border-top:1px solid #ccc; font-size:9px; color:#888; text-align:left }
    @media (max-width:780px) {
      .bg-pv .bg-doc { width:100%; padding:14px }
      .bg-pv .bg-grid3, .bg-pv .bg-grid4, .bg-pv .bg-grid2 { grid-template-columns:1fr }
    }
  `;
}

/**
 * Body-HTML (ohne <html>/<body>-Wrapper). Wird im Frontend in einen Container injiziert,
 * im Server in das Puppeteer-Vollmarkup gepackt.
 *
 * Das Markup-Layout spiegelt das Excel-Sheet "Bankgespräch" 1:1:
 *   - Header (B3-I5)
 *   - Top-Grid: 3 Boxen (Kaufpreis | Cashflow | Hochrechnung Verkauf)
 *   - Wertsteigerungsstrategie
 *   - Cashflow-Tabelle N Jahre
 *   - Kennzahlen-Grid: 4 Boxen (Eckdaten | Mittelherkunft | Monatl. Investitionen ab J2 | Annahmen + Vermögensaufbau)
 *   - Disclaimer
 */
function bankgespraechBodyHtml(p: BankgespraechPayload): string {
  // User-Wunsch 2026-05-02: "Jahr 1" ... "Jahr 10" statt 2026/2027/...
  const yearCols = p.cashflowYears.map((_, i) => `<th class="bg-num">Jahr ${i + 1}</th>`).join('');
  const cfRow = (label: string, getter: (y: BankgespraechCashflowYear) => number, opts: { bold?: boolean; sumRow?: boolean } = {}) => {
    const cells = p.cashflowYears.map(y => {
      const v = getter(y);
      return `<td class="bg-num ${cls(v)}">${v ? fmt(v) + ' €' : '–'}</td>`;
    }).join('');
    return `<tr class="${opts.sumRow ? 'bg-sum' : ''}"><td class="${opts.bold ? 'bg-bold' : ''}">${escapeHtml(label)}</td>${cells}</tr>`;
  };
  const irrStr = p.hv_eigenkapitalRenditePA !== null
    ? fmtPct(p.hv_eigenkapitalRenditePA)
    : '–';
  // User-Wunsch 2026-05-04: Wertsteigerungsstrategie-Sektion komplett ausblenden
  // wenn keine Bullets vorhanden sind (Default = leer / nicht aktiviert).
  const bullets = (p.wertsteigerungBullets && p.wertsteigerungBullets.length > 0)
    ? p.wertsteigerungBullets
    : [];
  const disclaimer = p.disclaimer && p.disclaimer.trim() ? p.disclaimer : DEFAULT_DISCLAIMER;

  // Header- und Footer-Templates für jede Seite (User-Wunsch 2026-05-02)
  const renderHeader = () => `
  <div class="bg-hdr">
    <div>
      <div class="bg-h1">unverbindliches Rechenbeispiel</div>
      <div class="bg-sub">${escapeHtml(p.headerSubtitle)}</div>
      <div class="bg-projekt">
        ${escapeHtml(p.projektTitel)}
        <span class="bg-badge">${p.scope === 'aufteiler' ? 'Einzeleinheit' : 'Globalverkauf'}</span>
      </div>
      <div class="bg-sub" style="margin-top:2px">${escapeHtml(p.adresse)}</div>
    </div>
    <div class="bg-logo-box" style="background:transparent !important;padding:0 !important;border-radius:0 !important">
      <img src="${IVT_LOGO_DATA_URL}" alt="IVT AG" class="bg-logo-img" style="width:140px;height:auto;display:block;background:transparent">
    </div>
  </div>`;

  const renderFooter = (pageNum: number, totalPages: number) => `
  <div class="bg-foot">
    <span style="float:left">${escapeHtml(p.kalkName)}</span>
    <span style="float:right;font-style:italic">Ein Produkt der IVT Wohnen GmbH</span>
    <span style="display:block;text-align:center">Seite ${pageNum} / ${totalPages}</span>
    <div style="clear:both"></div>
  </div>`;

  // Inhaltssektionen — werden auf Seiten verteilt:
  const sectionTopGrid = `
  <div class="bg-grid3">
    <!-- Box 1: Kaufpreis + Mittelherkunft (Excel C19-D28, User-Wunsch 2026-05-03 erweitert) -->
    <div class="bg-box">
      <div class="bg-box-t">Kaufpreis</div>
      <table>
        ${p.kaufpreisStellplatz > 0 ? `
        <tr><td>Kaufpreis Wohnung</td><td class="bg-num">${fmt(p.kaufpreisWohnung)} €</td></tr>
        <tr><td>+ Kaufpreis Stellplatz</td><td class="bg-num">${fmt(p.kaufpreisStellplatz)} €</td></tr>
        <tr><td class="bg-bold">= Kaufpreis</td><td class="bg-num bg-bold">${fmt(p.kaufpreis)} €</td></tr>
        ` : `
        <tr><td>Kaufpreis</td><td class="bg-num">${fmt(p.kaufpreis)} €</td></tr>
        `}
        <tr><td>+ Kaufnebenkosten</td><td class="bg-num">${fmt(p.nebenkosten)} €</td></tr>
        <tr><td>+ Renovierungsbeispiel</td><td class="bg-num">${fmt(p.renovierung)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">Gesamtinvestitionskosten</td><td class="bg-num bg-bold">${fmt(p.gik)} €</td></tr>
        ${p.renovierungWegRuecklage > 0 ? `<tr><td style="font-size:8pt;color:#888;font-style:italic">nachrichtl.: Sanierung aus WEG-Rücklage (steuerl. sofort, weder EK noch FK)</td><td class="bg-num" style="font-size:8pt;color:#888">${fmt(p.renovierungWegRuecklage)} €</td></tr>` : ''}
      </table>
      <div class="bg-box-t-sub">Mittelherkunft</div>
      <table>
        <tr><td>Fremdkapital</td><td class="bg-num">${fmt(p.fremdkapital)} €</td></tr>
        <tr><td>Eigenkapital</td><td class="bg-num">${fmt(p.eigenkapital)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">Summe</td><td class="bg-num bg-bold">${fmt(p.fremdkapital + p.eigenkapital)} €</td></tr>
      </table>
    </div>

    <!-- Box 2: Einnahmen/Ausgaben — Jahr 1 aufgeschlüsselt + Durchschnitt
         (User-Wunsch 2026-05-04: 2.-Jahres-Block raus, Jahr 1 mit Volldetail) -->
    <div class="bg-box">
      <div class="bg-group-title">Einnahmen / Ausgaben</div>
      <div class="bg-box-t">1. Jahr (monatlich)</div>
      <table>
        <tr><td>Kaltmiete</td><td class="bg-num bg-grn">${fmtD(p.cf_jahr1_kaltmieteMonat)} €</td></tr>
        <tr><td>Zins</td><td class="bg-num bg-red">${fmtD(p.cf_jahr1_zinsMonat)} €</td></tr>
        <tr><td>Tilgung</td><td class="bg-num bg-red">${fmtD(-p.cf_jahr1_tilgungProMonat)} €</td></tr>
        <tr><td>nicht umlagef. Nebenkosten</td><td class="bg-num bg-red">${fmtD(p.cf_jahr1_nichtUmlagefaehigMonat)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">Einnahmen vor Steuer</td><td class="bg-num bg-bold ${cls(p.cf_jahr1_einnahmenVorSteuerMonat)}">${fmtD(p.cf_jahr1_einnahmenVorSteuerMonat)} €</td></tr>
        <tr><td>Steuerrückerstattung</td><td class="bg-num ${cls(p.cf_jahr1_steuerrueckerstattungMonat)}">${fmtD(p.cf_jahr1_steuerrueckerstattungMonat)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">Einnahmen nach Steuer</td><td class="bg-num bg-bold ${cls(p.cf_jahr1_einnahmenNachSteuerMonat)}">${fmtD(p.cf_jahr1_einnahmenNachSteuerMonat)} €</td></tr>
      </table>
      <div style="height:1px;background:#d0dae5;margin:3mm 0"></div>
      <div class="bg-box-t">Durchschnittswerte ${p.hv_dauerJahre} Jahre (n. Steuern, monatlich)</div>
      <table>
        <tr><td>Cashflow</td><td class="bg-num ${cls(p.durchschnitt_cashflowProMonat)}">${fmtD(p.durchschnitt_cashflowProMonat)} €</td></tr>
        <tr><td>Tilgung</td><td class="bg-num bg-grn">${fmtD(p.durchschnitt_tilgungProMonat)} €</td></tr>
        <tr><td>Vermögensaufbau</td><td class="bg-num ${cls(p.durchschnitt_vermoegensaufbauProMonat)}">${fmtD(p.durchschnitt_vermoegensaufbauProMonat)} €</td></tr>
      </table>
    </div>

    <!-- Box 3: Performance / Hochrechnung Verkauf -->
    <div class="bg-box">
      <div class="bg-group-title">Performance</div>
      <div class="bg-box-t">Hochrechnung Verkauf in ${p.hv_dauerJahre} Jahren</div>
      <table>
        <tr><td>Immobilienwert Verkauf</td><td class="bg-num">${fmt(p.hv_verkaufspreis)} €</td></tr>
        <tr><td>− Restschuld bei Verkauf</td><td class="bg-num bg-red">${fmt(-p.hv_restschuld)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">= Liquidität aus Verkauf</td><td class="bg-num bg-bold bg-grn">${fmt(p.hv_erloes)} €</td></tr>
        <tr><td>+ Σ Cashflow nach Steuern ${p.hv_dauerJahre} J</td><td class="bg-num ${cls(p.kumul_cashflow_summe)}">${fmt(p.kumul_cashflow_summe)} €</td></tr>
        <tr><td>− Initial eingesetztes EK</td><td class="bg-num bg-red">${fmt(-p.eigenkapital)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">= Steuerfreier Vermögenszuwachs</td><td class="bg-num bg-bold ${p.hv_steuerfreierVermoegenszuwachs >= 0 ? 'bg-grn' : 'bg-red'}">${fmt(p.hv_steuerfreierVermoegenszuwachs)} €</td></tr>
        <tr><td>Verm.zuwachs in % vom Initial-EK</td><td class="bg-num bg-bold">${p.eigenkapital > 0 ? (p.hv_steuerfreierVermoegenszuwachs / p.eigenkapital * 100).toLocaleString('de-DE',{minimumFractionDigits:1,maximumFractionDigits:1}) + ' %' : '–'}</td></tr>
        <tr><td>Eigenkapitalrendite p.a. (IRR)</td><td class="bg-num bg-bold">${irrStr}</td></tr>
        <tr><td>Miete pro Monat (Endjahr)</td><td class="bg-num">${fmt(p.hv_mieteEndjahr)} €</td></tr>
        <tr><td>Mietrendite auf Restschuld</td><td class="bg-num bg-bold">${(p.hv_renditeAufRestschuld * 100).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})} %</td></tr>
      </table>
      <div class="bg-key">
        <div class="l">Steuerfreier Vermögenszuwachs in ${p.hv_dauerJahre} Jahren</div>
        <div class="v">${fmt(p.hv_steuerfreierVermoegenszuwachs)} €</div>
      </div>
    </div>
  </div>

  ${bullets.length > 0 ? `
  <div class="bg-h2">Hinweise</div>
  <div class="bg-strat">
    <ul>
      ${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}
    </ul>
  </div>
  ` : ''}`;

  // CF und Steuerkalk als getrennte Sections (User-Wunsch 2026-05-03:
  // dürfen auf 2 Seiten gesplittet werden, falls beide nicht auf eine passen).
  // <colgroup> sichert weiterhin: Spalten beider Tabellen sind exakt
  // untereinander (gleiche Label-Breite 60mm + auto-Verteilung der Jahre).
  const colgroupHtml = `<colgroup><col class="bg-col-lbl">${
    p.cashflowYears.map(() => '<col class="bg-col-yr">').join('')
  }</colgroup>`;
  const sectionCashflow = `
  <div class="bg-h2">Cashflow-Betrachtung ${p.hv_dauerJahre} Jahre</div>
  <table class="bg-cf10 bg-cf10-fixed">
    ${colgroupHtml}
    <thead><tr><th class="bg-lbl">Position</th>${yearCols}</tr></thead>
    <tbody>
      ${cfRow('Kaltmiete', y => y.kaltmiete)}
      ${cfRow('- nicht umlagef. Bewirtschaftung', y => y.bewirtschaftung)}
      ${cfRow('- Zinsen', y => y.zinsen)}
      ${cfRow('- Tilgung', y => y.tilgung)}
      ${cfRow('= Cashflow vor Steuer', y => y.cashflowVorSteuer, { sumRow: true })}
      ${cfRow('- Steuererstattung (+) / Steuerlast (-)', y => y.steuerErstattungLast)}
      ${cfRow('= Cashflow nach Steuern', y => y.cashflowNachSteuern, { sumRow: true })}
      ${cfRow('Kumulierter Cashflow', y => y.kumuliert, { bold: true })}
    </tbody>
  </table>`;

  const sectionSteuerkalk = `
  <div class="bg-h2" style="font-size:10pt">Steuerkalkulation ${p.hv_dauerJahre} Jahre (Detail zu „Steuererstattung / -last")</div>
  <table class="bg-cf10 bg-cf10-fixed">
    ${colgroupHtml}
    <thead><tr><th class="bg-lbl">Position</th>${yearCols}</tr></thead>
    <tbody>
      ${cfRow('Kaltmiete', y => y.kaltmiete)}
      ${cfRow('- nicht umlagef. Bewirtschaftung', y => y.bewirtschaftung)}
      ${cfRow('- Zinsen (Werbungskosten)', y => y.zinsen)}
      ${cfRow('- AfA (jährliche Abschreibung)', () => -p.tax_afaProJahrTotal)}
      ${cfRow('- Sanierung', y => y.year === p.cashflowYears[0]!.year ? -p.tax_sanSofort : 0)}
      ${cfRow('= zu versteuerndes Einkommen', y => y.tax_zuVersteuerndesEinkommen, { sumRow: true })}
      ${cfRow(`= Steuererstattung (+) / Last (-) (× ${(p.steuersatz * 100).toLocaleString('de-DE',{minimumFractionDigits:0,maximumFractionDigits:2})} % Steuersatz)`, y => y.steuerErstattungLast, { sumRow: true })}
    </tbody>
  </table>`;

  const sectionKennzahlen = `
  <!-- Kennzahlen 2x2-Grid (User-Wunsch 2026-05-03):
       Eckdaten | Annahmen
       Monatl. Investitionen | Vermögensaufbau -->
  <div class="bg-h2">Kennzahlen</div>
  <div class="bg-grid2">
    <!-- Box 1 oben links: Eckdaten + Kaufpreis-Block aufgeschlüsselt
         (User-Wunsch 2026-05-03: Reihenfolge Mietfläche, KP Wohnung, KP Wohnung pro m²,
          Stellplätze (Anzahl), KP Stellplatz; dann Kaufpreis-Block mit Nebenkosten-Aufschlüsselung) -->
    <div class="bg-box">
      <div class="bg-box-t">Eckdaten</div>
      <table>
        <tr><td>Mietfläche</td><td class="bg-num">${p.wohnflaeche.toLocaleString('de-DE',{maximumFractionDigits:1})} m²</td></tr>
        <tr><td>Kaufpreis Wohnung</td><td class="bg-num">${fmt(p.kaufpreisWohnung)} €</td></tr>
        <tr><td>Kaufpreis Wohnung pro m²</td><td class="bg-num">${fmt(p.kaufpreisProQm)} €</td></tr>
        ${p.stellplaetzeAnzahl > 0 ? `
        <tr><td>Anzahl Stellplätze</td><td class="bg-num">${p.stellplaetzeAnzahl}</td></tr>
        <tr><td>Kaufpreis Stellplatz</td><td class="bg-num">${fmt(p.kaufpreisStellplatz)} €</td></tr>
        ` : ''}
      </table>
      <div class="bg-box-t-sub">Kaufpreis</div>
      <table>
        <tr><td>Kaufpreis</td><td class="bg-num">${fmt(p.kaufpreis)} €</td></tr>
        ${p.nebenkosten_notar > 0 ? `<tr><td>+ Notar</td><td class="bg-num">${fmt(p.nebenkosten_notar)} €</td></tr>` : ''}
        ${p.nebenkosten_grundbuch > 0 ? `<tr><td>+ Grundbuch</td><td class="bg-num">${fmt(p.nebenkosten_grundbuch)} €</td></tr>` : ''}
        ${p.nebenkosten_grunderwerbsteuer > 0 ? `<tr><td>+ Grunderwerbsteuer</td><td class="bg-num">${fmt(p.nebenkosten_grunderwerbsteuer)} €</td></tr>` : ''}
        ${p.nebenkosten_makler > 0 ? `<tr><td>+ Makler</td><td class="bg-num">${fmt(p.nebenkosten_makler)} €</td></tr>` : ''}
        ${p.nebenkosten_sonstige > 0 ? `<tr><td>+ Sonstige Nebenkosten</td><td class="bg-num">${fmt(p.nebenkosten_sonstige)} €</td></tr>` : ''}
        <tr><td>+ Renovierungskosten</td><td class="bg-num">${fmt(p.renovierung)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">= Gesamtinvestitionskosten</td><td class="bg-num bg-bold">${fmt(p.gik)} €</td></tr>
        ${p.renovierungWegRuecklage > 0 ? `<tr><td style="font-size:8pt;color:#888;font-style:italic">nachrichtl.: Sanierung aus WEG-Rücklage (steuerl. sofort, weder EK noch FK)</td><td class="bg-num" style="font-size:8pt;color:#888">${fmt(p.renovierungWegRuecklage)} €</td></tr>` : ''}
      </table>
      <div class="bg-box-t-sub">Mittelherkunft</div>
      <table>
        <tr><td>Fremdkapital</td><td class="bg-num">${fmt(p.fremdkapital)} €</td></tr>
        <tr><td>Eigenkapital</td><td class="bg-num">${fmt(p.eigenkapital)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">Summe</td><td class="bg-num bg-bold">${fmt(p.fremdkapital + p.eigenkapital)} €</td></tr>
      </table>
    </div>

    <!-- Box 2 oben rechts: Annahmen -->
    <div class="bg-box">
      <div class="bg-box-t">Annahmen</div>
      <table>
        <tr><td>Zins</td><td class="bg-num">${fmtPct(p.zins)}</td></tr>
        <tr><td>Tilgung</td><td class="bg-num">${fmtPct(p.tilgung)}</td></tr>
        <tr><td>Wertzuwachs p.a.</td><td class="bg-num">${fmtPct(p.wertzuwachsPa)}</td></tr>
        <tr><td>Mietentwicklung p.a.</td><td class="bg-num">${fmtPct(p.mietentwicklungPa)}</td></tr>
        <tr><td>Steuersatz</td><td class="bg-num">${fmtPct(p.steuersatz)}</td></tr>
        <tr><td>AfA-Satz</td><td class="bg-num">${fmtPct(p.afaSatz)}</td></tr>
        <tr><td>AfA-Bemessungsgrundlage</td><td class="bg-num">${fmt(p.afaBemessungsgrundlage)} €</td></tr>
      </table>
    </div>

    <!-- Box 3 unten links: Monatliche Investitionen -->
    <div class="bg-box">
      <div class="bg-box-t">Monatliche Investitionen</div>
      <div class="bg-box-t-sub" style="margin-top:0">Durchschnittswerte</div>
      <table>
        <tr><td>Zins</td><td class="bg-num bg-red">${fmtD(p.basisjahr2_zinsMonat)} €</td></tr>
        <tr><td>Tilgung</td><td class="bg-num bg-red">${fmtD(p.basisjahr2_tilgungMonat)} €</td></tr>
        <tr><td>nicht umlagefähige Nebenkosten</td><td class="bg-num bg-red">${fmtD(p.basisjahr2_nichtUmlagefaehigMonat)} €</td></tr>
        <tr><td>Kaltmiete pro Monat</td><td class="bg-num bg-grn">${fmtD(p.basisjahr2_kaltmieteMonat)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">mtl. Einnahmen vor Steuer</td><td class="bg-num bg-bold ${cls(p.basisjahr2_einnahmenVorSteuerMonat)}">${fmtD(p.basisjahr2_einnahmenVorSteuerMonat)} €</td></tr>
        <tr><td>Steuerrückerstattung</td><td class="bg-num ${cls(p.basisjahr2_steuerrueckerstattungMonat)}">${fmtD(p.basisjahr2_steuerrueckerstattungMonat)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">mtl. Einnahmen nach Steuer</td><td class="bg-num bg-bold ${cls(p.basisjahr2_einnahmenNachSteuerMonat)}">${fmtD(p.basisjahr2_einnahmenNachSteuerMonat)} €</td></tr>
      </table>
    </div>

    <!-- Box 4 unten rechts: Vermögensaufbau / Hochrechnung Verkauf -->
    <div class="bg-box">
      <div class="bg-box-t">Vermögensaufbau</div>
      <div class="bg-box-t-sub" style="margin-top:0">Hochrechnung Verkauf in ${p.hv_dauerJahre} Jahren</div>
      <table>
        <tr><td>Verkaufspreis</td><td class="bg-num">${fmt(p.hv_verkaufspreis)} €</td></tr>
        <tr><td>− Restschuld</td><td class="bg-num bg-red">${fmt(-p.hv_restschuld)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">= Liquidität aus Verkauf</td><td class="bg-num bg-bold bg-grn">${fmt(p.hv_erloes)} €</td></tr>
        <tr><td>+ Σ Cashflow n.St. ${p.hv_dauerJahre} J</td><td class="bg-num ${cls(p.kumul_cashflow_summe)}">${fmt(p.kumul_cashflow_summe)} €</td></tr>
        <tr><td>− Initial EK</td><td class="bg-num bg-red">${fmt(-p.eigenkapital)} €</td></tr>
        <tr class="bg-sum"><td class="bg-bold">= Steuerfr. Vermögenszuwachs</td><td class="bg-num bg-bold ${p.hv_steuerfreierVermoegenszuwachs >= 0 ? 'bg-grn' : 'bg-red'}">${fmt(p.hv_steuerfreierVermoegenszuwachs)} €</td></tr>
        <tr><td>Eigenkapitalrendite p.a.</td><td class="bg-num bg-bold">${irrStr}</td></tr>
        <tr><td>Miete pro Monat (Endjahr)</td><td class="bg-num">${fmt(p.hv_mieteEndjahr)} €</td></tr>
        <tr><td>Mietrendite auf Restschuld</td><td class="bg-num bg-bold">${(p.hv_renditeAufRestschuld * 100).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})} %</td></tr>
      </table>
    </div>
  </div>`;

  const sectionDisclaimer = `
  <div class="bg-h2">Disclaimer</div>
  <div class="bg-disclaimer">
    <b>Disclaimer:</b> ${escapeHtml(disclaimer).replace(/\n\n/g, '</p><p style="margin:1.5mm 0 0">')}
  </div>`;

  const sectionImpressionen = (p.impressionen && p.impressionen.length > 0) ? `
  <div class="bg-h2">Impressionen</div>
  <div class="bg-impressionen bg-impressionen-${p.impressionen.length}">
    ${p.impressionen.slice(0, 9).map(src => `<div class="bg-img-wrap"><img src="${src}" alt="Foto" class="bg-img"></div>`).join('')}
  </div>` : '';

  const sectionAnhaenge = (p.anhaengeNamen && p.anhaengeNamen.length > 0) ? `
  <div class="bg-h2">Anhänge</div>
  <ul class="bg-anhang-list">
    ${p.anhaengeNamen.map(n => `<li>📎 ${escapeHtml(n)}</li>`).join('')}
  </ul>` : '';

  // ── Fließendes A4-Layout (User-Wunsch 2026-05-03):
  //    Inhalt ist EIN durchgängiger Strom — Browser setzt Page-Breaks nur dort
  //    wo eine Sektion sonst getrennt würde. Jede Tabelle/Box hat
  //    `page-break-inside: avoid`, damit Zahlen nie mittendrin gerissen werden.
  //    Impressionen werden als kleinere Blöcke gestaltet, sodass sie sich nach
  //    den Texten einfügen statt eine eigene Seite zu erzwingen.
  const allSections = [
    sectionTopGrid,
    sectionCashflow,
    sectionSteuerkalk,
    sectionKennzahlen,
    sectionDisclaimer,
    sectionImpressionen,
    sectionAnhaenge,
  ].filter(Boolean).join('\n');

  return `
    <article class="bg-doc">
      ${renderHeader()}
      <div class="bg-doc-body">${allSections}</div>
      ${renderFooter(1, 1)}
    </article>
  `;
}

/**
 * Liefert HTML für Live-Preview im Frontend.
 * Gewickelt in `<div class="bg-pv">` und mit eingebettetem `<style>`-Block.
 */
export function bankgespraechPreviewHtml(p: BankgespraechPayload): string {
  return `<style>${bankgespraechCss('preview')}</style><div class="bg-pv">${bankgespraechBodyHtml(p)}</div>`;
}

/**
 * Liefert vollständiges HTML-Dokument für Puppeteer-PDF-Export.
 * Inklusive `<!DOCTYPE>`, `<html>`, `<head>`, `<body>` und A4-CSS.
 */
export function bankgespraechFullHtml(p: BankgespraechPayload): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(p.kalkName)}</title>
<style>${bankgespraechCss('pdf')}</style>
</head>
<body>
${bankgespraechBodyHtml(p)}
</body>
</html>`;
}

/**
 * Header-Template für Puppeteer's `displayHeaderFooter` (auf JEDER Seite).
 * Puppeteer ersetzt `<span class="pageNumber">` und `<span class="totalPages">`
 * automatisch. Das Template muss inline-CSS verwenden, externes CSS wird ignoriert.
 */
export function bankgespraechPdfHeader(p: BankgespraechPayload): string {
  // Hintergrund-Farben werden in Puppeteer-Header-Templates IGNORIERT
  // (separater Render-Kontext, ignoriert printBackground). Lösung: SVG mit
  // <rect>-Hintergrund — SVG wird immer mitgedruckt, unabhängig von Print-Settings.
  // Das Logo ist als <image> mit Data-URL eingebettet.
  // Bereich: 100mm × 24mm = 378.5 × 90.7 px bei 96dpi.
  // Logo OHNE Hintergrundfarbe — blaues Logo wirkt sonst grau auf blauem #003366-Hintergrund.
  const logoSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="38mm" height="14mm" viewBox="0 0 380 140" preserveAspectRatio="xMidYMid meet" style="display:block">
      <image href="${IVT_LOGO_DATA_URL}" x="0" y="0" width="380" height="140" preserveAspectRatio="xMidYMid meet"/>
    </svg>`;
  // Auch der Scope-Badge verliert sonst seinen blauen Hintergrund — daher ebenfalls SVG.
  const badgeText = p.scope === 'aufteiler' ? 'Einzeleinheit' : 'Globalverkauf';
  const badgeWidth = badgeText.length * 5 + 10;  // grobe Approximation
  const badgeSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${badgeWidth * 0.4}mm" height="3.5mm" viewBox="0 0 ${badgeWidth} 14" style="display:inline-block;vertical-align:middle;margin-left:2mm">
      <rect x="0" y="0" width="${badgeWidth}" height="14" rx="2" ry="2" fill="#003366"/>
      <text x="${badgeWidth / 2}" y="10" font-family="Helvetica, Arial, sans-serif" font-size="9" font-weight="600" fill="#ffffff" text-anchor="middle">${escapeHtml(badgeText)}</text>
    </svg>`;
  return `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:9pt;color:#1a1a1a;width:100%;padding:8mm 12mm 0 12mm;box-sizing:border-box;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #003366;padding-bottom:2mm;">
    <div style="flex:1">
      <div style="font-size:13pt;font-weight:700;color:#003366;letter-spacing:-0.01em">unverbindliches Rechenbeispiel</div>
      <div style="font-size:8pt;color:#555;margin-top:0.5mm">${escapeHtml(p.headerSubtitle)}</div>
      <div style="font-size:10pt;font-weight:600;color:#003366;margin-top:1mm">
        ${escapeHtml(p.projektTitel)}${badgeSvg}
      </div>
      <div style="font-size:8pt;color:#555;margin-top:0.5mm">${escapeHtml(p.adresse)}</div>
    </div>
    <div style="margin-left:4mm">
      ${logoSvg}
    </div>
  </div>
</div>`;
}

/**
 * Footer-Template für Puppeteer's `displayHeaderFooter`. Inkl. Seitennummer.
 */
export function bankgespraechPdfFooter(p: BankgespraechPayload): string {
  return `
<div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:7pt;color:#888;width:100%;padding:0 12mm 6mm 12mm;box-sizing:border-box;border-top:1px solid #ccc;padding-top:2mm">
  <table style="width:100%;border:none;border-collapse:collapse">
    <tr>
      <td style="text-align:left;border:none;padding:0">${escapeHtml(p.kalkName)}</td>
      <td style="text-align:center;border:none;padding:0">Seite <span class="pageNumber"></span> / <span class="totalPages"></span></td>
      <td style="text-align:right;border:none;padding:0;font-style:italic">Ein Produkt der IVT Wohnen GmbH</td>
    </tr>
  </table>
</div>`;
}
