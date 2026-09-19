/**
 * Kundenkalkulation: Vorbelegung aus dem Deal und Bearbeitungsregeln.
 * Aus gg-immohandel `src/modules/kundenkalk/kundenkalk.ts` (Stand 9d693b8): defaultsFromDeal, kkalkUpdateField,
 * applyEK, kkalkSetEKQuick, kkalkSetTranche1Quick, kkalkRenderList (Sortierung).
 */
import { computeKKalk, type KKalkInputs, splitSanierung } from './engine.ts';

/** Standardannahmen „Kundenkalkulation“ in Prozent (alte App: immo-kkalk-defaults). */
export interface KundenkalkStandard {
  notarPct: number;
  grundbuchPct: number;
  grundsteuerPct: number;
  maklerPct: number;
  sonstigePct: number;
  wertsteigerungJaehrlich: number;
  mieterhoehungJaehrlich: number;
  kostensteigerungJaehrlich: number;
  anteilGebaeudeKaufpreis: number;
  afaSatz: number;
  grenzsteuersatz: number;
  betrachtungsdauerJahre: number;
  default_zinssatz: number;
  default_tilgung: number;
  default_fk_anteil_kp: number;
}

export const KUNDENKALK_STANDARD: KundenkalkStandard = {
  notarPct: 1.5, grundbuchPct: 0.5, grundsteuerPct: 5.0, maklerPct: 0, sonstigePct: 0,
  wertsteigerungJaehrlich: 2.0, mieterhoehungJaehrlich: 2.0, kostensteigerungJaehrlich: 0,
  anteilGebaeudeKaufpreis: 70, afaSatz: 2.0, grenzsteuersatz: 42, betrachtungsdauerJahre: 10,
  default_zinssatz: 4.0, default_tilgung: 2.0, default_fk_anteil_kp: 80,
};

export type KundenkalkScope = 'global' | 'aufteiler';

/** Deal-Einheit mit den Feldnamen der alten App; hier gilt Unärplus (`+e.fl`), nicht parseNum. */
export interface KkEinheit {
  id: string;
  typ?: string | null;
  lage?: string | null;
  fl?: number | string | null;
  mi_ist?: number | string | null;
  mi_neu?: number | string | null;
  rend_k?: number | string | null;
  vkp?: number | string | null;
}

const plus = (v: unknown) => +(v as number);

/**
 * Verkaufspreis je Einheit für die Kundenkalkulation. Achtung, Ist-Verhalten: anders als die Ankaufskalkulation
 * nimmt diese Stelle „Miete neu“ auch ohne Manuell-Häkchen (`+e.mi_neu || +e.mi_ist`).
 */
export function kkEinheitVerkaufspreis(e: KkEinheit | null | undefined): number {
  if (e?.vkp) return plus(e.vkp);
  const r = plus(e?.rend_k) || 0;
  const mn = plus(e?.mi_neu) || plus(e?.mi_ist) || 0;
  return r && mn ? Math.round((mn * 12) / (r / 100)) : 0;
}

export interface KundenkalkulationDaten {
  name: string;
  scope: KundenkalkScope;
  einheitId: string | null;
  projektTitel: string;
  wertsteigerungBullets: string[];
  wertsteigerungSichtbar: boolean;
  internNotiz: string;
  kaufpreisWohnung: number;
  kaufpreisStellplatz: number;
  stellplaetzeAnzahl: number;
  stellplaetzeIds: string[];
  objSnapshot: { adresse: string; kaufdatum: string; wohnflaecheGesamt: number; stellplaetzeAnzahl: number; einheitenAnzahl: number };
  inputs: KKalkInputs;
}

/** defaultsFromDeal (+ Stellplatz-Auswahl kkalkStellplatzConfirm). */
export function kundenkalkulationVorbelegen(q: {
  scope: KundenkalkScope;
  einheitId?: string | null;
  stellplatzIds?: readonly string[];
  einheiten: readonly KkEinheit[];
  dealKaufpreis: unknown;
  objekt: { strasse?: string | null; hausnr?: string | null; stadt?: string | null; wohnflaeche?: unknown; angebotspreis?: unknown; stellplaetze?: unknown } | null;
  standard: KundenkalkStandard;
  hinweise: readonly string[];
  heute: string;
}): KundenkalkulationDaten {
  const { scope, einheiten, standard: kkD } = q;
  const obj = q.objekt ?? {};
  const einheit = scope === 'aufteiler' && q.einheitId ? einheiten.find((e) => e.id === q.einheitId) ?? null : null;

  const wohnflaeche =
    scope === 'aufteiler' && einheit
      ? plus(einheit.fl) || 0
      : einheiten.reduce((s, e) => s + (e.typ === 'Stellplatz' ? 0 : plus(e.fl) || 0), 0) || plus(obj.wohnflaeche) || 0;

  let kaufpreis: number;
  if (scope === 'aufteiler' && einheit) kaufpreis = kkEinheitVerkaufspreis(einheit);
  else kaufpreis = einheiten.reduce((s, e) => s + kkEinheitVerkaufspreis(e), 0) || plus(q.dealKaufpreis) || plus(obj.angebotspreis) || 0;

  const monatsmiete =
    scope === 'aufteiler' && einheit
      ? plus(einheit.mi_neu) || plus(einheit.mi_ist) || 0
      : einheiten.reduce((s, e) => s + (plus(e.mi_neu) || plus(e.mi_ist) || 0), 0);

  const adresse = [obj.strasse, obj.hausnr].filter(Boolean).join(' ') + (obj.stadt ? `, ${obj.stadt}` : '');
  const lage = einheit?.lage || 'Einheit';
  const daten: KundenkalkulationDaten = {
    name: scope === 'aufteiler' ? `Kalkulation ${lage}` : 'Kalkulation Globalverkauf',
    scope,
    einheitId: q.einheitId ?? null,
    projektTitel: scope === 'aufteiler' ? `Einzelverkauf ${lage}` : `Projekt: ${adresse || 'Globalverkauf'}`,
    wertsteigerungBullets: [...q.hinweise],
    wertsteigerungSichtbar: q.hinweise.length > 0,
    internNotiz: '',
    kaufpreisWohnung: kaufpreis,
    kaufpreisStellplatz: 0,
    stellplaetzeAnzahl: 0,
    stellplaetzeIds: [],
    objSnapshot: {
      adresse,
      kaufdatum: q.heute,
      wohnflaecheGesamt: wohnflaeche,
      stellplaetzeAnzahl: scope === 'aufteiler' ? 0 : plus(obj.stellplaetze) || 0,
      einheitenAnzahl: scope === 'aufteiler' ? 1 : einheiten.length || 1,
    },
    inputs: {
      kaufpreis,
      notarPct: kkD.notarPct / 100,
      grundbuchPct: kkD.grundbuchPct / 100,
      grundsteuerPct: kkD.grundsteuerPct / 100,
      maklerPct: kkD.maklerPct / 100,
      sonstigePct: kkD.sonstigePct / 100,
      sanierungsposten: [],
      nettokaltmieteMonat: monatsmiete,
      stellplatzMiete: 0,
      sonstigeMiete: 0,
      umlagefaehig: 0,
      mieterhoehungJaehrlich: kkD.mieterhoehungJaehrlich / 100,
      nichtUmlagefaehig: 0,
      kostensteigerungJaehrlich: kkD.kostensteigerungJaehrlich / 100,
      wertsteigerungJaehrlich: kkD.wertsteigerungJaehrlich / 100,
      anteilGebaeudeKaufpreis: kkD.anteilGebaeudeKaufpreis / 100,
      afaSatz: kkD.afaSatz / 100,
      afaTypDenkmal: false,
      grenzsteuersatz: kkD.grenzsteuersatz / 100,
      darlehen: [{ label: 'Darlehen I', summe: Math.round(kaufpreis * (kkD.default_fk_anteil_kp / 100)), zinssatz: kkD.default_zinssatz / 100, tilgung: kkD.default_tilgung / 100 }],
      kaufjahr: Number(q.heute.slice(0, 4)),
      betrachtungsdauerJahre: kkD.betrachtungsdauerJahre,
      wohnflaecheGesamt: wohnflaeche,
    },
  };

  // Stellplätze zur Wohnung (kkalkStellplatzConfirm): Kaufpreis Stellplatz = Summe der gewählten VKPs
  const ids = q.stellplatzIds ?? [];
  if (scope === 'aufteiler' && ids.length) {
    const summe = ids.reduce((s, id) => s + kkEinheitVerkaufspreis(einheiten.find((e) => e.id === id)), 0);
    daten.stellplaetzeIds = [...ids];
    daten.stellplaetzeAnzahl = ids.length;
    daten.kaufpreisStellplatz = Math.round(summe);
    daten.inputs.kaufpreis = daten.kaufpreisWohnung + daten.kaufpreisStellplatz;
  }
  return daten;
}

/** Kaufpreis = Wohnung + Stellplatz (einzige Engine-relevante Zahl ist inputs.kaufpreis). */
export const kaufpreisGesamt = (wohnung: number | null | undefined, stellplatz: number | null | undefined) => (wohnung || 0) + (stellplatz || 0);

/** Nebenkosten in € eingegeben → Prozentsatz vom Kaufpreis (kkalkUpdateField `…__eur`). */
export const nebenkostenAnteilAusEuro = (euro: number, kaufpreis: number) => (kaufpreis > 0 ? euro / kaufpreis : 0);

/** Betrachtungsdauer: ganze Jahre 1–50, unlesbar → 10. */
export const betrachtungsdauer = (jahre: number) => Math.min(50, Math.max(1, Math.round(jahre) || 10));

/** EK setzen (applyEK): Tranche 1 = GIK − EK − übrige Tranchen, nicht negativ. */
export function eigenkapitalAnwenden(inputs: KKalkInputs, ekNeu: number): KKalkInputs {
  const gik = computeKKalk(inputs).investition.gik;
  const darlehen = inputs.darlehen.length ? inputs.darlehen.map((d) => ({ ...d })) : [{ label: 'Darlehen I', summe: 0, zinssatz: 0.04, tilgung: 0.02 }];
  const andere = darlehen.slice(1).reduce((s, d) => s + d.summe, 0);
  darlehen[0]!.summe = Math.max(0, Math.round(gik - ekNeu - andere));
  return { ...inputs, darlehen };
}

/** EK-Schnellwahl: 0 · Nebenkosten · 10 % vom Kaufpreis. */
export function eigenkapitalSchnell(inputs: KKalkInputs, modus: 'zero' | 'nk' | 'p10'): KKalkInputs {
  const ek = modus === 'zero' ? 0 : modus === 'nk' ? Math.round(computeKKalk(inputs).investition.nebenkostenEuroTotal) : Math.round(inputs.kaufpreis * 0.1);
  return eigenkapitalAnwenden(inputs, ek);
}

/** Tranche-1-Schnellwahl: 100 % KP · KP + finanzierbare Sanierung · KP + Nebenkosten · 90 % KP. */
export function tranche1Schnell(inputs: KKalkInputs, modus: 'kp' | 'kp_san' | 'kp_nk' | 'kp90'): KKalkInputs {
  const kp = inputs.kaufpreis;
  const neu =
    modus === 'kp' ? kp
      : modus === 'kp_san' ? kp + splitSanierung(inputs.sanierungsposten).investor
        : modus === 'kp_nk' ? kp + Math.round(computeKKalk(inputs).investition.nebenkostenEuroTotal)
          : Math.round(kp * 0.9);
  const darlehen = inputs.darlehen.length ? inputs.darlehen.map((d) => ({ ...d })) : [{ label: 'Hauptdarlehen', summe: 0, zinssatz: 0.04, tilgung: 0.02 }];
  darlehen[0]!.summe = neu;
  return { ...inputs, darlehen };
}

/** Hinweise-Textfeld → Liste (eine Zeile je Hinweis, führende „- “/„• “ entfernt). */
export const hinweiseAusText = (text: string) =>
  text.split('\n').map((s) => s.trim().replace(/^[-•\s]+/, '')).filter((s) => s.length > 0);

const normLage = (s: unknown) =>
  String(s || '').toLowerCase().replace(/[\s\-_.,]+/g, '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

/** Sortierung der Liste im Deal: Global zuerst (neueste oben), dann Aufteiler in Einheiten-Reihenfolge. */
export function kundenkalkulationenSortieren<T extends { scope: string; einheitId: string | null; name: string; projektTitel: string | null; updatedAt: string }>(
  liste: readonly T[],
  einheiten: readonly { id: string; lage?: string | null }[],
): T[] {
  const einheitIndex = new Map(einheiten.map((e, i) => [e.id, i]));
  const lageIndex = new Map<string, number>();
  einheiten.forEach((e, i) => { const k = normLage(e.lage); if (k) lageIndex.set(k, i); });
  const lagen = [...lageIndex.keys()].sort((a, b) => b.length - a.length);
  const indexFuer = (k: T) => {
    if (k.einheitId && einheitIndex.has(k.einheitId)) return einheitIndex.get(k.einheitId)!;
    for (const kandidat of [k.name, k.projektTitel].filter(Boolean) as string[]) {
      const n = normLage(kandidat);
      for (const l of lagen) if (n.includes(l)) return lageIndex.get(l)!;
    }
    return Number.MAX_SAFE_INTEGER;
  };
  return [...liste].sort((a, b) => {
    const ag = a.scope !== 'aufteiler', bg = b.scope !== 'aufteiler';
    if (ag !== bg) return ag ? -1 : 1;
    if (!ag) { const d = indexFuer(a) - indexFuer(b); if (d) return d; }
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
}
