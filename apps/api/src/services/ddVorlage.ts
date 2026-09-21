import { type Db, schema } from '@gg/db';
import { DD_STANDARD, ddListeBereinigen, type DdZeile } from '@gg/domain';
import { asc } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';

/** getDDTemplate: die gespeicherte Liste, sonst der Auslieferungszustand. */
export async function ddVorlageLesen(db: Db): Promise<{ zeilen: DdZeile[]; gespeichert: boolean }> {
  const zeilen = await db.select().from(schema.ddChecklisteVorlage).orderBy(asc(schema.ddChecklisteVorlage.sort), asc(schema.ddChecklisteVorlage.id));
  if (!zeilen.length) return { zeilen: DD_STANDARD.map((z) => ({ ...z })), gespeichert: false };
  return { zeilen: zeilen.map((z) => ({ dokument: z.dokument ?? '', quelle: z.quelle ?? '—' })), gespeichert: true };
}

/** settingsDDSave: die Liste als Ganzes ersetzen — die Reihenfolge ist die Information. Leere Liste = zurück zum Auslieferungszustand. */
export async function ddVorlageSpeichern(db: Db, eingabe: { dokument?: string | null; quelle?: string | null }[]) {
  const zeilen = ddListeBereinigen(eingabe);
  await db.transaction(async (tx) => {
    await tx.delete(schema.ddChecklisteVorlage);
    if (zeilen.length) await tx.insert(schema.ddChecklisteVorlage).values(zeilen.map((z, i) => ({ ...z, sort: i })));
  });
  await auditSchreiben(db, { type: 'mutation', entity: 'dd-template', action: 'update', collection: 'dd_checkliste_vorlage', source: '/api/einstellungen/dd-vorlage', metadata: { positionen: zeilen.length } });
  return ddVorlageLesen(db);
}
