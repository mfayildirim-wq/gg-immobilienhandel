import { createDb, schema } from '@gg/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll } from 'vitest';

/**
 * Die Tests rechnen mit den **ausgelieferten** Kalkulations-Standards. Liegen in der lokalen Datenbank eigene
 * (etwa nach einem Umzug des echten Bestands: Notar 2 %, Makler 4,76 %), rechnen dieselben Tests andere Zahlen und
 * werden rot — sie prüften dann die Umgebung statt des Verhaltens. Deshalb: gespeicherte Standards für die Dauer
 * der Tests beiseitelegen und danach unverändert zurückschreiben.
 *
 * Mit **eigener** Verbindung: die Testdateien schließen ihre im eigenen `afterAll`, und das läuft vor diesem hier —
 * beim ersten Versuch über die geteilte Verbindung scheiterte das Zurückschreiben, und die Standards waren weg.
 */
export function mitAusgeliefertenStandards(url: string) {
  const SCHLUESSEL = 'kalk-standard';
  const { db, client } = createDb(url);
  let gesichert: typeof schema.einstellungen.$inferSelect | undefined;
  beforeAll(async () => {
    [gesichert] = await db.select().from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, SCHLUESSEL));
    if (gesichert) await db.delete(schema.einstellungen).where(eq(schema.einstellungen.schluessel, SCHLUESSEL));
  });
  afterAll(async () => {
    try {
      if (gesichert) await db.insert(schema.einstellungen).values(gesichert).onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert: gesichert.wert, updatedAt: gesichert.updatedAt } });
    } finally {
      await client.end();
    }
  });
}
