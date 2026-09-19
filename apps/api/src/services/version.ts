import { schema } from '@gg/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { FachFehler } from '../fehler.ts';
import type { Tx } from './tx.ts';

type Versioniert = typeof schema.deals | typeof schema.makler | typeof schema.objekte;

/**
 * Optimistisches Sperren (07, Regel 6): Zeile sperren, Version vergleichen, Version erhöhen.
 * Ersetzt die 409-Zusammenführung ganzer Sammlungen der alten App durch eine Prüfung je Datensatz.
 */
export async function versionFortschreiben(tx: Tx, tabelle: Versioniert, id: string, version: number, name: string): Promise<number> {
  const [zeile] = await tx
    .select({ version: tabelle.version })
    .from(tabelle)
    .where(and(eq(tabelle.id, id), isNull(tabelle.deletedAt)))
    .for('update');
  if (!zeile) throw new FachFehler(404, `${name} nicht gefunden`);
  if (zeile.version !== version) {
    throw new FachFehler(409, `${name} wurde zwischenzeitlich geändert`, { aktuelleVersion: zeile.version });
  }
  const [neu] = await tx
    .update(tabelle)
    .set({ version: sql`${tabelle.version} + 1`, updatedAt: sql`now()` })
    .where(eq(tabelle.id, id))
    .returning({ version: tabelle.version });
  return neu!.version;
}
