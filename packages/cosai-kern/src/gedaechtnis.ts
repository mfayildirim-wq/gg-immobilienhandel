/**
 * Das Gedächtnis des Agenten — je Nutzer, in vier Schichten (Vertrag `GedaechtnisArt`):
 * Episoden (was getan wurde), Formulierungen (was in welchem Feld gesagt wurde → Vorschläge),
 * Fakten (bestätigt) und Routinen (Reihenfolgen als Daten). Nichts wird stumm gelernt: alles ist sichtbar und löschbar.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { gedaechtnis as tabelle } from './schema.ts';
import type { GedaechtnisEintrag } from './vertrag.ts';

// Der Kern kennt die Datenbank nur als Drizzle-Instanz — welcher Treiber dahinter steht, entscheidet der Host.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any, any>;

export type Gedaechtnis = ReturnType<typeof gedaechtnis>;

export function gedaechtnis(db: Db, nutzer: string) {
  const zeile = (z: typeof tabelle.$inferSelect): GedaechtnisEintrag => ({
    id: z.id,
    art: z.art as GedaechtnisEintrag['art'],
    schluessel: z.schluessel,
    inhalt: z.inhalt,
    kontext: (z.kontext ?? {}) as Record<string, unknown>,
    haeufigkeit: z.haeufigkeit,
    zuletzt: new Date(z.zuletzt).toISOString(),
  });

  return {
    /**
     * Merkt einen Eintrag. Formulierungen, Fakten und Routinen mit gleichem Schlüssel und Inhalt werden nicht
     * doppelt gespeichert, sondern zählen hoch — so entsteht die Häufigkeit für die Vorschläge. Episoden sind immer neu.
     */
    async merke(art: GedaechtnisEintrag['art'], schluessel: string, inhalt: string, kontext: Record<string, unknown> = {}): Promise<GedaechtnisEintrag> {
      const text = inhalt.trim();
      if (art === 'episode') {
        const [z] = await db.insert(tabelle).values({ nutzer, art, schluessel, inhalt: text, kontext }).returning();
        return zeile(z!);
      }
      const [z] = await db
        .insert(tabelle)
        .values({ nutzer, art, schluessel, inhalt: text, kontext })
        .onConflictDoUpdate({
          target: [tabelle.nutzer, tabelle.art, tabelle.schluessel, tabelle.inhalt],
          // Teilindex: Postgres findet ihn nur mit derselben Bedingung
          targetWhere: sql`art <> 'episode'`,
          set: { haeufigkeit: sql`${tabelle.haeufigkeit} + 1`, zuletzt: sql`now()`, kontext },
        })
        .returning();
      return zeile(z!);
    },

    /** Die häufigsten, zuletzt genutzten Einträge einer Art — mit Schlüssel eingegrenzt, sonst alle. */
    async erinnere(art: GedaechtnisEintrag['art'], schluessel?: string, n = 5): Promise<GedaechtnisEintrag[]> {
      const wo = schluessel ? and(eq(tabelle.nutzer, nutzer), eq(tabelle.art, art), eq(tabelle.schluessel, schluessel)) : and(eq(tabelle.nutzer, nutzer), eq(tabelle.art, art));
      const zeilen = await db.select().from(tabelle).where(wo).orderBy(desc(tabelle.haeufigkeit), desc(tabelle.zuletzt)).limit(n);
      return zeilen.map(zeile);
    },

    /** Die jüngsten Episoden — der Zeitstrahl „was ich getan habe“. */
    async verlauf(n = 20, sitzungId?: string): Promise<GedaechtnisEintrag[]> {
      const wo = sitzungId
        ? and(eq(tabelle.nutzer, nutzer), eq(tabelle.art, 'episode'), sql`${tabelle.kontext}->>'sitzungId' = ${sitzungId}`)
        : and(eq(tabelle.nutzer, nutzer), eq(tabelle.art, 'episode'));
      const zeilen = await db.select().from(tabelle).where(wo).orderBy(desc(tabelle.createdAt)).limit(n);
      return zeilen.map(zeile);
    },

    /** Alles, was gemerkt ist — für die Gedächtnis-Leiste. */
    async alles(n = 200): Promise<GedaechtnisEintrag[]> {
      const zeilen = await db.select().from(tabelle).where(eq(tabelle.nutzer, nutzer)).orderBy(desc(tabelle.zuletzt)).limit(n);
      return zeilen.map(zeile);
    },

    async bestaetige(id: string): Promise<void> {
      await db.update(tabelle).set({ bestaetigt: true }).where(and(eq(tabelle.id, id), eq(tabelle.nutzer, nutzer)));
    },

    /** Löscht nur eigene Einträge — die Kennung allein reicht nicht. */
    async loeschen(id: string): Promise<boolean> {
      const weg = await db.delete(tabelle).where(and(eq(tabelle.id, id), eq(tabelle.nutzer, nutzer))).returning({ id: tabelle.id });
      return weg.length > 0;
    },

    async leeren(): Promise<number> {
      const weg = await db.delete(tabelle).where(eq(tabelle.nutzer, nutzer)).returning({ id: tabelle.id });
      return weg.length;
    },
  };
}
