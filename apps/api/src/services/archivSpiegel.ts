/**
 * Archiv-Spiegel und Aufräumlauf — der zweite Cron (alt: server/archive-mirror.ts, server/cron-archive.ts).
 * Was ein Lauf tun würde, entscheidet `spiegelPlanen` in `@gg/domain`; hier stehen nur die Außenkontakte.
 *
 *  • Die Buchzeile entsteht NACH der geglückten Kopie, nie vorher: jeder Abbruch kostet höchstens die eine Datei, die
 *    gerade lief — sie fehlt im Buch und ist im nächsten Lauf wieder Arbeit.
 *  • Das Buchführen über Verschwundenes hängt NICHT am Kopierbudget: es passiert direkt nach dem Auflisten.
 *  • Kopiert wird im Speicher selbst (`kopieren`), es laufen keine Bytes durch die Function.
 *  • Im Archiv wird nie gelöscht und nie überschrieben: eine vorhandene Fassung wandert nach `_superseded/…`.
 */
import { type Db, schema } from '@gg/db';
import {
  budgetErschoepft, eingangAbgelaufen, ersetztSchluessel, SPIEGEL_BUDGET, type SpiegelBudget, type SpiegelEnde, spiegelPlanen,
} from '@gg/domain';
import { BUCKETS, DATEI_BUCKETS, type Dateispeicher, EINGANG } from '@gg/integrations';
import { and, eq } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';

export interface SpiegelBericht {
  ende: SpiegelEnde;
  kopiert: number;
  bytes: number;
  ersetzt: number;
  offen: number;
  jeBucket: { bucket: string; gelistet: number; neu: number; geaendert: number; verschwunden: number; zurueck: number; unveraendert: number }[];
  fehler: string[];
}

export async function archivSpiegeln(db: Db, speicher: Dateispeicher, opt: { budget?: SpiegelBudget; jetzt?: () => number } = {}): Promise<SpiegelBericht> {
  const budget = opt.budget ?? SPIEGEL_BUDGET;
  const jetzt = opt.jetzt ?? Date.now;
  const start = jetzt();
  const bericht: SpiegelBericht = { ende: 'fertig', kopiert: 0, bytes: 0, ersetzt: 0, offen: 0, jeBucket: [], fehler: [] };

  for (const bucket of DATEI_BUCKETS) {
    const objekte = (await speicher.auflisten(bucket)).map((o) => ({ key: o.key, groesse: o.groesse, stand: `${o.geaendert}|${o.kennung}` }));
    const buch = (await db.select().from(schema.archiveLedger).where(eq(schema.archiveLedger.bucket, bucket)))
      .map((z) => ({ key: z.key, groesse: z.sizeBytes, stand: z.sourceUpdatedAt, verschwundenSeit: z.missingSince }));
    const plan = spiegelPlanen(bucket, objekte, buch);
    const zeile = (key: string) => and(eq(schema.archiveLedger.bucket, bucket), eq(schema.archiveLedger.key, key));

    // Verschwunden / zurück — vor dem Kopieren und unabhängig vom Budget
    for (const key of plan.verschwunden) await db.update(schema.archiveLedger).set({ missingSince: jetzt() }).where(zeile(key));
    for (const key of plan.zurueck) await db.update(schema.archiveLedger).set({ missingSince: null }).where(zeile(key));

    let erledigt = 0;
    for (const a of plan.aufgaben) {
      const stopp = budgetErschoepft(budget, { bytes: bericht.bytes, objekte: bericht.kopiert, millis: jetzt() - start }, a.groesse);
      if (stopp) { bericht.ende = stopp; break; }
      try {
        const kopiere = () => speicher.kopieren(bucket, a.key, BUCKETS.archiv, a.archivKey);
        const beiseite = async () => { await speicher.verschieben(BUCKETS.archiv, a.archivKey, ersetztSchluessel(bucket, a.key, new Date(jetzt()))); bericht.ersetzt++; };
        if (a.art === 'geändert') await beiseite();
        try {
          await kopiere();
        } catch (e) {
          // Kopie lag schon dort, das Buch wusste nichts davon (Abbruch zwischen Kopie und Buchzeile): beiseitelegen, nicht überschreiben
          if (a.art !== 'neu' || !/exist|409|Duplicate/i.test(String(e))) throw e;
          await beiseite();
          await kopiere();
        }
        await db.insert(schema.archiveLedger)
          .values({ bucket, key: a.key, archiveKey: a.archivKey, sizeBytes: a.groesse, sourceUpdatedAt: a.stand, mirroredAt: jetzt(), missingSince: null })
          .onConflictDoUpdate({ target: [schema.archiveLedger.bucket, schema.archiveLedger.key], set: { archiveKey: a.archivKey, sizeBytes: a.groesse, sourceUpdatedAt: a.stand, mirroredAt: jetzt(), missingSince: null } });
        bericht.kopiert++; bericht.bytes += a.groesse; erledigt++;
      } catch (e) {
        // Eine Datei darf den Lauf nicht beenden: sie bleibt ohne Buchzeile und ist im nächsten Lauf wieder Arbeit
        bericht.fehler.push(`${bucket}/${a.key}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
      }
    }
    bericht.offen += plan.aufgaben.length - erledigt;
    bericht.jeBucket.push({
      bucket, gelistet: objekte.length, neu: plan.aufgaben.filter((x) => x.art === 'neu').length, geaendert: plan.aufgaben.filter((x) => x.art === 'geändert').length,
      verschwunden: plan.verschwunden.length, zurueck: plan.zurueck.length, unveraendert: plan.unveraendert,
    });
    // Nach einem Budget-Stopp werden die übrigen Buckets in diesem Lauf nicht betrachtet — und deshalb auch nicht als „weg" gebucht
    if (bericht.ende !== 'fertig') break;
  }
  await auditSchreiben(db, { type: 'backup', action: 'archive-mirror', source: '/api/cron/archiv', metadata: { ...bericht, fehler: bericht.fehler.slice(0, 10) } });
  return bericht;
}

/** Abgebrochene Direkt-Uploads aus den Eingängen entfernen. Gibt die Zahl der gelöschten Objekte zurück. */
export async function eingangAufraeumen(speicher: Dateispeicher, jetzt = Date.now()): Promise<number> {
  let geloescht = 0;
  for (const bucket of [BUCKETS.pdfs, BUCKETS.dealDocs]) {
    const alt = (await speicher.auflisten(bucket, EINGANG)).filter((o) => eingangAbgelaufen(o.geaendert, jetzt)).map((o) => o.key);
    await speicher.loeschen(bucket, alt);
    geloescht += alt.length;
  }
  return geloescht;
}
