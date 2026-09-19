/**
 * Propstack (CRM/Bewertung): Feldabbildung zwischen unserem Datenmodell und der Propstack-API.
 * Wörtlich aus gg-immohandel src/lib/propstack.ts (buildPropstackPayload, defaultsFromDealAndEinheit,
 * saveBewertungsDatenToEinheit, propstackUnitUrl).
 */
import { parseNum } from './zahlen.ts';

export const QUALITAET_OPTIONEN = ['einfach', 'normal', 'gehoben', 'luxuriös'] as const;
export type Qualitaet = (typeof QUALITAET_OPTIONEN)[number];

/** Die API erwartet englische Bezeichnungen. */
const QUALITAET_PROPSTACK: Record<Qualitaet, string> = { einfach: 'simple', normal: 'normal', gehoben: 'sophisticated', 'luxuriös': 'luxury' };

export interface BewertungsDaten {
  strasse: string; hausnr: string; plz: string; ort: string; baujahr: string;
  wohnflaeche: string; zimmer: string;
  letzteModernisierung: string; etage: string; etagenzahl: string; balkonFlaeche: string;
  qualitaet: Qualitaet;
}

/** buildPropstackPayload; `statusId` kommt aus den Einstellungen (alt: immo-propstack-status-id). */
export function propstackPayload(d: BewertungsDaten, statusId?: number | null): { property: Record<string, unknown> } {
  const property: Record<string, unknown> = {
    marketing_type: 'BUY', object_type: 'LIVING', rs_type: 'APARTMENT',
    street: d.strasse || undefined, house_number: d.hausnr || undefined, zip_code: d.plz || undefined, city: d.ort || undefined, country: 'DE',
    construction_year: parseInt(d.baujahr) || undefined,
    // parseNum statt parseFloat: „1.250“ sind 1250 m², nicht 1,25 m² — der Wert geht unwiderruflich ins fremde CRM
    living_space: parseNum(d.wohnflaeche) || undefined,
    number_of_rooms: parseNum(d.zimmer) || undefined,
    last_modernization: parseInt(d.letzteModernisierung) || undefined,
    floor: parseInt(d.etage) || undefined,
    number_of_floors: parseInt(d.etagenzahl) || undefined,
    balcony_space: parseNum(d.balkonFlaeche) || undefined,
    furnishing_quality: QUALITAET_PROPSTACK[d.qualitaet] || undefined,
    furnishing_note: d.qualitaet,
  };
  if (statusId) property.property_status_id = statusId;
  for (const k of Object.keys(property)) if (property[k] === undefined) delete property[k];
  return { property };
}

export interface PropstackEinheit {
  flaeche?: number | null; zimmer?: number | null;
  propstack?: { unitId?: string | number | null; letzteModernisierung?: string; etage?: string; etagenzahl?: string; balkonFlaeche?: string; qualitaet?: Qualitaet } | null;
}

/** defaultsFromDealAndEinheit: Adresse aus dem Objekt, Maße aus der Einheit, Individuelles vom letzten Mal. */
export function bewertungVorbelegen(
  objekt: { strasse?: string | null; hausnr?: string | null; plz?: string | null; stadt?: string | null; baujahr?: number | null },
  einheit: PropstackEinheit,
): BewertungsDaten {
  const ps = einheit.propstack ?? {};
  return {
    strasse: (objekt.strasse ?? '').trim(),
    hausnr: (objekt.hausnr ?? '').trim(),
    plz: (objekt.plz ?? '').trim(),
    ort: (objekt.stadt ?? '').trim(),
    baujahr: String(objekt.baujahr ?? ''),
    wohnflaeche: String(einheit.flaeche ?? ''),
    zimmer: String(einheit.zimmer ?? ''),
    letzteModernisierung: String(ps.letzteModernisierung ?? ''),
    etage: String(ps.etage ?? ''),
    etagenzahl: String(ps.etagenzahl ?? ''),
    balkonFlaeche: String(ps.balkonFlaeche ?? ''),
    qualitaet: (ps.qualitaet ?? 'normal') as Qualitaet,
  };
}

/** saveBewertungsDatenToEinheit: die individuellen Werte bleiben an der Einheit, damit die nächste Bewertung sie kennt. */
export const bewertungMerken = (d: BewertungsDaten, unitId?: string | number | null) => ({
  ...(unitId ? { unitId } : {}),
  letzteModernisierung: d.letzteModernisierung, etage: d.etage, etagenzahl: d.etagenzahl,
  balkonFlaeche: d.balkonFlaeche, qualitaet: d.qualitaet,
});

export const propstackUnitUrl = (id: string | number) => `https://crm.propstack.de/app/properties/${encodeURIComponent(String(id))}`;
export const PROPSTACK_STELLPLATZ_HINWEIS = 'Stellplätze können nicht bewertet werden';
