/* eslint-disable @typescript-eslint/no-explicit-any -- Datensätze je Entität mit unterschiedlichen Feldern */
/**
 * Dublettenprüfung und Zusammenführen.
 * Nach gg-immohandel src/lib/dedup.ts (findAllDuplicates, compareMaklers, compareObjekte, Ignorierliste)
 * und src/lib/merge.ts (Felder, Diffs, mergeMakler/mergeObjekt/mergeDeal, Journal-Frist).
 */
import { addressSimilar, type DublettenSicherheit, nameSimilar, normalizeAddr } from '../expose/uebernahme.ts';

export type DublettenEntitaet = 'makler' | 'objekt' | 'deal';

export interface DublettenPaar { typ: DublettenEntitaet; a: any; b: any; sicherheit: DublettenSicherheit; grund: string }

const normalizeHausnr = (s: string) => (s || '').toLowerCase().replace(/\s+/g, '').trim();
const telNormal = (s: string) => s.replace(/[\s\-()]/g, '');

/** Schlüssel eines Paares, unabhängig von der Reihenfolge (pairHash). */
export const paarSchluessel = (id1: string, id2: string) => [id1, id2].sort().join('|');

/** compareMaklers */
export function maklerVergleich(a: any, b: any): { sicherheit: DublettenSicherheit; grund: string } | null {
  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) return { sicherheit: 'exact', grund: 'Gleiche E-Mail-Adresse' };
  if (a.tel && b.tel && telNormal(a.tel) === telNormal(b.tel)) return { sicherheit: 'exact', grund: 'Gleiche Telefonnummer' };
  if (nameSimilar(a.name || '', b.name || '')) {
    if (a.firma && b.firma && a.firma.toLowerCase() === b.firma.toLowerCase()) return { sicherheit: 'fuzzy', grund: 'Ähnlicher Name + gleiche Firma' };
    return { sicherheit: 'fuzzy', grund: 'Ähnlicher Name' };
  }
  return null;
}

/** compareObjekte */
export function objektVergleich(a: any, b: any): { sicherheit: DublettenSicherheit; grund: string } | null {
  if (!addressSimilar(a, b)) return null;
  const exakt = normalizeAddr(a.strasse || '') === normalizeAddr(b.strasse || '')
    && normalizeHausnr(a.hausnr || '') === normalizeHausnr(b.hausnr || '')
    && normalizeAddr(a.stadt || '') === normalizeAddr(b.stadt || '');
  return exakt ? { sicherheit: 'exact', grund: 'Identische Adresse' } : { sicherheit: 'fuzzy', grund: 'Ähnliche Adresse' };
}

/**
 * findAllDuplicates: alle Paare über Makler, Objekte und Deals; jedes Paar einmal, ignorierte bleiben weg,
 * „exact“ steht vorn. Deals nur bei gleicher Objekt+Makler-Kombination (ohne Makler gar nicht).
 */
export function alleDubletten(makler: any[], objekte: any[], deals: any[], ignoriert: Iterable<string> = []): DublettenPaar[] {
  const weg = new Set(ignoriert);
  const ergebnis: DublettenPaar[] = [];

  for (let i = 0; i < makler.length; i++) {
    for (let j = i + 1; j < makler.length; j++) {
      const a = makler[i], b = makler[j];
      if (weg.has(paarSchluessel(a.id, b.id))) continue;
      const treffer = maklerVergleich(a, b);
      if (treffer) ergebnis.push({ typ: 'makler', a, b, ...treffer });
    }
  }

  for (let i = 0; i < objekte.length; i++) {
    for (let j = i + 1; j < objekte.length; j++) {
      const a = objekte[i], b = objekte[j];
      if (weg.has(paarSchluessel(a.id, b.id))) continue;
      const treffer = objektVergleich(a, b);
      if (treffer) ergebnis.push({ typ: 'objekt', a, b, ...treffer });
    }
  }

  const schluessel = new Map<string, any>();
  for (const d of deals) {
    const objektId = d.objektId ?? d.objId;
    if (!objektId || !d.maklerId) continue;
    const k = `${objektId}|${d.maklerId}`;
    const vorhanden = schluessel.get(k);
    if (vorhanden) {
      if (!weg.has(paarSchluessel(vorhanden.id, d.id))) {
        ergebnis.push({ typ: 'deal', a: vorhanden, b: d, sicherheit: 'exact', grund: 'Gleiche Objekt+Makler-Kombination' });
      }
    } else {
      schluessel.set(k, d);
    }
  }

  return ergebnis.sort((x, y) => (x.sicherheit === y.sicherheit ? 0 : x.sicherheit === 'exact' ? -1 : 1));
}

// ── Zusammenführen (merge.ts) ───────────────────────────────

/** Felder je Entität, übertragen auf die Spalten des Neubaus (alte Namen in Klammern). */
export const MAKLER_FELDER = [
  'name', 'firma', 'tel', 'email', 'prio', 'nachfassFrequenz', 'lastContact', 'nextContact',
  'beziehungsNotiz', 'kiSummary', 'webseite', 'notizen', 'anrede', 'position',
] as const;
export const OBJEKT_FELDER = [
  'strasse', 'hausnr', 'plz', 'stadt', 'baujahr', 'einheitenAnzahl', 'wohnflaeche', 'grundstueck',
  'energieklasse', 'heizung', 'angebotspreis', 'zielpreis', 'status', 'istMiete', 'sollMiete', 'notizen', 'bundesland',
] as const;
export const DEAL_FELDER = ['status', 'angebotsDatum', 'nachfassFrequenz', 'nextContact', 'lastContact', 'prio', 'notizen'] as const;

export const FELDER: Record<DublettenEntitaet, readonly string[]> = { makler: MAKLER_FELDER, objekt: OBJEKT_FELDER, deal: DEAL_FELDER };

/** Sub-Strukturen mit Auswahl (CHOICE_SUBARRAYS). */
export const WAHL_LISTEN: Record<DublettenEntitaet, readonly string[]> = {
  makler: ['persoenlich'],
  objekt: ['einheiten'],
  deal: ['kalkulation', 'einheiten', 'sanierungen'],
};
/** Verlustfrei vereint (LOSSLESS_ARRAYS): Kommunikation, Tags, Deal-Kommentare. */
export const VEREINTE_LISTEN: Record<DublettenEntitaet, readonly string[]> = {
  makler: ['kommunikation', 'tags'],
  objekt: [],
  deal: ['kommentare'],
};

export interface FeldUnterschied { feld: string; wertA: any; wertB: any; konflikt: boolean }
export interface MergeWahl { felder: Record<string, 'A' | 'B'>; listen: Record<string, 'A' | 'B' | 'union'> }

const hatWert = (v: any) => v !== undefined && v !== null && v !== '';

/** computeFieldDiffs */
export function feldUnterschiede(a: any, b: any, felder: readonly string[]): FeldUnterschied[] {
  return felder.map((f) => {
    const wertA = a?.[f], wertB = b?.[f];
    return { feld: f, wertA, wertB, konflikt: hatWert(wertA) && hatWert(wertB) && JSON.stringify(wertA) !== JSON.stringify(wertB) };
  });
}

/** resolveField: gefüllter Wert gewinnt, bei Konflikt die Wahl (Standard A). */
export function feldWert(feld: string, a: any, b: any, wahl: MergeWahl): any {
  const va = a?.[feld], vb = b?.[feld];
  if (hatWert(va) && !hatWert(vb)) return va;
  if (hatWert(vb) && !hatWert(va)) return vb;
  if (!hatWert(va) && !hatWert(vb)) return va !== undefined ? va : vb;
  return wahl.felder[feld] === 'B' ? vb : va;
}

/** resolveSubStructure: A, B oder vereint (Listen aneinander, Objekte mit Vorrang A). */
export function listenWert(name: string, a: any, b: any, wahl: MergeWahl): any {
  const auswahl = wahl.listen[name] ?? 'A';
  const va = a?.[name], vb = b?.[name];
  if (auswahl === 'A') return va;
  if (auswahl === 'B') return vb;
  if (Array.isArray(va) || Array.isArray(vb)) return [...(va || []), ...(vb || [])];
  if (typeof va === 'object' && typeof vb === 'object') return { ...(vb || {}), ...(va || {}) };
  return va ?? vb;
}

const eindeutig = <T,>(liste: T[], schluessel: (x: T) => string) => {
  const gesehen = new Set<string>();
  return liste.filter((x) => { const k = schluessel(x); if (gesehen.has(k)) return false; gesehen.add(k); return true; });
};

/** mergeKomm: nach Kennung eindeutig, neueste zuerst. */
export function kommunikationVereinen(a: any[] = [], b: any[] = []): any[] {
  const zeit = (x: any) => (x?.zeitpunkt ? Date.parse(x.zeitpunkt) : 0) || 0;
  return eindeutig([...(a || []), ...(b || [])], (k) => k.id || JSON.stringify(k)).sort((x, y) => zeit(y) - zeit(x));
}

/** mergeKommentare: doppelt nur bei gleichem Zeitpunkt UND Text; neueste zuerst. */
export function kommentareVereinen(a: any[] = [], b: any[] = []): any[] {
  const zeit = (x: any) => (x?.zeitpunkt ? Date.parse(x.zeitpunkt) : 0) || 0;
  return eindeutig([...(a || []), ...(b || [])], (k) => (k?.id ? `id:${k.id}` : JSON.stringify([k?.zeitpunkt ?? '', k?.text ?? ''])))
    .sort((x, y) => zeit(y) - zeit(x));
}

const vereinen = (a: string[] = [], b: string[] = []) => Array.from(new Set([...(a || []), ...(b || [])]));

/** mergeMakler: Felder nach Wahl, Kommunikation und Tags vereint, Persönliches nach Wahl, KI-Zusammenfassung verfällt. */
export function mergeMakler(primaer: any, sekundaer: any, wahl: MergeWahl): any {
  const zusammen: any = { ...primaer };
  for (const f of MAKLER_FELDER) zusammen[f] = feldWert(f, primaer, sekundaer, wahl);
  zusammen.kommunikation = kommunikationVereinen(primaer.kommunikation, sekundaer.kommunikation);
  zusammen.tags = vereinen(primaer.tags, sekundaer.tags);
  zusammen.persoenlich = listenWert('persoenlich', primaer, sekundaer, wahl) ?? null;
  // Die Zusammenfassung bezog sich auf die alte Kommunikation
  zusammen.kiSummary = null;
  zusammen.kiSummaryAt = null;
  zusammen.id = primaer.id;
  return zusammen;
}

export function mergeObjekt(primaer: any, sekundaer: any, wahl: MergeWahl): any {
  const zusammen: any = { ...primaer };
  for (const f of OBJEKT_FELDER) zusammen[f] = feldWert(f, primaer, sekundaer, wahl);
  zusammen.einheiten = listenWert('einheiten', primaer, sekundaer, wahl) || [];
  zusammen.id = primaer.id;
  return zusammen;
}

export function mergeDeal(primaer: any, sekundaer: any, wahl: MergeWahl): any {
  const zusammen: any = { ...primaer };
  for (const f of DEAL_FELDER) zusammen[f] = feldWert(f, primaer, sekundaer, wahl);
  zusammen.kommentare = kommentareVereinen(primaer.kommentare, sekundaer.kommentare);
  zusammen.kalkulation = listenWert('kalkulation', primaer, sekundaer, wahl) || {};
  zusammen.einheiten = listenWert('einheiten', primaer, sekundaer, wahl) || [];
  zusammen.sanierungen = listenWert('sanierungen', primaer, sekundaer, wahl) || [];
  zusammen.id = primaer.id;
  return zusammen;
}

export const zusammenfuehren = (typ: DublettenEntitaet, primaer: any, sekundaer: any, wahl: MergeWahl) =>
  (typ === 'makler' ? mergeMakler : typ === 'objekt' ? mergeObjekt : mergeDeal)(primaer, sekundaer, wahl);

/** Rückgängig nur innerhalb von 24 Stunden (JOURNAL_MAX_AGE_MS). */
export const MERGE_UNDO_MS = 24 * 60 * 60 * 1000;
export const mergeAbgelaufen = (am: string, jetzt: number = Date.now()) => {
  const ts = Date.parse(am);
  return !Number.isFinite(ts) || jetzt - ts >= MERGE_UNDO_MS;
};

export const MERGE_GEAENDERT_HINWEIS = 'Der zusammengeführte Eintrag wurde seit dem Merge bearbeitet. Rückgängig verwirft diese Änderungen.';
export const DUBLETTEN_KEINE = 'Keine Dubletten gefunden.';
export const IGNORIEREN_LABEL = 'Keine Dublette';
