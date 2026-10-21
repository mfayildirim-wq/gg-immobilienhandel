/**
 * Makler-Recherche (21.10.2026): Angaben der Makler mit ihrer Firmen-Webseite und dem ImmoScout24-Profil abgleichen.
 * Neu gegenüber der alten App. Hier stehen nur die Regeln: woher die Webseite kommt, wie die ImmoScout-Adresse aus dem
 * Firmennamen entsteht, welche Funde ein Vorschlag werden und was ein Lauf ungefähr kostet. Lesen und KI: @gg/integrations.
 */
import { telefonSchluessel } from './kontakte.ts';
import { unternehmenDomain } from './unternehmen.ts';

/** Woher eine Adresse stammt — steht in der Tabelle unter dem Link. */
export type RechercheQuelle = 'bekannt' | 'email' | 'firmenname' | 'ki' | 'hand';
export const RECHERCHE_QUELLEN: Record<RechercheQuelle, string> = {
  bekannt: 'bekannt', email: 'aus E-Mail', firmenname: 'aus Firmenname', ki: 'KI-Websuche', hand: 'von Hand',
};

/** wartet/laeuft nur während eines Laufs; danach einer der übrigen. */
export type RechercheStatus = 'wartet' | 'laeuft' | 'gefunden' | 'nicht_genannt' | 'nichts_gefunden' | 'fehler' | 'abgebrochen';
export const RECHERCHE_STATUS: Record<RechercheStatus, string> = {
  wartet: 'wartet', laeuft: 'läuft', gefunden: 'gefunden', nicht_genannt: 'nicht mehr dort?', nichts_gefunden: 'nichts gefunden',
  fehler: 'Fehler', abgebrochen: 'abgebrochen',
};

/** Felder, die die Recherche vorschlagen kann. Firma-Felder gehören dem Unternehmen (ohne Unternehmen: Altfelder am Makler). */
export const RECHERCHE_FELDER = {
  makler: { anrede: 'Anrede', position: 'Position', tel: 'Telefon', mobil: 'Mobil', festnetz: 'Festnetz', email: 'E-Mail', firma: 'Firma' },
  unternehmen: { webseite: 'Webseite', strasse: 'Straße', plz: 'PLZ', ort: 'Ort', telefonZentrale: 'Telefon Zentrale', emailZentrale: 'E-Mail Zentrale', fax: 'Fax' },
} as const;
export type RechercheZiel = keyof typeof RECHERCHE_FELDER;
export type RechercheFeld = { [Z in RechercheZiel]: keyof (typeof RECHERCHE_FELDER)[Z] }[RechercheZiel];
/** Nur mit Unternehmen möglich (kein Altfeld am Makler). */
const NUR_MIT_UNTERNEHMEN = new Set(['telefonZentrale', 'emailZentrale', 'fax']);

/** Ein Wert, den die Auswertung auf einer Seite gefunden hat. */
export interface RechercheFund { ziel: RechercheZiel; feld: string; wert: string; quelle: string }

export interface RechercheVorschlag {
  ziel: RechercheZiel; feld: string; alt: string | null; neu: string; quelle: string;
  entscheidung: 'uebernommen' | 'verworfen' | null; entschiedenAm: string | null;
}

/** Webseite als aufrufbare Adresse („www.x.de“ → „https://www.x.de“); ohne Host mit Punkt: null. */
export function webseiteAlsUrl(webseite: string | null | undefined): string | null {
  const roh = (webseite ?? '').trim();
  if (!roh) return null;
  const mitSchema = /^https?:\/\//i.test(roh) ? roh : `https://${roh.replace(/^\/+/, '')}`;
  try {
    const u = new URL(mitSchema);
    return u.hostname.includes('.') ? u.href : null;
  } catch {
    return null;
  }
}

/** Die Webseite, mit der ein Lauf beginnt: gespeicherter Stand, sonst bekannt (Unternehmen/Makler), sonst aus der E-Mail-Domain. */
export function rechercheWebseite(stand: { webseite?: string | null; webseiteQuelle?: string | null } | null, bekannt: string | null | undefined, email: string | null | undefined): { url: string; quelle: RechercheQuelle } | null {
  const gespeichert = webseiteAlsUrl(stand?.webseite);
  if (gespeichert) return { url: gespeichert, quelle: (stand?.webseiteQuelle as RechercheQuelle) || 'bekannt' };
  const b = webseiteAlsUrl(bekannt);
  if (b) return { url: b, quelle: 'bekannt' };
  const domain = email?.includes('@') ? unternehmenDomain(null, email) : null;
  return domain ? { url: `https://${domain}/`, quelle: 'email' } : null;
}

/** ImmoScout24-Anbieterprofil aus dem Firmennamen: „Dennis Teuscher Immobilien“ → …/anbieter/profil/dennis-teuscher-immobilien. */
export function immoscoutProfilAusFirma(firma: string | null | undefined): string | null {
  const slug = (firma ?? '').trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length >= 3 ? `https://www.immobilienscout24.de/anbieter/profil/${slug}` : null;
}

export const istImmoscoutProfil = (url: string | null | undefined) => /^https:\/\/www\.immobilienscout24\.de\/anbieter\/profil\/[a-z0-9-]+\/?$/i.test(url ?? '');

const leer = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
const schluessel = (feld: string, v: string) => {
  if (['tel', 'mobil', 'festnetz', 'telefonZentrale', 'fax'].includes(feld)) return telefonSchluessel(v);
  if (feld === 'webseite') return unternehmenDomain(v) ?? v.trim().toLowerCase();
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
};

/**
 * Funde → Vorschläge. Ein Fund wird kein Vorschlag, wenn
 *   • er leer ist oder dem Wert schon entspricht (Telefon ziffernweise, Webseite nach Domain, Text ohne Groß/Klein),
 *   • eine Telefonnummer schon in einem anderen Telefonfeld des Maklers steht,
 *   • er früher verworfen wurde (gleiches Feld, gleicher Wert),
 *   • er ein reines Unternehmensfeld ist und der Makler kein Unternehmen hat,
 *   • er eine Firma ist und der Makler schon eine hat (sonst wechselte er das Unternehmen).
 * Je Feld zählt der erste Fund. Übernommen wird nie von allein — nur per Klick.
 */
export function rechercheVorschlaege(
  makler: Record<string, unknown>,
  unternehmen: Record<string, unknown> | null,
  funde: RechercheFund[],
  verworfen: { ziel: string; feld: string; neu: string }[] = [],
): RechercheVorschlag[] {
  const vorschlaege: RechercheVorschlag[] = [];
  const gesehen = new Set<string>();
  const telefone = ['tel', 'mobil', 'festnetz'].map((f) => makler[f]).filter((v): v is string => !leer(v)).map((v) => telefonSchluessel(v));
  for (const f of funde) {
    const felder = RECHERCHE_FELDER[f.ziel] as Record<string, string> | undefined;
    if (!felder?.[f.feld] || leer(f.wert)) continue;
    if (f.ziel === 'unternehmen' && !unternehmen && NUR_MIT_UNTERNEHMEN.has(f.feld)) continue;
    const id = `${f.ziel}.${f.feld}`;
    if (gesehen.has(id)) continue;
    const neu = f.wert.trim();
    const quelleWerte = f.ziel === 'unternehmen' ? (unternehmen ?? makler) : makler;
    const alt = leer(quelleWerte[f.feld]) ? null : String(quelleWerte[f.feld]).trim();
    const k = schluessel(f.feld, neu);
    if (alt && schluessel(f.feld, alt) === k) continue;
    // Firma nur, wo noch keine steht: ein anderer Name verschöbe den Makler in ein anderes Unternehmen
    if (f.ziel === 'makler' && f.feld === 'firma' && alt) continue;
    if (f.ziel === 'makler' && ['tel', 'mobil', 'festnetz'].includes(f.feld) && telefone.includes(k)) continue;
    if (verworfen.some((v) => v.ziel === f.ziel && v.feld === f.feld && schluessel(f.feld, v.neu) === k)) continue;
    gesehen.add(id);
    vorschlaege.push({ ziel: f.ziel, feld: f.feld, alt, neu, quelle: f.quelle, entscheidung: null, entschiedenAm: null });
  }
  return vorschlaege;
}

/** Richtwerte je Makler in Euro: Auswerten der gelesenen Seiten (kleinstes Modell) und, wenn angehakt, die KI-Websuche. */
export const RECHERCHE_KOSTEN = { auswerten: 0.003, kiSuche: 0.03, warnungAb: 5 } as const;

/**
 * Kostenschätzung für den Start-Dialog. Ausgewertet wird jeder Makler mit Quelle (Webseite oder ImmoScout); die KI-Websuche
 * nur für die ohne Webseite — in der Schätzung alle ohne, tatsächlich nur die, bei denen auch ImmoScout nichts findet.
 */
export function rechercheKostenSchaetzung(z: { mitWebseite: number; ohneWebseite: number }, mitKi: boolean) {
  const auswerten = (z.mitWebseite + z.ohneWebseite) * RECHERCHE_KOSTEN.auswerten;
  const kiSuche = mitKi ? z.ohneWebseite * RECHERCHE_KOSTEN.kiSuche : 0;
  const euro = Math.round((auswerten + kiSuche) * 100 + 1e-6) / 100;
  return { euro, kiSucheMakler: mitKi ? z.ohneWebseite : 0, warnung: euro >= RECHERCHE_KOSTEN.warnungAb };
}
