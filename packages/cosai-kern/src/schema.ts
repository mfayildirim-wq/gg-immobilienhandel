/**
 * Das Schema `cosai` — die Bibliothek bringt es mit, die Host-App spielt es in ihre Datenbank ein
 * (gg-immo: Re-Export in `packages/db/src/schema.ts` → `pnpm db:generate`; Python: Alembic).
 *
 * Fachdaten des Hosts werden nie per Fremdschlüssel referenziert, nur als Werte in `kontext` — so bleibt
 * das Schema hostunabhängig und die Fachtabellen bleiben unberührt. Alles Persönliche hängt an `nutzer`.
 */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const cosai = pgSchema('cosai');

const zeit = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const jetzt = (name: string) => zeit(name).notNull().defaultNow();
const kennung = () => text('id').primaryKey().default(sql`gen_random_uuid()::text`);

/** DNAs der Agenten — versioniert, mit Fingerabdruck der Oberfläche/OpenAPI, gegen den sie entworfen wurden. */
export const agenten = cosai.table('agenten', {
  id: kennung(),
  slug: text('slug').notNull(),
  version: integer('version').notNull().default(1),
  dna: jsonb('dna').notNull(),
  fingerabdruck: text('fingerabdruck'),
  /** aktiv · zu_pruefen · abgeloest */
  status: text('status').notNull().default('aktiv'),
  createdAt: jetzt('created_at'),
  updatedAt: jetzt('updated_at'),
}, (t) => [uniqueIndex('cosai_agenten_slug_version').on(t.slug, t.version)]).enableRLS();

/** Der Werkzeugkatalog, wie er zuletzt aus OpenAPI/MCP gelesen wurde. */
export const faehigkeiten = cosai.table('faehigkeiten', {
  name: text('name').primaryKey(),
  beschreibung: text('beschreibung').notNull(),
  methode: text('methode'),
  pfad: text('pfad'),
  lesend: boolean('lesend').notNull(),
  schema: jsonb('schema'),
  fingerabdruck: text('fingerabdruck'),
  updatedAt: jetzt('updated_at'),
}).enableRLS();

export const sitzungen = cosai.table('sitzungen', {
  id: kennung(),
  nutzer: text('nutzer').notNull(),
  /** Slug des Agenten (DNA), der die Sitzung führt */
  agent: text('agent').notNull().default('meister'),
  ort: text('ort'),
  kontext: jsonb('kontext').notNull().default({}),
  createdAt: jetzt('created_at'),
  updatedAt: jetzt('updated_at'),
}, (t) => [index('cosai_sitzungen_nutzer').on(t.nutzer, t.updatedAt)]).enableRLS();

export const nachrichten = cosai.table('nachrichten', {
  id: kennung(),
  sitzungId: text('sitzung_id').notNull(),
  /** nutzer · agent · system */
  rolle: text('rolle').notNull(),
  text: text('text').notNull(),
  steuerung: jsonb('steuerung'),
  chips: jsonb('chips'),
  createdAt: jetzt('created_at'),
}, (t) => [index('cosai_nachrichten_sitzung').on(t.sitzungId, t.createdAt)]).enableRLS();

/** Der Kanal, protokolliert: Beobachtungen der Oberfläche und Steuerungen des Agenten. */
export const ereignisse = cosai.table('ereignisse', {
  id: kennung(),
  nutzer: text('nutzer').notNull(),
  sitzungId: text('sitzung_id'),
  /** beobachtung · steuerung */
  richtung: text('richtung').notNull(),
  art: text('art').notNull(),
  ziel: text('ziel'),
  wert: text('wert'),
  kontext: jsonb('kontext').notNull().default({}),
  createdAt: jetzt('created_at'),
}, (t) => [index('cosai_ereignisse_nutzer').on(t.nutzer, t.createdAt)]).enableRLS();

/** Episoden, Formulierungen, Fakten, Routinen — je Nutzer, sichtbar und löschbar. */
export const gedaechtnis = cosai.table('gedaechtnis', {
  id: kennung(),
  nutzer: text('nutzer').notNull(),
  art: text('art').notNull(),
  schluessel: text('schluessel').notNull(),
  inhalt: text('inhalt').notNull(),
  kontext: jsonb('kontext').notNull().default({}),
  haeufigkeit: integer('haeufigkeit').notNull().default(1),
  bestaetigt: boolean('bestaetigt').notNull().default(false),
  zuletzt: jetzt('zuletzt'),
  createdAt: jetzt('created_at'),
}, (t) => [
  index('cosai_gedaechtnis_nutzer_schluessel').on(t.nutzer, t.art, t.schluessel),
  // Episoden sind immer neu; Formulierungen, Fakten und Routinen zählen bei gleichem Inhalt hoch
  uniqueIndex('cosai_gedaechtnis_formulierung').on(t.nutzer, t.art, t.schluessel, t.inhalt).where(sql`art <> 'episode'`),
]).enableRLS();

/** Ein Graph-Lauf je Sitzung — Kopf; der Zustand liegt in den Checkpoints. */
export const laeufe = cosai.table('laeufe', {
  id: kennung(),
  sitzungId: text('sitzung_id').notNull(),
  /** laeuft · wartet · fertig · fehler */
  status: text('status').notNull().default('laeuft'),
  wartetAuf: jsonb('wartet_auf'),
  fehler: text('fehler'),
  createdAt: jetzt('created_at'),
  updatedAt: jetzt('updated_at'),
}, (t) => [index('cosai_laeufe_sitzung').on(t.sitzungId, t.createdAt)]).enableRLS();

/** LangGraph-Checkpoints (Thread = Sitzung). Serialisiert vom Kern, nie von Hand gelesen. */
export const checkpoints = cosai.table('checkpoints', {
  threadId: text('thread_id').notNull(),
  checkpointNs: text('checkpoint_ns').notNull().default(''),
  checkpointId: text('checkpoint_id').notNull(),
  parentCheckpointId: text('parent_checkpoint_id'),
  typ: text('typ').notNull(),
  checkpoint: text('checkpoint').notNull(),
  metadata: text('metadata').notNull(),
  createdAt: jetzt('created_at'),
}, (t) => [primaryKey({ columns: [t.threadId, t.checkpointNs, t.checkpointId] })]).enableRLS();

export const checkpointWrites = cosai.table('checkpoint_writes', {
  threadId: text('thread_id').notNull(),
  checkpointNs: text('checkpoint_ns').notNull().default(''),
  checkpointId: text('checkpoint_id').notNull(),
  taskId: text('task_id').notNull(),
  idx: integer('idx').notNull(),
  channel: text('channel').notNull(),
  typ: text('typ').notNull(),
  wert: text('wert').notNull(),
  taskPath: text('task_path').notNull().default(''),
}, (t) => [primaryKey({ columns: [t.threadId, t.checkpointNs, t.checkpointId, t.taskId, t.idx] })]).enableRLS();

/** Vorschläge (Chips, Todos) mit der Entscheidung des Nutzers — für Routinen und Häufigkeiten. */
export const vorschlaege = cosai.table('vorschlaege', {
  id: kennung(),
  nutzer: text('nutzer').notNull(),
  sitzungId: text('sitzung_id'),
  label: text('label').notNull(),
  wert: text('wert').notNull(),
  entscheidung: text('entscheidung'),
  kontext: jsonb('kontext').notNull().default({}),
  createdAt: jetzt('created_at'),
  entschiedenAt: zeit('entschieden_at'),
}, (t) => [index('cosai_vorschlaege_nutzer').on(t.nutzer, t.createdAt)]).enableRLS();
