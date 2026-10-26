/**
 * Gedächtnis (24.10.2026): was gg dem zentralen Gedächtnis-Dienst meldet und unter welchem Bezug.
 *
 * Ein Ereignis ersetzt im Dienst den letzten Eintrag gleicher Art am selben Bezug. Deshalb beschreibt jeder Text den
 * ganzen aktuellen Stand seiner Art (alle Kontaktdaten, nicht nur die geänderte Nummer) — sonst ginge mit dem
 * Ersetzen Wissen verloren. Kommentare haben je Kommentar eine eigene Art und ersetzen nichts.
 */

/** Alles, was in gg einen eigenen Dialog hat, hat auch ein Gedächtnis (26.10.2026: KI-Leiste, vorher nur Deal und Makler). */
export const GEDAECHTNIS_ARTEN = ['deal', 'makler', 'objekt', 'projekt', 'kundenkalkulation', 'vertriebsliste', 'begleitschein'] as const;
export type GedaechtnisArt = (typeof GEDAECHTNIS_ARTEN)[number];
export const istGedaechtnisArt = (a: unknown): a is GedaechtnisArt => GEDAECHTNIS_ARTEN.includes(a as GedaechtnisArt);

/** Bezug im Gedächtnis: `gg:deal:<id>`, `gg:makler:<id>`, `gg:objekt:<id>` … */
export const gedaechtnisBezug = (art: GedaechtnisArt, id: string) => `gg:${art}:${id}`;

const liste = (teile: (string | null | undefined | false)[]) => teile.filter((t): t is string => Boolean(t && t.trim())).join(', ');

export interface MaklerGedaechtnisSicht {
  name: string | null; vorname?: string | null; nachname?: string | null; firma: string | null;
  tel: string | null; mobil?: string | null; festnetz?: string | null; email: string | null;
  prio: string | null; kontaktFrequenz?: string | null; zustaendig?: string | null; hinweis?: string | null; mailsAbgemeldet?: boolean | null;
}

export const maklerAnzeigename = (m: Pick<MaklerGedaechtnisSicht, 'name' | 'vorname' | 'nachname'>) =>
  [m.vorname, m.nachname].filter(Boolean).join(' ').trim() || (m.name ?? '').trim() || 'unbekannt';

const wer = (m: MaklerGedaechtnisSicht) => `Makler ${maklerAnzeigename(m)}${m.firma ? ` (${m.firma})` : ''}`;

/** Felder, deren Änderung den Kontakt- bzw. Betreuungsstand neu meldet. */
export const MAKLER_KONTAKT_FELDER = ['tel', 'mobil', 'festnetz', 'email', 'name', 'vorname', 'nachname', 'firma'] as const;
export const MAKLER_BETREUUNG_FELDER = ['prio', 'kontaktFrequenz', 'zustaendig', 'hinweis', 'mailsAbgemeldet'] as const;

export const gedaechtnisBetrifft = (geaendert: Record<string, unknown>, felder: readonly string[]) => felder.some((f) => geaendert[f] !== undefined);

/** Ganzer Kontaktstand, `null` wenn nichts bekannt ist. */
export function maklerKontaktText(m: MaklerGedaechtnisSicht): string | null {
  const daten = liste([m.tel && `Telefon ${m.tel}`, m.mobil && `Mobil ${m.mobil}`, m.festnetz && `Festnetz ${m.festnetz}`, m.email && `E-Mail ${m.email}`]);
  return daten ? `${wer(m)}: ${daten}.` : null;
}

/** Ganzer Betreuungsstand, `null` wenn nichts gesetzt ist. */
export function maklerBetreuungText(m: MaklerGedaechtnisSicht): string | null {
  const daten = liste([
    m.prio && `Priorität ${m.prio}`, m.kontaktFrequenz && `Kontakt-Rhythmus ${m.kontaktFrequenz}`,
    m.zustaendig && `zuständig ${m.zustaendig}`, m.mailsAbgemeldet && 'von allen E-Mails abgemeldet', m.hinweis && `Hinweis: ${m.hinweis}`,
  ]);
  return daten ? `${wer(m)}: ${daten}.` : null;
}

export function dealStatusText(d: { titel: string; status: string; grund?: string | null }): string {
  return `Deal ${d.titel}: Status ${d.status}${d.grund?.trim() ? ` (Grund: ${d.grund.trim()})` : ''}.`;
}

export function dealKommentarText(d: { titel: string; text: string }): string {
  return `Kommentar zum Deal ${d.titel}: ${d.text.trim()}`;
}
