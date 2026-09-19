/* eslint-disable @typescript-eslint/no-explicit-any -- Einträge im Altformat wie in der alten App */
/**
 * Globale Suche über Objekte, Deals und Makler.
 * Nach gg-immohandel src/lib/search.ts globalSearchExec (ersetzte dort mkQuickSearch als primäre Suche).
 */

export interface SucheTreffer { id: string; titel: string; zusatz: string }
export interface SucheErgebnis { objekte: SucheTreffer[]; deals: SucheTreffer[]; makler: SucheTreffer[]; gesamt: number }

export const SUCHE_MINDESTLAENGE = 2;
export const SUCHE_HINWEIS_KURZ = 'Mindestens 2 Zeichen…';
export const SUCHE_HINWEIS_LEER = 'Suchbegriff eingeben…';
export const SUCHE_HINWEIS_OHNE_TREFFER = 'Kein Treffer';
/** Höchstens fünf Treffer je Bereich (slice(0,5) wie alt). */
export const SUCHE_GRENZE = 5;

/** Null, solange weniger als zwei Zeichen eingegeben sind (alt: „Mindestens 2 Zeichen…“). */
export function globaleSuche(objekte: any[], deals: any[], makler: any[], eingabe: string): SucheErgebnis | null {
  const query = (eingabe ?? '').trim().toLowerCase();
  if (query.length < SUCHE_MINDESTLAENGE) return null;
  const queryDigits = query.replace(/[^\d]/g, '');

  const mk = makler.filter((m: any) =>
    (m.name || '').toLowerCase().includes(query) ||
    (m.firma || '').toLowerCase().includes(query) ||
    (m.email || '').toLowerCase().includes(query) ||
    (queryDigits.length >= 3 && m.tel && m.tel.replace(/[^\d]/g, '').includes(queryDigits)),
  ).slice(0, SUCHE_GRENZE);

  const dl = deals.filter((d: any) =>
    `${d.adresse || ''} ${d.hausnr || ''}`.toLowerCase().includes(query) ||
    (d.stadt || '').toLowerCase().includes(query) ||
    (d.maklerName || '').toLowerCase().includes(query) ||
    (d.plz || '').includes(query),
  ).slice(0, SUCHE_GRENZE);

  const ob = objekte.filter((o: any) =>
    (o.strasse || '').toLowerCase().includes(query) ||
    (o.hausnr || '').toLowerCase().includes(query) ||
    (o.stadt || '').toLowerCase().includes(query) ||
    (o.plz || '').includes(query),
  ).slice(0, SUCHE_GRENZE);

  return {
    objekte: ob.map((o: any) => ({ id: o.id, titel: `${o.strasse || ''} ${o.hausnr || ''}`, zusatz: `${o.plz || ''} ${o.stadt || ''}` })),
    deals: dl.map((d: any) => ({ id: d.id, titel: `${d.adresse || '–'} ${d.hausnr || ''}`, zusatz: `${d.stadt || ''} · ${d.maklerName || ''}` })),
    makler: mk.map((m: any) => ({ id: m.id, titel: m.name || '–', zusatz: `${m.firma || ''}${m.tel ? ` · ${m.tel}` : ''}` })),
    gesamt: ob.length + dl.length + mk.length,
  };
}
