import { type Db, schema } from '@gg/db';
import { eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { VORLAGEN_GESPEICHERT, type Zeilen } from './umformen.ts';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const PAKET = 500;

async function einfuegen(tx: Tx, tabelle: PgTable, zeilen: object[]) {
  for (let i = 0; i < zeilen.length; i += PAKET) {
    await tx.insert(tabelle).values(zeilen.slice(i, i + PAKET) as never);
  }
}

/**
 * Spiegelt den Bestand: Umzugstabellen leeren und neu befüllen, in der Transaktion des Aufrufers.
 * Vor dem Umschalttag ist die alte App die Wahrheit; im Neubau erfasste Testdaten dieser Tabellen gehen dabei verloren.
 * Deal-, Objekt- und Makler-Kinder werden per `on delete cascade` mitgelöscht.
 */
export async function schreiben(tx: Tx, z: Zeilen) {
  await tx.delete(schema.kundenkalkulationen); // verweist ohne Kaskade auf deals
  await tx.delete(schema.finanzpraesentationen); // ebenso; Folien gehen per Kaskade mit
  await tx.delete(schema.begleitscheine); // verweist ohne Kaskade auf Objekte und Vorlagen
  await tx.delete(schema.vertriebslisten); // Zeilen per Kaskade
  await tx.delete(schema.projekte); // Einheiten, Gespräche, Aufgaben, Maßnahmen per Kaskade
  await tx.delete(schema.gespeicherteFilter);
  await tx.delete(schema.textvorlagen);
  await tx.delete(schema.ddChecklisteVorlage);
  await tx.delete(schema.einstellungen).where(eq(schema.einstellungen.schluessel, VORLAGEN_GESPEICHERT));
  await tx.delete(schema.begleitscheinAktionen);
  await tx.delete(schema.vordrucke);
  await tx.delete(schema.begleitscheinVorlagen);
  await tx.delete(schema.deals);
  await tx.delete(schema.objekte);
  await tx.delete(schema.makler);

  await einfuegen(tx, schema.makler, z.makler);
  await einfuegen(tx, schema.maklerKommunikation, z.maklerKommunikation);
  await einfuegen(tx, schema.objekte, z.objekte);
  await einfuegen(tx, schema.objektEinheiten, z.objektEinheiten);
  await einfuegen(tx, schema.objektFotos, z.objektFotos);
  await einfuegen(tx, schema.deals, z.deals);
  await einfuegen(tx, schema.dealEinheiten, z.dealEinheiten);
  await einfuegen(tx, schema.dealSanierungen, z.dealSanierungen);
  await einfuegen(tx, schema.dealKommentare, z.dealKommentare);
  await einfuegen(tx, schema.dealKalkVarianten, z.dealKalkVarianten);
  await einfuegen(tx, schema.dealStatusHistorie, z.dealStatusHistorie);
  await einfuegen(tx, schema.dokumente, z.dokumente);
  await einfuegen(tx, schema.kundenkalkulationen, z.kundenkalkulationen);
  await einfuegen(tx, schema.finanzpraesentationen, z.finanzpraesentationen);
  await einfuegen(tx, schema.praesentationFolien, z.praesentationFolien);
  await einfuegen(tx, schema.begleitscheinVorlagen, z.begleitscheinVorlagen);
  await einfuegen(tx, schema.vordrucke, z.vordrucke);
  await einfuegen(tx, schema.begleitscheinAktionen, z.begleitscheinAktionen);
  await einfuegen(tx, schema.begleitscheine, z.begleitscheine);
  await einfuegen(tx, schema.vertriebslisten, z.vertriebslisten);
  await einfuegen(tx, schema.vertriebslisteZeilen, z.vertriebslisteZeilen);
  await einfuegen(tx, schema.projekte, z.projekte);
  await einfuegen(tx, schema.projektEinheiten, z.projektEinheiten);
  await einfuegen(tx, schema.projektMieterhistorie, z.projektMieterhistorie);
  await einfuegen(tx, schema.projektAufgaben, z.projektAufgaben);
  await einfuegen(tx, schema.projektGebaeudeMassnahmen, z.projektGebaeudeMassnahmen);
  await einfuegen(tx, schema.gespeicherteFilter, z.gespeicherteFilter);
  await einfuegen(tx, schema.textvorlagen, z.textvorlagen);
  await einfuegen(tx, schema.ddChecklisteVorlage, z.ddChecklisteVorlage);
  for (const e of z.einstellungen) {
    await tx.insert(schema.einstellungen).values(e).onConflictDoUpdate({ target: schema.einstellungen.schluessel, set: { wert: e.wert, updatedAt: sql`now()` } });
  }
}
