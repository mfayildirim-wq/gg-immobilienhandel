import type { GespeicherterFilter, GespeicherterFilterAnlegen, ListenAltformat } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { fehlendeVorlagen, type Module, type SavedFilter } from '@gg/domain';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import { exposeDokumentIds } from './dealDokumente.ts';

/** Felder ohne Wert weglassen: die alte Sammlung kannte sie dann nicht (wichtig für is_set/is_empty der Filter). */
const ohneLeer = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
const gruppieren = <T, K>(liste: T[], schluessel: (x: T) => K) => {
  const m = new Map<K, T[]>();
  for (const x of liste) m.set(schluessel(x), [...(m.get(schluessel(x)) ?? []), x]);
  return m;
};

/**
 * Makler, Objekte und Deals im Format der alten Sammlungen (DB.makler()/objs()/deals()), in deren Reihenfolge, ohne Papierkorb.
 * Grundlage der Listenregeln und der gespeicherten Filter (Feldpfade wie `kalk.kaufpreis`, `adresse`, `prio`).
 */
export async function listenAltformat(db: Db): Promise<ListenAltformat> {
  const makler = await db.select().from(schema.makler).where(isNull(schema.makler.deletedAt)).orderBy(asc(schema.makler.reihenfolge), asc(schema.makler.id));
  const objekte = await db.select().from(schema.objekte).where(isNull(schema.objekte.deletedAt)).orderBy(asc(schema.objekte.reihenfolge), asc(schema.objekte.id));
  const deals = await db.select().from(schema.deals).where(isNull(schema.deals.deletedAt)).orderBy(asc(schema.deals.reihenfolge), asc(schema.deals.id));
  const objEinheiten = gruppieren(await db.select().from(schema.objektEinheiten).orderBy(asc(schema.objektEinheiten.sort)), (e) => e.objektId);
  const dealEinheiten = gruppieren(await db.select().from(schema.dealEinheiten).orderBy(asc(schema.dealEinheiten.sort)), (e) => e.dealId);
  const sanierungen = gruppieren(await db.select().from(schema.dealSanierungen).orderBy(asc(schema.dealSanierungen.sort)), (e) => e.dealId);
  const objNachId = new Map(objekte.map((o) => [o.id, o]));
  const mkNachId = new Map(makler.map((m) => [m.id, m]));

  return {
    exposeIds: await exposeDokumentIds(db),
    makler: makler.map((m) => ohneLeer({
      id: m.id, name: m.name, firma: m.firma, tel: m.tel, email: m.email, webseite: m.webseite, prio: m.prio, kontaktFreq: m.kontaktFrequenz === 'Nie' ? 'Nicht kontaktieren' : m.kontaktFrequenz, // Makler-Formular der alten App kannte nur „Nicht kontaktieren“
      lastContact: m.lastContact, nextContact: m.nextContact, relationshipNote: m.beziehungsNotiz, tags: m.tags, personal: m.persoenlich, aiSummary: m.kiSummary,
    })),
    objekte: objekte.map((o) => {
      const details = (o.details as Record<string, unknown> | null) ?? {};
      return ohneLeer({
        ...details,
        id: o.id, strasse: o.strasse, hausnr: o.hausnr, plz: o.plz, stadt: o.stadt, bundesland: o.bundesland, baujahr: o.baujahr, einheitenAnz: o.einheitenAnzahl,
        wohnflaeche: o.wohnflaeche, grundstueck: o.grundstueck, energie: o.energieklasse, heizung: o.heizung, angebotspreis: o.angebotspreis, zielpreis: o.zielpreis,
        istmiete: o.istMiete, sollmiete: o.sollMiete, status: o.status, notizen: o.notizen, datum: o.erfasstAm,
        einheiten: (objEinheiten.get(o.id) ?? []).map((e) => ohneLeer({ id: e.id, typ: e.typ, lage: e.lage, zimmer: e.zimmer, stueck: e.stueck, flaeche: e.flaeche, kaltmiete: e.kaltmiete, vermiet: e.vermietung })),
      });
    }),
    deals: deals.map((d) => {
      const o = objNachId.get(d.objektId);
      const m = d.maklerId ? mkNachId.get(d.maklerId) : undefined;
      return ohneLeer({
        id: d.id, objId: d.objektId, maklerId: d.maklerId, status: d.status, prio: d.prio, angebotsDatum: d.angebotsDatum, nachfassFreq: d.nachfassFrequenz,
        lastContact: d.lastContact, nextContact: d.nextContact, kalk: d.kalkulation, notizen: d.notizen,
        // Kopien der alten App (Objekt/Makler), hier stets aktuell
        adresse: o?.strasse, hausnr: o?.hausnr, plz: o?.plz, stadt: o?.stadt, wohnflaeche: o?.wohnflaeche, einheitenAnz: o?.einheitenAnzahl,
        maklerName: m?.name, maklerFirma: m?.firma, maklerTel: m?.tel, maklerEmail: m?.email,
        einheiten: (dealEinheiten.get(d.id) ?? []).map((e) => ohneLeer({
          id: e.id, typ: e.typ, lage: e.lage, zimmer: e.zimmer, fl: e.flaeche, mi_ist: e.mieteIst, mi_neu: e.mieteNeu, mi_neu_manual: e.mieteNeuManuell, rend_k: e.renditeK, vkp: e.verkaufspreis, stk: e.stueck,
        })),
        sanierung: (sanierungen.get(d.id) ?? []).map((s) => ohneLeer({ id: s.id, desc: s.beschreibung, amt: s.betrag, scope: s.bereich })),
      });
    }),
  };
}

// ── Gespeicherte Filter ───────────────────────────────────────
const sekunden = (ts: string) => Math.floor(new Date(ts.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).getTime() / 1000);
type Zeile = typeof schema.gespeicherteFilter.$inferSelect;
const alsFilter = (f: Zeile): GespeicherterFilter => ({
  id: f.id, module: f.modul as GespeicherterFilter['module'], name: f.name ?? '', criteria: (f.kriterien ?? []) as GespeicherterFilter['criteria'],
  createdAt: sekunden(f.createdAt), updatedAt: sekunden(f.updatedAt),
});

export async function filterListe(db: Db): Promise<GespeicherterFilter[]> {
  return (await db.select().from(schema.gespeicherteFilter).orderBy(asc(schema.gespeicherteFilter.createdAt), asc(schema.gespeicherteFilter.id))).map(alsFilter);
}

export async function filterAnlegen(db: Db, e: GespeicherterFilterAnlegen): Promise<GespeicherterFilter> {
  const [f] = await db.insert(schema.gespeicherteFilter).values({ id: crypto.randomUUID(), modul: e.module, name: e.name.trim(), kriterien: e.criteria }).returning();
  return alsFilter(f!);
}

/** sfRename: nur der Name ändert sich (updatedAt neu). */
export async function filterUmbenennen(db: Db, id: string, name: string): Promise<GespeicherterFilter> {
  const [f] = await db.update(schema.gespeicherteFilter).set({ name: name.trim(), updatedAt: new Date().toISOString() }).where(eq(schema.gespeicherteFilter.id, id)).returning();
  if (!f) throw new FachFehler(404, 'Filter nicht gefunden');
  return alsFilter(f);
}

export async function filterLoeschen(db: Db, id: string) {
  const [f] = await db.delete(schema.gespeicherteFilter).where(eq(schema.gespeicherteFilter.id, id)).returning({ id: schema.gespeicherteFilter.id });
  if (!f) throw new FachFehler(404, 'Filter nicht gefunden');
  return { id };
}

/** ensureTemplatesInstalled: fehlende Vorlagen des Moduls anlegen (nach Namen), serialisiert gegen parallele Aufrufe. */
export async function filterVorlagenEinrichten(db: Db, module: Module): Promise<GespeicherterFilter[]> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('gespeicherte_filter_vorlagen'))`);
    const alle = (await tx.select().from(schema.gespeicherteFilter)).map(alsFilter) as SavedFilter[];
    const fehlend = fehlendeVorlagen(alle, module);
    if (fehlend.length) await tx.insert(schema.gespeicherteFilter).values(fehlend.map((t) => ({ id: crypto.randomUUID(), modul: t.module, name: t.name, kriterien: t.criteria })));
  });
  return filterListe(db);
}
