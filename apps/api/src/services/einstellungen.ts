import { type Db, schema } from '@gg/db';
import { KALK_STANDARD, type KalkStandard, KUNDENKALK_STANDARD, type KundenkalkStandard, standardVorlagen, type Vorlage, vorlagenBereinigen } from '@gg/domain';
import { asc, eq, sql } from 'drizzle-orm';
import type { Tx } from './tx.ts';

const SCHLUESSEL_KALK = 'kalk-standard';

/** Kalkulations-Standardwerte (alte App: immo-kalk-defaults), fehlende Werte aus KALK_STANDARD. */
export async function kalkStandardLesen(db: Db | Tx): Promise<KalkStandard> {
  const [zeile] = await db.select({ wert: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, SCHLUESSEL_KALK));
  return { ...KALK_STANDARD, ...((zeile?.wert as Partial<KalkStandard> | null) ?? {}) };
}

export async function kalkStandardSpeichern(db: Db, wert: KalkStandard): Promise<KalkStandard> {
  await db
    .insert(schema.einstellungen)
    .values({ schluessel: SCHLUESSEL_KALK, wert, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert, updatedAt: sql`now()` } });
  return wert;
}

async function wertLesen(db: Db | Tx, schluessel: string): Promise<unknown> {
  const [zeile] = await db.select({ wert: schema.einstellungen.wert }).from(schema.einstellungen).where(eq(schema.einstellungen.schluessel, schluessel));
  return zeile?.wert ?? null;
}

async function wertSpeichern(db: Db | Tx, schluessel: string, wert: unknown) {
  await db
    .insert(schema.einstellungen)
    .values({ schluessel, wert: wert as object, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert: wert as object, updatedAt: sql`now()` } });
}

/** Kundenkalkulation: Standardannahmen (%), zentrale Hinweise, Disclaimer (leer = Vorlage). */
export async function kundenkalkEinstellungenLesen(db: Db | Tx) {
  const standard = { ...KUNDENKALK_STANDARD, ...((await wertLesen(db, 'kundenkalk-standard')) as Partial<KundenkalkStandard> | null ?? {}) };
  const hinweise = await wertLesen(db, 'kundenkalk-hinweise');
  const disclaimer = await wertLesen(db, 'kundenkalk-disclaimer');
  const ersteller = await wertLesen(db, 'mein-name');
  return {
    standard,
    hinweise: Array.isArray(hinweise) ? hinweise.filter((h): h is string => typeof h === 'string') : [],
    disclaimer: typeof disclaimer === 'string' ? disclaimer : '',
    ersteller: typeof ersteller === 'string' ? ersteller : '',
  };
}

export async function kundenkalkEinstellungenSpeichern(db: Db, e: { standard: KundenkalkStandard; hinweise: string[]; disclaimer: string; ersteller?: string }) {
  await db.transaction(async (tx) => {
    await wertSpeichern(tx, 'kundenkalk-standard', e.standard);
    await wertSpeichern(tx, 'kundenkalk-hinweise', e.hinweise.map((h) => h.trim()).filter(Boolean));
    await wertSpeichern(tx, 'kundenkalk-disclaimer', e.disclaimer.trim() || null);
    if (e.ersteller !== undefined) await wertSpeichern(tx, 'mein-name', e.ersteller.trim() || null);
  });
  return kundenkalkEinstellungenLesen(db);
}

/** Textvorlagen + „Mein Name“ (Platzhalter {meinName}). Nie gespeichert → Standardvorlagen wie alt (getVorlagen). */
export async function vorlagenLesen(db: Db | Tx): Promise<{ vorlagen: Vorlage[]; meinName: string }> {
  const gespeichert = (await wertLesen(db, 'textvorlagen-gespeichert')) === true;
  const zeilen = await db.select().from(schema.textvorlagen).orderBy(asc(schema.textvorlagen.sort));
  const meinName = await wertLesen(db, 'mein-name');
  const vorlagen = gespeichert
    ? zeilen.map((v) => ({ id: v.id, name: v.name ?? '', kanal: (v.kanal ?? 'email') as Vorlage['kanal'], ...(v.betreff !== null ? { betreff: v.betreff } : {}), text: v.text ?? '' }))
    : standardVorlagen(() => crypto.randomUUID());
  return { vorlagen, meinName: typeof meinName === 'string' ? meinName : '' };
}

export async function vorlagenSpeichern(db: Db, e: { vorlagen: Vorlage[]; meinName: string }) {
  await db.transaction(async (tx) => {
    await tx.delete(schema.textvorlagen);
    const bereinigt = vorlagenBereinigen(e.vorlagen);
    if (bereinigt.length) await tx.insert(schema.textvorlagen).values(bereinigt.map((v, sort) => ({ id: v.id || crypto.randomUUID(), sort, name: v.name, kanal: v.kanal, betreff: v.betreff ?? null, text: v.text })));
    await wertSpeichern(tx, 'textvorlagen-gespeichert', true);
    await wertSpeichern(tx, 'mein-name', e.meinName.trim() || null);
  });
  return vorlagenLesen(db);
}
