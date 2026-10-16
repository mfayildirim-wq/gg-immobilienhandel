// Kartendienst für die Lagebeschreibung: Adresse → Stadtteil (OpenStreetMap über Nominatim).
// Welcher Treffer gilt, entscheidet @gg/domain (verortungWaehlen); hier nur Abruf und Umformung.
// Nutzungsregeln von nominatim.openstreetmap.org: höchstens eine Anfrage je Sekunde, eine Kennung im User-Agent,
// Ergebnisse zwischenspeichern (macht die API: Tabelle geo_verortungen).
import type { Anschrift, Verortung } from '@gg/domain';

/* eslint-disable @typescript-eslint/no-explicit-any -- Antwort eines Fremddienstes */

export interface Geocoder {
  /** Treffer zur Adresse, bester zuerst. Wirft bei Netz- und Dienstfehlern (die API speichert dann nichts zwischen). */
  kandidaten(a: Anschrift): Promise<Verortung[]>;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Nominatim-Antwort (format=jsonv2, addressdetails=1) → Verortungen. In Stuttgart steht der Stadtbezirk in `suburb`
 * („Vaihingen“), der Stadtteil in `neighbourhood` („Vaihingen-Mitte“); in Leonberg der Ortsteil in `suburb`
 * („Eltingen“), das Wohngebiet in `quarter`. Wo `suburb` fehlt, springen `city_district` und `borough` ein.
 */
export function nominatimAuswerten(json: unknown): Verortung[] {
  if (!Array.isArray(json)) return [];
  return json.map((t: any) => {
    const a = t?.address ?? {};
    return {
      stadtteil: text(a.suburb) || text(a.city_district) || text(a.borough),
      viertel: text(a.quarter) || text(a.neighbourhood),
      ort: text(a.city) || text(a.town) || text(a.village) || text(a.municipality),
      plz: text(a.postcode),
    };
  });
}

let naechsterSlot = 0;
/** Höchstens eine Anfrage je Sekunde (je laufender Instanz) — eine zweite wartet, statt den Dienst zu verärgern. */
async function warteAufSlot(abstandMs: number) {
  const jetzt = Date.now();
  const start = Math.max(jetzt, naechsterSlot);
  naechsterSlot = start + abstandMs;
  if (start > jetzt) await new Promise((r) => setTimeout(r, start - jetzt));
}

export interface NominatimOptionen {
  /** User-Agent: wer fragt (Pflicht laut Nutzungsregeln). */
  kennung: string;
  basis?: string;
  zeitlimitMs?: number;
  abstandMs?: number;
  abruf?: typeof fetch;
}

export function nominatimGeocoder({ kennung, basis = 'https://nominatim.openstreetmap.org', zeitlimitMs = 5000, abstandMs = 1100, abruf = fetch }: NominatimOptionen): Geocoder {
  return {
    async kandidaten(a) {
      const q = new URLSearchParams({
        street: [a.hausnr, a.strasse].map((s) => s.trim()).filter(Boolean).join(' '),
        country: 'de', format: 'jsonv2', addressdetails: '1', limit: '5', 'accept-language': 'de',
      });
      if (a.plz.trim()) q.set('postalcode', a.plz.trim());
      if (a.stadt.trim()) q.set('city', a.stadt.trim());
      await warteAufSlot(abstandMs);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), zeitlimitMs);
      try {
        const resp = await abruf(`${basis}/search?${q}`, { headers: { 'User-Agent': kennung, Accept: 'application/json' }, signal: ctrl.signal });
        if (!resp.ok) throw new Error(`Nominatim ${resp.status}`);
        return nominatimAuswerten(await resp.json());
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
