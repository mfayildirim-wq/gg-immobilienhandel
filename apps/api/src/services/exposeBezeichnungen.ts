/**
 * Exposé-Wörterbuch (Protokoll 30 §6/§10): lernt beim Zuordnen auf der Prüfseite und im Reiter „Aus dem Exposé“.
 * Schlüssel = normalisierte Bezeichnung (`bezeichnungSchluessel`), Ziel = gg-Ziel-Schlüssel. Notizen werden nicht gelernt.
 */
import type { ExposeBezeichnung } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { bezeichnungSchluessel, type Gelernt, GG_ZIELE } from '@gg/domain';
import { desc, eq, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import type { Tx } from './tx.ts';

/** Alles Gelernte als Schlüssel → Ziel, für `zuordnen(…, gelernt)` und `angabenAusImport(…, gelernt)`. */
export async function gelerntLesen(db: Db | Tx): Promise<Gelernt> {
  const z = await db.select({ schluessel: schema.exposeBezeichnungen.schluessel, ziel: schema.exposeBezeichnungen.ziel }).from(schema.exposeBezeichnungen);
  return Object.fromEntries(z.map((x) => [x.schluessel, x.ziel]));
}

/** Merkt „Bezeichnung → Ziel“; gleiche Bezeichnung erneut: Ziel wird überschrieben, Anzahl +1. Gibt false zurück, wenn nichts zu lernen war. */
export async function lernen(db: Db | Tx, bezeichnung: string, ziel: string): Promise<boolean> {
  const schluessel = bezeichnungSchluessel(bezeichnung);
  if (!schluessel || ziel === 'notizen' || !GG_ZIELE[ziel]) return false;
  const t = schema.exposeBezeichnungen;
  await db.insert(t).values({ schluessel, bezeichnung: bezeichnung.trim(), ziel })
    .onConflictDoUpdate({ target: t.schluessel, set: { bezeichnung: bezeichnung.trim(), ziel, anzahl: sql`${t.anzahl} + 1`, zuletzt: sql`now()` } });
  return true;
}

export async function bezeichnungenListe(db: Db): Promise<ExposeBezeichnung[]> {
  const t = schema.exposeBezeichnungen;
  const z = await db.select().from(t).orderBy(desc(t.zuletzt));
  return z.map((x) => ({ schluessel: x.schluessel, bezeichnung: x.bezeichnung, ziel: x.ziel, anzahl: x.anzahl, zuletzt: x.zuletzt }));
}

export async function bezeichnungLoeschen(db: Db, schluessel: string) {
  const weg = await db.delete(schema.exposeBezeichnungen).where(eq(schema.exposeBezeichnungen.schluessel, schluessel)).returning({ s: schema.exposeBezeichnungen.schluessel });
  if (!weg.length) throw new FachFehler(404, 'Eintrag nicht gefunden');
  return { schluessel };
}
