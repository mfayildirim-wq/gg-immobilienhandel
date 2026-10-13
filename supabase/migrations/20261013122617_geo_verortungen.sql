CREATE TABLE "fach"."geo_verortungen" (
	"schluessel" text PRIMARY KEY NOT NULL,
	"ergebnis" jsonb,
	"abgerufen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fach"."geo_verortungen" ENABLE ROW LEVEL SECURITY;