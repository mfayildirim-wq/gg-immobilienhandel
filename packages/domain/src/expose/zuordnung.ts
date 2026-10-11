/**
 * Mapping Standard → gg (Protokoll 28). Feste Tabelle `MAPPING` (Standard-Pfad → gg-Ziele) plus wenige Regeln mit Test:
 * Straße/Hausnummer trennen, Vor- und Nachname zusammen, Jahres- → Monatswert, Provision in Prozent, Einheiten aus Tabellen.
 *
 * Erster Treffer füllt ein Ziel; ein späterer Treffer mit gleichem Wert gilt als zugeordnet, mit anderem Wert bleibt er
 * „doppelt“ unter „Weitere Angaben“. Was keine Zuordnung hat, bekommt den KI-Vorschlag (nur Vorauswahl im Dropdown).
 * Ergebnis ist u. a. das Format der Prüfseite (`ExtrahiertV0`), damit `exposeVorbereiten` unverändert weiterläuft.
 */
import type { EinheitenTabelle, ExposeV2 } from './erfassung.ts';
import type { EinheitFeld } from './katalog.ts';
import { jahrAusText, leerraum, type NormWert, plzOrtTrennen, strasseTrennen, wertNormalisieren, zahlAusText } from './normalisieren.ts';
import { GG_ZIELE } from './ziele.ts';

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

function gleich(a: NormWert | string[] | undefined, b: NormWert): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 0.005 * Math.max(Math.abs(a), Math.abs(b));
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/** Wert einer Angabe für ein Ziel, mit den Sonderregeln. */
export function zielWert(ziel: string, wort: string, pfad: string | null): { wert: NormWert; hinweis?: string } {
  const z = GG_ZIELE[ziel];
  if (!z) return { wert: null };
  if (pfad?.endsWith('_jahr') && (ziel === 'objekt.istmiete' || ziel === 'objekt.sollmiete')) {
    const n = zahlAusText(wort);
    return n === null ? { wert: null } : { wert: +(n / 12).toFixed(2), hinweis: 'Jahreswert ÷ 12' };
  }
  if (ziel === 'kalkulation.makler') {
    if (/provisionsfrei|keine (käufer)?provision|courtagefrei/i.test(wort)) return { wert: 0, hinweis: 'provisionsfrei' };
    if (!/%/.test(wort)) return { wert: null };
  }
  if (ziel === 'objekt.heizungsbaujahr' || ziel === 'objekt.baujahr') return { wert: jahrAusText(wort) };
  return { wert: wertNormalisieren(wort, z.typ) };
}

function setzePfad(o: Record<string, unknown>, pfad: string, wert: unknown) {
  const teile = pfad.split('.');
  let akt = o;
  for (const t of teile.slice(0, -1)) {
    if (!akt[t] || typeof akt[t] !== 'object' || Array.isArray(akt[t])) akt[t] = {};
    akt = akt[t] as Record<string, unknown>;
  }
  akt[teile.at(-1)!] = wert;
}

// ── Einheiten ──────────────────────────────────────────────────

const STELLPLATZ = /stellpl|garage|\btg\b|tiefgarage|carport|parkpl|duplex/i;
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
      const statusText = zelle('status');
      const kaltText = zelle('kaltmiete');
      const leer = /leer|frei\b|unvermietet|nicht vermietet/i.test(`${statusText ?? ''} ${kaltText ?? ''}`);
      let kaltmiete = zahl('kaltmiete');
      if (leer && kaltmiete === null) kaltmiete = 0;
      const vermiet = leer ? 'Leerstand' : statusText && /vermietet|bestand|belegt/i.test(statusText) ? 'Vermietet' : kaltmiete && kaltmiete > 0 ? 'Vermietet' : null;
      einheiten.push({
        typ: einheitTyp(zelle('typ'), zelle('lage'), zelle('nr')), lage: zelle('lage') ?? null, zimmer: zahl('zimmer'),
        flaeche: zahl('flaeche'), kaltmiete, vermiet,
      });
      const d: EinheitDetails = {};
      const nr = zelle('nr'); if (nr) d.nr = nr;
      for (const f of ['nebenkosten', 'warmmiete', 'sollmiete'] as const) { const n = zahl(f); if (n !== null) d[f] = n; }
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
  const vollerName = (k: number) => { const n = namen.get(k); return text([n?.vorname, n?.name].filter(Boolean).join(' ')); };

  const weitere = { namen: [] as string[], tel: [] as string[], email: [] as string[] };

  const belegen = (ziel: string, wert: NormWert, i: number, wort: string): ZuordnungGrund => {
    const z = GG_ZIELE[ziel]!;
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

  angaben.forEach((a, i) => {
    const kontakt = kontaktVon(a);
    const vorschlagGueltig = a.gg && GG_ZIELE[a.gg] ? a.gg : null;
    const ohneZiel = (grund: ZuordnungGrund, hinweis?: string): ZuordnungZeile => {
      const w = vorschlagGueltig ? zielWert(vorschlagGueltig, a.wert, a.pfad).wert : null;
      return { index: i, ziel: null, grund, vorschlag: vorschlagGueltig, wert: w, ...(hinweis ? { hinweis } : {}) };
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
    if (!ziele?.length) { zeilen.push(ohneZiel('keinMapping')); return; }

    // Sonderregeln: Name, Adresse
    if (a.pfad === 'kontaktperson.vorname' || a.pfad === 'kontaktperson.name') {
      const n = vollerName(kontakt ?? 1);
      const grund = n ? belegen('makler.name', n, i, a.wert) : 'keinWert';
      zeilen.push(grund === 'zugeordnet' ? { index: i, ziel: 'makler.name', grund, vorschlag: null, wert: n } : ohneZiel(grund));
      return;
    }
    if (a.pfad === 'geo.strasse' || a.pfad === 'kontaktperson.strasse') {
      const [vorne, hinten] = a.wert.split(/,\s*/, 2) as [string, string | undefined];
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

  // Prüfdaten füllen
  const p = leerePruefdaten();
  for (const [ziel, w] of Object.entries(werte)) {
    const z = GG_ZIELE[ziel];
    if (!z?.pruef) continue;
    const wert = Array.isArray(w) ? w.join('\n') : w;
    setzePfad(p as unknown as Record<string, unknown>, z.pruef, wert);
  }
  const { einheiten, details: einheitenDetails } = einheitenAusTabellen(v2.einheiten_tabellen);
  p.objekt.einheiten = einheiten;
  const m = p.makler;
  m.tel = m.mobiltel ?? m.festnetztel;
  m.alleNamen = ohneDoppel([m.name, ...weitere.namen]);
  m.alleTelefonnummern = ohneDoppel([m.mobiltel, m.festnetztel, ...weitere.tel]);
  m.alleEmails = ohneDoppel([m.email, ...weitere.email]);
  if (weitere.namen.length || weitere.tel.length || weitere.email.length) {
    werte['makler.weitereKontakte'] = [...ohneDoppel(weitere.namen), ...ohneDoppel(weitere.tel), ...ohneDoppel(weitere.email)];
  }

  // Konfidenz der Prüfseite aus der Belegprüfung
  if (belegt) {
    for (const [ziel, i] of Object.entries(quelleIndex)) {
      const z = GG_ZIELE[ziel];
      if (!z?.pruef?.startsWith('objekt.')) continue;
      const b = belegt[i];
      p._konfidenz[z.pruef.split('.').at(-1)!] = b === true ? 'hoch' : b === false ? 'niedrig' : 'mittel';
    }
  }

  // details
  const details: Record<string, unknown> = {};
  for (const [ziel, w] of Object.entries(werte)) {
    const z = GG_ZIELE[ziel];
    if (z?.details && z.art === 'objekt') setzePfad(details, z.details, w);
  }

  if (!v2.einheiten_vollstaendig || (v2.einheiten_im_dokument !== null && v2.einheiten_im_dokument > einheiten.length)) {
    warnungen.push(`Einheitenliste unvollständig: ${einheiten.length} erfasst, ${v2.einheiten_im_dokument ?? '?'} im Dokument`);
  }
  return { pruefdaten: p, werte, details, einheitenDetails, zeilen, warnungen };
}

/** Trägt die Erfassung? Ort und Kaufpreis gefunden und mindestens eine Einheit (oder das Dokument nennt genau eine). */
export function v2Traegt(v2: ExposeV2): boolean {
  const { werte, pruefdaten } = zuordnen(v2);
  const ort = !!(werte['objekt.stadt'] || werte['objekt.strasse'] || werte['objekt.plz']);
  const preis = typeof werte['objekt.angebotspreis'] === 'number' && werte['objekt.angebotspreis'] > 0;
  const einheiten = pruefdaten.objekt.einheiten.length > 0 || v2.einheiten_im_dokument === 1 || werte['objekt.einheitenAnz'] === 1;
  return ort && preis && einheiten;
}
