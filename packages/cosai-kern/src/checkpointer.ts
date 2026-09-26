/**
 * LangGraph-Checkpoints in der Datenbank der Host-App (Tabellen `cosai.checkpoints`, `cosai.checkpoint_writes`).
 *
 * Damit ist ein Lauf eine Folge kurzer Aufrufe: nach jedem Knoten liegt der Zustand in der Datenbank, eine
 * Unterbrechung („abschicken?“) kann Stunden offen bleiben, und der nächste Aufruf — aus dem Browser oder einem
 * Cron — nimmt genau dort wieder auf. Ein Dauerprozess ist nicht nötig (Vercel-Functions enden nach 300 s).
 * Nach dem Muster des MemorySaver aus `@langchain/langgraph-checkpoint`; Thread = Sitzung.
 */
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver, copyCheckpoint, getCheckpointId, WRITES_IDX_MAP,
  type ChannelVersions, type Checkpoint, type CheckpointListOptions, type CheckpointMetadata, type CheckpointTuple, type PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { Db } from './gedaechtnis.ts';
import { checkpointWrites, checkpoints } from './schema.ts';

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));

export class DrizzleSaver extends BaseCheckpointSaver {
  constructor(private readonly db: Db) {
    super();
  }

  private async schreibungen(threadId: string, ns: string, checkpointId: string) {
    const zeilen = await this.db.select().from(checkpointWrites)
      .where(and(eq(checkpointWrites.threadId, threadId), eq(checkpointWrites.checkpointNs, ns), eq(checkpointWrites.checkpointId, checkpointId)))
      .orderBy(asc(checkpointWrites.taskId), asc(checkpointWrites.idx));
    return Promise.all(zeilen.map(async (z) => [z.taskId, z.channel, await this.serde.loadsTyped(z.typ, bytes(z.wert))] as [string, string, unknown]));
  }

  private async tupel(z: typeof checkpoints.$inferSelect): Promise<CheckpointTuple> {
    const t: CheckpointTuple = {
      config: { configurable: { thread_id: z.threadId, checkpoint_ns: z.checkpointNs, checkpoint_id: z.checkpointId } },
      checkpoint: await this.serde.loadsTyped(z.typ, bytes(z.checkpoint)),
      metadata: await this.serde.loadsTyped(z.typ, bytes(z.metadata)),
      pendingWrites: await this.schreibungen(z.threadId, z.checkpointNs, z.checkpointId),
    };
    if (z.parentCheckpointId) t.parentConfig = { configurable: { thread_id: z.threadId, checkpoint_ns: z.checkpointNs, checkpoint_id: z.parentCheckpointId } };
    return t;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) return undefined;
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const checkpointId = getCheckpointId(config);
    const wo = checkpointId
      ? and(eq(checkpoints.threadId, threadId), eq(checkpoints.checkpointNs, ns), eq(checkpoints.checkpointId, checkpointId))
      : and(eq(checkpoints.threadId, threadId), eq(checkpoints.checkpointNs, ns));
    const [z] = await this.db.select().from(checkpoints).where(wo).orderBy(desc(checkpoints.checkpointId)).limit(1);
    return z ? this.tupel(z) : undefined;
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const ns = config.configurable?.checkpoint_ns as string | undefined;
    const vor = options?.before?.configurable?.checkpoint_id as string | undefined;
    const bedingungen = [
      threadId ? eq(checkpoints.threadId, threadId) : undefined,
      ns !== undefined ? eq(checkpoints.checkpointNs, ns) : undefined,
      vor ? lt(checkpoints.checkpointId, vor) : undefined,
    ].filter((b): b is NonNullable<typeof b> => !!b);
    let abfrage = this.db.select().from(checkpoints).where(and(...bedingungen)).orderBy(desc(checkpoints.checkpointId)).$dynamic();
    if (options?.limit !== undefined) abfrage = abfrage.limit(options.limit);
    for (const z of await abfrage) {
      const t = await this.tupel(z);
      if (options?.filter && !Object.entries(options.filter).every(([k, v]) => (t.metadata as Record<string, unknown> | undefined)?.[k] === v)) continue;
      yield t;
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, _newVersions: ChannelVersions): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) throw new Error('Checkpoint ohne thread_id (Sitzung)');
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    const [[typ, cp], [, meta]] = await Promise.all([this.serde.dumpsTyped(copyCheckpoint(checkpoint)), this.serde.dumpsTyped(metadata)]);
    const zeile = { threadId, checkpointNs: ns, checkpointId: checkpoint.id, parentCheckpointId: (config.configurable?.checkpoint_id as string | undefined) ?? null, typ, checkpoint: b64(cp), metadata: b64(meta) };
    await this.db.insert(checkpoints).values(zeile).onConflictDoUpdate({ target: [checkpoints.threadId, checkpoints.checkpointNs, checkpoints.checkpointId], set: zeile });
    return { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (!threadId || !checkpointId) throw new Error('Schreibungen ohne thread_id/checkpoint_id');
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? '';
    for (const [i, [channel, wert]] of writes.entries()) {
      const [typ, daten] = await this.serde.dumpsTyped(wert);
      const idx = WRITES_IDX_MAP[channel] ?? i;
      const zeile = { threadId, checkpointNs: ns, checkpointId, taskId, idx, channel, typ, wert: b64(daten) };
      // Feste Kanäle (Fehler, Unterbrechung) überschreiben, nummerierte nur einmal schreiben — wie der MemorySaver
      if (idx >= 0) await this.db.insert(checkpointWrites).values(zeile).onConflictDoNothing();
      else await this.db.insert(checkpointWrites).values(zeile).onConflictDoUpdate({ target: [checkpointWrites.threadId, checkpointWrites.checkpointNs, checkpointWrites.checkpointId, checkpointWrites.taskId, checkpointWrites.idx], set: zeile });
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.db.delete(checkpointWrites).where(eq(checkpointWrites.threadId, threadId));
    await this.db.delete(checkpoints).where(eq(checkpoints.threadId, threadId));
  }
}
