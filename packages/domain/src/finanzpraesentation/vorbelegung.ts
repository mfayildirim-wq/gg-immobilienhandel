/* eslint-disable @typescript-eslint/no-explicit-any -- Altformat der Deals/Objekte wie in der alten App */
/**
 * Vorbelegung und Prüfung der Bank-Präsentation aus Deal und Objekt.
 * Port aus gg-immohandel src/modules/finanzpraes/finanzpraes.ts, geprüft per Golden Master.
 *
 * Die alte App las Deal/Objekt aus dem Speicher und schrieb die Folie direkt zurück. Hier sind es reine Funktionen:
 * sie bekommen Deal und Objekt im **Altformat** (kalk, einheiten mit fl/mi_ist/…, sanierung mit amt/scope; die API
 * bildet die neuen Tabellen darauf ab) und geben die neuen Folien-Daten zurück. `null` = die alte App brach mit
 * einem Hinweis ab (z. B. „Deal hat keinen Kaufpreis“).
 */
import { formatiereFlaeche } from './tabelle.ts';
import type { FinanzpraesDefaults } from './standard.ts';
import type { FinanzPraes, Slide, SlideTyp } from './typen.ts';

type Daten = Record<string, any>;

// ── Anlegen ─────────────────────────────────────────────────

/** createEmptySlide: Geschäftsmodell-Texte werden kopiert, bei Organigramm/Abschluss nur die Texte (Bild kommt beim Rendern). */
export function leereFolie(typ: SlideTyp, defaults: FinanzpraesDefaults, id: string): Slide {
  const data: Record<string, any> = {};
  if (typ === 'geschaeftsmodell') Object.assign(data, defaults.geschaeftsmodell);
  if (typ === 'organigramm') data.beschreibung = defaults.organigramm.beschreibung;
  if (typ === 'abschluss') data.untertitel = defaults.abschluss.untertitel;
  return { id, typ, visible: true, data };
}

// ── Deckblatt & Objektbeschreibung ─────────────────────────

/** computeDeckblattTitelPrefill */
export function deckblattTitel(objekt: any | null): string {
  if (!objekt) return '';
  const typ = (objekt.objektTyp as string) || (objekt.einheitenAnz && objekt.einheitenAnz > 1 ? 'Mehrfamilienhaus' : 'Wohnobjekt');
  return `ANKAUF ${typ}`;
}

/** computeDeckblattUntertitelPrefill (Deal-Kopien der Adresse haben Vorrang, wie alt) */
export function deckblattUntertitel(deal: any | null, objekt: any | null): string {
  const stadt = deal?.stadt || objekt?.stadt || '';
  const strasse = deal?.adresse || objekt?.strasse || '';
  const hausnr = deal?.hausnr || objekt?.hausnr || '';
  const adresse = [strasse, hausnr].filter(Boolean).join(' ');
  if (stadt && adresse) return `in ${stadt}, ${adresse}`;
  if (stadt) return `in ${stadt}`;
  return adresse;
}

/** finanzpraesPrefillDeckblatt */
export function deckblattVorbelegen(data: Daten, deal: any | null, objekt: any | null): Daten {
  return { ...data, titel: deckblattTitel(objekt), untertitel: deckblattUntertitel(deal, objekt) };
}

/** finanzpraesPrefillObjekt — `null`, wenn weder Deal noch Objekt da sind. */
export function objektbeschreibungVorbelegen(data: Daten, deal: any | null, objekt: any | null): Daten | null {
  if (!deal && !objekt) return null;
  const d: Daten = { ...data };
  d.adresse = deckblattUntertitel(deal, objekt).replace(/^in\s+/, '');
  d.baujahr = String(objekt?.baujahr || '');
  d.einheiten = String(objekt?.einheitenAnz || '');
  d.wohnflaeche = String(objekt?.wohnflaeche || '');
  d.grundstueck = String(objekt?.grundstueck || '');
  const kp = Number(deal?.kalk?.kaufpreis) || 0;
  if (kp) d.gik = `${kp.toLocaleString('de-DE')} €`;
  const dealEinheiten: any[] = Array.isArray(deal?.einheiten) ? deal.einheiten : [];
  const wfHaus = dealEinheiten
    .filter((e: any) => e.typ !== 'Stellplatz')
    .reduce((sum: number, e: any) => sum + (Number(e.fl) || 0), 0);
  const wf = wfHaus || Number(objekt?.wohnflaeche) || 0;
  if (kp && wf) d.kaufpreisPerM2 = `${Math.round(kp / wf).toLocaleString('de-DE')} €/m²`;
  const miMonatIst = dealEinheiten.reduce((sum: number, e: any) => sum + (Number(e.mi_ist) || 0), 0);
  const jnkm = miMonatIst * 12;
  if (jnkm) d.jnkm = `${jnkm.toLocaleString('de-DE')} €`;
  if (kp && jnkm) {
    const rend = (jnkm / kp) * 100;
    d.renditeIst = `${rend.toFixed(2).replace('.', ',')} %`;
  }
  return d;
}

// ── Projektkalkulation (wörtlich) ──────────────────────────

/** Helper: Berechnet die VOLLSTÄNDIGE Aufteiler- bzw. Global-Kalkulation
 *  exakt wie die Boxen am Ende der Deal-Kalkulation — ABER ohne
 *  EK-Opportunitätskosten (intern, nicht für die Bank).
 *
 *  Algorithmik 1:1 aus deals.ts dealKalkRC() repliziert:
 *  - Anschaffungskosten, FK-Zinsen, Bank-Abschlussgebühr, Mieteinnahmen
 *  - Sanierung + Puffer mit Scope-Filter
 *  - Aufteilungskosten + Vertriebsprovision (nur Aufteiler)
 *  - Zirkelbezugs-Auflösung GIK = (base - mabzug) / (1 - f - a)
 *  - Verkaufserlöse: Summe der Einheiten-VKPs (Aufteiler) bzw. GIK × (1+Marge) (Global)
 *  - Gewinn + Marge auf VKP. */
export function computeDealKalkSummary(deal: any, scope: 'aufteiler' | 'global'): {
  rows: Array<[string, string]>;
  kp: number; gik: number; vkp: number; gewinn: number; marge: number;
  // Finanzierungs-Werte (für die Finanzierungsstruktur-Slide)
  em: number;        // Eigenmittel in €
  fm: number;        // Fremdmittel Bank in €
  ekAnteilPct: number;  // EK-Anteil in % (auf 1 Stelle gerundet)
  fkAnteilPct: number;  // FK-Anteil in % (auf 1 Stelle gerundet)
  zinssatz: number;     // Verzinsung p.a. in %
  margeBank: number;    // Marge Bank in % (für Zinsbindungs-Anzeige)
  haltMonate: number;   // Kreditlaufzeit in Monaten
} | null {
  const k = deal?.kalk || {};
  const einheiten = Array.isArray(deal?.einheiten) ? deal.einheiten : [];
  const sanierung = Array.isArray(deal?.sanierung) ? deal.sanierung : [];
  const kp = Number(k.kaufpreis) || 0;
  if (!kp) return null;
  const fmt = (n: number) => n ? Math.round(n).toLocaleString('de-DE') + ' €' : '–';
  const fmtNeg = (n: number) => n ? '– ' + Math.round(n).toLocaleString('de-DE') + ' €' : '–';
  const fmtPct = (n: number) => (typeof n === 'number' && !isNaN(n)) ? n.toFixed(2).replace('.', ',') + '%' : '–';

  // Eingaben
  const notarP = Number(k.notar) || 0;
  const gestP  = Number(k.gest)  || 0;
  const maklP  = Number(k.makler) || 0;
  const fkP    = Number(k.fk_p) || 0;
  const eu     = Number(k.euribor) || 0;
  const mb     = Number(k.margeB)  || 0;
  const halt   = Number(k.halt)    || 0;            // Monate
  const abgebPct = Number(k.bank_abgeb) || 0;
  const vprovP = Number(k.vprov) || 0;
  const aufkB  = Number(k.aufk)  || 0;
  // aufH/aufE sind heute nur noch UI-Helfer (siehe deals.ts dealAufkHelperApply).
  // Wir lesen sie weiterhin, nutzen sie aber NICHT mehr für die Berechnung —
  // damit hier nicht der gleiche "+9.600 €"-Fehler entsteht wie vor dem deals.ts-Fix.
  const gloMP  = scope === 'global' ? (Number(k.glo_m) || 0) : 0;

  // Berechnung
  const notar = kp * notarP / 100;
  const gest  = kp * gestP / 100;
  const makl  = kp * maklP / 100;
  const zs1 = kp + notar + gest + makl;  // Anschaffungskosten

  // Mieteinnahmen-Abzug während Haltedauer (IST — was tatsächlich reinkommt)
  const miMonatIst = einheiten.reduce((s: number, e: any) => s + (Number(e.mi_ist) || 0), 0);
  const mabzug = miMonatIst * halt;
  // SOLL-Miete für JNKM SOLL / KP-Faktor Kunde / Bruttorendite Kunde
  // (nach Mieterhöhung — was der Kunde nach Übernahme tatsächlich an Miete sieht)
  const miMonatSoll = einheiten.reduce((s: number, e: any) => {
    const mn = e.mi_neu_manual ? (Number(e.mi_neu) || 0) : (Number(e.mi_ist) || 0);
    return s + mn;
  }, 0);

  // Sanierung mit Scope-Filter
  const filterScope = scope === 'aufteiler' ? 'auf' : 'glo';
  const sanItems = sanierung.filter((s: any) => !s.scope || s.scope === 'both' || s.scope === filterScope);
  const sanNetto = sanItems.reduce((sum: number, s: any) => sum + (Number(s.amt) || 0), 0);
  const rpPct = (k.rp_pct !== undefined ? Number(k.rp_pct) : 10);
  const rpFix = Number(k.rp_fix) || 0;
  const sanGesNetto = sanierung.reduce((sum: number, s: any) => sum + (Number(s.amt) || 0), 0);
  const pufferGes = rpFix > 0 ? rpFix : sanGesNetto * rpPct / 100;
  const pufFak = sanGesNetto > 0 ? pufferGes / sanGesNetto : (rpPct / 100);
  const sanInkl = sanNetto + sanNetto * pufFak;
  const sanPuffer = sanNetto * pufFak;

  // Aufteilungskosten (nur Aufteiler) — EXAKT der eingegebene Wert aus der
  // Deal-Kalkulation, keine versteckte H×6000 + E×600-Mathematik mehr.
  const aufkTeilung = scope === 'aufteiler' ? aufkB : 0;

  // VKP-Summe (für Vertriebsprovision Aufteiler)
  const calcVkp = (e: any): number => {
    if (e.vkp) return Number(e.vkp);
    const r = Number(e.rend_k) || 0;
    const mn = e.mi_neu_manual ? (Number(e.mi_neu) || 0) : (Number(e.mi_ist) || 0);
    return (r && mn) ? Math.round((mn * 12) / (r / 100)) : 0;
  };
  const kpkSum = einheiten.reduce((s: number, e: any) => s + calcVkp(e), 0);
  const avprovPre = scope === 'aufteiler' ? (kpkSum * vprovP / 100) : 0;

  // Zirkelbezugs-Auflösung — OHNE EK-Opportunitätskosten (e_base = 0, weil intern)
  const zsr = eu + mb;     // Zinssatz
  const hj  = halt / 12;
  const f_base = (fkP / 100) * (zsr / 100) * hj;          // FK-Zinsen-Faktor
  const a_base = (fkP / 100) * (abgebPct / 100);          // Bank-Abschlussgebühr-Faktor
  // Scope = 'both' für FK/Bankabgeb (gleich wie Deal-Kalk)
  const base = zs1 + sanInkl + aufkTeilung + avprovPre;
  const denom = 1 - f_base - a_base;  // OHNE e_base!
  let gik: number, fkz: number, bankAbgeb: number;
  if (denom > 0.05) {
    gik = (base - mabzug) / denom;
    fkz = gik * f_base;
    bankAbgeb = gik * a_base;
  } else {
    fkz = (base - mabzug) * f_base;
    bankAbgeb = (base - mabzug) * a_base;
    gik = base - mabzug + fkz + bankAbgeb;
  }

  // Verkaufserlöse + Gewinn + Marge
  let vkp: number, gewinn: number, marge: number;
  if (scope === 'aufteiler') {
    vkp = kpkSum;
    gewinn = vkp - gik;
    marge = vkp ? (gewinn / vkp * 100) : 0;
  } else {
    vkp = Math.round(gik * (1 + gloMP / 100));
    gewinn = vkp - gik;
    marge = vkp ? (gewinn / vkp * 100) : 0;
  }

  const wf = einheiten.filter((e: any) => e.typ !== 'Stellplatz').reduce((s: number, e: any) => s + (Number(e.fl) || 0), 0);
  const jnkm = miMonatSoll * 12;  // SOLL-Miete × 12 — was der Kunde an Jahresrendite sieht
  const gloFak = jnkm ? vkp / jnkm : 0;
  const gloRendite = vkp && jnkm ? (jnkm / vkp * 100) : 0;

  // Tabellenzeilen — strukturiert nach Original-Box
  const rows: Array<[string, string]> = [
    ['PROJEKTKOSTEN', ''],
    ['Kaufpreis', fmt(kp)],
    [`+ Notar & Grundbuch (${fmtPct(notarP)})`, fmt(notar)],
    [`+ Grunderwerbsteuer (${fmtPct(gestP)})`, fmt(gest)],
    [`+ Maklerprovision (${fmtPct(maklP)})`, fmt(makl)],
    ['= Anschaffungskosten', fmt(zs1)],
  ];
  if (fkz)        rows.push([`+ FK-Zinskosten (${fmtPct(zsr)} p.a. × ${(hj).toFixed(1).replace('.', ',')} J. auf ${fmtPct(fkP)} FK)`, fmt(fkz)]);
  if (bankAbgeb)  rows.push([`+ Abschlussgebühr Bank (${fmtPct(abgebPct)} auf FK)`, fmt(bankAbgeb)]);
  if (mabzug)     rows.push(['– Mieteinnahmen IST (Haltedauer)', fmtNeg(mabzug)]);
  rows.push(['HERSTELLUNGSKOSTEN', '']);
  // Bug-Fix 2026-05-16: Sanierungsposten als echte "+"-Positionen darstellen
  // (statt "• Posten" + "+ Sanierungskosten gesamt"-Zwischensumme die wie
  // eine eigene Position wirkte). Jetzt ist jeder Posten eine eigene
  // additive Zeile, die Summen-Zwischenzeile entfällt komplett.
  // Auch hier: leere Posten (Betrag = 0) werden übersprungen.
  if (sanItems.length > 0) {
    sanItems.forEach((s: any) => {
      const amt = Number(s.amt) || 0;
      if (!amt) return;
      rows.push([`+ ${s.desc || 'Sanierungsposten'}`, fmt(amt)]);
    });
  }
  if (sanPuffer)  rows.push([`+ Risikopuffer (${fmtPct(rpPct)})`, fmt(sanPuffer)]);
  if (scope === 'aufteiler') {
    if (avprovPre)  rows.push([`+ Vertriebsprovision (${fmtPct(vprovP)} auf VKP)`, fmt(avprovPre)]);
    if (aufkTeilung) rows.push(['+ Aufteilungskosten', fmt(aufkTeilung)]);
  }
  rows.push(['= Gesamt-Investitionskosten (GIK)', fmt(gik)]);
  if (wf && gik) rows.push(['  GIK pro m²', Math.round(gik / wf).toLocaleString('de-DE') + ' €/m²']);

  // Exit-Sektion
  rows.push([scope === 'aufteiler' ? 'EXIT AUFTEILER' : 'EXIT GLOBAL', '']);
  if (scope === 'aufteiler') {
    rows.push(['Verkaufserlöse (Σ KP Kunden)', fmt(vkp)]);
    if (wf && vkp) rows.push(['  pro m²', Math.round(vkp / wf).toLocaleString('de-DE') + ' €/m²']);
  } else {
    rows.push([`Verkaufserlöse (GIK × ${(1 + gloMP / 100).toFixed(2).replace('.', ',')})`, fmt(vkp)]);
    if (wf && vkp) rows.push(['  pro m²', Math.round(vkp / wf).toLocaleString('de-DE') + ' €/m²']);
    if (jnkm)      rows.push(['JNKM SOLL', fmt(jnkm)]);
    if (gloFak)    rows.push(['KP-Faktor Kunde', gloFak.toFixed(1).replace('.', ',') + 'x']);
    if (gloRendite) rows.push(['Bruttorendite Kunde', gloRendite.toFixed(2).replace('.', ',') + '%']);
  }
  rows.push(['Gewinn ' + (scope === 'aufteiler' ? 'Aufteiler' : 'Global'), fmt(gewinn)]);
  rows.push(['Marge auf Verkaufserlöse', marge.toFixed(1).replace('.', ',') + '%']);

  // Finanzierungs-Werte ableiten — basierend auf der bereits berechneten GIK.
  // ekP statt (100-fkP) damit der User-Wert priorisiert wird falls fk_p+ek_p ≠ 100.
  const ekP = (Number(k.ek_p) >= 0 ? Number(k.ek_p) : Math.max(0, 100 - fkP));
  const fm = gik * fkP / 100;
  const em = gik * ekP / 100;
  const ekAnteilPct = gik > 0 ? Math.round(em / gik * 100) : 0;
  const fkAnteilPct = gik > 0 ? Math.round(fm / gik * 100) : 0;

  return {
    rows, kp, gik, vkp, gewinn, marge,
    em, fm, ekAnteilPct, fkAnteilPct,
    zinssatz: zsr, margeBank: mb, haltMonate: halt,
  };
}

/** finanzpraesPrefillProjektkalk — `null`, wenn der Deal keinen Kaufpreis hat. */
export function projektkalkulationVorbelegen(data: Daten, deal: any | null, scope: 'aufteiler' | 'global'): Daten | null {
  if (!deal) return null;
  const summary = computeDealKalkSummary(deal, scope);
  if (!summary) return null;
  return {
    ...data,
    tableHeaders: ['Position', 'Betrag'],
    tableRows: summary.rows,
    tableTitle: scope === 'aufteiler' ? 'Aufteiler-Kalkulation' : 'Global-Kalkulation',
    bildPath: '',
    _scope: scope,
    _snapshot: { gik: summary.gik, em: summary.em, fm: summary.fm, ekAnteilPct: summary.ekAnteilPct, fkAnteilPct: summary.fkAnteilPct, vkp: summary.vkp },
  };
}

// ── Verkaufspreise & Mietenaufstellung ─────────────────────

/** finanzpraesPrefillVerkaufspreise — `null` ohne Einheiten. */
export function verkaufspreiseVorbelegen(data: Daten, deal: any | null): Daten | null {
  if (!deal || !Array.isArray(deal.einheiten) || deal.einheiten.length === 0) return null;
  const fmt = (n: number) => n ? Math.round(n).toLocaleString('de-DE') + ' €' : '–';
  const fmtPct = (n: number) => (typeof n === 'number' && !isNaN(n) && n) ? n.toFixed(2).replace('.', ',') + '%' : '–';
  const calcVkp = (e: any): number => {
    if (e.vkp) return Number(e.vkp);
    const r = Number(e.rend_k) || 0;
    const mn = e.mi_neu_manual ? (Number(e.mi_neu) || 0) : (Number(e.mi_ist) || 0);
    return (r && mn) ? Math.round((mn * 12) / (r / 100)) : 0;
  };
  const headers = ['Nr.', 'Typ', 'Lage', 'Zimmer', 'Fläche', 'Miete (Soll)', 'Rendite', 'VKP', '€/m²'];
  const rows: string[][] = deal.einheiten.map((e: any, i: number) => {
    const fl = Number(e.fl) || 0;
    const mn = e.mi_neu_manual ? (Number(e.mi_neu) || 0) : (Number(e.mi_ist) || 0);
    const vkp = calcVkp(e);
    return [
      String(i + 1),
      String(e.typ || '–'),
      String(e.lage || ''),
      String(e.zimmer || ''),
      fl ? `${fl.toString().replace('.', ',')} m²` : '–',
      mn ? `${Math.round(mn).toLocaleString('de-DE')} €` : '–',
      fmtPct(Number(e.rend_k)),
      fmt(vkp),
      vkp && fl ? `${Math.round(vkp / fl).toLocaleString('de-DE')} €` : '–',
    ];
  });
  const totalFl = deal.einheiten.reduce((s: number, e: any) => s + (Number(e.fl) || 0), 0);
  const totalVkp = deal.einheiten.reduce((s: number, e: any) => s + calcVkp(e), 0);
  rows.push(['', 'GESAMT', '', '',
    totalFl ? `${formatiereFlaeche(totalFl)} m²` : '–',
    '', '',
    fmt(totalVkp),
    totalVkp && totalFl ? `Ø ${Math.round(totalVkp / totalFl).toLocaleString('de-DE')} €` : '–',
  ]);
  return { ...data, tableHeaders: headers, tableRows: rows, tableTitle: '', bildPath: '' };
}

export interface MietenSpalte {
  key: string;
  label: string;
  default: boolean;
  compute: (e: any, i: number) => string;
}

export const MIETEN_SPALTEN: MietenSpalte[] = (() => {
  return [
    { key: 'nr',     label: 'Nr.',          default: true,  compute: (_e, i) => String(i + 1) },
    { key: 'typ',    label: 'Typ',          default: true,  compute: (e) => String(e.typ || '–') },
    { key: 'lage',   label: 'Lage',         default: true,  compute: (e) => String(e.lage || '') },
    { key: 'zimmer', label: 'Zimmer',       default: false, compute: (e) => String(e.zimmer || '') },
    { key: 'flaeche',label: 'Wohnfläche',   default: true,  compute: (e) => { const f = Number(e.fl) || 0; return f ? `${f.toString().replace('.', ',')} m²` : '–'; } },
    { key: 'mi_ist', label: 'Kaltmiete IST',default: true,  compute: (e) => { const v = Number(e.mi_ist) || 0; return v ? `${Math.round(v).toLocaleString('de-DE')} €` : '–'; } },
    { key: 'mi_neu', label: 'Kaltmiete SOLL',default: false, compute: (e) => { const v = e.mi_neu_manual ? (Number(e.mi_neu) || 0) : (Number(e.mi_ist) || 0); return v ? `${Math.round(v).toLocaleString('de-DE')} €` : '–'; } },
    { key: 'mi_qm',  label: '€/m² IST',     default: false, compute: (e) => { const f = Number(e.fl) || 0; const m = Number(e.mi_ist) || 0; return f && m ? `${(m / f).toFixed(2).replace('.', ',')} €/m²` : '–'; } },
    { key: 'jnkm',   label: 'Jahres-NKM',   default: false, compute: (e) => { const v = Number(e.mi_ist) || 0; return v ? `${Math.round(v * 12).toLocaleString('de-DE')} €` : '–'; } },
    { key: 'stk',    label: 'Stück',        default: false, compute: (e) => String(e.stk || 1) },
  ];
})();

/** finanzpraesApplyMietenSpalten — `null` ohne Einheitenliste oder ohne gewählte Spalte.
 *  Eine leere Liste ergibt (wie alt) nur die Summenzeile; der Dialog der alten App öffnete sich dann gar nicht erst. */
export function mietenaufstellungVorbelegen(data: Daten, deal: any | null, selectedKeys: string[]): Daten | null {
  if (!deal || !Array.isArray(deal.einheiten)) return null;
  if (!MIETEN_SPALTEN.some((s) => selectedKeys.includes(s.key))) return null;
  // Reihenfolge der Spaltenliste, nicht der Auswahl (alt: Reihenfolge der Checkboxen im Dialog)
  const selected = MIETEN_SPALTEN.filter((s) => selectedKeys.includes(s.key));
  const headers = selected.map((s) => s.label);
  const rows: string[][] = deal.einheiten.map((e: any, i: number) => selected.map((s) => s.compute(e, i)));
  const totalFl = deal.einheiten.reduce((s: number, e: any) => s + (Number(e.fl) || 0), 0);
  const totalIst = deal.einheiten.reduce((s: number, e: any) => s + (Number(e.mi_ist) || 0), 0);
  const totalNeu = deal.einheiten.reduce((s: number, e: any) => s + (e.mi_neu_manual ? (Number(e.mi_neu) || 0) : (Number(e.mi_ist) || 0)), 0);
  const summaryRow = selected.map((s) => {
    if (s.key === 'nr') return '';
    if (s.key === 'typ') return 'GESAMT';
    if (s.key === 'flaeche') return totalFl ? `${formatiereFlaeche(totalFl)} m²` : '–';
    if (s.key === 'mi_ist') return totalIst ? `${Math.round(totalIst).toLocaleString('de-DE')} €` : '–';
    if (s.key === 'mi_neu') return totalNeu ? `${Math.round(totalNeu).toLocaleString('de-DE')} €` : '–';
    if (s.key === 'jnkm')   return totalIst ? `${Math.round(totalIst * 12).toLocaleString('de-DE')} €` : '–';
    if (s.key === 'mi_qm' && totalFl && totalIst) return `Ø ${(totalIst / totalFl).toFixed(2).replace('.', ',')} €/m²`;
    return '';
  });
  rows.push(summaryRow);
  return { ...data, tableHeaders: headers, tableRows: rows, tableTitle: '', bildPath: '' };
}

/** finanzpraesClearSlideContent */
export function folienInhaltLeeren(data: Daten): Daten {
  const { tableHeaders: _h, tableRows: _r, tableTitle: _t, ...rest } = data;
  return { ...rest, bildPath: '' };
}

// ── Finanzierungsstruktur ──────────────────────────────────

/** Scope, den die Finanzierung übernimmt: der der Projektkalkulation, sonst `null` (die alte App fragte dann nach). */
export function finanzierungScope(p: FinanzPraes): 'aufteiler' | 'global' | null {
  const projSlide = p.slides.find((x) => x.typ === 'projektkalkulation');
  return (projSlide?.data?._scope as 'aufteiler' | 'global' | undefined) || null;
}

/** finanzpraesPrefillFinanzierung — `null`, wenn der Deal keinen Kaufpreis hat. Nutzereingaben der Standardfelder bleiben. */
export function finanzierungVorbelegen(data: Daten, deal: any | null, scope: 'aufteiler' | 'global'): Daten | null {
  if (!deal) return null;
  const summary = computeDealKalkSummary(deal, scope);
  if (!summary) return null;
  const fmtEur = (n: number) => n ? `${Math.round(n).toLocaleString('de-DE')} €` : '';
  const fmtPct = (n: number) => n ? `${n.toFixed(n < 10 ? 1 : 0).replace('.', ',')}%` : '';
  const d: Daten = { ...data };
  d.gik       = fmtEur(summary.gik);
  d.em        = fmtEur(summary.em);
  d.ekAnteil  = summary.ekAnteilPct ? `${summary.ekAnteilPct}%` : '';
  d.fm        = fmtEur(summary.fm);
  d.fkAnteil  = summary.fkAnteilPct ? `${summary.fkAnteilPct}%` : '';
  d.verzinsung = fmtPct(summary.zinssatz);
  d.zinsbindung = summary.margeBank
    ? `Euribor 3 Monate + ${summary.margeBank.toFixed(summary.margeBank % 1 === 0 ? 0 : 1).replace('.', ',')}% Marge`
    : 'Euribor 3 Monate + Marge';
  if (summary.haltMonate) d.kreditlaufzeit = `${summary.haltMonate} Monate`;
  d._scope = scope;
  if (!d.strukturierungsentgelt) d.strukturierungsentgelt = '1,5%';
  if (!d.kreditnehmer) d.kreditnehmer = 'IVT Wohnen GmbH';
  if (!d.verwendungszweck) d.verwendungszweck = 'Zum gewerbsmäßigen Weiterverkauf';
  if (!d.buergschaft) d.buergschaft = 'Blanco Anteil 50% Sven Neubert, 50% IVT AG';
  if (!d.grundschuldeintragung) d.grundschuldeintragung = 'mit enger Zweckerklärung';
  if (!d.grundschuldAufteilung) d.grundschuldAufteilung = 'vollstreckbare und nicht vollstreckbare Grundschuld';
  if (!d.ausschuettung) d.ausschuettung = 'aus Übererlös der verkauften Einheiten';
  if (!d.tilgung) d.tilgung = '';
  if (!d.bereitstellung) d.bereitstellung = '';
  return d;
}

// ── Konsistenz ─────────────────────────────────────────────

export interface ConsistencyIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  slides: string[];  // Slide-IDs
}

/** Prüft die aktuelle Praes auf inhaltliche Inkonsistenzen zwischen Slides.
 *  Gibt eine Liste mit Problemen zurück. Leeres Array = alles konsistent. */
export function finanzpraesCheckConsistency(p: FinanzPraes): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const projSlide = p.slides.find((s) => s.typ === 'projektkalkulation');
  const finSlide = p.slides.find((s) => s.typ === 'finanzierungsstruktur');
  // Helper: parse "1.234.567 €" → 1234567
  const parseEur = (s: any): number => {
    if (typeof s === 'number') return s;
    if (typeof s !== 'string') return 0;
    const cleaned = s.replace(/\./g, '').replace(/[€\s]/g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
  };
  // 1. Projektkalk vs Finanzierungsstruktur — gleiche GIK?
  if (projSlide && finSlide && projSlide.data._snapshot) {
    const projGik = projSlide.data._snapshot.gik as number;
    const finGik = parseEur(finSlide.data.gik);
    if (projGik && finGik && Math.abs(projGik - finGik) > 1) {
      issues.push({
        severity: 'error',
        message: `GIK weicht ab: Projektkalkulation = ${Math.round(projGik).toLocaleString('de-DE')} €, Finanzierungsstruktur = ${Math.round(finGik).toLocaleString('de-DE')} €. Differenz: ${Math.round(Math.abs(projGik - finGik)).toLocaleString('de-DE')} €.`,
        slides: [projSlide.id, finSlide.id],
      });
    }
    // EM (Eigenmittel) prüfen
    const projEm = projSlide.data._snapshot.em as number;
    const finEm = parseEur(finSlide.data.em);
    if (projEm && finEm && Math.abs(projEm - finEm) > 1) {
      issues.push({
        severity: 'error',
        message: `Eigenmittel weichen ab: Projektkalk-Snapshot = ${Math.round(projEm).toLocaleString('de-DE')} €, Finanzierungsstruktur = ${Math.round(finEm).toLocaleString('de-DE')} €.`,
        slides: [projSlide.id, finSlide.id],
      });
    }
    // FM (Fremdmittel)
    const projFm = projSlide.data._snapshot.fm as number;
    const finFm = parseEur(finSlide.data.fm);
    if (projFm && finFm && Math.abs(projFm - finFm) > 1) {
      issues.push({
        severity: 'error',
        message: `Fremdmittel weichen ab: Projektkalk-Snapshot = ${Math.round(projFm).toLocaleString('de-DE')} €, Finanzierungsstruktur = ${Math.round(finFm).toLocaleString('de-DE')} €.`,
        slides: [projSlide.id, finSlide.id],
      });
    }
    // Scope-Konsistenz
    if (projSlide.data._scope && finSlide.data._scope && projSlide.data._scope !== finSlide.data._scope) {
      issues.push({
        severity: 'warning',
        message: `Unterschiedlicher Scope: Projektkalk = ${projSlide.data._scope}, Finanzierungsstruktur = ${finSlide.data._scope}. Beide sollten dieselbe Variante (Aufteiler oder Global) zeigen.`,
        slides: [projSlide.id, finSlide.id],
      });
    }
  }
  // 2. Finanzierung: EM + FM = GIK (Finanzierungslücke prüfen)
  if (finSlide) {
    const gik = parseEur(finSlide.data.gik);
    const em = parseEur(finSlide.data.em);
    const fm = parseEur(finSlide.data.fm);
    if (gik > 0 && (em || fm)) {
      const sum = em + fm;
      const diff = gik - sum;
      if (Math.abs(diff) > 1) {
        issues.push({
          severity: 'error',
          message: `Finanzierungslücke: Eigenmittel (${Math.round(em).toLocaleString('de-DE')} €) + Fremdmittel (${Math.round(fm).toLocaleString('de-DE')} €) = ${Math.round(sum).toLocaleString('de-DE')} € ≠ GIK ${Math.round(gik).toLocaleString('de-DE')} €. Differenz: ${Math.round(diff).toLocaleString('de-DE')} €.`,
          slides: [finSlide.id],
        });
      }
      // FK + EK Anteile = 100%?
      const fkPct = parseFloat(String(finSlide.data.fkAnteil || '').replace(/[^\d,.]/g, '').replace(',', '.'));
      const ekPct = parseFloat(String(finSlide.data.ekAnteil || '').replace(/[^\d,.]/g, '').replace(',', '.'));
      if (fkPct && ekPct && Math.abs(fkPct + ekPct - 100) > 0.5) {
        issues.push({
          severity: 'warning',
          message: `EK-Anteil (${ekPct}%) + FK-Anteil (${fkPct}%) = ${(fkPct + ekPct).toFixed(1)}% ≠ 100%.`,
          slides: [finSlide.id],
        });
      }
    }
  }
  // 3. Verkaufspreise vs Projektkalk — gleicher VKP?
  const vkpSlide = p.slides.find((s) => s.typ === 'verkaufspreise');
  if (vkpSlide && projSlide?.data._snapshot && projSlide.data._snapshot.vkp) {
    const projVkp = projSlide.data._snapshot.vkp as number;
    // Versuche aus Verkaufspreise-Tabelle die Summe-Zeile zu finden
    const rows = (vkpSlide.data.tableRows || []) as Array<[string, string]>;
    const sumRow = rows.find(r => /∑|summe|gesamt/i.test(r[0] || ''));
    if (sumRow) {
      const vkpVerk = parseEur(sumRow[1]);
      if (vkpVerk && Math.abs(projVkp - vkpVerk) > 1) {
        issues.push({
          severity: 'warning',
          message: `Verkaufserlöse weichen ab: Projektkalk = ${Math.round(projVkp).toLocaleString('de-DE')} €, Verkaufspreise-Slide = ${Math.round(vkpVerk).toLocaleString('de-DE')} €.`,
          slides: [projSlide.id, vkpSlide.id],
        });
      }
    }
  }
  return issues;
}


// ── Standards beim Export ──────────────────────────────────

/** expandWithDefaults: leere Bilder von Organigramm/Abschluss und leere Geschäftsmodell-Texte aus den Einstellungen. */
export function mitStandards(p: FinanzPraes, defaults: FinanzpraesDefaults): FinanzPraes {
  return {
    ...p,
    slides: p.slides.map((s) => {
      if (s.typ === 'organigramm' && !s.data.bild) {
        return { ...s, data: { ...s.data, bild: defaults.organigramm.bild, beschreibung: s.data.beschreibung || defaults.organigramm.beschreibung } };
      }
      if (s.typ === 'abschluss' && !s.data.bild) {
        return { ...s, data: { ...s.data, bild: defaults.abschluss.bild, untertitel: s.data.untertitel || defaults.abschluss.untertitel } };
      }
      if (s.typ === 'geschaeftsmodell') {
        const gd = defaults.geschaeftsmodell;
        return {
          ...s,
          data: {
            ...s.data,
            zielgruppe:      s.data.zielgruppe      || gd.zielgruppe,
            angebot:         s.data.angebot         || gd.angebot,
            kundengewinnung: s.data.kundengewinnung || gd.kundengewinnung,
            vorteile:        s.data.vorteile        || gd.vorteile,
            vorteileIvt:     s.data.vorteileIvt     || gd.vorteileIvt,
          },
        };
      }
      return s;
    }),
  };
}

/** finanzpraesPrefillFromSettings */
export function ausEinstellungen(data: Daten, ziel: 'organigramm' | 'abschluss', defaults: FinanzpraesDefaults): Daten {
  return ziel === 'organigramm'
    ? { ...data, bild: defaults.organigramm.bild, beschreibung: defaults.organigramm.beschreibung }
    : { ...data, bild: defaults.abschluss.bild, untertitel: defaults.abschluss.untertitel };
}

/** finanzpraesSlideMove */
export function folieVerschieben(slides: Slide[], slideId: string, delta: number): Slide[] {
  const neu = [...slides];
  const von = neu.findIndex((s) => s.id === slideId);
  const nach = von + delta;
  if (von < 0 || nach < 0 || nach >= neu.length) return neu;
  const [bewegt] = neu.splice(von, 1);
  neu.splice(nach, 0, bewegt!);
  return neu;
}
