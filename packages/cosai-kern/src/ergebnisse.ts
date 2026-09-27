/**
 * Ergebnisse des Agenten mit Bezug auf Objekte der App. Der Bezug entsteht aus dem Fokus, den die App markiert
 * (`data-agent-fokus='{"dealId":"…","deal":"Musterweg 1"}'`): jeder Schlüssel `<typ>Id` wird ein Bezug, `<typ>` ist
 * seine Bezeichnung. Die App muss dafür nichts weiter tun — und jede andere App funktioniert genauso.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './gedaechtnis.ts';
import { ergebnisBezuege, ergebnisse } from './schema.ts';

export interface Bezug { typ: string; refId: string; bezeichnung: string }
export interface Quelle { titel: string; url?: string }
export interface Ergebnis {
  id: string;
  titel: string;
  art: string;
  inhalt: string;
  quellen: Quelle[];
  frage: string | null;
  werkzeuge: string[];
  modell: string | null;
  nutzer: string;
  createdAt: string;
  bezuege: Bezug[];
}
export interface NeuesErgebnis { titel: string; art: string; inhalt: string; quellen: Quelle[]; frage?: string; werkzeuge: string[]; modell?: string; sitzungId?: string; bezuege: Bezug[] }

export function bezuegeAusKontext(kontext: Record<string, unknown>): Bezug[] {
  return Object.entries(kontext)
    .filter(([k, v]) => /^[a-z][a-zA-Z0-9]*Id$/.test(k) && typeof v === 'string' && v !== '')
    .map(([k, v]) => {
      const typ = k.slice(0, -2);
      const name = kontext[typ];
      return { typ, refId: v as string, bezeichnung: typeof name === 'string' ? name : '' };
    });
}

export function ergebnisseVon(db: Db, nutzer: string) {
  async function mitBezuegen(zeilen: (typeof ergebnisse.$inferSelect)[]): Promise<Ergebnis[]> {
    if (!zeilen.length) return [];
    const b = await db.select().from(ergebnisBezuege).where(inArray(ergebnisBezuege.ergebnisId, zeilen.map((z) => z.id)));
    return zeilen.map((z) => ({
      id: z.id, titel: z.titel, art: z.art, inhalt: z.inhalt, quellen: (z.quellen ?? []) as Quelle[], frage: z.frage,
      werkzeuge: (z.werkzeuge ?? []) as string[], modell: z.modell, nutzer: z.nutzer, createdAt: new Date(z.createdAt).toISOString(),
      bezuege: b.filter((x) => x.ergebnisId === z.id).map((x) => ({ typ: x.typ, refId: x.refId, bezeichnung: x.bezeichnung })),
    }));
  }
  const zuBezug = (typ: string, id: string) => sql`${ergebnisse.id} in (select ${ergebnisBezuege.ergebnisId} from ${ergebnisBezuege} where ${ergebnisBezuege.typ} = ${typ} and ${ergebnisBezuege.refId} = ${id})`;

  return {
    async speichern(e: NeuesErgebnis): Promise<Ergebnis> {
      const [z] = await db.insert(ergebnisse).values({
        nutzer, titel: e.titel.slice(0, 200), art: e.art || 'sonstiges', inhalt: e.inhalt, quellen: e.quellen.slice(0, 50), frage: e.frage ?? null,
        werkzeuge: e.werkzeuge, modell: e.modell ?? null, sitzungId: e.sitzungId ?? null,
      }).returning();
      if (e.bezuege.length) await db.insert(ergebnisBezuege).values(e.bezuege.map((b) => ({ ergebnisId: z!.id, typ: b.typ, refId: b.refId, bezeichnung: b.bezeichnung }))).onConflictDoNothing();
      return (await mitBezuegen([z!]))[0]!;
    },
    /** Zu einem Objekt der App — oder ohne Bezug die jüngsten */
    async liste(bezug?: { typ: string; id: string }, n = 50): Promise<Ergebnis[]> {
      const zeilen = await db.select().from(ergebnisse).where(bezug ? zuBezug(bezug.typ, bezug.id) : undefined).orderBy(desc(ergebnisse.createdAt)).limit(n);
      return mitBezuegen(zeilen);
    },
    async zaehlen(bezug: { typ: string; id: string }): Promise<number> {
      const [z] = await db.select({ n: sql<number>`count(*)::int` }).from(ergebnisse).where(zuBezug(bezug.typ, bezug.id));
      return z?.n ?? 0;
    },
    async loeschen(id: string): Promise<boolean> {
      const weg = await db.delete(ergebnisse).where(and(eq(ergebnisse.id, id))).returning({ id: ergebnisse.id });
      return weg.length > 0;
    },
  };
}
export type ErgebnisSpeicher = ReturnType<typeof ergebnisseVon>;
