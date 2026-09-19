import type { DealDokument } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import { BUCKETS, type Dateispeicher, DOKUMENT_GRENZEN, dokumentSchluessel, einheitenExtrahieren, type ExtrahierteEinheit, type KiClient, kostenBuchung, pdfSeitenzahl, pruefeDateien } from '@gg/integrations';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { auditSchreiben } from './audit.ts';
import { FachFehler } from '../fehler.ts';

const alsDokument = (d: typeof schema.dealDokumente.$inferSelect): DealDokument => ({
  id: d.id, dateiname: d.dateiname ?? '', mimeType: d.mimeType ?? 'application/octet-stream', groesseBytes: d.groesseBytes ?? 0, label: d.label ?? '', hochgeladenAm: d.hochgeladenAm,
});

/** Audit wie alt (logAudit in server/index.ts: Bezeichnung ändern, Löschen). */
async function audit(db: Db, e: { type: 'mutation' | 'delete'; dokId: string; action: 'update' | 'delete'; fieldName?: string; oldValue?: string | null; newValue?: string; metadata?: object }) {
  await auditSchreiben(db, {
    type: e.type, entity: 'doc', entityId: e.dokId, action: e.action, collection: 'deal_documents', source: '/api/deals/{id}/dokumente/{dokId}',
    fieldName: e.fieldName, oldValue: e.oldValue ?? null, newValue: e.newValue, metadata: e.metadata ?? null,
  });
}

async function dealPruefen(db: Db, dealId: string) {
  const [d] = await db.select({ id: schema.deals.id }).from(schema.deals).where(and(eq(schema.deals.id, dealId), isNull(schema.deals.deletedAt)));
  if (!d) throw new FachFehler(404, 'Deal nicht gefunden');
}

/** listDocs: neueste zuerst. */
export async function dokumenteListe(db: Db, dealId: string): Promise<DealDokument[]> {
  await dealPruefen(db, dealId);
  return (await db.select().from(schema.dealDokumente).where(eq(schema.dealDokumente.dealId, dealId)).orderBy(desc(schema.dealDokumente.hochgeladenAm), desc(schema.dealDokumente.id))).map(alsDokument);
}

/**
 * Stapel hochladen (POST /api/docs/:dealId): erst jede Datei prüfen (Signatur), dann schreiben;
 * scheitert das Schreiben, wird Geschriebenes zurückgenommen (deal-docs.ts).
 */
export async function dokumenteHochladen(db: Db, speicher: Dateispeicher, dealId: string, dateien: { name: string; typ: string; bytes: Uint8Array }[]): Promise<DealDokument[]> {
  await dealPruefen(db, dealId);
  if (!dateien.length) throw new FachFehler(400, 'Keine Dateien hochgeladen');
  if (dateien.length > DOKUMENT_GRENZEN.maxDateien) throw new FachFehler(413, `Zu viele Dateien — höchstens ${DOKUMENT_GRENZEN.maxDateien} pro Upload.`);
  const zuGross = dateien.find((d) => d.bytes.byteLength > DOKUMENT_GRENZEN.maxBytes);
  if (zuGross) throw new FachFehler(413, `„${zuGross.name}" ist größer als ${DOKUMENT_GRENZEN.maxBytes / 1024 / 1024} MB.`);
  const stapel = pruefeDateien(dateien.map((d) => ({ name: d.name, gemeldeterTyp: d.typ, bytes: Buffer.from(d.bytes) })));
  if (!stapel.ok) {
    throw new FachFehler(415, stapel.grund, { hint: 'Erlaubt sind PDF, Bilder, Office-Dateien und Text. Es wurde nichts gespeichert — bitte die beanstandete Datei aus der Auswahl nehmen und erneut hochladen.' });
  }
  const geschrieben: { id: string; key: string }[] = [];
  try {
    for (const [i, d] of dateien.entries()) {
      const id = crypto.randomUUID();
      const key = dokumentSchluessel(dealId, id, d.name);
      await speicher.ablegen(BUCKETS.dealDocs, key, d.bytes, stapel.dateien[i]!.mime);
      geschrieben.push({ id, key });
      await db.insert(schema.dealDokumente).values({ id, dealId, dateiname: d.name, mimeType: stapel.dateien[i]!.mime, groesseBytes: d.bytes.byteLength, label: '', istExpose: false, storageKey: key });
    }
  } catch (err) {
    for (const g of geschrieben) {
      await db.delete(schema.dealDokumente).where(eq(schema.dealDokumente.id, g.id)).catch(() => {});
      await speicher.loeschen(BUCKETS.dealDocs, [g.key]).catch(() => {});
    }
    throw err;
  }
  const ids = geschrieben.map((g) => g.id);
  return (await dokumenteListe(db, dealId)).filter((d) => ids.includes(d.id));
}

async function dokument(db: Db, dealId: string, dokId: string) {
  const [d] = await db.select().from(schema.dealDokumente).where(and(eq(schema.dealDokumente.id, dokId), eq(schema.dealDokumente.dealId, dealId)));
  if (!d) throw new FachFehler(404, 'Dokument nicht gefunden');
  return d;
}

/** Datei ausliefern: inline nur für PDF und Bilder, sonst als Download (verhindert Browser-Rendering von HTML etc.). */
export async function dokumentDatei(db: Db, speicher: Dateispeicher, dealId: string, dokId: string) {
  const d = await dokument(db, dealId, dokId);
  const mime = d.mimeType ?? 'application/octet-stream';
  let bytes: Uint8Array;
  try {
    bytes = await speicher.holen(BUCKETS.dealDocs, d.storageKey ?? dokumentSchluessel(dealId, d.id, d.dateiname ?? ''));
  } catch {
    throw new FachFehler(404, 'Datei fehlt in der Ablage');
  }
  const inline = mime === 'application/pdf' || mime.startsWith('image/');
  const name = (d.dateiname ?? 'dokument').replace(/[^\w\s.\-äöüÄÖÜß]/g, '_');
  return { bytes, mime, disposition: `${inline ? 'inline' : 'attachment'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(d.dateiname ?? name)}` };
}

export async function dokumentBezeichnen(db: Db, dealId: string, dokId: string, label: string) {
  const d = await dokument(db, dealId, dokId);
  await db.update(schema.dealDokumente).set({ label }).where(eq(schema.dealDokumente.id, dokId));
  await audit(db, { type: 'mutation', dokId, action: 'update', fieldName: 'label', oldValue: d.label, newValue: label });
  return { ok: true as const };
}

/** Zeile zuerst: scheitert das Entfernen im Bucket, bleibt eine unsichtbare Datei statt eines toten Eintrags. */
export async function dokumentLoeschen(db: Db, speicher: Dateispeicher, dealId: string, dokId: string) {
  const d = await dokument(db, dealId, dokId);
  await db.delete(schema.dealDokumente).where(eq(schema.dealDokumente.id, dokId));
  await audit(db, { type: 'delete', dokId, action: 'delete', metadata: { deal_id: dealId, original_name: d.dateiname } });
  await speicher.loeschen(BUCKETS.dealDocs, [d.storageKey ?? dokumentSchluessel(dealId, d.id, d.dateiname ?? '')]).catch((e) => console.error('[dokumente] Datei nicht gelöscht:', e));
  return { ok: true as const };
}

/** listExposeDocIds: je Deal das Exposé-Dokument (Bezeichnung „Expos…“ vor Dateiname mit „expos“, dann das neueste). */
export async function exposeDokumentIds(db: Db): Promise<Record<string, string>> {
  const zeilen = await db.selectDistinctOn([schema.dealDokumente.dealId], { dealId: schema.dealDokumente.dealId, id: schema.dealDokumente.id })
    .from(schema.dealDokumente)
    .where(or(sql`${schema.dealDokumente.label} ilike 'expos%'`, sql`${schema.dealDokumente.dateiname} ilike '%expos%'`))
    .orderBy(schema.dealDokumente.dealId, sql`(${schema.dealDokumente.label} ilike 'expos%') desc`, desc(schema.dealDokumente.hochgeladenAm));
  return Object.fromEntries(zeilen.map((z) => [z.dealId, z.id]));
}

/**
 * Einheiten aus Mieterliste/Flächenberechnung (POST /api/deals/:dealId/extract-units): PDF zuerst in den Dokumenten des Deals
 * ablegen, dann per KI auslesen. Scheitert die KI, bleibt die Datei im Deal (docId geht mit zurück).
 */
export async function einheitenAusMieterliste(
  db: Db, speicher: Dateispeicher, ki: KiClient | null | undefined, dealId: string, datei: { name: string; typ: string; bytes: Uint8Array } | null,
): Promise<{ docId: string; einheiten: ExtrahierteEinheit[]; pages: number }> {
  if (!datei) throw new FachFehler(400, 'Keine Datei hochgeladen');
  await dealPruefen(db, dealId);
  if (datei.bytes.byteLength > 50 * 1024 * 1024) throw new FachFehler(413, `„${datei.name}" ist größer als 50 MB.`);
  const geprueft = pruefeDateien([{ name: datei.name, gemeldeterTyp: datei.typ, bytes: Buffer.from(datei.bytes) }]);
  if (!geprueft.ok || geprueft.dateien[0]!.mime !== 'application/pdf') {
    throw new FachFehler(415, geprueft.ok ? `„${datei.name}" ist kein PDF.` : geprueft.grund);
  }
  const [dok] = await dokumenteHochladen(db, speicher, dealId, [datei]);
  const docId = dok!.id;
  await db.update(schema.dealDokumente).set({ label: 'Mieterliste (für Einheiten-Extraktion)' }).where(eq(schema.dealDokumente.id, docId));
  try {
    if (!ki) throw new Error('KI ist nicht eingerichtet (ANTHROPIC_API_KEY)');
    const pages = await pdfSeitenzahl(Buffer.from(datei.bytes));
    const a = await einheitenExtrahieren(ki, datei.bytes, pages);
    const b = kostenBuchung(a.model, a.usage, 'deals/extract-units', { deal_id: dealId });
    await auditSchreiben(db, { type: b.type, aiModel: b.ai_model, aiFunction: 'deals/extract-units', source: 'deals/extract-units', inputTokens: b.input_tokens, outputTokens: b.output_tokens, costEur: b.cost_eur, metadata: b.metadata });
    await auditSchreiben(db, { type: 'auto_import', source: '/api/deals/:dealId/extract-units', metadata: { deal_id: dealId, doc_id: docId, einheiten_count: a.wert.length, pages } });
    return { docId, einheiten: a.wert, pages };
  } catch (e) {
    console.error('[deals/extract-units] Einheiten-Extraktion fehlgeschlagen:', e);
    throw new FachFehler(500, `Einheiten-Extraktion fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, {
      docId, hint: 'Das PDF liegt trotzdem im Deal. Anthropic-Key prüfen oder die Einheiten von Hand erfassen.',
    });
  }
}
