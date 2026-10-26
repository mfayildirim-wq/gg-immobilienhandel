CREATE TABLE "fach"."ki_gespraeche" (
	"id" text PRIMARY KEY NOT NULL,
	"bezug_art" text,
	"bezug_id" text,
	"titel" text NOT NULL,
	"nutzer" text NOT NULL,
	"anzahl" integer DEFAULT 0 NOT NULL,
	"nachrichten" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."ki_gespraeche" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "ki_gespraeche_bezug_idx" ON "fach"."ki_gespraeche" USING btree ("bezug_art","bezug_id","updated_at");