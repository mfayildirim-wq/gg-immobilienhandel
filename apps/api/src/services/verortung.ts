import { type Db, schema } from '@gg/db';
import { type Anschrift, type Verortung, verortungMoeglich, verortungSchluessel, verortungWaehlen } from '@gg/domain';
import type { Geocoder } from '@gg/integrations';
import { eq, sql } from 'drizzle-orm';

const TAG_MS = 86_400_000;
/** Ein Stadtteil ändert sich nicht; ein Fehlschlag (z. B. Adresse noch unvollständig) wird nach einer Woche neu versucht. */
const GUELTIG_TREFFER_MS = 180 * TAG_MS;
const GUELTIG_OHNE_MS = 7 * TAG_MS;

/**
 * Stadtteil zur Adresse für die KI-Lagebeschreibung — aus dem Zwischenspeicher oder vom Kartendienst.
 * Wirft nie: ohne Dienst, ohne Straße oder bei einer Störung gibt es `null`, und die KI nennt dann keinen Stadtteil.
 * Störungen werden nicht gespeichert, damit der nächste Versuch wieder fragt.
 */
export async function verortungErmitteln(db: Db, geocoder: Geocoder | null | undefined, anschrift: Anschrift, jetzt = Date.now()): Promise<Verortung | null> {
  if (!geocoder || !verortungMoeglich(anschrift)) return null;
  const schluessel = verortungSchluessel(anschrift);
  const [z] = await db.select().from(schema.geoVerortungen).where(eq(schema.geoVerortungen.schluessel, schluessel));
  if (z) {
    const alter = jetzt - new Date(z.abgerufenAt).getTime();
    if (alter < (z.ergebnis ? GUELTIG_TREFFER_MS : GUELTIG_OHNE_MS)) return (z.ergebnis as Verortung | null) ?? null;
  }
  let ergebnis: Verortung | null;
  try {
    ergebnis = verortungWaehlen(anschrift, await geocoder.kandidaten(anschrift));
  } catch (e) {
    console.warn('[verortung] Kartendienst nicht erreichbar:', e instanceof Error ? e.message : e);
    return null;
  }
  await db.insert(schema.geoVerortungen).values({ schluessel, ergebnis, abgerufenAt: sql`now()` })
    .onConflictDoUpdate({ target: schema.geoVerortungen.schluessel, set: { ergebnis, abgerufenAt: sql`now()` } });
  return ergebnis;
}
