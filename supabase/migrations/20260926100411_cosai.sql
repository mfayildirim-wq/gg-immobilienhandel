CREATE SCHEMA "cosai";
--> statement-breakpoint
CREATE TABLE "cosai"."agenten" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"slug" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"dna" jsonb NOT NULL,
	"fingerabdruck" text,
	"status" text DEFAULT 'aktiv' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosai"."agenten" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cosai"."checkpoint_writes" (
	"thread_id" text NOT NULL,
	"checkpoint_ns" text DEFAULT '' NOT NULL,
	"checkpoint_id" text NOT NULL,
	"task_id" text NOT NULL,
	"idx" integer NOT NULL,
	"channel" text NOT NULL,
	"typ" text NOT NULL,
	"wert" text NOT NULL,
	"task_path" text DEFAULT '' NOT NULL,
	CONSTRAINT "checkpoint_writes_thread_id_checkpoint_ns_checkpoint_id_task_id_idx_pk" PRIMARY KEY("thread_id","checkpoint_ns","checkpoint_id","task_id","idx")
);
--> statement-breakpoint
ALTER TABLE "cosai"."checkpoint_writes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cosai"."checkpoints" (
	"thread_id" text NOT NULL,
	"checkpoint_ns" text DEFAULT '' NOT NULL,
	"checkpoint_id" text NOT NULL,
	"parent_checkpoint_id" text,
	"typ" text NOT NULL,
	"checkpoint" text NOT NULL,
	"metadata" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkpoints_thread_id_checkpoint_ns_checkpoint_id_pk" PRIMARY KEY("thread_id","checkpoint_ns","checkpoint_id")
);
--> statement-breakpoint
ALTER TABLE "cosai"."checkpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cosai"."ereignisse" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"nutzer" text NOT NULL,
	"sitzung_id" text,
	"richtung" text NOT NULL,
	"art" text NOT NULL,
	"ziel" text,
	"wert" text,
	"kontext" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosai"."ereignisse" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cosai"."faehigkeiten" (
	"name" text PRIMARY KEY NOT NULL,
	"beschreibung" text NOT NULL,
	"methode" text,
	"pfad" text,
	"lesend" boolean NOT NULL,
	"schema" jsonb,
	"fingerabdruck" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosai"."faehigkeiten" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cosai"."gedaechtnis" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"nutzer" text NOT NULL,
	"art" text NOT NULL,
	"schluessel" text NOT NULL,
	"inhalt" text NOT NULL,
	"kontext" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"haeufigkeit" integer DEFAULT 1 NOT NULL,
	"bestaetigt" boolean DEFAULT false NOT NULL,
	"zuletzt" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosai"."gedaechtnis" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cosai"."laeufe" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"sitzung_id" text NOT NULL,
	"status" text DEFAULT 'laeuft' NOT NULL,
	"wartet_auf" jsonb,
	"fehler" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosai"."laeufe" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cosai"."nachrichten" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"sitzung_id" text NOT NULL,
	"rolle" text NOT NULL,
	"text" text NOT NULL,
	"steuerung" jsonb,
	"chips" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosai"."nachrichten" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cosai"."sitzungen" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"nutzer" text NOT NULL,
	"agent" text DEFAULT 'meister' NOT NULL,
	"ort" text,
	"kontext" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cosai"."sitzungen" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cosai"."vorschlaege" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"nutzer" text NOT NULL,
	"sitzung_id" text,
	"label" text NOT NULL,
	"wert" text NOT NULL,
	"entscheidung" text,
	"kontext" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entschieden_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cosai"."vorschlaege" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "cosai_agenten_slug_version" ON "cosai"."agenten" USING btree ("slug","version");--> statement-breakpoint
CREATE INDEX "cosai_ereignisse_nutzer" ON "cosai"."ereignisse" USING btree ("nutzer","created_at");--> statement-breakpoint
CREATE INDEX "cosai_gedaechtnis_nutzer_schluessel" ON "cosai"."gedaechtnis" USING btree ("nutzer","art","schluessel");--> statement-breakpoint
CREATE UNIQUE INDEX "cosai_gedaechtnis_formulierung" ON "cosai"."gedaechtnis" USING btree ("nutzer","art","schluessel","inhalt");--> statement-breakpoint
CREATE INDEX "cosai_laeufe_sitzung" ON "cosai"."laeufe" USING btree ("sitzung_id","created_at");--> statement-breakpoint
CREATE INDEX "cosai_nachrichten_sitzung" ON "cosai"."nachrichten" USING btree ("sitzung_id","created_at");--> statement-breakpoint
CREATE INDEX "cosai_sitzungen_nutzer" ON "cosai"."sitzungen" USING btree ("nutzer","updated_at");--> statement-breakpoint
CREATE INDEX "cosai_vorschlaege_nutzer" ON "cosai"."vorschlaege" USING btree ("nutzer","created_at");