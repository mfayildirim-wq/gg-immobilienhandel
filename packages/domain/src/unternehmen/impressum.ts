/**
 * Firmendaten aus dem Impressum (Baustein B, 17.10.2026, Protokoll 32). Hier stehen die reinen Regeln: HTML zu Text,
 * den Impressum-Link auf einer Seite finden, Felder per Regel herauslesen, Regel- und KI-Ergebnis zusammenführen und
 * das Ergebnis mit dem gespeicherten Unternehmen vergleichen. Abruf und KI-Aufruf liegen in `@gg/integrations`
 * (`impressum.ts`), die Übernahme in die Datenbank im API-Service `firmendaten.ts`.
 *
 * Entscheidung des Auftraggebers (17.10.): Unternehmensfelder dürfen leere Felder automatisch füllen, nie überschreiben;
 * Abweichungen zu gefüllten Feldern sind Vorschläge.
 */
import { rechtsformAusName, rechtsformTreffer } from './index.ts';

/** Die Felder, die ein Impressum für ein Unternehmen liefern kann — gleich benannt wie die Spalten von `fach.unternehmen`. */
export interface FirmenFelder {
  name: string | null;
  rechtsform: string | null;
  strasse: string | null;
  plz: string | null;
  ort: string | null;
  tel: string | null;
  fax: string | null;
  email: string | null;
}

export const FIRMEN_FELDER = ['name', 'rechtsform', 'strasse', 'plz', 'ort', 'tel', 'fax', 'email'] as const satisfies readonly (keyof FirmenFelder)[];
export type FirmenFeld = (typeof FIRMEN_FELDER)[number];

export const FIRMEN_FELD_LABEL: Record<FirmenFeld, string> = {
  name: 'Name', rechtsform: 'Rechtsform', strasse: 'Straße', plz: 'PLZ', ort: 'Ort', tel: 'Telefon', fax: 'Fax', email: 'E-Mail',
};

export const leereFirmenFelder = (): FirmenFelder => ({ name: null, rechtsform: null, strasse: null, plz: null, ort: null, tel: null, fax: null, email: null });

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', euro: '€', sect: '§', middot: '·', ndash: '–', mdash: '—', hellip: '…', copy: '©' };

/** HTML-Entitäten auflösen (benannte, dezimale, hexadezimale). */
export function entitaetenAufloesen(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (ganz, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ganz;
    }
    return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? ganz;
  });
}

/**
 * HTML zu lesbarem Text: Skripte, Stile und Kommentare weg, Block-Elemente und `<br>` werden Zeilenumbrüche,
 * Entitäten aufgelöst, Leerraum zusammengezogen. Zeilen bleiben erhalten — die Regeln arbeiten zeilenweise.
 */
export function htmlZuText(html: string): string {
  const ohne = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|li|ul|ol|tr|td|th|h[1-6]|section|article|header|footer|address|dt|dd|dl|table|blockquote|nav|main|aside|figure|figcaption|pre)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return entitaetenAufloesen(ohne)
    .replace(/ /g, ' ')
    .split('\n')
    .map((z) => z.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .filter((z, i, arr) => z || (i > 0 && arr[i - 1]))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Link-Text und Adresse eines Impressums; „Imprint“, „Legal Notice“ und „Anbieterkennzeichnung“ zählen mit. */
const IMPRESSUM_LINK = /impressum|imprint|legal[\s-]*notice|anbieterkennzeichnung|rechtliche[\s-]*hinweise/i;

/**
 * Den Impressum-Link einer Seite finden — Linktext oder Adresse. Relative Adressen werden gegen `basis` aufgelöst;
 * `mailto:`, `tel:` und Anker bleiben außen vor. Null, wenn keiner da ist.
 */
export function impressumLinkFinden(html: string, basis: string): string | null {
  const treffer: { url: string; imText: boolean }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    const href = entitaetenAufloesen((m[1] ?? m[2] ?? m[3] ?? '').trim());
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    const text = htmlZuText(m[4] ?? '');
    const imText = IMPRESSUM_LINK.test(text);
    if (!imText && !IMPRESSUM_LINK.test(href)) continue;
    let url: string;
    try { url = new URL(href, basis).toString(); } catch { continue; }
    if (!/^https?:/i.test(url)) continue;
    treffer.push({ url, imText });
  }
  // Linktext „Impressum“ geht vor einer Adresse, die nur so heißt (z. B. „/impressum-datenschutz“ mit anderem Text)
  return (treffer.find((t) => t.imText) ?? treffer[0])?.url ?? null;
}

/** Spricht der Text wie ein Impressum? Sonst war es die falsche Seite (Startseite mit 200, Kontaktformular …). */
export function siehtNachImpressumAus(text: string): boolean {
  return /impressum|imprint|angaben gem[äa]ß|anbieterkennzeichnung|§\s*5\s*(tmg|ddg)|vertreten durch|vertretungsberechtigt|handelsregister|registergericht|umsatzsteuer|ust[-.\s]*id|gesch[äa]ftsf[üu]hr/i.test(text);
}

const TELEFON_WERT = /([+(]?\d[\d\s/().‑-]{5,}\d)/;
const TEL_ZEILE = /(?:^|\b)(?:tel(?:efon)?|fon|phone|telephone|rufnummer|zentrale)\b\s*\.?\s*[:.]?\s*/i;
const FAX_ZEILE = /(?:^|\b)(?:fax|telefax)\b\s*\.?\s*[:.]?\s*/i;
/** „name@firma.de“ auch als „name(at)firma.de“, „name [at] firma [dot] de“, „name@firma(dot)de“. */
const EMAIL = /([a-z0-9._%+-]+)\s*(?:@|\(at\)|\[at\]|\{at\}|\s+at\s+|&#64;)\s*([a-z0-9.-]+(?:\s*(?:\(dot\)|\[dot\])\s*[a-z0-9-]+)*)\s*(?:\.|\(dot\)|\[dot\])\s*([a-z]{2,})/i;
const PLZ_ORT = /(?:^|\b)(?:[dD]|[dD][eE])?[-\s]?(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.]+(?:[ -](?:am|an|der|im|in|bei|ob|unter|vor)\b)?(?:[ -][A-ZÄÖÜ(][A-Za-zÄÖÜäöüß.)]*)*)/;
const STRASSE = /^(?:[A-ZÄÖÜ][\wÄÖÜäöüß.'-]*\s?){1,5}(?:str(?:a(?:ß|ss)e)?\.?|weg|platz|allee|gasse|ring|damm|ufer|markt|chaussee|promenade|steig|pfad|hof|graben|berg|tor|anger|wall|zeile|kai|brücke|bruecke|park|carr[ée]e|dorf|höhe|hoehe)?\s+\d{1,4}\s?[a-zA-Z]?(?:\s?[-–/]\s?\d{1,4}\s?[a-zA-Z]?)?(?:\s*,?\s*(?:[A-Za-zÄÖÜäöüß.]*\s*\d{0,2}\s*(?:OG|EG|Stock|Etage|Haus|Geb(?:äude)?)\.?\s*\w*))?\.?$/;

function telefonBereinigen(roh: string): string | null {
  const t = roh.replace(/‑/g, '-').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '');
  const ziffern = t.replace(/\D/g, '');
  return ziffern.length >= 6 && ziffern.length <= 16 ? t : null;
}

function emailAus(text: string): string | null {
  const m = EMAIL.exec(text);
  if (!m) return null;
  const domain = m[2]!.replace(/\s*(?:\(dot\)|\[dot\])\s*/gi, '.').replace(/\s+/g, '');
  const adresse = `${m[1]}@${domain}.${m[3]}`.toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(adresse) ? adresse : null;
}

/** Zeilen, die eher den Betreiber als eine Behörde oder den Webdesigner nennen, zählen nicht als Firmenname. */
const KEIN_FIRMENNAME = /aufsichtsbeh|kammer|amtsgericht|registergericht|finanzamt|berufsbezeichnung|umsetzung|realisierung|konzept|design|agentur|programmierung|webdesign|gestaltung|erstellt von|powered by|quelle|streitschlichtung|verbraucherschlichtung|plattform|haftung|urheberrecht|datenschutz|impressum|inhaltlich verantwortlich/i;

/**
 * Felder per Regel aus dem Impressum-Text: Name (erste kurze Zeile mit Rechtsform), Straße + PLZ/Ort (das erste Paar
 * aus Straßenzeile und folgender Ortszeile), Telefon/Fax/E-Mail an ihren Bezeichnungen. Was die Regel nicht sicher
 * findet, bleibt null — die KI füllt es, oder es bleibt leer.
 */
export function impressumFelder(text: string): FirmenFelder {
  const f = leereFirmenFelder();
  const zeilen = text.split('\n').map((z) => z.trim()).filter(Boolean);

  for (const z of zeilen) {
    if (z.length > 120 || KEIN_FIRMENNAME.test(z)) continue;
    const ohneVorsatz = z.replace(/^(?:firma|unternehmen|betreiber|anbieter|herausgeber|verantwortlich(?:er)?|dienstanbieter|angaben gem[äa]ß\s*§\s*5\s*(?:tmg|ddg))\s*[:：]?\s*/i, '').replace(/\s+/g, ' ').trim();
    const t = rechtsformTreffer(ohneVorsatz);
    if (!t) continue;
    // der Name endet mit der Rechtsform; was danach steht („, vertreten durch …“), gehört nicht dazu
    const name = ohneVorsatz.slice(0, t.index + t.laenge).replace(/[,;:]+$/, '').trim();
    if (name.length > 90 || !/[a-zäöüß]/i.test(name.slice(0, t.index))) continue;
    f.name = name; f.rechtsform = t.form;
    break;
  }

  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i]!.replace(/^(?:anschrift|adresse|sitz|hausanschrift|postanschrift|b[üu]roanschrift)\s*[:：]?\s*/i, '');
    // „Musterstraße 12, 70173 Stuttgart“ in einer Zeile
    const inEiner = /^(.+?\d{1,4}\s?[a-zA-Z]?)\s*[,|·]\s*(?:[dD]|[dD][eE])?[-\s]?(\d{5})\s+(.+)$/.exec(z);
    if (inEiner && STRASSE.test(inEiner[1]!.trim())) { f.strasse = inEiner[1]!.trim(); f.plz = inEiner[2]!; f.ort = ortBereinigen(inEiner[3]!); break; }
    const plzOrt = PLZ_ORT.exec(z);
    if (!plzOrt || !/^(?:d|de)?[-\s]?\d{5}\s/i.test(z)) continue;
    const davor = zeilen[i - 1] ?? '';
    const strasseZeile = davor.replace(/^(?:anschrift|adresse|sitz|hausanschrift|postanschrift)\s*[:：]?\s*/i, '').trim();
    if (!STRASSE.test(strasseZeile) || KEIN_FIRMENNAME.test(strasseZeile)) continue;
    f.strasse = strasseZeile; f.plz = plzOrt[1]!; f.ort = ortBereinigen(plzOrt[2]!);
    break;
  }

  for (const z of zeilen) {
    if (!f.tel && TEL_ZEILE.test(z) && !FAX_ZEILE.test(z.slice(0, 5))) {
      const rest = z.slice(z.search(TEL_ZEILE)).replace(TEL_ZEILE, '');
      const m = TELEFON_WERT.exec(rest.split(/\bfax\b|\btelefax\b|\bmobil\b|\be-?mail\b/i)[0] ?? '');
      if (m) f.tel = telefonBereinigen(m[1]!);
    }
    if (!f.fax && FAX_ZEILE.test(z)) {
      const rest = z.slice(z.search(FAX_ZEILE)).replace(FAX_ZEILE, '');
      const m = TELEFON_WERT.exec(rest.split(/\btel(?:efon)?\b|\bmobil\b|\be-?mail\b/i)[0] ?? '');
      if (m) f.fax = telefonBereinigen(m[1]!);
    }
    if (!f.email) f.email = emailAus(z);
  }
  return f;
}

function ortBereinigen(s: string): string {
  return s.replace(/\s*[,;|·(].*$/, '').replace(/\b(?:germany|deutschland)\b.*$/i, '').replace(/\s+/g, ' ').trim();
}

/**
 * Regel und KI zusammenführen: die KI liest den Namen und die Rechtsform aus dem Zusammenhang (Vorrang), die Regel füllt,
 * was die KI nicht hat. Rechtsform notfalls aus dem Namen. Ohne KI gilt die Regel allein.
 */
export function firmenFelderZusammenfuehren(regel: FirmenFelder, ki: Partial<FirmenFelder> | null | undefined): FirmenFelder {
  const f = leereFirmenFelder();
  for (const k of FIRMEN_FELDER) {
    const a = feldBereinigen(k, ki?.[k]);
    const b = feldBereinigen(k, regel[k]);
    f[k] = a ?? b;
  }
  if (!f.rechtsform && f.name) f.rechtsform = rechtsformAusName(f.name);
  return f;
}

function feldBereinigen(k: FirmenFeld, v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t || /^(null|unbekannt|k\.?\s?a\.?|n\/a|-|–)$/i.test(t)) return null;
  if (k === 'email') return emailAus(t) ?? (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t) ? t.toLowerCase() : null);
  if (k === 'tel' || k === 'fax') return telefonBereinigen(t);
  if (k === 'plz') return /^\d{5}$/.test(t) ? t : null;
  return t.length <= 200 ? t : null;
}

/** Vergleichsform: Telefon nur Ziffern (führende 0049/+49 → 0), Text klein und ohne Leerraum-Unterschiede. */
export function firmenFeldVergleichswert(k: FirmenFeld, v: string | null | undefined): string {
  const t = (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return '';
  if (k === 'tel' || k === 'fax') return t.replace(/\D/g, '').replace(/^(0049|49)0?/, '0');
  if (k === 'strasse') return t.replace(/stra(ß|ss)e/g, 'str.').replace(/str\.?\b/g, 'str.').replace(/[.,]/g, '').replace(/\s+/g, '');
  return t.replace(/[.,;:]+$/, '');
}

export interface FirmenAbweichung { feld: FirmenFeld; aktuell: string; ermittelt: string }

export interface FirmenVergleich {
  /** Felder, die beim Unternehmen leer sind und aus dem Impressum gefüllt werden können */
  leer: FirmenFeld[];
  /** Felder, die gefüllt sind und im Impressum anders stehen — Vorschläge, nie automatisch */
  abweichend: FirmenAbweichung[];
  /** Felder, die (in Vergleichsform) übereinstimmen */
  gleich: FirmenFeld[];
}

/** Ermitteltes gegen das gespeicherte Unternehmen: leere Felder füllen, gefüllte vergleichen. */
export function firmenFelderVergleichen(aktuell: Partial<Record<FirmenFeld, string | null>>, ermittelt: FirmenFelder): FirmenVergleich {
  const v: FirmenVergleich = { leer: [], abweichend: [], gleich: [] };
  for (const k of FIRMEN_FELDER) {
    const neu = ermittelt[k];
    if (!neu) continue;
    const alt = aktuell[k] ?? null;
    if (!alt || !alt.trim()) { v.leer.push(k); continue; }
    if (firmenFeldVergleichswert(k, alt) === firmenFeldVergleichswert(k, neu)) v.gleich.push(k);
    else v.abweichend.push({ feld: k, aktuell: alt, ermittelt: neu });
  }
  return v;
}

/**
 * Die Adressen, unter denen ein Impressum üblicherweise liegt — in Prüfreihenfolge; die Startseiten zum Schluss (Link suchen).
 * Ganz am Ende die Startseite über `http://`: manche Hosts (z. B. Sparkassen-Kurzdomains) nehmen auf 443 nichts an und leiten
 * nur über HTTP auf ihre eigentliche Adresse um — der Umleitung wird gefolgt, das Ziel noch einmal geprüft.
 */
export function impressumKandidaten(domain: string): string[] {
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const hosts = d.startsWith('www.') ? [d, d.slice(4)] : [d, `www.${d}`];
  const pfade = ['/impressum', '/impressum/', '/impressum.html', '/imprint', '/impressum.php', '/kontakt/impressum', '/de/impressum', '/legal-notice'];
  const aus: string[] = [];
  for (const h of hosts) for (const p of pfade) aus.push(`https://${h}${p}`);
  for (const h of hosts) aus.push(`https://${h}/`);
  for (const h of hosts) aus.push(`http://${h}/`);
  return aus;
}
