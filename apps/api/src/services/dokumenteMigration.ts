/**
 * Bestand nach SharePoint und Abgleich (Protokoll 19, Phase 4).
 *
 *  • Migration: Dokumente mit `ablage = supabase` werden einzeln gelesen, in SharePoint an ihren Platz gelegt
 *    (Objekt-/Deal-Ordner wie bei neuen Dokumenten), auf Größe geprüft und dann in der Zeile umgestellt. Die Datei in
 *    Supabase bleibt liegen — sie ist der Rückweg, bis jemand bewusst aufräumt. Läuft in Bündeln, damit ein Lauf in
 *    die Zeit einer Function passt, und ist wiederaufnehmbar: was fehlschlägt, bleibt bei `supabase` und ist beim
 *    nächsten Lauf wieder dran.
 *  • Abgleich: Dokumente mit `ablage = sharepoint` werden über ihre stabile Item-Kennung nachgeschlagen — wer in
 *    SharePoint verschiebt oder umbenennt, wird eingeholt (Pfad, Link, eTag); Verschwundenes wird datiert, nicht gelöscht.
 */
import { type Db, schema } from '@gg/db';
import { type Bucket, BUCKETS, type Dateispeicher, type SharepointAblage, sharepointName } from '@gg/integrations';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';
import { sharepointOrdner } from './dateien.ts';
import { FachFehler } from '../fehler.ts';

export interface MigrationsStand { inSupabase: number; inSharepoint: number; fehlend: number }

export async function migrationsStand(db: Db): Promise<MigrationsStand> {
  const [z] = await db.select({
    inSupabase: sql<number>`count(*) filter (where ${schema.dokumente.ablage} = 'supabase')::int`,
    inSharepoint: sql<number>`count(*) filter (where ${schema.dokumente.ablage} = 'sharepoint')::int`,
    fehlend: sql<number>`count(*) filter (where ${schema.dokumente.spFehltSeit} is not null)::int`,
  }).from(schema.dokumente);
  return z!;
}

export async function dokumenteNachSharepoint(db: Db, speicher: Dateispeicher, sharepoint: SharepointAblage | null, limit = 25) {
  if (!sharepoint) throw new FachFehler(422, 'SharePoint ist nicht aktiv (Einstellungen → SharePoint).');
  const zeilen = await db.select().from(schema.dokumente).where(eq(schema.dokumente.ablage, 'supabase')).orderBy(asc(schema.dokumente.hochgeladenAm)).limit(Math.max(1, Math.min(limit, 200)));
  const bericht = { migriert: 0, fehler: [] as string[] };
  for (const d of zeilen) {
    try {
      if (!d.objektId) throw new Error('kein Objektbezug');
      const bytes = await speicher.holen(d.bucket as Bucket, d.storageKey ?? '');
      if (bytes.byteLength !== (d.groesseBytes ?? bytes.byteLength)) throw new Error(`Größe in Supabase ${bytes.byteLength} ≠ ${d.groesseBytes}`);
      const ordner = await sharepointOrdner(db, d.objektId, d.dealId);
      const key = `${ordner}/${sharepointName(d.dateiname || d.id)}`;
      await sharepoint.speicher.ablegen(BUCKETS.dokumente, key, bytes, d.mimeType ?? 'application/octet-stream');
      const it = await sharepoint.item(BUCKETS.dokumente, key);
      if (!it) throw new Error('in SharePoint nicht wiedergefunden');
      const kopf = await sharepoint.speicher.anfang(BUCKETS.dokumente, key, 1);
      if (kopf.groesse !== bytes.byteLength) throw new Error(`Größe in SharePoint ${kopf.groesse} ≠ ${bytes.byteLength}`);
      await db.update(schema.dokumente).set({ ablage: 'sharepoint', bucket: BUCKETS.dokumente, storageKey: key, spItemId: it.id, spPfad: it.pfad, spWebUrl: it.webUrl, spEtag: it.eTag, spFehltSeit: null }).where(eq(schema.dokumente.id, d.id));
      bericht.migriert++;
    } catch (e) {
      // Zeile bleibt bei `supabase` — beim nächsten Lauf wieder dran
      bericht.fehler.push(`${d.dateiname ?? d.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  }
  const stand = await migrationsStand(db);
  await auditSchreiben(db, { type: 'mutation', entity: 'sharepoint', action: 'migration', source: '/api/sharepoint/migration', metadata: { ...bericht, fehler: bericht.fehler.slice(0, 10), offen: stand.inSupabase } });
  return { ...bericht, offen: stand.inSupabase };
}

export async function dokumenteAbgleichen(db: Db, sharepoint: SharepointAblage | null, limit = 200) {
  if (!sharepoint) throw new FachFehler(422, 'SharePoint ist nicht aktiv (Einstellungen → SharePoint).');
  const zeilen = await db.select().from(schema.dokumente).where(and(eq(schema.dokumente.ablage, 'sharepoint'), isNull(schema.dokumente.spFehltSeit)))
    .orderBy(asc(schema.dokumente.hochgeladenAm)).limit(Math.max(1, Math.min(limit, 1000)));
  const verschwundene = await db.select().from(schema.dokumente).where(sql`${schema.dokumente.spFehltSeit} is not null`);
  const bericht = { geprueft: 0, verschoben: 0, verschwunden: 0, zurueck: 0, fehler: [] as string[] };
  for (const d of [...zeilen, ...verschwundene]) {
    try {
      const it = d.spItemId ? await sharepoint.itemNachId(d.spItemId) : null;
      bericht.geprueft++;
      if (!it) {
        if (!d.spFehltSeit) { await db.update(schema.dokumente).set({ spFehltSeit: sql`now()` }).where(eq(schema.dokumente.id, d.id)); bericht.verschwunden++; }
        continue;
      }
      const geaendert = it.pfad !== d.spPfad || it.webUrl !== d.spWebUrl || it.eTag !== d.spEtag;
      if (d.spFehltSeit) bericht.zurueck++;
      if (geaendert && !d.spFehltSeit) bericht.verschoben++;
      if (geaendert || d.spFehltSeit) {
        // der Schlüssel folgt dem Pfad: Wurzel und Bucket-Ordner sind bekannt, der Rest ist der Schlüssel
        const key = sharepoint.schluessel(BUCKETS.dokumente, it.pfad);
        await db.update(schema.dokumente).set({ spPfad: it.pfad, spWebUrl: it.webUrl, spEtag: it.eTag, spFehltSeit: null, dateiname: it.pfad.split('/').pop() ?? d.dateiname, ...(key ? { storageKey: key } : {}) }).where(eq(schema.dokumente.id, d.id));
      }
    } catch (e) {
      bericht.fehler.push(`${d.dateiname ?? d.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  }
  await auditSchreiben(db, { type: 'mutation', entity: 'sharepoint', action: 'abgleich', source: '/api/sharepoint/abgleich', metadata: { ...bericht, fehler: bericht.fehler.slice(0, 10) } });
  return bericht;
}
