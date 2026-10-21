/**
 * Mapping → gg (Protokoll 28). Zuerst gelten die gg-Felder aus Teil A (`v2.felder`, bewährter Prompt wie früher — „mindestens
 * wie früher“, Auftraggeber 11.10.2026). Teil B (wörtliche Angaben) füllt nur, was dort leer ist; widerspricht eine Angabe
 * einem Teil-A-Wert, bleibt sie „doppelt“ unter „Weitere Angaben“ (Ersetzen per Klick).
 * Feste Tabelle `MAPPING` (Standard-Pfad → gg-Ziele) plus wenige Regeln mit Test:
 * Straße/Hausnummer trennen, Vor- und Nachname zusammen, Jahres- → Monatswert, Provision in Prozent, Einheiten aus Tabellen.
 *
 * Erster Treffer füllt ein Ziel; ein späterer Treffer mit gleichem Wert gilt als zugeordnet, mit anderem Wert bleibt er
 * „doppelt“ unter „Weitere Angaben“. Was keine Zuordnung hat, bekommt den KI-Vorschlag (nur Vorauswahl im Dropdown).
 * Ergebnis ist u. a. das Format der Prüfseite (`ExtrahiertV0`), damit `exposeVorbereiten` unverändert weiterläuft.
 */
import type { EinheitenTabelle, ExposeV2 } from './erfassung.ts';
import type { EinheitFeld } from './katalog.ts';
import { jahrAusText, leerraum, type NormWert, plzOrtTrennen, strasseTrennen, wertNormalisieren, zahlAusText } from './normalisieren.ts';
import { zeitraum } from './rohdaten.ts';
import { istMobilnummer } from './uebernahme.ts';
import { GG_ZIELE, type GgZiel } from './ziele.ts';

// ── Mapping-Tabelle ────────────────────────────────────────────

/** Standard-Pfad → gg-Ziele. Kontaktpfade gelten für Kontakt 1 (Makler); weitere Kontakte → `makler.weitereKontakte`. */
export const MAPPING: Record<string, string[]> = {
  'geo.strasse': ['objekt.strasse'],
  'geo.hausnummer': ['objekt.hausnr'],
  'geo.plz': ['objekt.plz'],
  'geo.ort': ['objekt.stadt'],
  'geo.bundesland': ['objekt.bundesland'],
  'geo.anzahl_etagen': ['details.etagen'],
  'geo.gemarkung': ['details.gemarkung'],
  'geo.flur': ['details.gemarkung'],
  'geo.flurstueck': ['details.gemarkung'],
  'objektkategorie.objektart': ['details.objektart'],
  'objektkategorie.nutzungsart': ['details.nutzungsart'],
  'preise.kaufpreis': ['objekt.angebotspreis', 'kalkulation.kaufpreis'],
  'preise.mieteinnahmen_ist_monat': ['objekt.istmiete'],
  'preise.mieteinnahmen_ist_jahr': ['objekt.istmiete'],
  'preise.mieteinnahmen_soll_monat': ['objekt.sollmiete'],
  'preise.mieteinnahmen_soll_jahr': ['objekt.sollmiete'],
  'preise.x_fache': ['details.kaufpreisfaktor'],
  'preise.aussen_courtage': ['details.provision', 'kalkulation.makler'],
  'preise.hausgeld': ['details.hausgeld_monat'],
  'preise.nebenkosten': ['details.nebenkosten_monat'],
  'preise.instandhaltungsruecklage': ['details.instandhaltungsruecklage'],
  'preise.erbpacht': ['details.erbbaurecht'],
  'gg.bruttorendite': ['objekt.bruttorendite'],
  'flaechen.wohnflaeche': ['objekt.wohnflaeche'],
  'flaechen.grundstuecksflaeche': ['objekt.grundstueck'],
  'flaechen.nutzflaeche': ['details.nutzflaeche'],
  'flaechen.anzahl_wohneinheiten': ['objekt.einheitenAnz'],
  'flaechen.anzahl_gewerbeeinheiten': ['details.gewerbeeinheiten'],
  'flaechen.anzahl_stellplaetze': ['details.stellplaetze'],
  'ausstattung.heizungsart': ['objekt.heizungsart'],
  'ausstattung.befeuerung': ['details.energietraeger'],
  ...Object.fromEntries([
    'ausstatt_kategorie', 'warmwasser', 'fahrstuhl', 'stellplatzart', 'bad', 'kueche', 'boden', 'fenster', 'dachform', 'bauweise',
    'unterkellert', 'balkon_terrasse', 'garten', 'barrierefrei', 'wasch_trockenraum', 'abstellraum', 'fahrradraum', 'kabel_sat_tv',
    'breitband_zugang', 'sicherheitstechnik', 'rolladen', 'merkmal',
  ].map((e) => [`ausstattung.${e}`, ['objekt.ausstattung']])),
  'gg.heizung_baujahr': ['objekt.heizungsbaujahr'],
  'zustand_angaben.baujahr': ['objekt.baujahr'],
  'zustand_angaben.zustand': ['details.zustand'],
  'zustand_angaben.letztemodernisierung': ['details.sanierungen'],
  'gg.sanierung': ['details.sanierungen'],
  'zustand_angaben.energiepass.epart': ['objekt.energieausweis.art'],
  'zustand_angaben.energiepass.wertklasse': ['objekt.energieausweis.klasse'],
  'zustand_angaben.energiepass.energieverbrauchkennwert': ['objekt.energieausweis.kennwert'],
  'zustand_angaben.energiepass.endenergiebedarf': ['objekt.energieausweis.kennwert'],
  'zustand_angaben.energiepass.gueltig_bis': ['details.energieausweis.gueltig_bis'],
  'zustand_angaben.energiepass.primaerenergietraeger': ['details.energietraeger'],
  'freitexte.objekttitel': ['details.titel'],
  'freitexte.lage': ['objekt.lagebeschreibung'],
  'freitexte.ausstatt_beschr': ['objekt.ausstattung'],
  'freitexte.objektbeschreibung': ['details.objektbeschreibung'],
  'freitexte.sonstige_angaben': ['objekt.notizen'],
  'verwaltung_objekt.denkmalgeschuetzt': ['details.denkmalschutz'],
  'verwaltung_objekt.verfuegbar_ab': ['details.verfuegbar_ab'],
  'verwaltung_techn.objektnr_extern': ['details.objektnr_extern'],
  'kontaktperson.name': ['makler.name'],
  'kontaktperson.vorname': ['makler.name'],
  'kontaktperson.firma': ['makler.firma'],
  'anbieter.firma': ['makler.firma'],
  'kontaktperson.tel_handy': ['makler.mobiltel'],
  'kontaktperson.tel_durchw': ['makler.festnetztel'],
  'kontaktperson.tel_zentrale': ['makler.festnetztel'],
  'kontaktperson.email_direkt': ['makler.email'],
  'kontaktperson.email_zentrale': ['makler.email'],
  'kontaktperson.url': ['makler.webseite'],
  'kontaktperson.strasse': ['makler.strasse'],
  'kontaktperson.plz': ['makler.plz'],
  'kontaktperson.ort': ['makler.ort'],
};

/** Kontaktpfade, die bei Kontakt 2, 3 … in `makler.weitereKontakte` gehen. */
const WEITERE_KONTAKT_PFADE = new Set([
  'kontaktperson.name', 'kontaktperson.vorname', 'kontaktperson.tel_handy', 'kontaktperson.tel_durchw', 'kontaktperson.tel_zentrale',
  'kontaktperson.email_direkt', 'kontaktperson.email_zentrale',
]);

// ── Format der Prüfseite ───────────────────────────────────────

export interface EinheitV0 { typ: string | null; lage: string | null; zimmer: number | null; flaeche: number | null; kaltmiete: number | null; vermiet: string | null }

export interface ObjektV0 {
  strasse: string | null; hausnr: string | null; plz: string | null; stadt: string | null; bundesland: string | null;
  baujahr: number | null; wohnflaeche: number | null; grundstueck: number | null; einheitenAnz: number | null;
  angebotspreis: number | null; istmiete: number | null; bruttorendite: number | null;
  heizungsart: string | null; heizungsbaujahr: number | null;
  energieausweis: { klasse: string | null; kennwert: number | null; art: string | null };
  lagebeschreibung: string | null; ausstattung: string | null; notizen: string | null;
  einheiten: EinheitV0[];
}

export interface MaklerV0 {
  name: string | null; alleNamen: string[]; firma: string | null;
  mobiltel: string | null; festnetztel: string | null; tel: string | null; alleTelefonnummern: string[];
  email: string | null; alleEmails: string[]; webseite: string | null;
}

export interface KalkulationV0 {
  kaufpreis: number | null; notar: number | null; gest: number | null; makler: number | null; fk_p: number | null; ek_p: number | null;
  euribor: number | null; margeB: number | null; ek_r: number | null; halt: number | null; rp_pct: number | null; glo_m: number | null;
}

export type Konfidenz = 'hoch' | 'mittel' | 'niedrig';
export interface ExtrahiertV0 { objekt: ObjektV0; makler: MaklerV0; kalkulation: KalkulationV0; _konfidenz: Record<string, Konfidenz> }

// ── Ergebnis ───────────────────────────────────────────────────

export type ZuordnungGrund = 'zugeordnet' | 'doppelt' | 'keinWert' | 'keinMapping';

export interface ZuordnungZeile {
  /** Index in `v2.angaben` */
  index: number;
  /** Automatisch belegtes Ziel (Mapping-Tabelle); bei mehreren Zielen das erste. */
  ziel: string | null;
  grund: ZuordnungGrund;
  /** KI-Vorschlag, nur wenn kein automatisches Ziel und der Vorschlag gültig ist. */
  vorschlag: string | null;
  /** Wert für `ziel ?? vorschlag` im Zieltyp; null, wenn nicht lesbar. */
  wert: NormWert;
  hinweis?: string;
}

export interface EinheitDetails {
  nr?: string; nebenkosten?: number; warmmiete?: number; sollmiete?: number; mietbeginn?: string; mietende?: string;
  status?: string; seite?: number; weitere?: Record<string, string>;
}

export interface ZuordnungsErgebnis {
  pruefdaten: ExtrahiertV0;
  /** Alle automatisch belegten Ziele (Listen-Ziele als Array). */
  werte: Record<string, NormWert | string[]>;
  /** `objekte.details` aus allen `details`-Zielen (verschachtelt). */
  details: Record<string, unknown>;
  einheitenDetails: (EinheitDetails | null)[];
  zeilen: ZuordnungZeile[];
  warnungen: string[];
}

// ── Hilfen ─────────────────────────────────────────────────────

const text = (s: string | null | undefined) => (s && leerraum(s) ? leerraum(s) : null);

function ohneDoppel(werte: (string | null | undefined)[]): string[] {
  const aus: string[] = [];
  for (const w of werte) { const t = text(w); if (t && !aus.includes(t)) aus.push(t); }
  return aus;
}

/** Text für den Vergleich: klein, „Straße“ = „Str.“, ohne Satzzeichen und Leerraum. */
const textSchluessel = (t: string) => t.toLowerCase().replace(/stra(ß|ss)e/g, 'str').replace(/[^a-z0-9äöü]/g, '');

/** Gleich: Zahlen ±0,5 %; Texte gleich oder der eine steckt im anderen („Tübingen“ / „Tübingen-Lustnau“, „Wilhelmstraße“ / „WILHELMSTR. 73“). */
function gleich(a: NormWert | string[] | undefined, b: NormWert): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 0.005 * Math.max(Math.abs(a), Math.abs(b));
  if (typeof a === 'string' && typeof b === 'string') {
    const x = textSchluessel(a); const y = textSchluessel(b);
    return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
  }
  return a === b;
}

/** Schlüssel in `_konfidenz` für einen Prüfpfad: `objekt.istmiete` → `istmiete`, `objekt.energieausweis.klasse` → `energieklasse` (wie die Prüfseite). */
export const konfidenzSchluessel = (pruef: string) => pruef.startsWith('objekt.energieausweis.') ? `energie${pruef.split('.').at(-1)}` : pruef.split('.').at(-1)!;

/** Wert einer Angabe für ein Ziel, mit den Sonderregeln. */
export function zielWert(ziel: string, wort: string, pfad: string | null): { wert: NormWert; hinweis?: string } {
  const z = GG_ZIELE[ziel];
  if (!z) return { wert: null };
  // Jahreswert: am Pfad oder am Wortlaut („72.200 € p.a.“, „Jahresnettokaltmiete“) — Prüfung 12.10.2026.
  // Steht ein Monatshinweis daneben („Jahresmiete 2.320 €/Monat“), gilt der Monat (E8, 16.10.2026).
  const monat = /monat|mtl\.?|p\.\s?m\.|\/\s?mo\b/i.test(wort);
  const jahr = !monat && (pfad?.endsWith('_jahr') || /p\.\s?a\.|pro jahr|jährl|jahres|\/\s?jahr|im jahr/i.test(wort));
  if (jahr && (ziel === 'objekt.istmiete' || ziel === 'objekt.sollmiete')) {
    const n = zahlAusText(wort, false);
    return n === null ? { wert: null } : { wert: +(n / 12).toFixed(2), hinweis: 'Jahreswert ÷ 12' };
  }
  if (ziel === 'kalkulation.makler') {
    if (/provisionsfrei|keine (käufer)?provision|courtagefrei/i.test(wort)) return { wert: 0, hinweis: 'provisionsfrei' };
    if (!/%/.test(wort)) return { wert: null };
  }
  if (ziel === 'objekt.heizungsbaujahr' || ziel === 'objekt.baujahr') return { wert: jahrAusText(wort) };
  // Energieklasse: nur die Klasse selbst (A+ bis H); „Endenergiebedarf kWh/(m²*a)“ aus der Nachbarzelle ist keine (16.10.2026)
  if (ziel === 'objekt.energieausweis.klasse') return { wert: energieklasseAusText(wort) };
  // Zahlen nur aus eindeutigen Angaben: „7 WE · 500 m² · 5.737 €“ ist kein Zahlwert (Prüfung 12.10.2026)
  if (z.typ === 'zahl' || z.typ === 'ganzzahl') {
    const n = zahlAusText(wort, ziel === 'kalkulation.makler');
    return { wert: n === null ? null : z.typ === 'ganzzahl' ? Math.round(n) : n };
  }
  return { wert: istPlatzhalter(wort) || istUeberschrift(wort) ? null : wertNormalisieren(wort, z.typ) };
}

/** „Energieeffizienzklasse: E“, „Klasse A+ (Bedarf)“ → „E“, „A+“; ohne Klasse null. */
export function energieklasseAusText(wort: string): string | null {
  const m = /(?:^|[^A-Za-z])(A\+{1,3}|[A-H])(?![A-Za-z+])/.exec(wort.trim());
  return m ? m[1]!.toUpperCase() : null;
}

/** Eine Zelle, die selbst eine Beschriftung ist („Endenergiebedarf kWh/(m²*a)“, „Preis in €“): Einheit, aber keine Zahl. */
export const istUeberschrift = (v: string) => !/\d/.test(v) && /kWh|m²|\bm2\b|€|\bEUR\b|%/.test(v);

function setzePfad(o: Record<string, unknown>, pfad: string, wert: unknown) {
  const teile = pfad.split('.');
  let akt = o;
  for (const t of teile.slice(0, -1)) {
    if (!akt[t] || typeof akt[t] !== 'object' || Array.isArray(akt[t])) akt[t] = {};
    akt = akt[t] as Record<string, unknown>;
  }
  akt[teile.at(-1)!] = wert;
}

// ── Adresse ────────────────────────────────────────────────────

const STRASSE = /(str\.|straße|strasse|weg|platz|allee|gasse|ring|damm|ufer|steige|staffel|berg|hof|markt|chaussee|pfad|promenade|graben|anlage|park|kai|zeile|feld)\b/i;

/**
 * Adresse in einer Angabe in Straßen-Abschnitt und „PLZ Ort“ zerlegen. Gesucht wird der Abschnitt, der wie eine Straße
 * aussieht (Straßenwort oder Hausnummer) — nicht einfach der erste („Baden-Württembergische Bank, Am Hauptbahnhof 2,
 * 70173 Stuttgart“, Prüfung 12.10.2026).
 */
export function adresseZerlegen(wert: string): [string | null, string | undefined] {
  const teile = wert.split(/\s*[,·|]\s*|\s{2,}/).map((t) => t.trim()).filter(Boolean);
  const plzOrt = teile.find((t) => /^(D-)?\d{5}\s+\S/.test(t));
  const strasse = teile.find((t) => t !== plzOrt && STRASSE.test(t) && /\d/.test(t))
    ?? teile.find((t) => t !== plzOrt && STRASSE.test(t))
    ?? teile.find((t) => t !== plzOrt && /\s\d+\s?[a-zA-Z]?$/.test(t))
    ?? null;
  return [strasse, plzOrt];
}

// ── Einheiten ──────────────────────────────────────────────────

const STELLPLATZ = /stellpl|stpl|st\.\s?pl|garage|\btg\b|tiefgarage|carport|parkpl|parker|duplex|\bpkw\b|\bkfz\b|motorrad|au(ß|ss)enpl|\bsp\s?\d/i;
const GEWERBE = /gewerb|laden|büro|buero|praxis|gastro|lager|halle|werkstatt|kiosk|shop/i;
const SUMME = /^(summe|gesamt|total|σ|insgesamt)/i;

export function einheitTyp(...zellen: (string | undefined)[]): 'Wohnung' | 'Gewerbe' | 'Stellplatz' | 'Sonstiges' {
  const s = zellen.filter(Boolean).join(' ');
  if (STELLPLATZ.test(s)) return 'Stellplatz';
  if (GEWERBE.test(s)) return 'Gewerbe';
  return 'Wohnung';
}

/** Einheiten aus den Tabellen; Summenzeilen fallen weg. */
export function einheitenAusTabellen(tabellen: EinheitenTabelle[]): { einheiten: EinheitV0[]; details: (EinheitDetails | null)[] } {
  const einheiten: EinheitV0[] = [];
  const details: (EinheitDetails | null)[] = [];
  for (const t of tabellen) {
    const idx = new Map<EinheitFeld, number>();
    t.spalten.forEach((s, i) => { if (s.feld && !idx.has(s.feld)) idx.set(s.feld, i); });
    for (const zeile of t.zeilen) {
      if (zeile.slice(0, 2).some((c) => SUMME.test(c.trim()))) continue;
      const zelle = (f: EinheitFeld) => { const i = idx.get(f); return i === undefined ? undefined : (zeile[i] ?? '').trim() || undefined; };
      const zahl = (f: EinheitFeld) => { const c = zelle(f); return c === undefined ? null : zahlAusText(c); };
      // Kachel-Raster („Wohnfläche | Zimmer | Grundstück“, darunter „Kaufpreis | CO₂ | Heizung“ und „550.000 € | 63,2 | Gas“) sieht aus
      // wie eine Einheitentabelle: Zeilen, deren Zellen nicht zu den Spalten passen, sind keine Einheiten (Test auf privat, 16.10.2026)
      if (/€|EUR\b/.test(zelle('flaeche') ?? '') || /m²|\bm2\b/.test(zelle('kaltmiete') ?? '')) continue;
      if (zelle('flaeche') !== undefined && !/\d/.test(zelle('flaeche')!)) continue;
      if (zahl('flaeche') === null && zahl('zimmer') === null && zahl('kaltmiete') === null && !zelle('lage') && !zelle('nr') && !zelle('typ')) continue;
      // Jahresspalten („Jahresnettokaltmiete“, „NK p.a.“, „Miete/Jahr“) → Monatswert (Protokoll 31, B9)
      const betrag = (f: EinheitFeld) => { const n = zahl(f); const i = idx.get(f); return n !== null && i !== undefined && zeitraum(t.spalten[i]!.ueberschrift) === 'jahr' ? +(n / 12).toFixed(2) : n; };
      const statusText = zelle('status');
      const kaltText = zelle('kaltmiete');
      const leer = /leer|frei\b|unvermietet|nicht vermietet/i.test(`${statusText ?? ''} ${kaltText ?? ''}`);
      let kaltmiete = betrag('kaltmiete');
      if (leer && kaltmiete === null) kaltmiete = 0;
      const vermiet = leer ? 'Leerstand' : statusText && /vermietet|bestand|belegt/i.test(statusText) ? 'Vermietet' : kaltmiete && kaltmiete > 0 ? 'Vermietet' : null;
      einheiten.push({
        typ: einheitTyp(zelle('typ'), zelle('lage'), zelle('nr')), lage: zelle('lage') ?? null, zimmer: zahl('zimmer'),
        flaeche: zahl('flaeche'), kaltmiete, vermiet,
      });
      const d: EinheitDetails = {};
      const nr = zelle('nr'); if (nr) d.nr = nr;
      for (const f of ['nebenkosten', 'warmmiete', 'sollmiete'] as const) { const n = betrag(f); if (n !== null) d[f] = n; }
      for (const f of ['mietbeginn', 'mietende'] as const) { const c = zelle(f); if (c) d[f] = c; }
      if (statusText) d.status = statusText;
      if (t.seite !== null) d.seite = t.seite;
      const weitere: Record<string, string> = {};
      t.spalten.forEach((s, i) => { const c = (zeile[i] ?? '').trim(); if (!s.feld && c) weitere[s.ueberschrift || `Spalte ${i + 1}`] = c; });
      if (Object.keys(weitere).length) d.weitere = weitere;
      details.push(Object.keys(d).length ? d : null);
    }
  }
  return { einheiten, details };
}

/**
 * Welche Einheit der einen Liste entspricht welcher der anderen? Punkte: gleiche Fläche 2, gleiche Lage 2 (gleiche Stellplatz-/
 * Gewerbe-Art in der Lage 1), gleiche Art 1, gleiche Miete 1; ab 2 Punkten ein Paar, beste Paare zuerst, jede Einheit einmal.
 * Zwei vorhandene, deutlich verschiedene Flächen schließen ein Paar aus. Ergebnis je Einheit der Basis: Index in `andere` oder null.
 */
export function einheitenAbgleichen(basis: EinheitV0[], andere: EinheitV0[]): (number | null)[] {
  const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
  const nah = (a: number, b: number, mindest: number) => Math.abs(a - b) <= Math.max(mindest, 0.01 * Math.max(Math.abs(a), Math.abs(b)));
  const punkte = (a: EinheitV0, b: EinheitV0): number => {
    let p = 0;
    if (a.flaeche !== null && b.flaeche !== null) {
      if (nah(a.flaeche, b.flaeche, 0.5)) p += 2;
      else if (!nah(a.flaeche, b.flaeche, 2) && Math.abs(a.flaeche - b.flaeche) > 0.05 * Math.max(a.flaeche, b.flaeche)) return 0;
    }
    const la = norm(a.lage); const lb = norm(b.lage);
    if (la && lb) {
      if (la === lb) p += 2;
      else { const ta = einheitTyp(a.lage ?? ''); if (ta !== 'Wohnung' && ta === einheitTyp(b.lage ?? '')) p += 1; }
    }
    if (a.typ && b.typ && a.typ === b.typ) p += 1;
    if (a.kaltmiete !== null && b.kaltmiete !== null && a.kaltmiete > 0 && nah(a.kaltmiete, b.kaltmiete, 1)) p += 1;
    return p;
  };
  const kandidaten: { i: number; j: number; p: number }[] = [];
  basis.forEach((a, i) => andere.forEach((b, j) => { const p = punkte(a, b); if (p >= 2) kandidaten.push({ i, j, p }); }));
  kandidaten.sort((x, y) => y.p - x.p || x.i - y.i || x.j - y.j);
  const aus: (number | null)[] = basis.map(() => null);
  const vergeben = new Set<number>();
  for (const k of kandidaten) {
    if (aus[k.i] !== null || vergeben.has(k.j)) continue;
    aus[k.i] = k.j;
    vergeben.add(k.j);
  }
  return aus;
}

/** Leere Felder der Einheit aus ihrer Entsprechung füllen; `artAusQuelle`: die Quelle (gelesene Liste) sagt ausdrücklich Stellplatz/Gewerbe. */
function einheitErgaenzen(e: EinheitV0, q: EinheitV0, artAusQuelle: boolean): EinheitV0 {
  const typ = artAusQuelle && e.typ === 'Wohnung' && (q.typ === 'Stellplatz' || q.typ === 'Gewerbe') ? q.typ : e.typ;
  return {
    typ, lage: e.lage ?? q.lage, zimmer: e.zimmer ?? q.zimmer, flaeche: e.flaeche ?? q.flaeche,
    kaltmiete: e.kaltmiete ?? q.kaltmiete, vermiet: e.vermiet ?? q.vermiet,
  };
}

// ── Teil A (gg-Felder wie früher) ──────────────────────────────

function pfadLesen(o: unknown, pfad: string): unknown {
  let akt: unknown = o;
  for (const t of pfad.split('.')) {
    if (!akt || typeof akt !== 'object') return undefined;
    akt = (akt as Record<string, unknown>)[t];
  }
  return akt;
}

/** Wert eines Teil-A-Felds im Zieltyp; leer → null. Zahlen kommen als Zahl, zur Sicherheit auch als Text gelesen. */
function feldWert(v: unknown, typ: GgZiel['typ']): NormWert {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? (typ === 'text' ? String(v) : v) : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim() && !istPlatzhalter(v) ? wertNormalisieren(v, typ) : null;
  return null;
}

/** Platzhalter statt eines Werts („nicht angegeben“, „Adresse auf Anfrage“, „liegt vor“, „vorhanden“) gelten als leer. */
export const istPlatzhalter = (v: unknown) => typeof v === 'string' && v.trim().length <= 40
  && /^(nicht (angegeben|genannt|bekannt)|k\.?\s?a\.?|keine angabe|unbekannt|n\/a|-+|–|liegt (vor|bei)|vorhanden|vorh\.|wird (nachgereicht|erstellt)|in erstellung|folgt)(\b|$)|\bauf anfrage\b/i.test(v.trim());

/** Teil A über das leere Gerüst legen: bekannte Gruppen flach zusammenführen, Energieausweis verschachtelt. */
function mitFeldern(p: ExtrahiertV0, felder: Record<string, unknown> | null): ExtrahiertV0 {
  if (!felder) return p;
  const gruppe = (k: string) => (felder[k] && typeof felder[k] === 'object' ? felder[k] as Record<string, unknown> : {});
  const leerWeg = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, w]) => w !== null && w !== undefined && w !== '' && !istPlatzhalter(w)));
  const o = leerWeg(gruppe('objekt'));
  const ea = o.energieausweis && typeof o.energieausweis === 'object' ? leerWeg(o.energieausweis as Record<string, unknown>) : {};
  return {
    objekt: { ...p.objekt, ...o, energieausweis: { ...p.objekt.energieausweis, ...ea }, einheiten: [] } as ObjektV0,
    makler: { ...p.makler, ...leerWeg(gruppe('makler')) } as MaklerV0,
    kalkulation: { ...p.kalkulation, ...leerWeg(gruppe('kalkulation')) } as KalkulationV0,
    _konfidenz: { ...(gruppe('_konfidenz') as Record<string, Konfidenz>) },
  };
}

const ERLAUBTE_TYPEN = new Set(['Wohnung', 'Gewerbe', 'Stellplatz', 'Sonstiges']);

/** Einheiten aus Teil A (`objekt.einheiten` wie früher). */
function einheitenAusFeldern(felder: Record<string, unknown> | null): EinheitV0[] {
  const liste = (felder?.objekt as { einheiten?: unknown } | undefined)?.einheiten;
  if (!Array.isArray(liste)) return [];
  const zahl = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? zahlAusText(v) : null);
  const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return liste.filter((e) => e && typeof e === 'object').map((e) => {
    const x = e as Record<string, unknown>;
    const typ = txt(x.typ);
    return { typ: typ && ERLAUBTE_TYPEN.has(typ) ? typ : typ ? einheitTyp(typ) : 'Wohnung', lage: txt(x.lage), zimmer: zahl(x.zimmer), flaeche: zahl(x.flaeche), kaltmiete: zahl(x.kaltmiete), vermiet: txt(x.vermiet) };
  });
}

// ── Zuordnen ───────────────────────────────────────────────────

const leerePruefdaten = (): ExtrahiertV0 => ({
  objekt: {
    strasse: null, hausnr: null, plz: null, stadt: null, bundesland: null, baujahr: null, wohnflaeche: null, grundstueck: null, einheitenAnz: null,
    angebotspreis: null, istmiete: null, bruttorendite: null, heizungsart: null, heizungsbaujahr: null,
    energieausweis: { klasse: null, kennwert: null, art: null }, lagebeschreibung: null, ausstattung: null, notizen: null, einheiten: [],
  },
  makler: { name: null, alleNamen: [], firma: null, mobiltel: null, festnetztel: null, tel: null, alleTelefonnummern: [], email: null, alleEmails: [], webseite: null },
  kalkulation: { kaufpreis: null, notar: null, gest: null, makler: null, fk_p: null, ek_p: null, euribor: null, margeB: null, ek_r: null, halt: null, rp_pct: null, glo_m: null },
  _konfidenz: {},
});

/** Kontakt einer Angabe: Kontaktpfade ohne Nummer gelten als Kontakt 1. */
const kontaktVon = (a: ExposeV2['angaben'][number]) => a.kontakt ?? (a.pfad?.startsWith('kontaktperson.') ? 1 : null);

/**
 * Erfassung v2 → gg. `belegt` (optional, je Angabe) setzt die Konfidenz der Prüfseite: belegt → hoch, nicht belegt → niedrig.
 */
export function zuordnen(v2: ExposeV2, belegt?: (boolean | null)[] | null): ZuordnungsErgebnis {
  const werte: Record<string, NormWert | string[]> = {};
  const quelleIndex: Record<string, number> = {};
  const zeilen: ZuordnungZeile[] = [];
  const warnungen: string[] = [];
  const angaben = v2.angaben;

  // Vor- und Nachname je Kontakt zusammen
  const namen = new Map<number, { vorname?: string; name?: string }>();
  angaben.forEach((a) => {
    const k = kontaktVon(a);
    if (k === null || (a.pfad !== 'kontaktperson.vorname' && a.pfad !== 'kontaktperson.name')) return;
    const n = namen.get(k) ?? {};
    if (a.pfad === 'kontaktperson.vorname') n.vorname ??= a.wert; else n.name ??= a.wert;
    namen.set(k, n);
  });
  const vollerName = (k: number) => {
    const n = namen.get(k);
    // „Bülent Genc Güner“ + „Güner“: der Vorname enthält den Nachnamen schon
    if (n?.vorname && n.name && n.vorname.trim().toLowerCase().endsWith(n.name.trim().toLowerCase())) return text(n.vorname);
    return text([n?.vorname, n?.name].filter(Boolean).join(' '));
  };

  const weitere = { namen: [] as string[], tel: [] as string[], email: [] as string[] };

  // Teil A: gg-Felder wie früher — sie gelten zuerst
  const ausFeldern = new Set<string>();
  const felder = (v2.felder ?? null) as Record<string, unknown> | null;
  if (felder) {
    for (const [ziel, z] of Object.entries(GG_ZIELE)) {
      if (!z.pruef) continue;
      const w = feldWert(pfadLesen(felder, z.pruef), z.typ);
      if (w === null) continue;
      werte[ziel] = z.liste && typeof w === 'string' ? [w] : w;
      ausFeldern.add(ziel);
    }
  }
  let listenVorschlag: string | null = null;

  const belegen = (ziel: string, wert: NormWert, i: number, wort: string): ZuordnungGrund => {
    const z = GG_ZIELE[ziel]!;
    if (ausFeldern.has(ziel)) {
      const da = werte[ziel];
      if (z.liste) {
        const passt = Array.isArray(da) && typeof wert === 'string' && da.some((x) => leerraum(x).toLowerCase().includes(leerraum(wert).toLowerCase()));
        if (passt) return 'zugeordnet';
        listenVorschlag = ziel;
        return 'keinMapping';
      }
      const a = angaben[i]!;
      // Freitext: der vollständige wörtliche Text ersetzt eine kürzere Fassung aus Teil A
      if (a.pfad?.startsWith('freitexte.') && typeof wert === 'string' && typeof da === 'string' && wert.length > da.length) {
        werte[ziel] = wert; quelleIndex[ziel] = i; ausFeldern.delete(ziel);
        return 'zugeordnet';
      }
      if (gleich(da, wert)) return 'zugeordnet';
      // Teil A hat eine Jahresmiete als Monatsmiete eingetragen (das Exposé sagt ausdrücklich „Jahr“): Monatswert gilt
      if ((ziel === 'objekt.istmiete' || ziel === 'objekt.sollmiete') && typeof wert === 'number' && wert !== zahlAusText(a.wert, false) && gleich(da, +(wert * 12).toFixed(2))) {
        werte[ziel] = wert; quelleIndex[ziel] = i; ausFeldern.delete(ziel);
        warnungen.push(`${z.label}: KI-Feld war der Jahreswert („${a.wert}“, S. ${a.seite ?? '?'}) — auf Monat umgerechnet`);
        return 'zugeordnet';
      }
      warnungen.push(`${z.label}: „${Array.isArray(da) ? da.join(', ') : String(da)}“ (KI-Feld) und „${a.wert}“ (S. ${a.seite ?? '?'}) — das KI-Feld gilt`);
      return 'doppelt';
    }
    if (z.liste) {
      const neu = typeof wert === 'string' ? wert : wort;
      const liste = (werte[ziel] as string[] | undefined) ?? [];
      if (!liste.includes(neu)) liste.push(neu);
      werte[ziel] = liste;
      quelleIndex[ziel] ??= i;
      return 'zugeordnet';
    }
    if (!(ziel in werte)) { werte[ziel] = wert; quelleIndex[ziel] = i; return 'zugeordnet'; }
    if (gleich(werte[ziel], wert)) return 'zugeordnet';
    const erste = angaben[quelleIndex[ziel]!]!;
    const a = angaben[i]!;
    warnungen.push(`${z.label}: „${erste.wert}“ (S. ${erste.seite ?? '?'}) und „${a.wert}“ (S. ${a.seite ?? '?'}) — der erste Wert gilt`);
    return 'doppelt';
  };

  angaben.forEach((a0, i) => {
    // Adressangabe mit Kontaktnummer ist die Adresse des Kontakts, nicht des Objekts (KI wählt dafür oft geo.*)
    const a = a0.kontakt !== null && a0.pfad && /^geo\.(strasse|hausnummer|plz|ort)$/.test(a0.pfad)
      ? { ...a0, pfad: a0.pfad === 'geo.ort' ? 'kontaktperson.ort' : a0.pfad === 'geo.hausnummer' ? 'kontaktperson.hausnummer' : a0.pfad.replace('geo.', 'kontaktperson.') }
      : a0;
    const kontakt = kontaktVon(a);
    const vorschlagGueltig = a.gg && GG_ZIELE[a.gg] ? a.gg : null;
    listenVorschlag = null;
    const ohneZiel = (grund: ZuordnungGrund, hinweis?: string): ZuordnungZeile => {
      const vorschlag = listenVorschlag ?? vorschlagGueltig;
      const w = vorschlag ? zielWert(vorschlag, a.wert, a.pfad).wert : null;
      return { index: i, ziel: null, grund, vorschlag, wert: w, ...(hinweis ? { hinweis } : {}) };
    };

    // weitere Kontakte
    if (kontakt !== null && kontakt > 1) {
      if (a.pfad && WEITERE_KONTAKT_PFADE.has(a.pfad)) {
        if (a.pfad === 'kontaktperson.name' || a.pfad === 'kontaktperson.vorname') { const n = vollerName(kontakt); if (n) weitere.namen.push(n); }
        else if (a.pfad.startsWith('kontaktperson.tel')) weitere.tel.push(a.wert);
        else weitere.email.push(a.wert);
        zeilen.push({ index: i, ziel: 'makler.weitereKontakte', grund: 'zugeordnet', vorschlag: null, wert: a.wert });
      } else zeilen.push(ohneZiel('keinMapping'));
      return;
    }

    const ziele = a.pfad ? MAPPING[a.pfad] : undefined;
    if (!ziele?.length) {
      zeilen.push(ohneZiel('keinMapping'));
      return;
    }

    // Sonderregeln: Name, Adresse
    if (a.pfad === 'kontaktperson.vorname' || a.pfad === 'kontaktperson.name') {
      const n = vollerName(kontakt ?? 1);
      const grund = n ? belegen('makler.name', n, i, a.wert) : 'keinWert';
      zeilen.push(grund === 'zugeordnet' ? { index: i, ziel: 'makler.name', grund, vorschlag: null, wert: n } : ohneZiel(grund));
      return;
    }
    if (a.pfad === 'geo.strasse' || a.pfad === 'kontaktperson.strasse') {
      const [vorne, hinten] = adresseZerlegen(a.wert);
      if (!vorne) { zeilen.push(ohneZiel('keinWert')); return; }
      const { strasse, hausnr } = strasseTrennen(vorne);
      const objekt = a.pfad === 'geo.strasse';
      const grund = belegen(objekt ? 'objekt.strasse' : 'makler.strasse', strasse, i, a.wert);
      if (grund === 'zugeordnet') {
        if (objekt && hausnr && !angaben.some((x) => x.pfad === 'geo.hausnummer')) belegen('objekt.hausnr', hausnr, i, a.wert);
        if (!objekt && hausnr) werte['makler.strasse'] = `${strasse} ${hausnr}`;
        const po = hinten ? plzOrtTrennen(hinten) : null;
        if (po) {
          if (!angaben.some((x) => x.pfad === (objekt ? 'geo.plz' : 'kontaktperson.plz'))) belegen(objekt ? 'objekt.plz' : 'makler.plz', po.plz, i, a.wert);
          if (!angaben.some((x) => x.pfad === (objekt ? 'geo.ort' : 'kontaktperson.ort'))) belegen(objekt ? 'objekt.stadt' : 'makler.ort', po.ort, i, a.wert);
        }
      }
      zeilen.push(grund === 'zugeordnet' ? { index: i, ziel: objekt ? 'objekt.strasse' : 'makler.strasse', grund, vorschlag: null, wert: strasse } : ohneZiel(grund));
      return;
    }
    if ((a.pfad === 'geo.plz' || a.pfad === 'kontaktperson.plz') && plzOrtTrennen(a.wert)) {
      const po = plzOrtTrennen(a.wert)!;
      const objekt = a.pfad === 'geo.plz';
      const grund = belegen(objekt ? 'objekt.plz' : 'makler.plz', po.plz, i, a.wert);
      if (grund === 'zugeordnet' && !angaben.some((x) => x.pfad === (objekt ? 'geo.ort' : 'kontaktperson.ort'))) belegen(objekt ? 'objekt.stadt' : 'makler.ort', po.ort, i, a.wert);
      zeilen.push(grund === 'zugeordnet' ? { index: i, ziel: objekt ? 'objekt.plz' : 'makler.plz', grund, vorschlag: null, wert: po.plz } : ohneZiel(grund));
      return;
    }

    // Telefon: Mobil nur bei Mobilnummer (01…, +49 1…), sonst Festnetz — egal, was die KI als Pfad wählt
    if (ziele[0] === 'makler.mobiltel' || ziele[0] === 'makler.festnetztel') {
      const ziel = istMobilnummer(a.wert) ? 'makler.mobiltel' : 'makler.festnetztel';
      const wert = leerraum(a.wert);
      const grund = belegen(ziel, wert, i, a.wert);
      zeilen.push(grund === 'zugeordnet' ? { index: i, ziel, grund, vorschlag: null, wert } : ohneZiel(grund));
      return;
    }

    // Standard: alle Ziele des Pfads; die Zeile zeigt das erste belegte
    let erste: ZuordnungZeile | null = null;
    let schlechtester: ZuordnungGrund = 'keinWert';
    let hinweisAus: string | undefined;
    for (const ziel of ziele) {
      const { wert, hinweis } = zielWert(ziel, a.wert, a.pfad);
      if (wert === null) continue;
      // Listen sammeln Einzelangaben als „Bezeichnung: Wert“, Freitexte unverändert
      const eintrag = GG_ZIELE[ziel]!.liste && typeof wert === 'string' && !a.pfad!.startsWith('freitexte.') && !wert.toLowerCase().startsWith(a.bezeichnung.toLowerCase())
        ? `${a.bezeichnung}: ${wert}` : wert;
      const grund = belegen(ziel, eintrag, i, a.wert);
      if (grund === 'zugeordnet') { erste ??= { index: i, ziel, grund, vorschlag: null, wert, ...(hinweis ? { hinweis } : {}) }; }
      else { schlechtester = grund; hinweisAus = hinweis; }
    }
    zeilen.push(erste ?? ohneZiel(schlechtester, hinweisAus));
  });

  // Prüfdaten: Teil A vollständig (auch Felder ohne gg-Ziel, z. B. Kalkulationswerte), dann Teil B in die Lücken
  const p = mitFeldern(leerePruefdaten(), felder);
  for (const [ziel, w] of Object.entries(werte)) {
    const z = GG_ZIELE[ziel];
    if (!z?.pruef || ausFeldern.has(ziel)) continue;
    const wert = Array.isArray(w) ? w.join('\n') : w;
    setzePfad(p as unknown as Record<string, unknown>, z.pruef, wert);
  }
  // Plausibilität: Miete je m² über 40 € und der Zwölftel-Wert liegt bei 2–40 € → vermutlich eine Jahresmiete.
  // Nur Warnung, keine stille Umrechnung (E8, 16.10.2026): bei Wohn- und Geschäftshäusern enthält die Ist-Miete die
  // Gewerbemiete, die Wohnfläche aber nicht die Gewerbefläche (Protokoll 31, B4) — die Umrechnung wäre dort falsch.
  const wfl = p.objekt.wohnflaeche;
  if (typeof p.objekt.istmiete === 'number' && typeof wfl === 'number' && wfl > 0) {
    const jeQm = p.objekt.istmiete / wfl;
    if (jeQm > 40 && jeQm / 12 >= 2 && jeQm / 12 <= 40) {
      warnungen.push(`Ist-Miete ${p.objekt.istmiete} € wären ${jeQm.toFixed(0)} €/m² im Monat — Jahresmiete oder Gewerbeanteil? Bitte prüfen (Monat wären ${+(p.objekt.istmiete / 12).toFixed(2)} €)`);
      p._konfidenz.istmiete = 'niedrig';
    }
  }
  const ausTabellen = einheitenAusTabellen(v2.einheiten_tabellen);
  const einheitenA = einheitenAusFeldern(felder);
  // Teil A wie früher; nur wenn die wörtlichen Tabellen mehr Einheiten haben (z. B. nach dem Nachfass), gelten sie.
  // Die Listen werden über Fläche, Lage, Art und Miete verbunden — nicht über die Reihenfolge (Protokoll 31, B8):
  // die gelesene Liste sagt Stellplatz/Gewerbe, wo Teil A „Wohnung“ meint; Zusatzspalten hängen an der passenden Einheit;
  // gilt die Tabelle, bleiben Mieten und Zimmer aus Teil A bei den passenden Einheiten erhalten.
  const ausA = einheitenA.length >= ausTabellen.einheiten.length && einheitenA.length > 0;
  const paare = ausA ? einheitenAbgleichen(einheitenA, ausTabellen.einheiten) : einheitenAbgleichen(ausTabellen.einheiten, einheitenA);
  const einheiten = ausA
    ? einheitenA.map((e, i) => { const j = paare[i] ?? null; return j === null ? e : einheitErgaenzen(e, ausTabellen.einheiten[j]!, true); })
    : ausTabellen.einheiten.map((e, i) => { const j = paare[i] ?? null; return j === null ? e : einheitErgaenzen(e, einheitenA[j]!, false); });
  const einheitenDetails = ausA ? einheitenA.map((_, i) => { const j = paare[i] ?? null; return j === null ? null : ausTabellen.details[j]!; }) : ausTabellen.details;
  p.objekt.einheiten = einheiten;
  const m = p.makler;
  // Mobil nur bei Mobilnummer — gilt auch für Teil A (Prüfung 12.10.2026: Festnetz im Feld Mobil)
  if (m.mobiltel && !istMobilnummer(m.mobiltel)) {
    if (!m.festnetztel) m.festnetztel = m.mobiltel;
    warnungen.push('Makler: angebliche Mobilnummer ist Festnetz — als Festnetz geführt');
    m.mobiltel = null;
  }
  m.tel ??= m.mobiltel ?? m.festnetztel;
  m.alleNamen = ohneDoppel([m.name, ...m.alleNamen, ...weitere.namen]);
  m.alleTelefonnummern = ohneDoppel([m.mobiltel, m.festnetztel, m.tel, ...m.alleTelefonnummern, ...weitere.tel]);
  m.alleEmails = ohneDoppel([m.email, ...m.alleEmails, ...weitere.email]);
  if (weitere.namen.length || weitere.tel.length || weitere.email.length) {
    werte['makler.weitereKontakte'] = [...ohneDoppel(weitere.namen), ...ohneDoppel(weitere.tel), ...ohneDoppel(weitere.email)];
  }

  // Konfidenz der Prüfseite aus der Belegprüfung
  if (belegt) {
    for (const [ziel, i] of Object.entries(quelleIndex)) {
      const z = GG_ZIELE[ziel];
      if (!z?.pruef?.startsWith('objekt.') || ausFeldern.has(ziel)) continue;
      const b = belegt[i];
      p._konfidenz[konfidenzSchluessel(z.pruef)] = b === true ? 'hoch' : b === false ? 'niedrig' : 'mittel';
    }
  }
  // Energieausweis aus per Texterkennung gelesenen Seiten gilt als unsicher (E7b, Paritätstest 16.10.2026: beim Scan
  // „A“/75 statt E/142,7 — die OCR-Zeilen trugen Überschriften ohne Werte)
  if (v2.dokument?.seiten.some((s) => s.ocr)) {
    const ea = p.objekt.energieausweis;
    const gesetzt = (['klasse', 'kennwert', 'art'] as const).filter((k) => ea[k] !== null && ea[k] !== undefined);
    if (gesetzt.length) {
      for (const k of gesetzt) p._konfidenz[konfidenzSchluessel(`objekt.energieausweis.${k}`)] = 'niedrig';
      warnungen.push('Energieausweis aus per Texterkennung gelesenen Seiten — bitte im Exposé prüfen');
    }
  }

  // details
  const details: Record<string, unknown> = {};
  for (const [ziel, w] of Object.entries(werte)) {
    const z = GG_ZIELE[ziel];
    if (z?.details && z.art === 'objekt') setzePfad(details, z.details, w);
  }

  if (v2.einheiten_im_dokument !== null ? v2.einheiten_im_dokument > einheiten.length : !v2.einheiten_vollstaendig && !einheiten.length) {
    warnungen.push(`Einheitenliste unvollständig: ${einheiten.length} erfasst, ${v2.einheiten_im_dokument ?? '?'} im Dokument`);
  }
  return { pruefdaten: p, werte, details, einheitenDetails, zeilen, warnungen };
}

/** Trägt die Erfassung? Ort und Kaufpreis gefunden und mindestens eine Einheit (oder das Dokument nennt genau eine). */
export function v2Traegt(v2: ExposeV2): boolean {
  const { objekt: o, kalkulation: k } = zuordnen(v2).pruefdaten;
  const ort = !!(o.stadt || o.strasse || o.plz);
  const preis = (typeof o.angebotspreis === 'number' && o.angebotspreis > 0) || (typeof k.kaufpreis === 'number' && k.kaufpreis > 0);
  const einheiten = o.einheiten.length > 0 || v2.einheiten_im_dokument === 1 || o.einheitenAnz === 1;
  return ort && preis && einheiten;
}
