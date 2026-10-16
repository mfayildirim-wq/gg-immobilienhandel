/**
 * Exposé-Import: Dubletten, Telefonregeln, Vorbereitung der ausgelesenen Daten, Kalkulationswerte.
 * Aus gg-immohandel `src/lib/dedup.ts`, `src/lib/utils.ts` und `src/modules/expose-wizard/expose-wizard.ts` (Stand 9d693b8).
 */
import type { KalkStandard } from '../ankaufkalkulation/engine.ts';

// ── Dubletten (dedup.ts) ────────────────────────────────────

export function normalizeAddr(s: string): string {
  return s.toLowerCase()
    .replace(/\bstraße\b|\bstrasse\b|\bstr\.\b|\bstr\b/g, 'str')
    .replace(/[.,\-]/g, '').replace(/\s+/g, ' ').trim();
}

const normalizeHausnr = (s: string) => (s || '').toLowerCase().replace(/\s+/g, '').trim();

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
  return dp[m]![n]!;
}

export function nameSimilar(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const na = a.toLowerCase().trim(), nb = b.toLowerCase().trim();
  if (na === nb) return true;
  const maxLen = Math.max(na.length, nb.length);
  return maxLen > 0 && levenshtein(na, nb) / maxLen < 0.3;
}

type Adresse = { strasse?: string | null; hausnr?: string | null; stadt?: string | null; plz?: string | null };

/** Straße (auch „Str.“, bis 2 Tippfehler, Präfix), gleiche Stadt; unterschiedliche Hausnummern trennen. */
export function addressSimilar(o: Adresse, d: Adresse): boolean {
  if (!o?.strasse || !d?.strasse) return false;
  const os = normalizeAddr(o.strasse), ds = normalizeAddr(d.strasse);
  const oc = normalizeAddr(o.stadt || ''), dc = normalizeAddr(d.stadt || '');
  if (oc && dc && oc !== dc) return false;
  const strasseGleich = os === ds || os.startsWith(ds) || ds.startsWith(os) || levenshtein(os, ds) <= 2;
  if (!strasseGleich) return false;
  const oh = normalizeHausnr(o.hausnr || ''), dh = normalizeHausnr(d.hausnr || '');
  return !(oh && dh && oh !== dh);
}

export type DublettenSicherheit = 'exact' | 'fuzzy';

/** Erstes passendes Objekt in Listenreihenfolge (findDuplicateObj). */
export function dublettenObjekt<T extends Adresse>(objekte: readonly T[], d: Adresse): { match: T; confidence: DublettenSicherheit } | null {
  if (!d.strasse) return null;
  for (const o of objekte) {
    if (!addressSimilar(o, d)) continue;
    const exakt = normalizeAddr(o.strasse || '') === normalizeAddr(d.strasse)
      && normalizeHausnr(o.hausnr || '') === normalizeHausnr(d.hausnr || '')
      && normalizeAddr(o.stadt || '') === normalizeAddr(d.stadt || '');
    return { match: o, confidence: exakt ? 'exact' : 'fuzzy' };
  }
  return null;
}

type Kontakt = { name?: string | null; email?: string | null; tel?: string | null };

/**
 * Makler-Dublette (findDuplicateMakler). Ist-Verhalten: geprüft wird Makler für Makler in Listenreihenfolge,
 * je Makler E-Mail → Telefon → Absender → ähnlicher Name. Ein früherer Makler mit ähnlichem Namen gewinnt
 * also vor einem späteren mit exakt gleicher E-Mail.
 */
export function dublettenMakler<T extends Kontakt>(makler: readonly T[], d: Kontakt, absenderEmail?: string | null): { match: T; confidence: DublettenSicherheit } | null {
  const tel = (s: string) => s.replace(/[\s\-()]/g, '');
  for (const m of makler) {
    if (m.email && d.email && m.email.toLowerCase() === d.email.toLowerCase()) return { match: m, confidence: 'exact' };
    if (m.tel && d.tel && tel(m.tel) === tel(d.tel)) return { match: m, confidence: 'exact' };
    if (absenderEmail && m.email && m.email.toLowerCase() === absenderEmail.toLowerCase()) return { match: m, confidence: 'fuzzy' };
    if (nameSimilar(m.name, d.name || '')) return { match: m, confidence: 'fuzzy' };
  }
  return null;
}

/** Deal-Dublette: gleiche Kombination Objekt + Makler (ohne Makler nie eine Dublette). */
export function dublettenDeal<T extends { objektId: string; maklerId: string | null }>(deals: readonly T[], objektId: string, maklerId: string | null): T | null {
  if (!objektId || !maklerId) return null;
  return deals.find((d) => d.objektId === objektId && d.maklerId === maklerId) ?? null;
}

// ── Telefon und E-Mail (utils.ts) ───────────────────────────

const TEL_ZEICHEN = /^[0-9+\s\-()/]+$/;

export function telefonPruefen(v: string | null | undefined): string | null {
  if (!v) return null;
  if (!TEL_ZEICHEN.test(v)) return 'Ungültige Zeichen — nur Ziffern, +, -, Leerzeichen erlaubt';
  const ziffern = (v.match(/\d/g) || []).length;
  if (ziffern < 6) return 'Zu kurz — mindestens 6 Ziffern eingeben';
  if (ziffern > 15) return 'Zu lang — maximal 15 Ziffern (internationale Norm)';
  return null;
}

export function emailPruefen(v: string | null | undefined): string | null {
  if (!v) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? null : 'Ungültige E-Mail-Adresse (z.B. name@firma.de)';
}

/** 0049 → +49, Klammern weg, mehrfache Leerzeichen glätten. */
export function telefonNormalisieren(v: string): string {
  if (!v) return v;
  return v.trim().replace(/^0049/, '+49').replace(/[()]/g, '').replace(/\s{2,}/g, ' ');
}

export function istMobilnummer(tel: string | null | undefined): boolean {
  if (!tel) return false;
  return /^(\+491|01[5-7])/.test(tel.replace(/[\s\-()]/g, ''));
}

/** Bestehenden Makler: Telefon nur ersetzen, wenn nicht eine Mobilnummer durch Festnetz ersetzt würde. */
export function telefonErsetzen(bestehend: string | null | undefined, neu: string | null | undefined): boolean {
  if (!neu || neu === bestehend) return false;
  return !(istMobilnummer(bestehend) && !istMobilnummer(neu));
}

/** Ghost-Guard: einen Makler nur anlegen, wenn Name, Firma, E-Mail oder Telefon vorhanden ist. */
export const maklerHatDaten = (m: { name?: string | null; firma?: string | null; email?: string | null; tel?: string | null }) =>
  !!(m.name?.trim() || m.firma?.trim() || m.email?.trim() || m.tel?.trim());

// ── Vorbereitung der ausgelesenen Daten (ewDoAnalyse) ───────

/**
 * Eine Einheit aus der Exposé-Auswertung. `null` heißt „im Exposé nicht gefunden" — so liefert es die KI.
 * `hinweis` setzt `exposeVorbereiten`: die Zeile trägt den Gesamtwert oder den Rest aus dem Gesamtwert (Fachentscheidung
 * 16.10.2026) und ist auf der Prüfseite als „bitte aufteilen" markiert.
 */
export interface ExposeEinheit {
  typ?: string | null;
  lage?: string | null;
  zimmer?: number | null;
  flaeche?: number | string | null;
  kaltmiete?: number | string | null;
  vermiet?: string | null;
  hinweis?: EinheitHinweis | null;
}
export type EinheitHinweis = 'gesamtwert' | 'rest';

/** Höchstzahl leerer Zeilen, die aus „Einheiten gesamt: N" entstehen. */
export const EINHEITEN_ZEILEN_MAX = 200;

const istZahl = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const zahlOderNull = (v: unknown): number | null => (istZahl(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null);

/**
 * Gesamtwert auf die Einheitenzeilen bringen, ohne zu verteilen (Fachentscheidung 16.10.2026, Protokoll 31 §8.4):
 *  - keine Zeile kennt den Wert → die erste Wohn-/Gewerbezeile bekommt den Gesamtwert (Hinweis „gesamtwert");
 *  - einige Zeilen kennen ihn → die erste Zeile ohne Wert bekommt den Rest (Gesamt minus bekannte, Hinweis „rest"),
 *    alle weiteren bleiben leer;
 *  - alle Zeilen kennen ihn → nichts ändern, bei Abweichung der Summe (> 1 %) eine Warnung;
 *  - negativer Rest → nichts eintragen, Warnung.
 * Stellplätze bleiben außen vor. Fläche und Miete laufen unabhängig voneinander. `0` gilt als bekannt (Leerstand).
 */
function gesamtwertEintragen(einheiten: ExposeEinheit[], feld: 'flaeche' | 'kaltmiete', gesamt: number | null, label: string, einheit: string, warnungen: string[]) {
  if (gesamt === null || gesamt <= 0) return;
  const wohn = einheiten.filter((e) => e.typ !== 'Stellplatz');
  if (!wohn.length) return;
  const bekannt = wohn.filter((e) => zahlOderNull(e[feld]) !== null);
  const offen = wohn.filter((e) => zahlOderNull(e[feld]) === null);
  const summe = bekannt.reduce((s, e) => s + (zahlOderNull(e[feld]) ?? 0), 0);
  const zeige = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  if (!offen.length) {
    if (Math.abs(summe - gesamt) > gesamt * 0.01) warnungen.push(`${label}: Einheiten ergeben ${zeige(summe)} ${einheit}, das Exposé nennt ${zeige(gesamt)} ${einheit}`);
    return;
  }
  if (!bekannt.length) {
    offen[0]![feld] = gesamt;
    offen[0]!.hinweis = 'gesamtwert';
    return;
  }
  const rest = +(gesamt - summe).toFixed(2);
  if (rest <= 0) {
    warnungen.push(`${label}: bekannte Einheiten ergeben schon ${zeige(summe)} ${einheit}, das Exposé nennt ${zeige(gesamt)} ${einheit} — Rest nicht eingetragen`);
    return;
  }
  offen[0]![feld] = rest;
  offen[0]!.hinweis ??= 'rest';
}

/**
 * Nach der Analyse: Einheitenzeilen wie das Exposé sie nennt (Liste, sonst „Einheiten gesamt", sonst eine Zeile), Gesamtwerte
 * für Fläche und Ist-Miete ohne Verteilung auf die erste offene Zeile (`gesamtwertEintragen`); Telefon Mobil > Festnetz > allgemein.
 * Bewusste Abweichung von der alten App, die fehlende Flächen gleichmäßig und fehlende Mieten nach Fläche verteilte
 * (Fachentscheidung 16.10.2026).
 */
export function exposeVorbereiten(extrahiert: any) {
  const warnungen: string[] = [];
  const objekt: Record<string, any> = { ...(extrahiert?.objekt || {}) };
  let einheiten: ExposeEinheit[] = Array.isArray(objekt.einheiten) ? objekt.einheiten.map((e: ExposeEinheit) => ({ ...e })) : [];
  const wohnflaeche = zahlOderNull(objekt.wohnflaeche);
  const istmiete = zahlOderNull(objekt.istmiete);
  if (!einheiten.length) {
    const anzahl = zahlOderNull(objekt.einheitenAnz);
    const zeilen = anzahl !== null && anzahl >= 1 ? Math.min(Math.round(anzahl), EINHEITEN_ZEILEN_MAX) : wohnflaeche !== null || istmiete !== null ? 1 : 0;
    einheiten = Array.from({ length: zeilen }, () => ({ typ: 'Wohnung', lage: null, zimmer: null, flaeche: null, kaltmiete: null, vermiet: null }));
  }
  if (einheiten.length) objekt.einheiten = einheiten;
  gesamtwertEintragen(einheiten, 'flaeche', wohnflaeche, 'Wohnfläche', 'm²', warnungen);
  gesamtwertEintragen(einheiten, 'kaltmiete', istmiete, 'Ist-Miete', '€', warnungen);

  const mkRoh = extrahiert?.makler || {};
  const makler = { ...mkRoh, tel: telefonNormalisieren(mkRoh.mobiltel || mkRoh.festnetztel || mkRoh.tel || ''), prio: 'B', kontaktFreq: 'Monatlich' };
  const deal = { status: 'In Prüfung', nachfassFreq: 'Wöchentlich', notizen: extrahiert?.objekt?.notizen || '', kalk: { ...(extrahiert?.kalkulation || {}) } };
  return { objekt, makler, deal, warnungen };
}

/**
 * Summenzeile der Einheitenaufstellung auf der Prüfseite: Summe Fläche und Kaltmiete (ohne Stellplätze bei der Fläche nicht nötig —
 * Stellplätze haben keine Fläche) und ob sie vom Gesamtwert des Exposés abweicht (> 1 %).
 */
export function einheitenSumme(einheiten: readonly ExposeEinheit[], wohnflaeche: number | null | undefined, istmiete: number | null | undefined) {
  const summe = (feld: 'flaeche' | 'kaltmiete') => einheiten.reduce((s, e) => s + (zahlOderNull(e[feld]) ?? 0), 0);
  const weicht = (ist: number, soll: number | null | undefined) => istZahl(soll) && soll > 0 && Math.abs(ist - soll) > soll * 0.01;
  const flaeche = +summe('flaeche').toFixed(2);
  const miete = +summe('kaltmiete').toFixed(2);
  return { flaeche, miete, flaecheWeicht: weicht(flaeche, wohnflaeche), mieteWeicht: weicht(miete, istmiete) };
}

// ── Kalkulationswerte im Wizard ─────────────────────────────

export const WIZARD_KALK_FELDER = ['kaufpreis', 'notar', 'gest', 'makler', 'fk_p', 'ek_p', 'euribor', 'margeB', 'ek_r', 'halt', 'rp_pct', 'glo_m'] as const;
export type WizardKalk = Partial<Record<(typeof WIZARD_KALK_FELDER)[number], number | null>>;

/**
 * Vorbelegung (ewRenderDeal): nicht erkannte Werte aus den Kalkulations-Einstellungen.
 * Bewusste Korrektur: die alte App speicherte den Risikopuffer als `rp`, die Kalkulation liest `rp_pct` –
 * der Wert blieb wirkungslos. Der Neubau schreibt `rp_pct` (ein ausgelesenes `rp` wird übernommen).
 */
export function wizardKalkVorbelegen(ausgelesen: Record<string, unknown>, standard: KalkStandard): WizardKalk {
  const zahl = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const k: WizardKalk = { kaufpreis: zahl(ausgelesen.kaufpreis) };
  for (const f of ['notar', 'gest', 'makler', 'fk_p', 'ek_p', 'euribor', 'margeB', 'ek_r', 'halt', 'glo_m'] as const) {
    k[f] = zahl(ausgelesen[f]) ?? standard[f];
  }
  k.rp_pct = zahl(ausgelesen.rp_pct) ?? zahl(ausgelesen.rp) ?? standard.rp_pct;
  return k;
}

/**
 * Speichern (ewFinalize). Bewusste Korrektur: die alte App schrieb `+wert || standard` – eine eingegebene 0
 * (z. B. 0 % Maklerprovision) wurde still zum Standard. Der Neubau übernimmt 0; nur leere Felder werden Standard.
 */
export function wizardKalkSpeichern(werte: WizardKalk, standard: KalkStandard): Record<string, number> {
  const v = (x: number | null | undefined, s: number) => (typeof x === 'number' && Number.isFinite(x) ? x : s);
  return {
    kaufpreis: v(werte.kaufpreis, 0),
    notar: v(werte.notar, standard.notar), gest: v(werte.gest, standard.gest), makler: v(werte.makler, standard.makler),
    fk_p: v(werte.fk_p, standard.fk_p), ek_p: v(werte.ek_p, standard.ek_p), euribor: v(werte.euribor, standard.euribor),
    margeB: v(werte.margeB, standard.margeB), ek_r: v(werte.ek_r, standard.ek_r), halt: v(werte.halt, standard.halt),
    rp_pct: v(werte.rp_pct, standard.rp_pct), glo_m: v(werte.glo_m, standard.glo_m),
  };
}

/**
 * Deal-Einheiten aus den Exposé-Einheiten. Bewusste Korrektur: die alte App schrieb nur das Altformat
 * `fl_ist/fl_soll/mi_soll`, das die Ankaufskalkulation nicht liest (Fläche fehlte bei jedem importierten Deal).
 * Der Neubau setzt `flaeche` (Kalkulation) und behält die Altfelder.
 */
export function dealEinheitenAusExpose(einheiten: readonly ExposeEinheit[] | undefined, renditeStandard: number) {
  return (einheiten ?? []).map((e, sort) => ({
    typ: e.typ || 'Wohnung',
    lage: e.lage || '',
    zimmer: +(e.zimmer ?? 0) || 0,
    flaeche: +(e.flaeche ?? 0) || 0,
    mieteIst: +(e.kaltmiete ?? 0) || 0,
    flaecheIst: +(e.flaeche ?? 0) || 0,
    flaecheSoll: +(e.flaeche ?? 0) || 0,
    mieteSoll: +(e.kaltmiete ?? 0) || 0,
    renditeK: renditeStandard,
    sort,
  }));
}
