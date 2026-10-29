CREATE TABLE "fach"."ki_gespraeche" (
	"id" text PRIMARY KEY NOT NULL,
	"bezug_art" text,
	"bezug_id" text,
	"titel" text NOT NULL,
	"von" text NOT NULL,
	"am" timestamp with time zone NOT NULL,
	"anzahl" integer NOT NULL,
	"nachrichten" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."ki_gespraeche" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "ki_gespraeche_bezug_idx" ON "fach"."ki_gespraeche" USING btree ("bezug_art","bezug_id","am");