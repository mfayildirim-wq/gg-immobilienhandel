CREATE TABLE "fach"."expose_bezeichnungen" (
	"schluessel" text PRIMARY KEY NOT NULL,
	"bezeichnung" text NOT NULL,
	"ziel" text NOT NULL,
	"anzahl" integer DEFAULT 1 NOT NULL,
	"zuletzt" timestamp with time zone DEFAULT now() NOT NULL,
	"erstellt_von" text
);
--> statement-breakpoint
ALTER TABLE "fach"."expose_bezeichnungen" ENABLE ROW LEVEL SECURITY;