import { createHash } from 'node:crypto';
import type { AuditEintrag, AuditFilter, AuditSeite } from '@gg/api-contract';
import { type Db, schema } from '@gg/db';
import {
  AUDIT_ANKER_AKTION, AUDIT_GENESIS, ankerMetadaten, type AuditKettenZeile, kettenHash, ketteRechnen,
} from '@gg/domain';
import { and, asc, count, desc, eq, gte, lte, or, sql } from 'drizzle-orm';

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');
/** MAX_VALUE_BYTES: lange Werte werden gekürzt — die Kürzung ist Teil des Hash-Formats. */
const MAX_WERT = 4096;

export interface AuditEingabe {
  type: string;
  entity?: string | null; entityId?: string | null; action?: string | null; collection?: string | null;
  fieldName?: string | null; oldValue?: unknown; newValue?: unknown;
  aiModel?: string | null; aiFunction?: string | null; inputTokens?: number | null; outputTokens?: number | null; costEur?: number | null;
  source?: string | null; metadata?: unknown;
}

const kuerzen = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  let s: string;
  try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch { return null; }
  if (s.length <= MAX_WERT) return s;
  return `${s.substring(0, MAX_WERT - 30)}…[truncated]`;
};

/** Zeile im Format der Kette: alles auf null normalisiert und gekürzt (auditRowFrom). */
const alsKettenZeile = (e: AuditEingabe, ts = Math.floor(Date.now() / 1000)) => ({
  ts, type: e.type, entity: e.entity ?? null, entity_id: e.entityId ?? null, action: e.action ?? null, collection: e.collection ?? null,
  field_name: e.fieldName ?? null, old_value: kuerzen(e.oldValue), new_value: kuerzen(e.newValue),
  ai_model: e.aiModel ?? null, ai_function: e.aiFunction ?? null, input_tokens: e.inputTokens ?? null, output_tokens: e.outputTokens ?? null,
  cost_eur: e.costEur ?? null, source: e.source ?? null, metadata: kuerzen(e.metadata),
});

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** appendAuditRow: hängt eine Zeile an die Kette. Der Aufrufer hält die Transaktion und die Sperre. */
async function anhaengen(tx: Tx, e: AuditEingabe) {
  const zeile = alsKettenZeile(e);
  const [vorher] = await tx.select({ hash: schema.auditLog.hashChain }).from(schema.auditLog).orderBy(desc(schema.auditLog.id)).limit(1);
  const hashChain = kettenHash(sha256, vorher?.hash ?? AUDIT_GENESIS, zeile);
  const [neu] = await tx.insert(schema.auditLog).values({
    ts: zeile.ts, hashChain, type: zeile.type, entity: zeile.entity, entityId: zeile.entity_id, action: zeile.action, collection: zeile.collection,
    fieldName: zeile.field_name, oldValue: zeile.old_value, newValue: zeile.new_value, aiModel: zeile.ai_model, aiFunction: zeile.ai_function,
    inputTokens: zeile.input_tokens, outputTokens: zeile.output_tokens, costEur: zeile.cost_eur, source: zeile.source, metadata: zeile.metadata,
  }).returning({ id: schema.auditLog.id });
  return neu!.id;
}

/**
 * logAudit: schreibt einen Eintrag samt Hash-Kette. Die Sperre reiht gleichzeitige Schreiber hintereinander,
 * sonst hingen zwei Zeilen am selben Vorgänger. Fehler werden geschluckt — Audit darf nie den Vorgang blockieren.
 */
export async function auditSchreiben(db: Db, e: AuditEingabe): Promise<number | null> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('gg-audit-kette'))`);
      return anhaengen(tx, e);
    });
  } catch (fehler) {
    console.error('[audit] Eintrag nicht geschrieben:', fehler);
    return null;
  }
}

/** fetchAuditLog: Filter wie alt (Typ, Entität, Zeitraum, Suche in Werten/IDs/Metadaten), neueste zuerst. */
export async function auditListe(db: Db, f: AuditFilter): Promise<AuditSeite> {
  const bedingungen = [
    f.type ? eq(schema.auditLog.type, f.type) : undefined,
    f.entity ? eq(schema.auditLog.entity, f.entity) : undefined,
    f.von ? gte(schema.auditLog.ts, Math.floor(Date.parse(`${f.von}T00:00:00Z`) / 1000)) : undefined,
    f.bis ? lte(schema.auditLog.ts, Math.floor(Date.parse(`${f.bis}T23:59:59Z`) / 1000)) : undefined,
    f.suche
      ? or(
        sql`${schema.auditLog.entityId} ilike ${`%${f.suche}%`}`,
        sql`${schema.auditLog.oldValue} ilike ${`%${f.suche}%`}`,
        sql`${schema.auditLog.newValue} ilike ${`%${f.suche}%`}`,
        sql`${schema.auditLog.metadata} ilike ${`%${f.suche}%`}`,
        sql`${schema.auditLog.action} ilike ${`%${f.suche}%`}`,
      )
      : undefined,
  ].filter(Boolean);
  const wo = bedingungen.length ? and(...bedingungen) : undefined;
  const [gesamtZeile] = await db.select({ anzahl: count() }).from(schema.auditLog).where(wo);
  const zeilen = await db.select().from(schema.auditLog).where(wo).orderBy(desc(schema.auditLog.id)).limit(f.limit ?? 500).offset(f.offset ?? 0);
  return {
    gesamt: Number(gesamtZeile?.anzahl ?? 0),
    zeilen: zeilen.map((z): AuditEintrag => ({
      id: z.id, ts: z.ts ?? 0, type: z.type ?? '', entity: z.entity, entityId: z.entityId, action: z.action, collection: z.collection,
      fieldName: z.fieldName, oldValue: z.oldValue, newValue: z.newValue, aiModel: z.aiModel, aiFunction: z.aiFunction,
      inputTokens: z.inputTokens, outputTokens: z.outputTokens, costEur: z.costEur, source: z.source, metadata: z.metadata,
    })),
  };
}

const alleZeilen = async (db: Db): Promise<AuditKettenZeile[]> => (await db.select().from(schema.auditLog).orderBy(asc(schema.auditLog.id)))
  .map((z) => ({
    id: z.id, hash_chain: z.hashChain ?? '', ts: z.ts ?? 0, type: z.type ?? '', entity: z.entity, entity_id: z.entityId, action: z.action,
    collection: z.collection, field_name: z.fieldName, old_value: z.oldValue, new_value: z.newValue, ai_model: z.aiModel, ai_function: z.aiFunction,
    input_tokens: z.inputTokens, output_tokens: z.outputTokens, cost_eur: z.costEur, source: z.source, metadata: z.metadata,
  }));

/**
 * verifyAuditChain: die Kette nachrechnen (das Rechnen liegt in @gg/domain).
 * Zeilen ohne Kettenhash stammen aus der Zeit vor der Hash-Kette; sie werden übersprungen und gezählt.
 */
export async function auditPruefen(db: Db) {
  const zeilen = await alleZeilen(db);
  const erste = zeilen.findIndex((z) => z.hash_chain);
  const ohneKette = erste < 0 ? zeilen.length : erste;
  const befund = ketteRechnen(sha256, erste < 0 ? [] : zeilen.slice(erste));
  const hinweis = ohneKette ? `${ohneKette} Eintrag/Einträge ohne Kettenhash (vor Einführung der Hash-Kette) wurden übersprungen.` : undefined;
  return { ...befund, totalRows: zeilen.length, anker: befund.anker ?? null, note: [befund.note, hinweis].filter(Boolean).join(' ') || undefined };
}

/** Export als JSON oder CSV (alt: /api/audit/export.json bzw. .csv). */
export async function auditExport(db: Db, format: 'json' | 'csv') {
  const { zeilen } = await auditListe(db, { limit: 100_000 });
  if (format === 'json') return { inhalt: JSON.stringify(zeilen, null, 1), mime: 'application/json', name: 'audit-log.json' };
  const spalten = ['id', 'ts', 'type', 'entity', 'entityId', 'action', 'collection', 'fieldName', 'oldValue', 'newValue', 'aiModel', 'aiFunction', 'inputTokens', 'outputTokens', 'costEur', 'source', 'metadata'] as const;
  const feld = (v: unknown) => (v === null || v === undefined ? '' : `"${String(v).replace(/"/g, '""')}"`);
  const csv = [spalten.join(';'), ...zeilen.map((z) => spalten.map((s) => feld(z[s])).join(';'))].join('\n');
  return { inhalt: csv, mime: 'text/csv; charset=utf-8', name: 'audit-log.csv' };
}

/**
 * Aufräumen: alles vor der Altersgrenze entfernen und einen Anker hinterlassen, damit die Prüfung
 * ab dem verbliebenen Anfang weiterrechnet (server/database.ts cleanupAuditOlderThan).
 */
export async function auditAufraeumen(db: Db, tage: number) {
  const grenze = Math.floor(Date.now() / 1000) - tage * 86_400;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('gg-audit-kette'))`);
    const [rand] = await tx.select({ maxId: sql<number | null>`max(${schema.auditLog.id})` }).from(schema.auditLog).where(lte(schema.auditLog.ts, grenze - 1));
    const maxId = rand?.maxId ?? null;
    if (maxId === null) return { entfernt: 0 };
    const [letzte] = await tx.select({ hash: schema.auditLog.hashChain }).from(schema.auditLog).where(eq(schema.auditLog.id, maxId));
    // Die Prüfung beginnt bei der ältesten Zeile mit Kettenhash — der Anker muss auf genau diese zeigen
    const [ersteBleibt] = await tx.select({ id: schema.auditLog.id }).from(schema.auditLog)
      .where(and(sql`${schema.auditLog.id} > ${maxId}`, sql`${schema.auditLog.hashChain} is not null`)).orderBy(asc(schema.auditLog.id)).limit(1);
    const entfernt = await tx.delete(schema.auditLog).where(sql`${schema.auditLog.id} <= ${maxId}`).returning({ id: schema.auditLog.id });
    await anhaengen(tx, {
      type: 'delete', entity: 'audit_log', action: AUDIT_ANKER_AKTION, source: 'services/audit.ts',
      metadata: ankerMetadaten({
        prevHash: letzte?.hash ?? AUDIT_GENESIS, prevId: Number(maxId), firstKeptId: ersteBleibt?.id ?? null,
        deleted: entfernt.length, cutoffTs: grenze,
      }),
    });
    return { entfernt: entfernt.length };
  });
}
