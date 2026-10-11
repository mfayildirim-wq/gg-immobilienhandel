/**
 * Kennzahlen des Prüfsatzes (Protokoll 27, T6): Was hat die Extraktion je Exposé gefunden, wie teuer und wie lange war
 * sie, und passen die Zahlen zueinander? Reine Funktionen über dem Analyse-Ergebnis — v0 und v2 werden über das Format der
 * Prüfseite auf dieselben Feldnamen abgebildet (v2 über `zuordnen`), damit die beiden Schemata je Feld vergleichbar sind. Keine Rohtexte, keine Adressen: nur Flags,
 * Zähler und Quoten, damit die Ausgabe in die Doku darf.
 */
import type { ExposeV2 } from './erfassung.ts';
import { v2Traegt, zuordnen } from './zuordnung.ts';

export const KERNFELDER = [
  'strasse', 'hausnr', 'plz', 'stadt', 'baujahr', 'wohnflaeche', 'grundstueck', 'einheitenAnz', 'kaufpreis', 'istmiete',
  'heizungsart', 'energieklasse', 'maklerName', 'maklerFirma', 'maklerEmail', 'maklerTel',
] as const;
export type Kernfeld = (typeof KERNFELDER)[number];

/** Nur in v2 vorhanden; bei v0 `null` (nicht im Schema), nicht 0. */
export const ZUSATZFELDER = [
  'hausgeld', 'nebenkosten', 'provision', 'denkmalschutz', 'erbpacht', 'objektart', 'sanierungen',
  'angaben', 'mitStandardPfad', 'zugeordnet', 'weitereAngaben', 'mitVorschlag', 'freitextZeichen', 'weitereKontakte',
  'einheitenMitMietbeginn', 'einheitenMitNebenkosten', 'einheitenZusatzspalten',
] as const;
export type Zusatzfeld = (typeof ZUSATZFELDER)[number];

export const KONSISTENZ_REGELN = [
  'summeKaltmieteVsIstmiete', 'anzahlWohnungenVsAnzahlWE', 'summeFlaechenVsWohnflaeche', 'mieteJeQm', 'plz5stellig', 'baujahr',
] as const;
export type KonsistenzRegel = (typeof KONSISTENZ_REGELN)[number];
export type KonsistenzStand = 'ok' | 'abweichung' | 'unbekannt';

export const QUOTEN = ['traegtQuote', 'belegQuote', 'abgeschnittenQuote', 'nachfassQuote', 'wiederholungQuote', 'sonnetQuote', 'fehlerQuote'] as const;
export type Quote = (typeof QUOTEN)[number];

export interface KennzahlenEingabe {
  datei: string;
  schema: 'v0' | 'v2';
  v2?: ExposeV2 | null;
  /** v0-Antwort (`extrahiert` der Analyse): { objekt, makler, kalkulation }. */
  v0?: unknown;
  modell: string;
  modus: string;
  stopReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
  dauerMs: number;
  kostenEur: number;
  nachfass: boolean;
  wiederholung: boolean;
  warnungen: string[];
  /** Ergebnis von belegePruefen je Angabe (nur v2, Textweg). */
  belegt?: (boolean | null)[] | null;
  /** Analyse fehlgeschlagen — dann zählen alle Felder als leer. */
  fehler?: string | null;
}

export interface KennzahlenJeExpose {
  datei: string;
  schema: 'v0' | 'v2';
  fehler: string | null;
  modell: string;
  modus: string;
  sonnet: boolean;
  abgeschnitten: boolean;
  nachfass: boolean;
  wiederholung: boolean;
  dauerMs: number;
  kostenEur: number;
  inputTokens: number;
  outputTokens: number;
  warnungen: number;
  /** v2: trägt das Ergebnis (v2Traegt: Ort, Preis, Einheiten); v0 → null. */
  traegt: boolean | null;
  kern: Record<Kernfeld, boolean>;
  zusatz: Record<Zusatzfeld, number | null>;
  einheitenAnzahl: number;
  /** belegt true / geprüfte Felder; null ohne Prüfung. */
  belegQuote: number | null;
  belegtAnzahl: { geprueft: number; belegt: number };
  /** Angaben, die ein schon belegtes gg-Feld mit anderem Wert treffen; v0 kennt das nicht → null. */
  dopplungen: number | null;
  konsistenz: Record<KonsistenzRegel, KonsistenzStand>;
}

export interface KennzahlenZusammenfassung {
  schema: 'v0' | 'v2' | 'gemischt';
  anzahl: number;
  fehler: number;
  /** Füllgrad je Kernfeld in % aller Exposés (gerundet). */
  kern: Record<Kernfeld, number>;
  /** Anteil der Exposés mit mindestens einem Wert in % (nur Exposés, deren Schema das Feld kennt); null, wenn keines. */
  zusatz: Record<Zusatzfeld, number | null>;
  /** Mittlere Anzahl je Exposé (für Listen: Einträge; für Einzelwerte 0/1). */
  zusatzMittel: Record<Zusatzfeld, number | null>;
  einheitenGesamt: number;
  einheitenMittel: number;
  quoten: Record<Quote, number | null>;
  dopplungenGesamt: number;
  dauerMsMittel: number;
  kostenEurSumme: number;
  kostenEurMittel: number;
  inputTokensSumme: number;
  outputTokensSumme: number;
  /** je Regel: ok-Quote in % der entscheidbaren Fälle sowie die Zähler. */
  konsistenz: Record<KonsistenzRegel, { okQuote: number | null; ok: number; abweichung: number; unbekannt: number }>;
}

/** Differenz b − a in Prozentpunkten (Quoten) bzw. absolut (Mittelwerte); null, wenn eine Seite nichts hat. */
export interface KennzahlenVergleich {
  kern: Record<Kernfeld, number | null>;
  zusatz: Record<Zusatzfeld, number | null>;
  quoten: Record<Quote, number | null>;
  konsistenz: Record<KonsistenzRegel, number | null>;
  einheitenMittel: number | null;
  dauerMsMittel: number | null;
  kostenEurMittel: number | null;
}

// ── gemeinsame Sicht auf v0 und v2 ───────────────────────────

interface EinheitSicht { typ: string | null; flaeche: number | null; kaltmiete: number | null; nebenkosten: number | null; mietbeginn: string | null }

interface Sicht {
  kern: Record<Kernfeld, unknown>;
  einheiten: EinheitSicht[];
  zusatz: Record<Zusatzfeld, number | null>;
}

const zahl = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const gefuellt = (v: unknown): boolean => (typeof v === 'string' ? v.trim() !== '' : typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean');
const leereZusatz = (): Record<Zusatzfeld, number | null> => Object.fromEntries(ZUSATZFELDER.map((f) => [f, null])) as Record<Zusatzfeld, number | null>;

function sichtV2(v2: ExposeV2): Sicht {
  const { pruefdaten, werte, zeilen, einheitenDetails } = zuordnen(v2);
  const basis = sichtV0(pruefdaten);
  const hat = (ziel: string) => (werte[ziel] !== undefined && werte[ziel] !== null ? 1 : 0);
  const liste = (ziel: string) => (Array.isArray(werte[ziel]) ? (werte[ziel] as unknown[]).length : 0);
  basis.einheiten = basis.einheiten.map((e, i) => ({ ...e, nebenkosten: einheitenDetails[i]?.nebenkosten ?? null, mietbeginn: einheitenDetails[i]?.mietbeginn ?? null }));
  basis.zusatz = {
    hausgeld: hat('details.hausgeld_monat'), nebenkosten: hat('details.nebenkosten_monat'), provision: hat('details.provision'),
    denkmalschutz: hat('details.denkmalschutz'), erbpacht: hat('details.erbbaurecht'), objektart: hat('details.objektart'),
    sanierungen: liste('details.sanierungen'),
    angaben: v2.angaben.length,
    mitStandardPfad: v2.angaben.filter((a) => a.pfad).length,
    zugeordnet: zeilen.filter((z) => z.grund === 'zugeordnet').length,
    weitereAngaben: zeilen.filter((z) => z.grund !== 'zugeordnet').length,
    mitVorschlag: zeilen.filter((z) => z.grund !== 'zugeordnet' && z.vorschlag).length,
    freitextZeichen: v2.angaben.filter((a) => a.pfad?.startsWith('freitexte.')).reduce((n, a) => n + a.wert.length, 0),
    weitereKontakte: new Set(v2.angaben.filter((a) => a.kontakt !== null && a.kontakt > 1).map((a) => a.kontakt)).size,
    einheitenMitMietbeginn: einheitenDetails.filter((d) => d?.mietbeginn).length,
    einheitenMitNebenkosten: einheitenDetails.filter((d) => d?.nebenkosten !== undefined).length,
    einheitenZusatzspalten: v2.einheiten_tabellen.reduce((n, t) => n + t.spalten.filter((x) => !x.feld).length, 0),
  };
  return basis;
}

function sichtV0(roh: unknown): Sicht {
  const r = (roh && typeof roh === 'object' ? roh : {}) as Record<string, any>;
  const o = (r.objekt && typeof r.objekt === 'object' ? r.objekt : {}) as Record<string, any>;
  const m = (r.makler && typeof r.makler === 'object' ? r.makler : {}) as Record<string, any>;
  const einheiten: unknown[] = Array.isArray(o.einheiten) ? o.einheiten : [];
  return {
    kern: {
      strasse: o.strasse, hausnr: o.hausnr, plz: o.plz, stadt: o.stadt,
      baujahr: o.baujahr, wohnflaeche: o.wohnflaeche, grundstueck: o.grundstueck, einheitenAnz: o.einheitenAnz,
      kaufpreis: zahl(o.angebotspreis) ?? zahl(r.kalkulation?.kaufpreis), istmiete: o.istmiete,
      heizungsart: o.heizungsart, energieklasse: o.energieausweis?.klasse,
      maklerName: m.name, maklerFirma: m.firma, maklerEmail: m.email, maklerTel: text(m.mobiltel) ?? text(m.festnetztel) ?? text(m.tel),
    },
    einheiten: einheiten.map((e) => {
      const x = (e && typeof e === 'object' ? e : {}) as Record<string, any>;
      return { typ: text(x.typ), flaeche: zahl(x.flaeche), kaltmiete: zahl(x.kaltmiete), nebenkosten: null, mietbeginn: null };
    }),
    zusatz: leereZusatz(),
  };
}

/** Nichts gefunden (oder Fehler): v2 kennt die Zusatzfelder → 0; v0 kennt sie nicht → null. */
function sichtLeer(schema: 'v0' | 'v2'): Sicht {
  const zusatz = schema === 'v2' ? (Object.fromEntries(ZUSATZFELDER.map((f) => [f, 0])) as Record<Zusatzfeld, number | null>) : leereZusatz();
  return { kern: Object.fromEntries(KERNFELDER.map((f) => [f, null])) as Record<Kernfeld, unknown>, einheiten: [], zusatz };
}

// ── Konsistenz ───────────────────────────────────────────────

const innerhalb = (ist: number, soll: number, toleranz: number): KonsistenzStand => (Math.abs(ist - soll) <= Math.abs(soll) * toleranz ? 'ok' : 'abweichung');

/** Die sechs Regeln aus Protokoll 27; `jahr` ist das „heute“ der Baujahr-Regel (Standard: aktuelles Jahr). */
export function konsistenzPruefen(s: Sicht, jahr = new Date().getFullYear()): Record<KonsistenzRegel, KonsistenzStand> {
  const istmiete = zahl(s.kern.istmiete);
  const wohnflaeche = zahl(s.kern.wohnflaeche);
  const anzahlWE = zahl(s.kern.einheitenAnz);
  const plz = text(s.kern.plz);
  const baujahr = zahl(s.kern.baujahr);
  const wohnungen = s.einheiten.filter((e) => e.typ === 'Wohnung');
  const mieten = s.einheiten.map((e) => e.kaltmiete).filter((x): x is number => x !== null);
  const flaechen = wohnungen.map((e) => e.flaeche).filter((x): x is number => x !== null);
  const summe = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    summeKaltmieteVsIstmiete: istmiete === null || istmiete <= 0 || mieten.length === 0 ? 'unbekannt' : innerhalb(summe(mieten), istmiete, 0.05),
    anzahlWohnungenVsAnzahlWE: anzahlWE === null || s.einheiten.length === 0 ? 'unbekannt' : wohnungen.length === anzahlWE ? 'ok' : 'abweichung',
    summeFlaechenVsWohnflaeche: wohnflaeche === null || wohnflaeche <= 0 || flaechen.length === 0 ? 'unbekannt' : innerhalb(summe(flaechen), wohnflaeche, 0.1),
    mieteJeQm: istmiete === null || wohnflaeche === null || wohnflaeche <= 0 ? 'unbekannt' : (istmiete / wohnflaeche >= 2 && istmiete / wohnflaeche <= 40 ? 'ok' : 'abweichung'),
    plz5stellig: plz === null ? 'unbekannt' : /^\d{5}$/.test(plz) ? 'ok' : 'abweichung',
    baujahr: baujahr === null ? 'unbekannt' : baujahr >= 1800 && baujahr <= jahr ? 'ok' : 'abweichung',
  };
}

// ── je Exposé ────────────────────────────────────────────────

export function kennzahlenJeExpose(e: KennzahlenEingabe, jahr?: number): KennzahlenJeExpose {
  const fehler = e.fehler ? String(e.fehler) : null;
  const sicht = fehler ? sichtLeer(e.schema) : e.schema === 'v2' ? (e.v2 ? sichtV2(e.v2) : sichtLeer('v2')) : sichtV0(e.v0);
  const kern = Object.fromEntries(KERNFELDER.map((f) => [f, gefuellt(sicht.kern[f])])) as Record<Kernfeld, boolean>;
  const belegt = (e.belegt ?? []).filter((b): b is boolean => b !== null);
  const geprueft = belegt.length;
  const belegtAnzahl = belegt.filter(Boolean).length;
  const dopplungen = e.schema === 'v2' && e.v2 && !fehler ? zuordnen(e.v2).zeilen.filter((z) => z.grund === 'doppelt').length : e.schema === 'v2' ? 0 : null;
  return {
    datei: e.datei, schema: e.schema, fehler,
    modell: e.modell ?? '', modus: e.modus ?? '',
    sonnet: /sonnet/i.test(e.modell ?? ''),
    abgeschnitten: e.stopReason === 'max_tokens',
    nachfass: !!e.nachfass, wiederholung: !!e.wiederholung,
    dauerMs: Math.round(e.dauerMs || 0), kostenEur: +(e.kostenEur || 0).toFixed(4),
    inputTokens: e.usage?.inputTokens ?? 0, outputTokens: e.usage?.outputTokens ?? 0,
    warnungen: e.warnungen?.length ?? 0,
    traegt: e.schema === 'v2' ? (!fehler && !!e.v2 && v2Traegt(e.v2)) : null,
    kern, zusatz: sicht.zusatz,
    einheitenAnzahl: sicht.einheiten.length,
    belegQuote: geprueft ? Math.round((belegtAnzahl / geprueft) * 100) : null,
    belegtAnzahl: { geprueft, belegt: belegtAnzahl },
    dopplungen,
    konsistenz: fehler ? (Object.fromEntries(KONSISTENZ_REGELN.map((r) => [r, 'unbekannt'])) as Record<KonsistenzRegel, KonsistenzStand>) : konsistenzPruefen(sicht, jahr),
  };
}

// ── Zusammenfassung ──────────────────────────────────────────

const prozent = (zaehler: number, nenner: number): number | null => (nenner > 0 ? Math.round((zaehler / nenner) * 100) : null);
const mittel = (xs: number[], stellen = 0): number | null => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(stellen) : null);

export function kennzahlenZusammenfassen(liste: KennzahlenJeExpose[]): KennzahlenZusammenfassung {
  const n = liste.length;
  const ohneFehler = liste.filter((k) => !k.fehler);
  const schemata = new Set(liste.map((k) => k.schema));
  const kern = Object.fromEntries(KERNFELDER.map((f) => [f, prozent(liste.filter((k) => k.kern[f]).length, n) ?? 0])) as Record<Kernfeld, number>;
  const zusatz = {} as Record<Zusatzfeld, number | null>;
  const zusatzMittel = {} as Record<Zusatzfeld, number | null>;
  for (const f of ZUSATZFELDER) {
    const werte = liste.map((k) => k.zusatz[f]).filter((x): x is number => x !== null);
    zusatz[f] = prozent(werte.filter((x) => x > 0).length, werte.length);
    zusatzMittel[f] = mittel(werte, 2);
  }
  const belege = ohneFehler.filter((k) => k.belegtAnzahl.geprueft > 0);
  const mitTraegt = liste.filter((k) => k.traegt !== null);
  const quoten: Record<Quote, number | null> = {
    traegtQuote: prozent(mitTraegt.filter((k) => k.traegt).length, mitTraegt.length),
    belegQuote: prozent(belege.reduce((a, k) => a + k.belegtAnzahl.belegt, 0), belege.reduce((a, k) => a + k.belegtAnzahl.geprueft, 0)),
    abgeschnittenQuote: prozent(ohneFehler.filter((k) => k.abgeschnitten).length, ohneFehler.length),
    nachfassQuote: prozent(ohneFehler.filter((k) => k.nachfass).length, ohneFehler.length),
    wiederholungQuote: prozent(ohneFehler.filter((k) => k.wiederholung).length, ohneFehler.length),
    sonnetQuote: prozent(ohneFehler.filter((k) => k.sonnet).length, ohneFehler.length),
    fehlerQuote: prozent(n - ohneFehler.length, n),
  };
  const konsistenz = {} as KennzahlenZusammenfassung['konsistenz'];
  for (const r of KONSISTENZ_REGELN) {
    const ok = liste.filter((k) => k.konsistenz[r] === 'ok').length;
    const abweichung = liste.filter((k) => k.konsistenz[r] === 'abweichung').length;
    konsistenz[r] = { okQuote: prozent(ok, ok + abweichung), ok, abweichung, unbekannt: n - ok - abweichung };
  }
  const einheitenGesamt = liste.reduce((a, k) => a + k.einheitenAnzahl, 0);
  const kostenEurSumme = +liste.reduce((a, k) => a + k.kostenEur, 0).toFixed(4);
  return {
    schema: schemata.size === 1 ? [...schemata][0]! : 'gemischt',
    anzahl: n, fehler: n - ohneFehler.length,
    kern, zusatz, zusatzMittel,
    einheitenGesamt, einheitenMittel: mittel(ohneFehler.map((k) => k.einheitenAnzahl), 1) ?? 0,
    quoten,
    dopplungenGesamt: liste.reduce((a, k) => a + (k.dopplungen ?? 0), 0),
    dauerMsMittel: mittel(ohneFehler.map((k) => k.dauerMs)) ?? 0,
    kostenEurSumme, kostenEurMittel: mittel(ohneFehler.map((k) => k.kostenEur), 4) ?? 0,
    inputTokensSumme: liste.reduce((a, k) => a + k.inputTokens, 0),
    outputTokensSumme: liste.reduce((a, k) => a + k.outputTokens, 0),
    konsistenz,
  };
}

// ── Vergleich ────────────────────────────────────────────────

const differenz = (a: number | null | undefined, b: number | null | undefined, stellen = 0): number | null =>
  a == null || b == null ? null : +(b - a).toFixed(stellen);

/** b − a: positive Werte heißen „b hat mehr“. Quoten in Prozentpunkten, Mittelwerte absolut. */
export function kennzahlenVergleich(a: KennzahlenZusammenfassung, b: KennzahlenZusammenfassung): KennzahlenVergleich {
  return {
    kern: Object.fromEntries(KERNFELDER.map((f) => [f, differenz(a.kern[f], b.kern[f])])) as Record<Kernfeld, number | null>,
    zusatz: Object.fromEntries(ZUSATZFELDER.map((f) => [f, differenz(a.zusatz[f], b.zusatz[f])])) as Record<Zusatzfeld, number | null>,
    quoten: Object.fromEntries(QUOTEN.map((q) => [q, differenz(a.quoten[q], b.quoten[q])])) as Record<Quote, number | null>,
    konsistenz: Object.fromEntries(KONSISTENZ_REGELN.map((r) => [r, differenz(a.konsistenz[r].okQuote, b.konsistenz[r].okQuote)])) as Record<KonsistenzRegel, number | null>,
    einheitenMittel: differenz(a.einheitenMittel, b.einheitenMittel, 1),
    dauerMsMittel: differenz(a.dauerMsMittel, b.dauerMsMittel),
    kostenEurMittel: differenz(a.kostenEurMittel, b.kostenEurMittel, 4),
  };
}

// ── Markdown ─────────────────────────────────────────────────

const KERN_LABEL: Record<Kernfeld, string> = {
  strasse: 'Straße', hausnr: 'Hausnummer', plz: 'PLZ', stadt: 'Stadt', baujahr: 'Baujahr', wohnflaeche: 'Wohnfläche', grundstueck: 'Grundstück',
  einheitenAnz: 'Anzahl WE', kaufpreis: 'Kaufpreis', istmiete: 'Ist-Miete', heizungsart: 'Heizungsart', energieklasse: 'Energieklasse',
  maklerName: 'Makler Name', maklerFirma: 'Makler Firma', maklerEmail: 'Makler E-Mail', maklerTel: 'Makler Telefon',
};
const ZUSATZ_LABEL: Record<Zusatzfeld, string> = {
  hausgeld: 'Hausgeld', nebenkosten: 'Nebenkosten', provision: 'Provision', denkmalschutz: 'Denkmalschutz', erbpacht: 'Erbpacht', objektart: 'Objektart',
  sanierungen: 'Sanierungen', angaben: 'Erfasste Angaben', mitStandardPfad: 'Angaben mit Standard-Pfad', zugeordnet: 'Automatisch zugeordnet',
  weitereAngaben: 'Weitere Angaben (ohne Zuordnung)', mitVorschlag: 'davon mit KI-Vorschlag', freitextZeichen: 'Zeichen Freitext',
  weitereKontakte: 'Weitere Kontakte', einheitenMitMietbeginn: 'Einheiten mit Mietbeginn', einheitenMitNebenkosten: 'Einheiten mit Nebenkosten',
  einheitenZusatzspalten: 'Zusatzspalten der Mietlisten',
};
const QUOTE_LABEL: Record<Quote, string> = {
  traegtQuote: 'Trägt (Ort, Preis, Einheiten)',
  belegQuote: 'Beleg-Quote', abgeschnittenQuote: 'Abgeschnitten (max_tokens)', nachfassQuote: 'Nachfass Einheiten', wiederholungQuote: 'Wiederholung',
  sonnetQuote: 'Gründliches Modell (Sonnet)', fehlerQuote: 'Fehlgeschlagen',
};
const REGEL_LABEL: Record<KonsistenzRegel, string> = {
  summeKaltmieteVsIstmiete: 'Σ Kaltmieten ≈ Ist-Miete (±5 %)', anzahlWohnungenVsAnzahlWE: 'Anzahl Wohnungen = Anzahl WE',
  summeFlaechenVsWohnflaeche: 'Σ Flächen ≈ Wohnfläche (±10 %)', mieteJeQm: 'Miete/m² 2–40 €', plz5stellig: 'PLZ 5-stellig', baujahr: 'Baujahr 1800–heute',
};

const de = (x: number | null | undefined, stellen = 0, einheit = ''): string => (x == null ? '–' : `${x.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen })}${einheit}`);
const delta = (x: number | null, stellen = 0, einheit = ''): string => (x == null ? '–' : `${x > 0 ? '+' : ''}${de(x, stellen, einheit)}`);

/**
 * Markdown-Tabellen je Feld. Ohne `vergleich`: Feld | Wert. Mit `vergleich` (die andere Seite, z. B. v0):
 * Feld | vergleich | zusammenfassung | Δ, Δ = zusammenfassung − vergleich in Prozentpunkten.
 */
export function kennzahlenAlsMarkdown(z: KennzahlenZusammenfassung, vergleich?: KennzahlenZusammenfassung): string {
  const d = vergleich ? kennzahlenVergleich(vergleich, z) : null;
  const kopf = vergleich ? `| Feld | ${vergleich.schema} | ${z.schema} | Δ |\n|---|---:|---:|---:|` : `| Feld | ${z.schema} |\n|---|---:|`;
  const zeile = (label: string, a: number | null | undefined, b: number | null | undefined, diff: number | null, stellen = 0, einheit = '') =>
    vergleich ? `| ${label} | ${de(a, stellen, einheit)} | ${de(b, stellen, einheit)} | ${delta(diff, stellen, einheit)} |` : `| ${label} | ${de(b, stellen, einheit)} |`;
  const teile: string[] = [];

  teile.push(`## Umfang\n`, kopf);
  teile.push(zeile('Exposés', vergleich?.anzahl, z.anzahl, differenz(vergleich?.anzahl, z.anzahl)));
  teile.push(zeile('davon fehlgeschlagen', vergleich?.fehler, z.fehler, differenz(vergleich?.fehler, z.fehler)));
  teile.push(zeile('Einheiten gesamt', vergleich?.einheitenGesamt, z.einheitenGesamt, differenz(vergleich?.einheitenGesamt, z.einheitenGesamt)));
  teile.push(zeile('Einheiten ø je Exposé', vergleich?.einheitenMittel, z.einheitenMittel, d?.einheitenMittel ?? null, 1));
  teile.push(zeile('Dauer ø', vergleich ? vergleich.dauerMsMittel / 1000 : null, z.dauerMsMittel / 1000, d ? differenz(vergleich!.dauerMsMittel / 1000, z.dauerMsMittel / 1000, 1) : null, 1, ' s'));
  teile.push(zeile('Kosten Σ', vergleich?.kostenEurSumme, z.kostenEurSumme, differenz(vergleich?.kostenEurSumme, z.kostenEurSumme, 2), 2, ' €'));
  teile.push(zeile('Kosten ø', vergleich?.kostenEurMittel, z.kostenEurMittel, d?.kostenEurMittel ?? null, 4, ' €'));
  teile.push(zeile('Eingabe-Tokens Σ', vergleich?.inputTokensSumme, z.inputTokensSumme, differenz(vergleich?.inputTokensSumme, z.inputTokensSumme)));
  teile.push(zeile('Ausgabe-Tokens Σ', vergleich?.outputTokensSumme, z.outputTokensSumme, differenz(vergleich?.outputTokensSumme, z.outputTokensSumme)));
  teile.push(zeile('Dopplungen Kern ↔ weitere Angaben', vergleich?.dopplungenGesamt, z.dopplungenGesamt, differenz(vergleich?.dopplungenGesamt, z.dopplungenGesamt)));

  teile.push(`\n## Füllgrad Kernfelder (% der Exposés)\n`, kopf);
  for (const f of KERNFELDER) teile.push(zeile(KERN_LABEL[f], vergleich?.kern[f], z.kern[f], d?.kern[f] ?? null, 0, ' %'));

  teile.push(`\n## Zusatzfelder v2 (% der Exposés mit Wert · ø Anzahl)\n`, kopf);
  for (const f of ZUSATZFELDER) {
    const anhang = z.zusatzMittel[f] != null ? ` (ø ${de(z.zusatzMittel[f], 2)})` : '';
    teile.push(zeile(`${ZUSATZ_LABEL[f]}${anhang}`, vergleich?.zusatz[f], z.zusatz[f], d?.zusatz[f] ?? null, 0, ' %'));
  }

  teile.push(`\n## Quoten (% der Exposés)\n`, kopf);
  for (const q of QUOTEN) teile.push(zeile(QUOTE_LABEL[q], vergleich?.quoten[q], z.quoten[q], d?.quoten[q] ?? null, 0, ' %'));

  teile.push(`\n## Konsistenz (ok in % der entscheidbaren Fälle · ok/abw./unbek.)\n`, kopf);
  for (const r of KONSISTENZ_REGELN) {
    const k = z.konsistenz[r];
    teile.push(zeile(`${REGEL_LABEL[r]} (${k.ok}/${k.abweichung}/${k.unbekannt})`, vergleich?.konsistenz[r].okQuote, k.okQuote, d?.konsistenz[r] ?? null, 0, ' %'));
  }
  return teile.join('\n') + '\n';
}
