/* eslint-disable @typescript-eslint/no-explicit-any -- Datensätze je Entität mit unterschiedlichen Feldern */
/**
 * Dublettenprüfung und Zusammenführen (alt: Einstellungen → Dubletten, src/lib/dedup.ts + src/lib/merge.ts).
 * Regeln liegen in @gg/domain; hier wird gelesen, geschrieben, umgehängt und protokolliert.
 */
import type { DublettenPaarSicht, MergeVorschau } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  alleDubletten, type DublettenEntitaet, FELDER, feldUnterschiede, mergeAbgelaufen, MERGE_GEAENDERT_HINWEIS, type MergeWahl,
  paarSchluessel, VEREINTE_LISTEN, WAHL_LISTEN, zusammenfuehren,
} from '@gg/domain';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';
import { FachFehler } from '../fehler.ts';

const IGNORIERT = 'dubletten-ignoriert';

async function ignorierte(db: Db): Promise<string[]> {
  const [z] = await db.select({ wert: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, IGNORIERT));
  const wert = z?.wert as { paare?: string[] } | null;
  return Array.isArray(wert?.paare) ? wert.paare : [];
}

export async function dublettenIgnorieren(db: Db, id1: string, id2: string) {
  const paare = new Set(await ignorierte(db));
  paare.add(paarSchluessel(id1, id2));
  const wert = { paare: [...paare] };
  await db.insert(schema.einstellungen).values({ schluessel: IGNORIERT, wert })
    .onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert, updatedAt: sql`now()` } });
  return { ignoriert: wert.paare.length };
}

export async function dublettenIgnoriertLeeren(db: Db) {
  await db.insert(schema.einstellungen).values({ schluessel: IGNORIERT, wert: { paare: [] } })
    .onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert: { paare: [] }, updatedAt: sql`now()` } });
  return { ignoriert: 0 };
}

/** formatEntityLabel der alten Ansicht. */
const beschriftung = (typ: DublettenEntitaet, x: any) =>
  typ === 'makler' ? `${x.name || '–'}${x.firma ? ` (${x.firma})` : ''}`
    : typ === 'objekt' ? `${[x.strasse, x.hausnr].filter(Boolean).join(' ')}${x.stadt ? `, ${x.stadt}` : ''}`
      : `${x.adresse || '–'} · ${x.maklerName || '–'}`;

/** findAllDuplicates über die aktiven Datensätze. */
export async function dublettenScan(db: Db): Promise<DublettenPaarSicht[]> {
  // Reihenfolge wie in den Listen (alt: Reihenfolge der Sammlung) — sie bestimmt, welcher Eintrag im Paar vorn steht
  const makler = await db.select().from(schema.makler).where(isNull(schema.makler.deletedAt)).orderBy(asc(schema.makler.reihenfolge));
  const objekte = await db.select().from(schema.objekte).where(isNull(schema.objekte.deletedAt)).orderBy(asc(schema.objekte.reihenfolge));
  const deals = await db.select({ id: schema.deals.id, objektId: schema.deals.objektId, maklerId: schema.deals.maklerId, adresse: schema.objekte.strasse, maklerName: schema.makler.name })
    .from(schema.deals)
    .innerJoin(schema.objekte, eq(schema.objekte.id, schema.deals.objektId))
    .leftJoin(schema.makler, eq(schema.makler.id, schema.deals.maklerId))
    .where(isNull(schema.deals.deletedAt)).orderBy(asc(schema.deals.reihenfolge));
  return alleDubletten(makler, objekte, deals, await ignorierte(db)).map((p) => ({
    typ: p.typ, sicherheit: p.sicherheit, grund: p.grund,
    a: { id: p.a.id, label: beschriftung(p.typ, p.a) },
    b: { id: p.b.id, label: beschriftung(p.typ, p.b) },
  }));
}

// ── Datensatz samt Unterlisten lesen und schreiben ──────────

interface Aggregat { datensatz: any; listen: Record<string, any[]> }

async function aggregat(db: Db, typ: DublettenEntitaet, id: string): Promise<Aggregat> {
  if (typ === 'makler') {
    const [m] = await db.select().from(schema.makler).where(eq(schema.makler.id, id));
    if (!m) throw new FachFehler(404, 'Makler nicht gefunden');
    const kommunikation = await db.select().from(schema.maklerKommunikation).where(eq(schema.maklerKommunikation.maklerId, id));
    return { datensatz: { ...m, kommunikation }, listen: { kommunikation } };
  }
  if (typ === 'objekt') {
    const [o] = await db.select().from(schema.objekte).where(eq(schema.objekte.id, id));
    if (!o) throw new FachFehler(404, 'Objekt nicht gefunden');
    const einheiten = await db.select().from(schema.objektEinheiten).where(eq(schema.objektEinheiten.objektId, id));
    const fotos = await db.select().from(schema.objektFotos).where(eq(schema.objektFotos.objektId, id));
    return { datensatz: { ...o, einheiten }, listen: { einheiten, fotos } };
  }
  const [d] = await db.select().from(schema.deals).where(eq(schema.deals.id, id));
  if (!d) throw new FachFehler(404, 'Deal nicht gefunden');
  const kommentare = await db.select().from(schema.dealKommentare).where(eq(schema.dealKommentare.dealId, id));
  const einheiten = await db.select().from(schema.dealEinheiten).where(eq(schema.dealEinheiten.dealId, id));
  const sanierungen = await db.select().from(schema.dealSanierungen).where(eq(schema.dealSanierungen.dealId, id));
  const dokumente = await db.select().from(schema.dokumente).where(eq(schema.dokumente.dealId, id));
  return { datensatz: { ...d, kommentare, einheiten, sanierungen }, listen: { kommentare, einheiten, sanierungen, dokumente } };
}

const TABELLE = { makler: schema.makler, objekt: schema.objekte, deal: schema.deals } as const;
/** Name der Fremdschlüsselspalte (maklerId, objektId oder dealId) und der Tabelle — beides landet im Protokoll. */
const verweisSpalte = (spalte: any): 'maklerId' | 'objektId' | 'dealId' =>
  (spalte.name === 'makler_id' || spalte.name === 'maklerId' ? 'maklerId' : spalte.name === 'objekt_id' || spalte.name === 'objektId' ? 'objektId' : 'dealId');
const tabellenName = (tabelle: any): string => String(tabelle[Symbol.for('drizzle:Name') as unknown as keyof typeof tabelle] ?? tabelle._?.name ?? '');
/** Unterlisten je Entität: Tabelle und die Spalte, die auf den Datensatz zeigt. */
const UNTERLISTEN: Record<DublettenEntitaet, { name: string; tabelle: any; spalte: any }[]> = {
  makler: [{ name: 'kommunikation', tabelle: schema.maklerKommunikation, spalte: schema.maklerKommunikation.maklerId }],
  objekt: [
    { name: 'einheiten', tabelle: schema.objektEinheiten, spalte: schema.objektEinheiten.objektId },
    { name: 'fotos', tabelle: schema.objektFotos, spalte: schema.objektFotos.objektId },
  ],
  deal: [
    { name: 'kommentare', tabelle: schema.dealKommentare, spalte: schema.dealKommentare.dealId },
    { name: 'einheiten', tabelle: schema.dealEinheiten, spalte: schema.dealEinheiten.dealId },
    { name: 'sanierungen', tabelle: schema.dealSanierungen, spalte: schema.dealSanierungen.dealId },
    { name: 'dokumente', tabelle: schema.dokumente, spalte: schema.dokumente.dealId },
  ],
};

/** Verweise, die beim Zusammenführen auf den behaltenen Eintrag zeigen müssen. */
const VERWEISE: Record<DublettenEntitaet, { tabelle: any; spalte: any }[]> = {
  makler: [{ tabelle: schema.deals, spalte: schema.deals.maklerId }],
  objekt: [{ tabelle: schema.deals, spalte: schema.deals.objektId }, { tabelle: schema.begleitscheine, spalte: schema.begleitscheine.objektId }],
  deal: [
    { tabelle: schema.projekte, spalte: schema.projekte.dealId },
    { tabelle: schema.kundenkalkulationen, spalte: schema.kundenkalkulationen.dealId },
    { tabelle: schema.vertriebslisten, spalte: schema.vertriebslisten.dealId },
    { tabelle: schema.finanzpraesentationen, spalte: schema.finanzpraesentationen.dealId },
    { tabelle: schema.begleitscheine, spalte: schema.begleitscheine.dealId },
  ],
};

/** Felder, die im Datensatz selbst stehen (ohne Unterlisten); nur echte Spalten der Tabelle. */
const spaltenWerte = (typ: DublettenEntitaet, zusammen: any) => {
  const tabelle = TABELLE[typ] as unknown as Record<string, unknown>;
  const felder: Record<string, unknown> = {};
  for (const f of FELDER[typ]) if (f in zusammen && f in tabelle) felder[f] = zusammen[f];
  if (typ === 'makler') { felder.tags = zusammen.tags ?? []; felder.persoenlich = zusammen.persoenlich ?? null; felder.kiSummary = null; felder.kiSummaryAt = null; }
  if (typ === 'deal') felder.kalkulation = zusammen.kalkulation ?? {};
  return felder;
};

/** Vorschau: Feldunterschiede und Umfang der Unterlisten (dedup-ui: Merge-Dialog). */
export async function dublettenVorschau(db: Db, typ: DublettenEntitaet, primaerId: string, sekundaerId: string): Promise<MergeVorschau> {
  const a = await aggregat(db, typ, primaerId);
  const b = await aggregat(db, typ, sekundaerId);
  const wert = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return {
    typ, primaerId, sekundaerId,
    primaerLabel: beschriftung(typ, a.datensatz), sekundaerLabel: beschriftung(typ, b.datensatz),
    felder: feldUnterschiede(a.datensatz, b.datensatz, FELDER[typ]).map((d) => ({ feld: d.feld, wertA: wert(d.wertA), wertB: wert(d.wertB), konflikt: d.konflikt })),
    wahlListen: WAHL_LISTEN[typ].map((name) => ({
      name,
      anzahlA: Array.isArray(a.datensatz[name]) ? a.datensatz[name].length : a.datensatz[name] ? 1 : 0,
      anzahlB: Array.isArray(b.datensatz[name]) ? b.datensatz[name].length : b.datensatz[name] ? 1 : 0,
    })),
    vereinteListen: VEREINTE_LISTEN[typ].map((name) => ({
      name,
      anzahlA: Array.isArray(a.datensatz[name]) ? a.datensatz[name].length : 0,
      anzahlB: Array.isArray(b.datensatz[name]) ? b.datensatz[name].length : 0,
    })),
    dateienB: (b.listen.fotos?.length ?? 0) + (b.listen.dokumente?.length ?? 0),
  };
}

/**
 * executeMerge: Felder nach Wahl schreiben, Unterlisten umhängen, Verweise umbiegen, Duplikat in den Papierkorb,
 * alles im Protokoll festhalten (24 Stunden rückgängig). Dateien bleiben unter ihrem Schlüssel und wechseln nur den Besitzer.
 */
export async function dublettenZusammenfuehren(db: Db, typ: DublettenEntitaet, primaerId: string, sekundaerId: string, wahl: MergeWahl) {
  if (primaerId === sekundaerId) throw new FachFehler(400, 'Behaltener und aufgegebener Eintrag sind identisch');
  const vorher = { primaer: await aggregat(db, typ, primaerId), sekundaer: await aggregat(db, typ, sekundaerId) };
  const zusammen = zusammenfuehren(typ, vorher.primaer.datensatz, vorher.sekundaer.datensatz, wahl);
  const t = TABELLE[typ];

  const betroffeneDealIds: string[] = [];
  const dateien: { liste: string; ids: string[] }[] = [];
  const verweise: { tabelle: string; spalte: string; ids: string[] }[] = [];

  await db.transaction(async (tx) => {
    await tx.update(t).set({ ...spaltenWerte(typ, zusammen), version: sql`${t.version} + 1`, updatedAt: sql`now()` }).where(eq(t.id, primaerId));

    for (const liste of UNTERLISTEN[typ]) {
      const istWahl = WAHL_LISTEN[typ].includes(liste.name);
      const auswahl = wahl.listen[liste.name] ?? 'A';
      const uebernehmen = !istWahl || auswahl === 'B' || auswahl === 'union';
      if (!uebernehmen) continue;
      const zeilen = vorher.sekundaer.listen[liste.name] ?? [];
      if (!zeilen.length) continue;
      if (istWahl && auswahl === 'B') {
        // Nur B: die Zeilen des behaltenen Eintrags weichen
        await tx.delete(liste.tabelle).where(eq(liste.spalte, primaerId));
      }
      await tx.update(liste.tabelle).set({ [verweisSpalte(liste.spalte)]: primaerId })
        .where(inArray(liste.tabelle.id, zeilen.map((z: any) => z.id)));
      if (liste.name === 'fotos' || liste.name === 'dokumente') dateien.push({ liste: liste.name, ids: zeilen.map((z: any) => z.id) });
    }

    for (const verweis of VERWEISE[typ]) {
      const spaltenName = verweisSpalte(verweis.spalte);
      const zeilen = await tx.update(verweis.tabelle).set({ [spaltenName]: primaerId })
        .where(eq(verweis.spalte, sekundaerId)).returning({ id: verweis.tabelle.id });
      if (!zeilen.length) continue;
      const ids = zeilen.map((z: { id: string }) => z.id);
      verweise.push({ tabelle: tabellenName(verweis.tabelle), spalte: spaltenName, ids });
      if (verweis.tabelle === schema.deals) betroffeneDealIds.push(...ids);
    }

    await tx.update(t).set({ deletedAt: sql`now()` }).where(eq(t.id, sekundaerId));
  });

  const nachher = await aggregat(db, typ, primaerId);
  const [protokoll] = await db.insert(schema.mergeProtokoll).values({
    id: crypto.randomUUID(), entitaet: typ, aktion: 'merge', primaerId, sekundaerId,
    primaerSnapshot: vorher.primaer as unknown as object, sekundaerSnapshot: vorher.sekundaer as unknown as object,
    ergebnisSnapshot: nachher as unknown as object, betroffeneDealIds, betroffeneDateien: { dateien, verweise },
  }).returning();

  await auditSchreiben(db, {
    type: 'merge', entity: typ, entityId: primaerId, action: 'merge', source: '/api/dubletten/zusammenfuehren',
    metadata: { sekundaerId, protokollId: protokoll!.id, betroffeneDealIds, dateien },
  });
  return { protokollId: protokoll!.id, betroffeneDealIds, betroffeneDateien: dateien.reduce((s, x) => s + x.ids.length, 0) };
}

/** Protokoll der letzten Zusammenführungen (abgelaufen = älter als 24 Stunden). */
export async function dublettenProtokoll(db: Db) {
  const zeilen = await db.select().from(schema.mergeProtokoll).orderBy(sql`${schema.mergeProtokoll.am} desc`).limit(50);
  return zeilen.map((z) => ({
    id: z.id, typ: (z.entitaet ?? '') as string, primaerId: z.primaerId ?? '', sekundaerId: z.sekundaerId ?? '',
    am: z.am, rueckgaengigAm: z.rueckgaengigAm, abgelaufen: mergeAbgelaufen(z.am),
    betroffeneDeals: z.betroffeneDealIds?.length ?? 0,
  }));
}

/** undoMerge: Stand vor dem Zusammenführen wiederherstellen; nur innerhalb von 24 Stunden und nur mit Nachfrage, wenn seither gearbeitet wurde. */
export async function dublettenRueckgaengig(db: Db, protokollId: string, erzwingen = false) {
  const [p] = await db.select().from(schema.mergeProtokoll).where(eq(schema.mergeProtokoll.id, protokollId));
  if (!p) throw new FachFehler(404, 'Protokolleintrag nicht gefunden');
  if (p.rueckgaengigAm) throw new FachFehler(409, 'Dieser Merge wurde bereits zurückgenommen');
  if (mergeAbgelaufen(p.am)) throw new FachFehler(409, 'Rückgängig ist nur 24 Stunden lang möglich');

  const typ = p.entitaet as DublettenEntitaet;
  const primaer = p.primaerSnapshot as unknown as Aggregat;
  const sekundaer = p.sekundaerSnapshot as unknown as Aggregat;
  const ergebnis = p.ergebnisSnapshot as unknown as Aggregat | null;
  const umgebogen = ((p.betroffeneDateien as { verweise?: { tabelle: string; spalte: string; ids: string[] }[] } | null)?.verweise ?? []);
  const t = TABELLE[typ];

  if (!erzwingen && ergebnis) {
    const jetzt = await aggregat(db, typ, p.primaerId!);
    // Schlüssel sortiert vergleichen: der Schnappschuss kommt aus jsonb und behält die Reihenfolge nicht
    const vergleichbar = (a: Aggregat) => {
      const { updatedAt: _u, version: _v, kommunikation: _k, einheiten: _e, kommentare: _km, sanierungen: _s, ...rest } = a.datensatz as Record<string, unknown>;
      return JSON.stringify(Object.fromEntries(Object.entries(rest).sort(([x], [y]) => x.localeCompare(y))));
    };
    if (vergleichbar(jetzt) !== vergleichbar(ergebnis)) throw new FachFehler(409, MERGE_GEAENDERT_HINWEIS, { needsForce: true });
  }

  await db.transaction(async (tx) => {
    await tx.update(t).set({ ...spaltenWerte(typ, primaer.datensatz), version: sql`${t.version} + 1`, updatedAt: sql`now()` }).where(eq(t.id, p.primaerId!));
    if (typ === 'makler') await tx.update(schema.makler).set({ kiSummary: primaer.datensatz.kiSummary ?? null, kiSummaryAt: primaer.datensatz.kiSummaryAt ?? null }).where(eq(schema.makler.id, p.primaerId!));
    await tx.update(t).set({ deletedAt: null }).where(eq(t.id, p.sekundaerId!));

    // Unterlisten zurück an ihren Besitzer
    for (const liste of UNTERLISTEN[typ]) {
      const spaltenName = verweisSpalte(liste.spalte);
      const zeilenB = (sekundaer.listen[liste.name] ?? []) as any[];
      if (zeilenB.length) await tx.update(liste.tabelle).set({ [spaltenName]: p.sekundaerId! }).where(inArray(liste.tabelle.id, zeilenB.map((z) => z.id)));
      const zeilenA = (primaer.listen[liste.name] ?? []) as any[];
      if (zeilenA.length) {
        // Zeilen des behaltenen Eintrags, die „nur B“ gelöscht hatte, wieder einsetzen
        const vorhanden = await tx.select({ id: liste.tabelle.id }).from(liste.tabelle).where(inArray(liste.tabelle.id, zeilenA.map((z) => z.id)));
        const fehlend = zeilenA.filter((z) => !vorhanden.some((v: { id: string }) => v.id === z.id));
        if (fehlend.length) await tx.insert(liste.tabelle).values(fehlend);
        await tx.update(liste.tabelle).set({ [spaltenName]: p.primaerId! }).where(inArray(liste.tabelle.id, zeilenA.map((z) => z.id)));
      }
    }

    // Verweise zurückbiegen: genau die Zeilen, die dieser Merge umgebogen hat
    for (const v of umgebogen) {
      const verweis = VERWEISE[typ].find((x) => tabellenName(x.tabelle) === v.tabelle && verweisSpalte(x.spalte) === v.spalte);
      if (!verweis || !v.ids.length) continue;
      await tx.update(verweis.tabelle).set({ [v.spalte]: p.sekundaerId! })
        .where(and(inArray(verweis.tabelle.id, v.ids), eq(verweis.spalte, p.primaerId!)));
    }
  });

  await db.update(schema.mergeProtokoll).set({ rueckgaengigAm: sql`now()` }).where(eq(schema.mergeProtokoll.id, protokollId));
  await auditSchreiben(db, { type: 'merge', entity: typ, entityId: p.primaerId, action: 'merge-undo', source: '/api/dubletten/protokoll/{id}/rueckgaengig', metadata: { protokollId, sekundaerId: p.sekundaerId } });
  return { ok: true as const };
}
