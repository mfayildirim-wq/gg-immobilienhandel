/* eslint-disable @typescript-eslint/no-explicit-any -- Einträge im Altformat wie in der alten App */
/**
 * Listen der Seiten Deals, Objekte und Makler: Zähler, Status-/Prio-Chip, Suche, gespeicherter Filter, Sortierung, Zellen.
 * Nach gg-immohandel dealRenderList (deals.ts), objRenderList (objekte.ts), mkRenderList (makler.ts) und den Helfern
 * fe/nf (storage.ts), getMaklerForObj/getJahresmiete (utils.ts). Eingaben im Altformat (wie DB.deals()/objs()/makler()).
 */
import { applyFilter, type FilterCriterion, type SavedFilter } from './gespeicherteFilter.ts';

/** fe aus storage.ts: ganze Euro, negative mit „–“, leer/0-los „–“. */
export const fe = (n: any) => { if (!n && n !== 0) return '–'; const a = Math.abs(Math.round(n)); return (n < 0 ? '–' : '') + a.toLocaleString('de-DE') + ' €'; };
/** nf aus storage.ts */
export const nf = (v: any) => (+v || 0).toLocaleString('de-DE');

export const LISTEN_STATUS = ['In Prüfung', 'Über Zeit nachfassen', 'Closing Path', 'Angebot abgegeben', 'Angekauft', 'Archiv'] as const;
/** Chips der Filterleiste (Deals und Objekte): ohne „Angekauft“, wie alt. */
export const LISTEN_STATUS_CHIPS = ['alle', 'In Prüfung', 'Über Zeit nachfassen', 'Angebot abgegeben', 'Closing Path', 'Archiv'] as const;
export const MAKLER_PRIO_CHIPS = ['alle', 'A', 'B', 'C'] as const;

const zaehlen = (items: any[], feld: string, werte: readonly string[]) => {
  const c: Record<string, number> = Object.fromEntries(werte.map((w) => [w, 0]));
  items.forEach((x) => { if (c[x[feld]] !== undefined) c[x[feld]]!++; });
  return c;
};

// ── Deals ────────────────────────────────────────────────────
export function dealAktuelleKriterien(statusFilter: string, suche: string): FilterCriterion[] {
  const criteria: FilterCriterion[] = [];
  if (statusFilter && statusFilter !== 'alle') criteria.push({ field: 'status', op: 'equals', value: statusFilter });
  const s = suche.trim();
  if (s) criteria.push({ field: 'adresse', op: 'contains', value: s });
  return criteria;
}

export function dealListe(deals: any[], objs: any[], makler: any[], statusFilter: string, suche: string, gespeichert: SavedFilter | null) {
  const search = suche.toLowerCase();
  const zaehler = zaehlen(deals, 'status', LISTEN_STATUS);
  let list = deals.filter((d: any) => {
    const mf = statusFilter === 'alle' || d.status === statusFilter;
    const ms = !search ||
      (d.adresse || '').toLowerCase().includes(search) ||
      (d.stadt || '').toLowerCase().includes(search) ||
      (d.maklerName || '').toLowerCase().includes(search);
    return mf && ms;
  });
  list = applyFilter(list, gespeichert);
  const statusOrder: Record<string, number> = { 'Closing Path': 0, 'Angebot abgegeben': 1, 'In Prüfung': 2, 'Über Zeit nachfassen': 3, Angekauft: 4, Archiv: 5 };
  list = [...list].sort((a: any, b: any) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9));

  const objMap = new Map(objs.map((o: any) => [o.id, o]));
  const mkMap = new Map(makler.map((m: any) => [m.id, m]));
  const getJNKM = (d: any) => {
    const o = objMap.get(d.objId);
    if (o?.einheiten?.length) return o.einheiten.reduce((s: number, e: any) => s + (+e.kaltmiete || 0), 0) * 12;
    if (d.kalk?.kaufpreis && d.einheiten?.length) return d.einheiten.reduce((s: number, e: any) => s + (+e.mi_ist || 0), 0) * 12;
    return 0;
  };
  const zeilen = list.map((d: any) => {
    const tel = mkMap.get(d.maklerId)?.tel || d.maklerTel || '';
    const wf = objMap.get(d.objId)?.wohnflaeche || 0;
    const jnkm = getJNKM(d);
    const vollAdr = [d.adresse, d.hausnr || objMap.get(d.objId)?.hausnr].filter(Boolean).join(' ');
    return {
      id: d.id as string, objId: d.objId as string, status: d.status as string,
      adresse: vollAdr || d.adresse || '–', stadt: d.stadt || '–',
      makler: d.maklerName || '–', firma: d.maklerFirma || '', tel: tel as string,
      kaufpreis: d.kalk?.kaufpreis ? fe(d.kalk.kaufpreis) : '–',
      flaeche: wf ? `${nf(wf)} m²` : '–',
      jnkm: jnkm ? fe(jnkm) : '–',
      rendite: jnkm && d.kalk?.kaufpreis ? `${((jnkm / d.kalk.kaufpreis) * 100).toFixed(1)}%` : '–',
      angeboten: d.angebotsDatum
        ? new Date(d.angebotsDatum.includes('.') ? d.angebotsDatum.split('.').reverse().join('-') : d.angebotsDatum).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '–',
    };
  });
  return { zaehler, zeilen };
}

// ── Objekte ──────────────────────────────────────────────────
export function objektAktuelleKriterien(statusFilter: string, suche: string): FilterCriterion[] {
  const criteria: FilterCriterion[] = [];
  if (statusFilter && statusFilter !== 'alle') criteria.push({ field: 'status', op: 'equals', value: statusFilter });
  const s = suche.trim();
  if (s) criteria.push({ field: 'strasse', op: 'contains', value: s });
  return criteria;
}

/** getMaklerForObj: Makler des ersten Deals zum Objekt (Kopie im Deal). */
function maklerZumObjekt(deals: any[], objId: string): string {
  const deal = deals.find((d: any) => d.objId === objId);
  return deal ? (deal.maklerName || '') + (deal.maklerFirma ? ' (' + deal.maklerFirma + ')' : '') : '–';
}

/** getJahresmiete */
export function jahresmiete(o: any): number {
  if (o.einheiten?.length) return o.einheiten.reduce((s: number, e: any) => s + (+e.kaltmiete || 0), 0) * 12;
  return o.istmiete ? o.istmiete * 12 : 0;
}

export function objektListe(objs: any[], deals: any[], statusFilter: string, suche: string, gespeichert: SavedFilter | null) {
  const search = suche.toLowerCase();
  const zaehler = zaehlen(objs, 'status', LISTEN_STATUS);
  let list = objs.filter((o: any) => {
    const mf = statusFilter === 'alle' || o.status === statusFilter;
    const ms = !search ||
      (o.strasse || '').toLowerCase().includes(search) ||
      (o.hausnr || '').toLowerCase().includes(search) ||
      (o.stadt || '').toLowerCase().includes(search) ||
      (o.plz || '').toLowerCase().includes(search);
    return mf && ms;
  });
  list = applyFilter(list, gespeichert);
  const zeilen = list.map((o: any) => {
    const jmiete = jahresmiete(o);
    return {
      id: o.id as string, status: (o.status ?? '') as string,
      adresse: [o.strasse, o.hausnr].filter(Boolean).join(' ') || '–',
      ort: [o.plz, o.stadt].filter(Boolean).join(' ') || '–',
      angeboten: o.datum || '–',
      makler: maklerZumObjekt(deals, o.id),
      angebotspreis: fe(o.angebotspreis), zielpreis: fe(o.zielpreis),
      flaeche: o.wohnflaeche ? `${nf(o.wohnflaeche)} m²` : '–',
      einheiten: String(o.einheitenAnz || '–'),
      kaltmieteJahr: jmiete ? fe(jmiete) : '–',
    };
  });
  return { zaehler, zeilen };
}

// ── Makler ───────────────────────────────────────────────────
export function maklerAktuelleKriterien(prioFilter: string, suche: string): FilterCriterion[] {
  const criteria: FilterCriterion[] = [];
  if (prioFilter && prioFilter !== 'alle') criteria.push({ field: 'prio', op: 'equals', value: prioFilter });
  const s = suche.trim();
  if (s) criteria.push({ field: 'name', op: 'contains', value: s });
  return criteria;
}

export function maklerListe(makler: any[], deals: any[], prioFilter: string, suche: string, gespeichert: SavedFilter | null) {
  const search = suche.toLowerCase();
  const zaehler: Record<string, number> & { gesamt: number } = { ...zaehlen(makler, 'prio', ['A', 'B', 'C']), gesamt: makler.length };
  let list = makler.filter((m: any) => {
    const mf = prioFilter === 'alle' || m.prio === prioFilter;
    const ms = !search || (m.name || '').toLowerCase().includes(search) || (m.firma || '').toLowerCase().includes(search);
    return mf && ms;
  });
  list = applyFilter(list, gespeichert);
  const rang = (p: any) => ({ A: 0, B: 1, C: 2 } as Record<string, number>)[p] ?? 1;
  list = [...list].sort((a: any, b: any) => rang(a.prio) - rang(b.prio) || (a.name || '').localeCompare(b.name || ''));
  const zeilen = list.map((m: any) => {
    const mDeals = deals.filter((d: any) => d.maklerId === m.id);
    return {
      id: m.id as string, prio: m.prio as string | undefined, prioText: `${m.prio}-Makler`,
      name: m.name || '–', firma: m.firma || '–', tel: (m.tel || '') as string, email: (m.email || '') as string,
      frequenz: m.kontaktFreq || '–',
      aktiveDeals: mDeals.filter((d: any) => d.status !== 'Archiv').length, deals: mDeals.length,
    };
  });
  return { zaehler, zeilen };
}
